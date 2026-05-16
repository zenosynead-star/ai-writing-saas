import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { consumeCredits, CREDIT_COST } from '@/lib/credits';
import { generate, extractJson, BASE_SYSTEM, sanitizeUserInput } from '@/lib/llm';
import { KEYWORD_EXPLORE_PROMPT } from '@/lib/prompts';
import { z } from 'zod';

const Schema = z.object({
  articleId: z.string(),
  theme: z.string().min(1).max(200),
});

interface KeywordResult {
  keyword: string;
  search_intent: string;
  estimated_competition: string;
  estimated_volume?: number;
  rationale: string;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const parsed = Schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'Invalid' }, { status: 400 });
    const { articleId, theme } = parsed.data;

    const article = await prisma.article.findFirst({ where: { id: articleId, userId: user.id } });
    if (!article) return NextResponse.json({ error: 'Article not found' }, { status: 404 });

    const cost = CREDIT_COST.keyword_theme;
    if (user.currentCredits < cost) {
      return NextResponse.json({ error: 'クレジットが不足しています' }, { status: 402 });
    }

    const result = await generate({
      logicalModel: 'balanced',
      taskType: 'keyword',
      system: BASE_SYSTEM,
      user: KEYWORD_EXPLORE_PROMPT({ theme: sanitizeUserInput(theme), language: user.language }),
      maxTokens: 3000,
      cacheSystem: true,
    });

    const json = extractJson<{ keywords: KeywordResult[] }>(result.content);
    if (!Array.isArray(json.keywords)) {
      throw new Error('Invalid keyword response shape');
    }

    await consumeCredits({
      userId: user.id,
      amount: cost,
      description: `キーワード探索: ${theme}`,
      relatedResourceId: articleId,
    });

    await prisma.article.update({
      where: { id: articleId },
      data: { totalCreditsUsed: { increment: cost } },
    });

    return NextResponse.json({ keywords: json.keywords });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
