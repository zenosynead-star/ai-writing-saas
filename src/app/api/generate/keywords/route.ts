import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { generate, extractJson, BASE_SYSTEM, sanitizeUserInput, llmErrorToResponse } from '@/lib/llm';
import { KEYWORD_EXPLORE_PROMPT } from '@/lib/prompts';
import { analyzeCompetitors } from '@/lib/competitorAnalysis';
import { z } from 'zod';

const Schema = z.object({
  articleId: z.string(),
  theme: z.string().min(1).max(200),
  useCompetitorAnalysis: z.boolean().optional(),
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

    const parsed = Schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
    const { articleId, theme, useCompetitorAnalysis } = parsed.data;

    const article = await prisma.article.findFirst({ where: { id: articleId, userId: user.id } });
    if (!article) return NextResponse.json({ error: 'Article not found' }, { status: 404 });

    // 競合分析: テーマで実際に上位表示されている記事のタイトル・共起語を取得
    let competitorTitles: string[] | undefined;
    let cooccurrenceWords: string[] | undefined;
    if (useCompetitorAnalysis !== false) {
      try {
        const analysis = await analyzeCompetitors(theme, { maxPages: 6 });
        if (analysis.competitorTitles.length > 0) competitorTitles = analysis.competitorTitles;
        if (analysis.cooccurrenceWords.length > 0) cooccurrenceWords = analysis.cooccurrenceWords;
      } catch (e) {
        console.warn('[keywords] competitor analysis failed, continuing without:', (e as Error).message);
      }
    }

    const result = await generate({
      logicalModel: 'balanced',
      taskType: 'keyword',
      system: BASE_SYSTEM,
      user: KEYWORD_EXPLORE_PROMPT({
        theme: sanitizeUserInput(theme),
        language: user.language,
        competitorTitles,
        cooccurrenceWords,
      }),
      maxTokens: 8000,
      jsonMode: true,
    });

    const json = extractJson<{ keywords: KeywordResult[] }>(result.content);
    if (!Array.isArray(json.keywords)) {
      return NextResponse.json({ error: 'AI出力の形式が想定外でした。再試行してください。' }, { status: 502 });
    }

    return NextResponse.json({
      keywords: json.keywords,
      competitorTitles: competitorTitles ?? [],
    });
  } catch (err) {
    console.error('[keywords]', err);
    const { status, body } = llmErrorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
