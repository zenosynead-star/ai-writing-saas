import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { generate, extractJson, BASE_SYSTEM, sanitizeUserInput, llmErrorToResponse } from '@/lib/llm';
import { HEADING_GENERATION_PROMPT } from '@/lib/prompts';
import { validateHeadingTree } from '@/lib/headings';
import { analyzeCompetitors } from '@/lib/competitorAnalysis';
import { z } from 'zod';

const Schema = z.object({
  articleId: z.string(),
  customInstruction: z.string().max(2000).optional(),
  /** false にすると競合分析をスキップ（高速・無料枠節約） */
  useCompetitorAnalysis: z.boolean().optional(),
});

interface HeadingResult {
  estimated_persona: string;
  search_intent: string;
  latent_needs: string[];
  headings: Array<{ level: number; text: string; children: HeadingResult['headings'] }>;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();

    const parsed = Schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
    const { articleId, customInstruction, useCompetitorAnalysis } = parsed.data;

    const article = await prisma.article.findFirst({ where: { id: articleId, userId: user.id } });
    if (!article) return NextResponse.json({ error: 'Article not found' }, { status: 404 });

    const keywords = JSON.parse(article.keywords || '[]') as string[];
    if (keywords.length === 0) {
      return NextResponse.json({ error: 'まずキーワードを設定してください' }, { status: 400 });
    }

    // 競合分析（リテラ相当）: 上位サイトの見出し + 共起語を取得してプロンプトに注入
    let competitorHeadings: string | undefined;
    let cooccurrenceWords: string[] | undefined;
    let avgWordCount: number | undefined;
    let competitorMeta: { sources: number; avgWordCount: number } | undefined;
    if (useCompetitorAnalysis !== false) {
      try {
        const analysis = await analyzeCompetitors(keywords.join(' '), { maxPages: 6 });
        if (analysis.competitorHeadingsText) competitorHeadings = analysis.competitorHeadingsText;
        if (analysis.cooccurrenceWords.length > 0) cooccurrenceWords = analysis.cooccurrenceWords;
        if (analysis.avgWordCount > 0) avgWordCount = analysis.avgWordCount;
        competitorMeta = { sources: analysis.sources.length, avgWordCount: analysis.avgWordCount };
      } catch (e) {
        console.warn('[headings] competitor analysis failed, continuing without:', (e as Error).message);
      }
    }

    const result = await generate({
      logicalModel: 'balanced',
      taskType: 'heading',
      system: BASE_SYSTEM,
      user: HEADING_GENERATION_PROMPT({
        keywords,
        competitorHeadings,
        cooccurrenceWords,
        avgWordCount,
        userCustomInstruction: customInstruction ? sanitizeUserInput(customInstruction) : undefined,
      }),
      maxTokens: 8000,
      jsonMode: true,
    });

    const json = extractJson<HeadingResult>(result.content);
    if (!validateHeadingTree(json.headings)) {
      return NextResponse.json({ error: 'AI出力の構造が想定外でした。再試行してください。' }, { status: 502 });
    }

    // 共起語を Article に保存（本文生成時に再利用するため）
    await prisma.article.update({
      where: { id: articleId },
      data: {
        persona: json.estimated_persona || article.persona,
        searchIntent: json.search_intent || article.searchIntent,
        latentNeeds: JSON.stringify(json.latent_needs || []),
        cooccurrenceWords: cooccurrenceWords ? JSON.stringify(cooccurrenceWords) : null,
      },
    });

    return NextResponse.json({
      estimated_persona: json.estimated_persona,
      search_intent: json.search_intent,
      latent_needs: json.latent_needs,
      headings: json.headings,
      competitor: competitorMeta,
      cooccurrenceWords: cooccurrenceWords ?? [],
    });
  } catch (err) {
    console.error('[headings]', err);
    const { status, body } = llmErrorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
