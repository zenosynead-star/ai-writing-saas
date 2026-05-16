import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { consumeCredits, CREDIT_COST } from '@/lib/credits';
import { generate, extractJson, BASE_SYSTEM } from '@/lib/llm';
import { TITLE_GENERATION_PROMPT } from '@/lib/prompts';
import { z } from 'zod';

const Schema = z.object({ articleId: z.string() });

interface TitleResult {
  title: string;
  type: string;
  char_count: number;
  appeal_point: string;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const parsed = Schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'Invalid' }, { status: 400 });
    const { articleId } = parsed.data;

    const article = await prisma.article.findFirst({ where: { id: articleId, userId: user.id } });
    if (!article) return NextResponse.json({ error: 'Article not found' }, { status: 404 });

    const keywords = JSON.parse(article.keywords || '[]') as string[];
    if (keywords.length === 0) {
      return NextResponse.json({ error: 'まずキーワードを設定してください' }, { status: 400 });
    }

    const cost = CREDIT_COST.title_generation;
    if (user.currentCredits < cost) {
      return NextResponse.json({ error: 'クレジットが不足しています' }, { status: 402 });
    }

    const result = await generate({
      logicalModel: 'balanced',
      taskType: 'title',
      system: BASE_SYSTEM,
      user: TITLE_GENERATION_PROMPT({
        keywords,
        persona: '自動推定（後続ステップで詳細化）',
      }),
      maxTokens: 2000,
      cacheSystem: true,
    });

    const json = extractJson<{ titles: TitleResult[] }>(result.content);
    if (!Array.isArray(json.titles)) throw new Error('Invalid title response shape');

    await consumeCredits({
      userId: user.id,
      amount: cost,
      description: 'タイトル生成',
      relatedResourceId: articleId,
    });

    await prisma.article.update({
      where: { id: articleId },
      data: { totalCreditsUsed: { increment: cost } },
    });

    return NextResponse.json({ titles: json.titles });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
