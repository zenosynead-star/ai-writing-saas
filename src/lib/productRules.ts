/**
 * 「おすすめ商品」出し分けルールのエンジン。
 *
 * サイト(WpConnection)単位で「デフォルト商品 + キーワード一致ルール」を持ち、
 * 記事のキーワード/タイトルから推奨商品(products.json の product_id)を決める。
 * - ルールは order 昇順で評価し、enabled かつ keyword(部分一致・大小無視)が
 *   キーワード or タイトルに含まれる最初のものを採用。
 * - 一致が無ければ defaultProductId。どちらも無ければ null
 *   （呼び出し側は従来の「本文言及 × priority」自動検出にフォールバック）。
 *
 * 選定商品は本文生成プロンプト（推奨商品として執筆）と商品カード挿入の両方で使う。
 */

import { loadProducts, type Product } from './articleEnhance/productCards';

export interface ProductRuleLite {
  keyword: string;
  productId: string;
  enabled: boolean;
  order: number;
}

/** products.json から product_id で取得（無ければ null）。 */
export function getProductById(productId?: string | null): Product | null {
  if (!productId) return null;
  return loadProducts().find((p) => p.product_id === productId) ?? null;
}

/** UI/検証用の軽量な商品選択肢一覧。 */
export function listProductChoices(): Array<{ product_id: string; name: string; price_jpy: number | null }> {
  return loadProducts().map((p) => ({
    product_id: p.product_id,
    name: p.name,
    price_jpy: typeof p.price_jpy === 'number' ? p.price_jpy : null,
  }));
}

/**
 * キーワード/タイトルから推奨商品IDを決める（ルール→デフォルト→null）。
 */
export function pickProductId(opts: {
  keywords: string[];
  title?: string;
  rules: ProductRuleLite[];
  defaultProductId?: string | null;
}): string | null {
  const hay = [...(opts.keywords || []), opts.title || ''].join(' ').toLowerCase();
  const sorted = [...(opts.rules || [])]
    .filter((r) => r.enabled && r.keyword && r.keyword.trim() && r.productId)
    .sort((a, b) => a.order - b.order);
  for (const r of sorted) {
    if (hay.includes(r.keyword.trim().toLowerCase())) return r.productId;
  }
  return opts.defaultProductId || null;
}

/**
 * 本文生成プロンプトに渡す「推奨商品」要約。
 * LLM がこの商品を“イチオシ”として自然に本文へ織り込めるよう、名称・価格・特長・URL を簡潔に。
 */
export function buildRecommendedProductBrief(p: Product | null): string | undefined {
  if (!p) return undefined;
  const lines: string[] = [];
  if (p.name) lines.push(`商品名: ${p.name}`);
  if (typeof p.price_jpy === 'number' && p.price_jpy > 0) {
    lines.push(`価格: ¥${Math.round(p.price_jpy).toLocaleString('en-US')}（税込）`);
  }
  const hl = (p.highlights || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 6);
  if (hl.length) lines.push(`特長: ${hl.join(' / ')}`);
  if (p.summary_copy) lines.push(`要約: ${String(p.summary_copy).trim()}`);
  const aliases = (p.aliases || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 4);
  if (aliases.length) lines.push(`別称(本文で自然に使ってよい): ${aliases.join(' / ')}`);
  return lines.length ? lines.join('\n') : undefined;
}
