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
  /** 手動の目標文字数（指定時は競合分析より優先。clampTargetChars で [3500,60000] にクランプ）。 */
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

/**
 * 1段階の生成を最大 attempts 回までリトライする（「時間がかかってもエラーを出さず最後まで」方針）。
 * すべて失敗したら例外を投げず null を返し、呼び出し側がフォールバックで処理を続行する。
 */
async function tryGen<T>(label: string, attempts: number, fn: () => Promise<T>): Promise<T | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      console.warn(`[auto] ${label} 試行 ${i + 1}/${attempts} 失敗: ${((e as Error).message || '').slice(0, 160)}`);
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  return null;
}

/** 見出し生成が失敗したときの既定の汎用構成（本文生成を止めないためのフォールバック）。 */
function defaultHeadingTree(keywords: string[]): HeadingNode[] {
  const kw = (keywords[0] || 'この商品').trim();
  return [
    { level: 2, text: `${kw}とは？基礎知識`, children: [] },
    { level: 2, text: `${kw}の選び方・比較ポイント`, children: [] },
    { level: 2, text: `${kw}のおすすめ`, children: [] },
    { level: 2, text: `${kw}の使い方・注意点`, children: [] },
    { level: 2, text: `よくある質問（FAQ）`, children: [] },
    { level: 2, text: `まとめ`, children: [] },
  ];
}

/** 本文生成が完全に失敗したときの最小スケルトン（増補パスで肉付けされる・エラーで止めないための保険）。 */
function skeletonBody(tree: HeadingNode[], title: string): string {
  const lead = `<p>${title}について、選び方やおすすめのポイントを解説します。</p>`;
  const secs = tree
    .filter((n) => n.level === 2)
    .map((n) => `<h2>${n.text}</h2>\n<p>${n.text}について、要点を整理して具体的に解説します。</p>`)
    .join('\n');
  return `${lead}\n${secs}`;
}

export async function POST(req: NextRequest) {
  // 'generating' に遷移済みの記事を、想定外の例外で「処理中」固着させないための後始末用。
  let articleIdForCleanup: string | null = null;
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

    articleIdForCleanup = articleId; // 以降で例外が出たら catch 側で failed に矯正する
    await prisma.article.update({ where: { id: articleId }, data: { status: 'generating' } });

    // 「時間がかかってもエラーを出さず最後まで処理」方針:
    // 各段階はリトライ＋フォールバックで進め、途中失敗しても 500 を返さず必ず completed にする。
    const fallbackTitle = keywords.join(' ');

    // ===== 1. タイトル（失敗時はキーワードをタイトルに）=====
    let title = fallbackTitle;
    const titleRes = await tryGen('title', 3, () =>
      generate({
        logicalModel, taskType: 'title', system: BASE_SYSTEM,
        user: TITLE_GENERATION_PROMPT({ keywords, persona: '自動推定' }),
        maxTokens: 4000, jsonMode: true,
      }),
    );
    if (titleRes) {
      try {
        const tj = extractJson<{ titles: TitleResult[] }>(titleRes.content);
        title = tj.titles?.[0]?.title || fallbackTitle;
      } catch { /* フォールバックのまま */ }
    }

    // ===== 2. 競合分析（任意・失敗は握りつぶし、取れた結果だけ使う）=====
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
    // 目標文字数: 手動指定 > 競合平均×1.3(自動) > 下限。競合が長ければ自動で大きくなる(最大6万字)。
    const targetChars = targetCharsOverride
      ? clampTargetChars(targetCharsOverride)
      : computeTargetChars(avgWordCount);

    // ===== 3. 見出し（失敗・不正時は既定の汎用構成にフォールバック）=====
    let headTree: HeadingNode[] = [];
    let persona: string | null = '自動推定';
    let searchIntent: string | null = 'informational';
    let latentNeeds: string[] = [];
    const headRes = await tryGen('headings', 3, () =>
      generate({
        logicalModel, taskType: 'heading', system: BASE_SYSTEM,
        user: HEADING_GENERATION_PROMPT({ keywords, competitorHeadings, cooccurrenceWords, avgWordCount, maxHeadingCount, commonTopics }),
        maxTokens: 8000, jsonMode: true,
      }),
    );
    if (headRes) {
      try {
        const hj = extractJson<HeadingResult>(headRes.content);
        if (validateHeadingTree(hj.headings)) {
          headTree = hj.headings;
          persona = toStr(hj.estimated_persona, '自動推定');
          searchIntent = toStr(hj.search_intent, 'informational');
          latentNeeds = Array.isArray(hj.latent_needs) ? hj.latent_needs : [];
        }
      } catch (e) {
        console.warn('[auto] heading parse failed → 既定構成にフォールバック:', (e as Error).message);
      }
    }
    if (headTree.length === 0) headTree = defaultHeadingTree(keywords);
    await saveHeadingTree(articleId, headTree).catch((e) => console.warn('[auto] saveHeadingTree:', (e as Error).message));

    await prisma.article
      .update({
        where: { id: articleId },
        data: {
          title, persona, searchIntent,
          latentNeeds: JSON.stringify(latentNeeds),
          cooccurrenceWords: cooccurrenceWords ? JSON.stringify(cooccurrenceWords) : null,
        },
      })
      .catch(() => {});

    // ===== 3.5 おすすめ商品ルール（既定接続のルールで推奨商品を決定）=====
    let featuredProductId: string | null = null;
    let recommendedProduct: string | undefined;
    try {
      const conn = await prisma.wpConnection.findFirst({ where: { userId: user.id, isDefault: true } });
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

    // ===== 4. 本文（失敗時は見出しからスケルトンを作って続行）=====
    let webContext: string | undefined;
    if (useWebSearch || article.useWebSearch) {
      try {
        const web = await fetchWebContext(`${title} ${keywords.join(' ')}`);
        if (web) webContext = `【Web検索で取得した最新情報】\n${web}`;
      } catch (e) {
        console.warn('[auto] fetchWebContext skipped:', (e as Error).message);
      }
    }
    if (article.referenceInfo?.trim()) {
      webContext = `【ユーザー提供の参考情報（最優先）】\n${article.referenceInfo.trim()}` + (webContext ? `\n\n${webContext}` : '');
    }
    let relatedArticles: Array<{ id: string; title: string }> = [];
    try {
      const siblings = await prisma.article.findMany({
        where: { userId: user.id, id: { not: articleId }, title: { not: '' } },
        select: { id: true, title: true },
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
        take: 20,
      });
      relatedArticles = siblings.map((s) => ({ id: s.id, title: s.title }));
    } catch { /* 内部リンク無しで続行 */ }

    const bodyRes = await tryGen('body', 5, () =>
      generate({
        logicalModel, taskType: 'body', system: BASE_SYSTEM,
        user: BODY_GENERATION_PROMPT({
          keywords, title, persona: persona || '自動推定',
          searchIntent: searchIntent || 'informational', latentNeeds,
          headingTree: headingTreeToText(headTree),
          toneSample: article.toneSample || undefined,
          volumeSpec: article.volumeSpec || undefined,
          cooccurrenceWords, webContext, relatedArticles,
          targetChars, competitorHeadings, commonTopics, recommendedProduct,
        }),
        maxTokens: 16000, temperature: 0.65,
      }),
    );
    const modelUsed = bodyRes?.actualModel || 'fallback-skeleton';
    let extracted = bodyRes ? extractMeta(bodyRes.content) : { html: '', meta: '' };
    if (!extracted.html.trim()) extracted = { html: skeletonBody(headTree, title), meta: extracted.meta };

    // 競合超えの分量・網羅に満たなければ自動増補（目標>12000はh2セクション単位＝5万字級も可）。失敗しても現状維持で続行。
    let exp = { html: extracted.html, passes: 0, finalChars: 0 };
    try {
      exp = await expandBodyIfShort({ html: extracted.html, title, targetChars, commonTopics, logicalModel });
    } catch (e) {
      console.warn('[auto] expand skipped:', (e as Error).message);
      exp = {
        html: extracted.html,
        passes: 0,
        finalChars: extracted.html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().length,
      };
    }
    const html = exp.html;
    const meta = extracted.meta;

    // 本文生成が全失敗し、増補でも実体が付かず最終文字数が極端に短い場合は degraded。
    // 「エラーを出さず最後まで」方針なので HTTP は 200 で返すが、status は completed にせず failed にして
    //   - 記事一覧で「完成」と誤認させない
    //   - 一括フローの自動公開（公開APIの最小文字数ガードと併せた二重防御）に乗せない
    // ようにする。見出しだけ既定構成に落ちても本文が十分なら通常の completed。
    const MIN_BODY_CHARS = 1200;
    const degraded = exp.finalChars < MIN_BODY_CHARS;
    const finalStatus = degraded ? 'failed' : 'completed';

    // 最終 update が接続断等で落ちても、記事を 'generating' のまま残さない
    // （db.ts のリトライを抜けた稀なケース）。失敗時は本文だけでも保存を試み、
    // それも無理なら status だけ 'failed' に落として「処理中」固着を防ぐ。
    try {
      await prisma.article.update({
        where: { id: articleId },
        data: { bodyHtml: html, metaDescription: meta, modelUsed, status: finalStatus, step: 5, featuredProductId },
      });
    } catch (e) {
      console.warn('[auto] 最終 update 失敗 → status を failed に矯正:', (e as Error).message);
      await prisma.article
        .update({ where: { id: articleId }, data: { status: 'failed' } })
        .catch(() => {});
      // degraded:true を立てて、一括フロー側で画像課金・公開をスキップさせる（保存できていないため）。
      return NextResponse.json(
        { ok: false, articleId, title, status: 'failed', degraded: true, bodyChars: exp.finalChars, error: '生成は完了しましたが保存に失敗しました' },
        { status: 200 },
      );
    }

    return NextResponse.json({
      ok: true, articleId, title,
      status: finalStatus,
      headings: headTree.length,
      bodyChars: exp.finalChars,
      targetChars,
      expandPasses: exp.passes,
      model: modelUsed,
      featuredProductId,
      degraded,
    });
  } catch (err) {
    console.error('[auto]', err);
    // 'generating' に遷移済みなら、想定外の例外でも記事を「処理中」のまま残さず failed に矯正（best-effort）。
    if (articleIdForCleanup) {
      await prisma.article.update({ where: { id: articleIdForCleanup }, data: { status: 'failed' } }).catch(() => {});
    }
    const { status, body } = llmErrorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
