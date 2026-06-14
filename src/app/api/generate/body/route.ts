import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { generate, BASE_SYSTEM, type LogicalModel, llmErrorToResponse } from '@/lib/llm';
import { BODY_GENERATION_PROMPT } from '@/lib/prompts';
import { analyzeCompetitors, fetchWebContext } from '@/lib/competitorAnalysis';
import { computeTargetChars, expandBodyIfShort } from '@/lib/bodyExpand';
import { z } from 'zod';

const Schema = z.object({
  articleId: z.string(),
  model: z.enum(['low_cost', 'balanced', 'high_quality']).optional(),
});

function buildHeadingTreeText(
  headings: Array<{ id: string; level: number; text: string; parentId: string | null; order: number }>,
): string {
  const sorted = [...headings].sort((a, b) => a.order - b.order);
  return sorted.map((h) => `${'#'.repeat(h.level)} ${h.text}`).join('\n');
}

function extractMetaDescription(html: string): { html: string; meta: string } {
  const m = html.match(/<!--\s*META:\s*([\s\S]*?)\s*-->/i);
  if (!m) return { html, meta: '' };
  return {
    html: html.replace(m[0], '').trim(),
    meta: m[1].trim(),
  };
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();

    const parsed = Schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
    const { articleId, model } = parsed.data;
    const logicalModel: LogicalModel = model ?? 'balanced';

    const article = await prisma.article.findFirst({
      where: { id: articleId, userId: user.id },
      include: { headings: true },
    });
    if (!article) return NextResponse.json({ error: 'Article not found' }, { status: 404 });

    const keywords = JSON.parse(article.keywords || '[]') as string[];
    if (keywords.length === 0 || !article.title || article.headings.length === 0) {
      return NextResponse.json({ error: 'キーワード/タイトル/見出しが揃っていません' }, { status: 400 });
    }

    await prisma.article.update({ where: { id: articleId }, data: { status: 'generating' } });

    try {
      // 参考情報(ユーザー入力) + Web検索(任意)を webContext として組み立て
      const contextParts: string[] = [];
      if (article.referenceInfo && article.referenceInfo.trim()) {
        contextParts.push(`【ユーザー提供の参考情報（最優先で反映）】\n${article.referenceInfo.trim()}`);
      }
      if (article.useWebSearch) {
        const web = await fetchWebContext(`${article.title} ${keywords.join(' ')}`);
        if (web) contextParts.push(`【Web検索で取得した最新情報】\n${web}`);
      }
      const webContext = contextParts.length > 0 ? contextParts.join('\n\n') : undefined;

      // 内部リンク用: 同ユーザーの他記事(完了済み優先)を最大20件
      const siblings = await prisma.article.findMany({
        where: { userId: user.id, id: { not: articleId }, title: { not: '' } },
        select: { id: true, title: true },
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
        take: 20,
      });
      const relatedArticles = siblings.map((s) => ({ id: s.id, title: s.title }));

      // 競合分析（targetChars / 必須トピック / 競合見出し を本文に反映＝競合超え）
      let competitorHeadings: string | undefined;
      let commonTopics: string[] | undefined;
      let avgWordCount: number | undefined;
      let cooccurrenceWords: string[] | undefined = article.cooccurrenceWords
        ? JSON.parse(article.cooccurrenceWords)
        : undefined;
      try {
        const a = await analyzeCompetitors(keywords.join(' '), { maxPages: 8 });
        if (a.competitorHeadingsText) competitorHeadings = a.competitorHeadingsText;
        if (a.commonTopics.length) commonTopics = a.commonTopics;
        if (a.avgWordCount) avgWordCount = a.avgWordCount;
        if (a.cooccurrenceWords.length) cooccurrenceWords = a.cooccurrenceWords;
      } catch (e) {
        console.warn('[body] competitor analysis skipped:', (e as Error).message);
      }
      const targetChars = computeTargetChars(avgWordCount);

      const result = await generate({
        logicalModel,
        taskType: 'body',
        system: BASE_SYSTEM,
        user: BODY_GENERATION_PROMPT({
          keywords,
          title: article.title,
          persona: article.persona || '自動推定',
          searchIntent: article.searchIntent || 'informational',
          latentNeeds: article.latentNeeds ? JSON.parse(article.latentNeeds) : [],
          headingTree: buildHeadingTreeText(article.headings),
          toneSample: article.toneSample || undefined,
          volumeSpec: article.volumeSpec || undefined,
          cooccurrenceWords,
          webContext,
          relatedArticles,
          targetChars,
          competitorHeadings,
          commonTopics,
        }),
        maxTokens: 16000,
        temperature: 0.65,
      });

      const extracted = extractMetaDescription(result.content);
      // 競合超えの分量・網羅に満たなければ自動増補（最大2回・既存構造は保持）
      const exp = await expandBodyIfShort({
        html: extracted.html,
        title: article.title,
        targetChars,
        commonTopics,
        logicalModel,
      });
      const html = exp.html;
      const meta = extracted.meta;

      await prisma.article.update({
        where: { id: articleId },
        data: {
          bodyHtml: html,
          metaDescription: meta,
          modelUsed: result.actualModel,
          status: 'completed',
        },
      });

      return NextResponse.json({ bodyHtml: html, metaDescription: meta, targetChars, expandPasses: exp.passes, model: result.actualModel });
    } catch (err) {
      await prisma.article.update({ where: { id: articleId }, data: { status: 'failed' } });
      throw err;
    }
  } catch (err) {
    console.error('[body]', err);
    const { status, body } = llmErrorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
