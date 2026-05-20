import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { generate, extractJson, BASE_SYSTEM, llmErrorToResponse } from '@/lib/llm';
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

    const parsed = Schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
    const { articleId } = parsed.data;

    const article = await prisma.article.findFirst({ where: { id: articleId, userId: user.id } });
    if (!article) return NextResponse.json({ error: 'Article not found' }, { status: 404 });

    const keywords = JSON.parse(article.keywords || '[]') as string[];
    if (keywords.length === 0) {
      return NextResponse.json({ error: 'まずキーワードを設定してください' }, { status: 400 });
    }

    const result = await generate({
      logicalModel: 'balanced',
      taskType: 'title',
      system: BASE_SYSTEM,
      user: TITLE_GENERATION_PROMPT({
        keywords,
        persona: '自動推定（後続ステップで詳細化）',
      }),
      maxTokens: 4000,
      jsonMode: true,
    });

    const json = extractJson<{ titles: TitleResult[] }>(result.content);
    if (!Array.isArray(json.titles)) {
      return NextResponse.json({ error: 'AI出力の形式が想定外でした。再試行してください。' }, { status: 502 });
    }

    return NextResponse.json({ titles: json.titles });
  } catch (err) {
    console.error('[titles]', err);
    const { status, body } = llmErrorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
