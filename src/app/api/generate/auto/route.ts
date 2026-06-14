import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { generate, extractJson, BASE_SYSTEM, llmErrorToResponse } from '@/lib/llm';
import { TITLE_GENERATION_PROMPT, HEADING_GENERATION_PROMPT, BODY_GENERATION_PROMPT } from '@/lib/prompts';
import { analyzeCompetitors, fetchWebContext } from '@/lib/competitorAnalysis';
import { computeTargetChars, clampTargetChars, expandBodyIfShort } from '@/lib/bodyExpand';
import { pickProductId, getProductById, buildRecommendedProductBrief } from '@/lib/productRules';
import { validateHeadingTree } from '@/lib/headings';
import { z } from 'zod';

/**
 * ワンショット自動生成: キーワードだけで タイトル→見出し(競合分析)→本文 を一気通貫生成する。
 * 各ステップは内部で generate() を使うため、年号最新化・装飾・TEXT_PROVIDER(claude/gemini) が自動適用される。
 */
const Schema = z.object({
  articleId: z.string(),
  useCompetitorAnalysis: z.boolean().optional(),
  useWebSearch: z.boolean().optional(),
  model: z.enum(['low_cost', 'balanced', 'high_quality']).optional(),
  /** 手動の目標文字数（指定時は競合分析より優先。[3500,50000] にクランプ）。 */
  targetCharsOverride: z.number().int().positive().max(60000).optional(),
});

interface TitleResult { title: string }
interface HeadingNode { level: number; text: string; children: HeadingNode[] }
interface HeadingResult {
  estimated_persona: string;
  search_intent: string;
  latent_needs: string[];
  headings: HeadingNode[];
}

function headingTreeToText(tree: HeadingNode[]): string {
  const lines: string[] = [];
  const walk = (nodes: HeadingNode[]) => {
    for (const n of nodes) {
      lines.push(`${'#'.repeat(n.level)} ${n.text}`);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(tree);
  return lines.join('\n');
}

async function saveHeadingTree(articleId: string, tree: HeadingNode[]) {
  await prisma.articleHeading.deleteMany({ where: { articleId } });
  let order = 0;
  const walk = async (nodes: HeadingNode[], parentId: string | null) => {
    for (const n of nodes) {
      const created = await prisma.articleHeading.create({
        data: { articleId, level: n.level, text: n.text, parentId, order: order++ },
      });
      if (n.children?.length) await walk(n.children, created.id);
    }
  };
  await walk(tree, null);
}

function extractMeta(html: string): { html: string; meta: string } {
  const m = html.match(/<!--\s*META:\s*([\s\S]*?)\s*-->/i);
  if (!m) return { html, meta: '' };
  return { html: html.replace(m[0], '').trim(), meta: m[1].trim() };
}

const toStr = (v: unknown, fallback: string | null): string | null => {
  if (v == null) return fallback;
  if (typeof v === 'string') return v;
  try {
    if (Array.isArray(v)) return v.map(String).join('、');
    if (typeof v === 'object') return Object.values(v as Record<string, unknown>).map(String).join('、');
    return String(v);
  } catch {
    return fallback;
  }
};

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    const parsed = Schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
    const { articleId, useCompetitorAnalysis, useWebSearch, model, targetCharsOverride } = parsed.data;
    const logicalModel = model ?? 'balanced';

    const article = await prisma.article.findFirst({ where: { id: articleId, userId: user.id } });
    if (!article) return NextResponse.json({ error: 'Article not found' }, { status: 404 });
    const keywords = JSON.parse(article.keywords || '[]') as string[];
    if (keywords.length === 0) return NextResponse.json({ error: 'キーワード未設定' }, { status: 400 });

    await prisma.article.update({ where: { id: articleId }, data: { status: 'generating' } });

    try {
      // ===== 1. タイトル =====
      const titleRes = await generate({
        logicalModel, taskType: 'title', system: BASE_SYSTEM,
        user: TITLE_GENERATION_PROMPT({ keywords, persona: '自動推定' }),
        maxTokens: 4000, jsonMode: true,
      });
      const titleJson = extractJson<{ titles: TitleResult[] }>(titleRes.content);
      const title = titleJson.titles?.[0]?.title || keywords.join(' ');

      // ===== 2. 競合分析 + 見出し =====
      let competitorHeadings: string | undefined;
      let cooccurrenceWords: string[] | undefined;
      let avgWordCount: number | undefined;
      let commonTopics: string[] | undefined;
      let maxHeadingCount: number | undefined;
      if (useCompetitorAnalysis !== false) {
        try {
          const a = await analyzeCompetitors(keywords.join(' '), { maxPages: 8 });
          if (a.competitorHeadingsText) competitorHeadings = a.competitorHeadingsText;
          if (a.cooccurrenceWords.length) cooccurrenceWords = a.cooccurrenceWords;
          if (a.avgWordCount) avgWordCount = a.avgWordCount;
          if (a.commonTopics.length) commonTopics = a.commonTopics;
          if (a.maxHeadingCount) maxHeadingCount = a.maxHeadingCount;
        } catch (e) {
          console.warn('[auto] competitor analysis skipped:', (e as Error).message);
        }
      }
      // 手動指定があれば競合分析より優先（検索が全滅していても確実に長文を狙える）。
      const targetChars = targetCharsOverride
        ? clampTargetChars(targetCharsOverride)
        : computeTargetChars(avgWordCount);
      const headRes = await generate({
        logicalModel, taskType: 'heading', system: BASE_SYSTEM,
        user: HEADING_GENERATION_PROMPT({ keywords, competitorHeadings, cooccurrenceWords, avgWordCount, maxHeadingCount, commonTopics }),
        maxTokens: 8000, jsonMode: true,
      });
      const headJson = extractJson<HeadingResult>(headRes.content);
      if (!validateHeadingTree(headJson.headings)) {
        throw new Error('見出し構造が不正でした');
      }
      await saveHeadingTree(articleId, headJson.headings);
      const persona = toStr(headJson.estimated_persona, '自動推定');
      const searchIntent = toStr(headJson.search_intent, 'informational');
      const latentNeeds = Array.isArray(headJson.latent_needs) ? headJson.latent_needs : [];

      await prisma.article.update({
        where: { id: articleId },
        data: {
          title, persona, searchIntent,
          latentNeeds: JSON.stringify(latentNeeds),
          cooccurrenceWords: cooccurrenceWords ? JSON.stringify(cooccurrenceWords) : null,
        },
      });

      // ===== 2.5 おすすめ商品ルール: サイト(既定の WpConnection)単位でキーワードから推奨商品を決定 =====
      let featuredProductId: string | null = null;
      let recommendedProduct: string | undefined;
      try {
        // 公開時の既定接続(publish と同じ isDefault:true)のルールで解決し、
        // 生成時と公開時で推奨商品サイトが食い違わないようにする。
        // 既定接続が無ければ featuredProductId は null のままにし、公開時に公開先サイトのルールで解決させる。
        const conn = await prisma.wpConnection.findFirst({
          where: { userId: user.id, isDefault: true },
        });
        if (conn) {
          const rules = await prisma.productRule.findMany({ where: { wpConnectionId: conn.id } });
          featuredProductId = pickProductId({
            keywords,
            title,
            rules: rules.map((r) => ({ keyword: r.keyword, productId: r.productId, enabled: r.enabled, order: r.order })),
            defaultProductId: conn.defaultProductId,
          });
          recommendedProduct = buildRecommendedProductBrief(getProductById(featuredProductId));
        }
      } catch (e) {
        console.warn('[auto] product rule resolution skipped:', (e as Error).message);
      }

      // ===== 3. 本文 =====
      let webContext: string | undefined;
      if (useWebSearch || article.useWebSearch) {
        const web = await fetchWebContext(`${title} ${keywords.join(' ')}`);
        if (web) webContext = `【Web検索で取得した最新情報】\n${web}`;
      }
      if (article.referenceInfo?.trim()) {
        webContext = `【ユーザー提供の参考情報（最優先）】\n${article.referenceInfo.trim()}` + (webContext ? `\n\n${webContext}` : '');
      }
      // 内部リンク用の関連記事(他記事 最大20件)
      const siblings = await prisma.article.findMany({
        where: { userId: user.id, id: { not: articleId }, title: { not: '' } },
        select: { id: true, title: true },
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
        take: 20,
      });
      const relatedArticles = siblings.map((s) => ({ id: s.id, title: s.title }));

      const bodyRes = await generate({
        logicalModel, taskType: 'body', system: BASE_SYSTEM,
        user: BODY_GENERATION_PROMPT({
          keywords, title, persona: persona || '自動推定',
          searchIntent: searchIntent || 'informational', latentNeeds,
          headingTree: headingTreeToText(headJson.headings),
          toneSample: article.toneSample || undefined,
          volumeSpec: article.volumeSpec || undefined,
          cooccurrenceWords, webContext, relatedArticles,
          targetChars, competitorHeadings, commonTopics, recommendedProduct,
        }),
        maxTokens: 16000, temperature: 0.65,
      });
      const extracted = extractMeta(bodyRes.content);
      // 競合超えの分量・網羅に満たなければ自動増補（既存構造は保持）。
      // 目標<=12000は本文全体を複数パス、>12000はh2セクション単位で増補する（bodyExpand 側で分岐）。
      const exp = await expandBodyIfShort({
        html: extracted.html, title, targetChars, commonTopics, logicalModel,
      });
      const html = exp.html;
      const meta = extracted.meta;

      await prisma.article.update({
        where: { id: articleId },
        data: { bodyHtml: html, metaDescription: meta, modelUsed: bodyRes.actualModel, status: 'completed', step: 5, featuredProductId },
      });

      return NextResponse.json({
        ok: true, articleId, title,
        headings: headJson.headings.length,
        bodyChars: exp.finalChars,
        targetChars,
        expandPasses: exp.passes,
        model: bodyRes.actualModel,
        featuredProductId,
      });
    } catch (err) {
      await prisma.article.update({ where: { id: articleId }, data: { status: 'failed' } }).catch(() => {});
      throw err;
    }
  } catch (err) {
    console.error('[auto]', err);
    const { status, body } = llmErrorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
