/**
 * 商品カード v27 生成・挿入モジュール（wp-article-rewriter engine.py + styles.py 移植）。
 *
 * 公開 API:
 *   loadProducts()          — products.json から Product[] を返す
 *   buildSummaryCard(p)     — variant="summary" の HTML 1行
 *   buildFullCard(p)        — variant="full" の HTML 1行
 *   buildBottomCard(p)      — variant="bottom" の HTML 1行
 *   insertProductCards(html)— 本文に summary/full/bottom を挿入（冪等）
 *   PRODUCT_CARD_CSS        — v27 CSS 全体（改行なし minify 済み）
 */

import productsRaw from '@/data/products.json';

// ----------------------------------------------------------------- 型定義

export interface ScoreDimension {
  label: string;
  score: number;
}

export interface ReviewParagraph {
  text: string;
  highlights?: Array<{ start: number; end: number }>;
}

export interface Review {
  author?: string;
  body?: string;
  rating?: number;
}

export interface StorePrices {
  official?: number | null;
  amazon?: number | null;
  rakuten?: number | null;
  yahoo?: number | null;
}

export interface Product {
  product_id: string;
  name: string;
  price_jpy?: number | null;
  aliases?: string[];
  cta_url?: string | null;
  cta_label?: string | null;
  image_url?: string | null;
  image_alt_text?: string | null;
  rating?: number | null;
  review_count?: number | null;
  badge_text?: string | null;
  highlights?: string[];
  summary_copy?: string | null;
  card_spec_columns?: string | null;
  bottom_cta_copy?: string | null;
  amazon_url?: string | null;
  priority?: number;
  rakuten_url?: string | null;
  yahoo_url?: string | null;
  score_overall?: number | null;
  score_dimensions?: ScoreDimension[];
  review_h2?: string | null;
  review_paragraphs?: ReviewParagraph[];
  good_points?: string[];
  concern_points?: string[];
  measured_specs?: Record<string, string | undefined> | null;
  reviews?: Review[];
  store_prices?: StorePrices | null;
  spec_material?: string | null;
  spec_motor?: string | null;
  spec_size?: string | null;
  spec_size_full?: string | null;
  spec_warranty?: string | null;
  spec_weight?: string | null;
  spec_package_weight?: string | null;
  [key: string]: unknown;
}

// ----------------------------------------------------------------- 定数

const DEFAULT_CTA_REL = 'noopener nofollow sponsored';
const DEFAULT_V27_STORE_ORDER = ['official', 'amazon', 'rakuten', 'yahoo'] as const;
const DEFAULT_V27_STORE_LABELS: Record<string, string> = {
  official: '公式サイトで詳細を見る',
  rakuten: '楽天市場で詳細を見る',
  amazon: 'Amazon で詳細を見る',
  yahoo: 'Yahoo! ショッピングで詳細を見る',
};
const DEFAULT_SPEC_COLUMNS = ['spec_size', 'spec_weight', 'spec_warranty'] as const;
const DEFAULT_SPEC_LABELS: Record<string, string> = {
  spec_size: 'サイズ',
  spec_size_full: 'サイズ詳細',
  spec_weight: '重量',
  spec_package_weight: '梱包重量',
  spec_material: '素材',
  spec_motor: 'モーター',
  spec_warranty: '保証',
  price: '価格',
};
const DEFAULT_HIGHLIGHTS_MAX = 5;
const DEFAULT_MAX_BADGES = 3;
const DEFAULT_BOTTOM_CTA_COPY = '今すぐチェック! 公式サイトで詳細を見る';
const CONCLUSION_RE = /まとめ|結論|最後に|おわりに/;

// ----------------------------------------------------------------- データロード

export function loadProducts(): Product[] {
  return productsRaw as unknown as Product[];
}

// ----------------------------------------------------------------- escape ヘルパ（relatedCards.ts 準拠）

function escapeAttr(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeText(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ----------------------------------------------------------------- 価格整形ヘルパ

function formatPriceYen(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'boolean') return null;
  if (typeof value === 'number') {
    const n = Math.round(value);
    if (n <= 0) return null;
    return '¥' + n.toLocaleString('en-US');
  }
  const s = String(value).trim();
  if (!s || s.toLowerCase() === 'nan') return null;
  return s;
}

function formatPriceValue(value: unknown): [string, boolean] | null {
  if (value == null) return null;
  if (typeof value === 'boolean') return null;
  if (typeof value === 'number') {
    const n = Math.round(value);
    return ['¥' + n.toLocaleString('en-US'), true];
  }
  const s = String(value).trim();
  if (!s) return null;
  return [s, false];
}

function formatScore(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'boolean') return null;
  const n = Number(value);
  if (isNaN(n)) return null;
  return n.toFixed(1);
}

// ----------------------------------------------------------------- カードタイトル

function formatCardTitle(p: Product): string {
  const name = (p.name || '').trim();
  const aliases = (p.aliases || []).filter(a => a && a.trim() && a.trim() !== name);
  if (aliases.length > 0) return `${name}「${aliases[0].trim()}」`;
  return name;
}

// ----------------------------------------------------------------- 画像ブロック

function buildImageHtml(p: Product, ctaUrl: string): string {
  const imageUrl = (p.image_url || '').trim();
  if (!imageUrl || imageUrl.toLowerCase() === 'nan') return '';
  const alt = escapeAttr((p.image_alt_text || p.name || '').trim());
  const src = escapeAttr(imageUrl);
  const rel = escapeAttr(DEFAULT_CTA_REL);
  const inner = ctaUrl
    ? `<a href="${escapeAttr(ctaUrl)}" target="_blank" rel="${rel}"><img src="${src}" alt="${alt}" loading="lazy"></a>`
    : `<img src="${src}" alt="${alt}" loading="lazy">`;
  return `<div class="ne-card-image">${inner}</div>`;
}

// ----------------------------------------------------------------- 価格ブロック

function buildPriceBlockHtml(p: Product): string {
  const formatted = formatPriceValue(p.price_jpy);
  if (!formatted) return '';
  const [text, isNumeric] = formatted;
  const safeVal = escapeText(text);
  let inner = `<span class="ne-card-price-value">${safeVal}</span>`;
  if (isNumeric) inner += `<span class="ne-card-price-tax">(税込)</span>`;
  return `<div class="ne-card-price">${inner}</div>`;
}

// ----------------------------------------------------------------- バッジブロック

function buildBadgesHtml(p: Product): string {
  const badges: string[] = [];
  const specWarranty = (p.spec_warranty || '') as string;
  if (specWarranty && (/3\s*年/.test(specWarranty) || /三年/.test(specWarranty))) {
    badges.push('<span class="ne-card-badge ne-card-badge-warranty">3 年保証付き ✓</span>');
  }
  const bt = (p.badge_text || '').toString().trim();
  if (bt) badges.push(`<span class="ne-card-badge ne-card-badge-extra">${escapeText(bt)}</span>`);
  const limited = badges.slice(0, DEFAULT_MAX_BADGES);
  if (!limited.length) return '';
  return `<div class="ne-card-badges">${limited.join('')}</div>`;
}

// ----------------------------------------------------------------- ハイライトバッジ

function buildHighlightsHtml(p: Product, max: number = DEFAULT_HIGHLIGHTS_MAX): string {
  const items = (p.highlights || []).map(x => String(x).trim()).filter(Boolean);
  const limited = max >= 0 ? items.slice(0, max) : items;
  if (!limited.length) return '';
  const lis = limited.map(txt => `<li class="ne-card-highlight">${escapeText(txt)}</li>`).join('');
  return `<ul class="ne-card-highlights">${lis}</ul>`;
}

// ----------------------------------------------------------------- スペック表

function resolveSpecColumns(p: Product): string[] {
  const raw = (p.card_spec_columns || '').trim();
  if (!raw || raw.toLowerCase() === 'nan') return [...DEFAULT_SPEC_COLUMNS];
  const parts = raw.replace(/;/g, ',').replace(/、/g, ',').split(',').map(s => s.trim()).filter(Boolean);
  return parts.length ? parts : [...DEFAULT_SPEC_COLUMNS];
}

function getSpecValue(p: Product, col: string): unknown {
  if (col === 'price') return p.price_jpy ?? null;
  return (p as Record<string, unknown>)[col] ?? null;
}

function buildSpecTableRows(p: Product): string {
  const cols = resolveSpecColumns(p);
  const rows: string[] = [];
  for (const col of cols) {
    const label = DEFAULT_SPEC_LABELS[col] || col;
    const raw = getSpecValue(p, col);
    if (raw == null) continue;
    let display: string;
    if (Array.isArray(raw)) {
      const parts = raw.map(x => String(x).trim()).filter(Boolean);
      if (!parts.length) continue;
      display = escapeText(parts.join(', '));
    } else {
      const s = String(raw).trim();
      if (!s || s === 'nan' || s.startsWith('該当なし')) continue;
      display = escapeText(s);
    }
    rows.push(`<tr><th>${escapeText(label)}</th><td>${display}</td></tr>`);
  }
  if (!rows.length) return '';
  return `<table class="ne-card-spec"><tbody>${rows.join('')}</tbody></table>`;
}

// ----------------------------------------------------------------- スコアブロック（full用）

function buildScoreSectionHtml(p: Product): string {
  const overallText = formatScore(p.score_overall);
  if (overallText == null) return '';
  const safeOverall = escapeText(overallText);
  const overallHtml =
    `<div class="ne-card-v27-score-overall">` +
    `<span class="ne-card-v27-score-label">総合評価</span>` +
    `<span class="ne-card-v27-score-value">${safeOverall}</span>` +
    `<span class="ne-card-v27-score-unit">/5</span>` +
    `</div>`;
  const dims = Array.isArray(p.score_dimensions) ? p.score_dimensions : [];
  let dimsHtml = '';
  if (dims.length) {
    const lis = dims.map(dim => {
      const lbl = String(dim.label || '').trim();
      const sc = formatScore(dim.score);
      if (!lbl || sc == null) return '';
      const pct = Math.max(0, Math.min(100, (Number(dim.score) / 5) * 100));
      const safeStyle = escapeAttr(`--score:${Math.round(pct)}%`);
      return `<li class="ne-card-v27-score-dim">` +
        `<span class="ne-card-v27-score-dim-label">${escapeText(lbl)}</span>` +
        `<span class="ne-card-v27-score-dim-bar" style="${safeStyle}"></span>` +
        `<span class="ne-card-v27-score-dim-value">${escapeText(sc)}</span>` +
        `</li>`;
    }).filter(Boolean).join('');
    if (lis) dimsHtml = `<ul class="ne-card-v27-score-dimensions">${lis}</ul>`;
  }
  return `<div class="ne-card-v27-score">${overallHtml}${dimsHtml}</div>`;
}

// ----------------------------------------------------------------- ストアボタン

function buildStoresHtml(p: Product): string {
  const ctaUrl = (p.cta_url || '').trim();
  if (!ctaUrl) return '';
  const storePrices: Record<string, unknown> = (p.store_prices && typeof p.store_prices === 'object') ? p.store_prices as Record<string, unknown> : {};
  const urlMap: Record<string, string> = {
    official: ctaUrl,
    amazon: (p.amazon_url || '').trim(),
    rakuten: (p.rakuten_url || '').trim(),
    yahoo: (p.yahoo_url || '').trim(),
  };
  const safeRel = escapeAttr(DEFAULT_CTA_REL);
  const buttons: string[] = [];
  for (const storeKey of DEFAULT_V27_STORE_ORDER) {
    const url = urlMap[storeKey] || '';
    if (!url) continue;
    const label = DEFAULT_V27_STORE_LABELS[storeKey] || storeKey;
    const priceVal = storePrices[storeKey] ?? null;
    const priceText = formatPriceYen(priceVal);
    const priceDisplay = priceText || '価格を見る';
    const safeUrl = escapeAttr(url);
    const safeLabel = escapeText(label);
    const safePrice = escapeText(priceDisplay);
    const safeAria = escapeAttr(label);
    buttons.push(
      `<a class="ne-card-v27-store ne-card-v27-store-${storeKey}"` +
      ` href="${safeUrl}" target="_blank" rel="${safeRel}"` +
      ` aria-label="${safeAria}">` +
      `<span class="ne-card-v27-store-label">${safeLabel}</span>` +
      `<span class="ne-card-v27-store-price">${safePrice}</span>` +
      `</a>`
    );
  }
  if (!buttons.length) return '';
  return `<div class="ne-card-v27-stores">${buttons.join('')}</div>`;
}

// ----------------------------------------------------------------- 詳細レビュー

function applyHighlightsToText(text: string, highlights: Array<{ start: number; end: number }>): string {
  if (!text) return '';
  if (!highlights || !highlights.length) return escapeText(text);
  const textLen = text.length;
  const valid: Array<[number, number]> = [];
  for (const h of highlights) {
    const s = Number(h.start);
    const e = Number(h.end);
    if (s < 0 || e <= s || e > textLen) continue;
    valid.push([s, e]);
  }
  if (!valid.length) return escapeText(text);
  valid.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const [s, e] of valid) {
    if (merged.length && s <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], e);
    } else {
      merged.push([s, e]);
    }
  }
  let out = '';
  let cursor = 0;
  for (const [s, e] of merged) {
    if (cursor < s) out += escapeText(text.slice(cursor, s));
    out += `<span class="ne-highlight">${escapeText(text.slice(s, e))}</span>`;
    cursor = e;
  }
  if (cursor < textLen) out += escapeText(text.slice(cursor));
  return out;
}

function buildReviewSectionHtml(p: Product): string {
  const h2 = (p.review_h2 || '').trim();
  if (!h2 || h2.toLowerCase() === 'nan') return '';
  const h2Html = `<h4 class="ne-card-v27-review-h2">${escapeText(h2)}</h4>`;
  const paras: string[] = [];
  const rawParas = Array.isArray(p.review_paragraphs) ? p.review_paragraphs : [];
  for (const para of rawParas) {
    if (typeof para !== 'object' || !para) continue;
    const text = String((para as ReviewParagraph).text || '').trim();
    if (!text) continue;
    const hl = Array.isArray((para as ReviewParagraph).highlights) ? ((para as ReviewParagraph).highlights as Array<{ start: number; end: number }>) : [];
    const textHtml = applyHighlightsToText(text, hl);
    paras.push(`<p class="ne-card-v27-review-para">${textHtml}</p>`);
  }
  return `<div class="ne-card-v27-review">${h2Html}${paras.join('')}</div>`;
}

// ----------------------------------------------------------------- 良い/気になる

function buildProsConsHtml(p: Product): string {
  const good = (p.good_points || []).map(x => String(x).trim()).filter(Boolean);
  const cons = (p.concern_points || []).map(x => String(x).trim()).filter(Boolean);
  if (!good.length && !cons.length) return '';
  let prosHtml = '';
  if (good.length) {
    const lis = good.map(pt => `<li>${escapeText(pt)}</li>`).join('');
    prosHtml = `<div class="ne-card-v27-pros"><h4>☺ 良い</h4><ul>${lis}</ul></div>`;
  }
  let consHtml = '';
  if (cons.length) {
    const lis = cons.map(pt => `<li>${escapeText(pt)}</li>`).join('');
    consHtml = `<div class="ne-card-v27-cons"><h4>☹ 気になる</h4><ul>${lis}</ul></div>`;
  }
  return `<div class="ne-card-v27-pros-cons">${prosHtml}${consHtml}</div>`;
}

// ----------------------------------------------------------------- 実測値

function buildMeasuredSpecsHtml(p: Product): string {
  const measured = p.measured_specs;
  if (!measured || typeof measured !== 'object') return '';
  const rows: string[] = [];
  for (const [k, v] of Object.entries(measured)) {
    if (k == null || v == null) continue;
    const ks = String(k).trim();
    const vs = String(v).trim();
    if (!ks || !vs) continue;
    rows.push(`<tr><th>${escapeText(ks)}</th><td>${escapeText(vs)}</td></tr>`);
  }
  if (!rows.length) return '';
  return `<div class="ne-card-v27-measured"><h4>実測値</h4><table class="ne-card-v27-measured-table"><tbody>${rows.join('')}</tbody></table></div>`;
}

// ----------------------------------------------------------------- クチコミ

function buildReviewsHtml(p: Product): string {
  const reviews = Array.isArray(p.reviews) ? p.reviews : [];
  if (!reviews.length) return '';
  const cards: string[] = [];
  for (const r of reviews) {
    if (typeof r !== 'object' || !r) continue;
    const rv = r as Review;
    const author = String(rv.author || '').trim();
    const body = String(rv.body || '').trim();
    if (!author && !body) continue;
    const authorHtml = author ? `<span class="ne-card-v27-review-author">${escapeText(author)}</span>` : '';
    let ratingHtml = '';
    if (rv.rating != null) {
      const rt = formatScore(rv.rating);
      if (rt != null) ratingHtml = `<span class="ne-card-v27-review-rating">${escapeText(rt + ' / 5')}</span>`;
    }
    const bodyHtml = body ? `<p class="ne-card-v27-review-body">${escapeText(body)}</p>` : '';
    cards.push(`<div class="ne-card-v27-review-card">${authorHtml}${ratingHtml}${bodyHtml}</div>`);
  }
  if (!cards.length) return '';
  return `<div class="ne-card-v27-reviews" data-ne-reviews-empty="false"><h4>この商品のクチコミ</h4><div class="ne-card-v27-reviews-scroll">${cards.join('')}</div></div>`;
}

// ----------------------------------------------------------------- 最下部 CTA（Sprint 37.5）

function buildBottomCtaHtml(p: Product): string {
  const ctaUrl = (p.cta_url || '').trim();
  if (!ctaUrl) return '';
  const safeUrl = escapeAttr(ctaUrl);
  const safeRel = escapeAttr(DEFAULT_CTA_REL);
  const priceText = formatPriceYen(p.price_jpy);
  const priceHtml = priceText
    ? `<span class="ne-card-v27-cta-main-price">${escapeText(priceText)} (税込)</span>`
    : '';
  const mainHtml =
    `<a class="ne-card-v27-cta-main" href="${safeUrl}" target="_blank" rel="${safeRel}">` +
    `公式サイトで詳細を見る${priceHtml}` +
    `</a>`;
  const subBtns: string[] = [];
  const amazonUrl = (p.amazon_url || '').trim();
  if (amazonUrl) {
    subBtns.push(
      `<a class="ne-card-v27-cta-subbtn ne-card-v27-cta-sub-amazon"` +
      ` href="${escapeAttr(amazonUrl)}" target="_blank" rel="${safeRel}">Amazonで見る</a>`
    );
  }
  const yahooUrl = (p.yahoo_url || '').trim();
  if (yahooUrl) {
    subBtns.push(
      `<a class="ne-card-v27-cta-subbtn ne-card-v27-cta-sub-yahoo"` +
      ` href="${escapeAttr(yahooUrl)}" target="_blank" rel="${safeRel}">Yahoo!で見る</a>`
    );
  }
  const subHtml = subBtns.length
    ? `<div class="ne-card-v27-cta-sub">${subBtns.join('')}</div>`
    : '';
  return `<div class="ne-card-v27-cta-bottom" data-ne-cta-bottom="auto">${mainHtml}${subHtml}</div>`;
}

// ----------------------------------------------------------------- 3バリアント生成（公開 API）

/** Summary variant: 画像 + スコア + 価格 + バッジ + ハイライト(max3) + 公式1ボタン */
export function buildSummaryCard(p: Product): string {
  const ctaUrl = (p.cta_url || '').trim();
  const safeId = escapeAttr(p.product_id);
  const safeTitle = escapeText(formatCardTitle(p));
  const imageHtml = buildImageHtml(p, ctaUrl);
  const overallText = formatScore(p.score_overall);
  const scoreHtml = overallText != null
    ? `<div class="ne-card-v27-summary-score"><span class="ne-card-v27-score-value">${escapeText(overallText)}</span><span class="ne-card-v27-score-unit">/5</span></div>`
    : '';
  const priceHtml = buildPriceBlockHtml(p);
  const badgesHtml = buildBadgesHtml(p);
  const highlightsHtml = buildHighlightsHtml(p, 3);
  let ctaHtml = '';
  if (ctaUrl) {
    const safeUrl = escapeAttr(ctaUrl);
    const safeRel = escapeAttr(DEFAULT_CTA_REL);
    const safeLabel = escapeText(DEFAULT_V27_STORE_LABELS['official']);
    ctaHtml =
      `<a class="ne-card-v27-store ne-card-v27-store-official"` +
      ` href="${safeUrl}" target="_blank" rel="${safeRel}">` +
      `<span class="ne-card-v27-store-label">${safeLabel}</span>` +
      `</a>`;
  }
  const bodyInner = `<h3 class="ne-card-title">${safeTitle}</h3>${scoreHtml}${priceHtml}${badgesHtml}${highlightsHtml}${ctaHtml}`;
  return (
    `<div class="ne-product-card ne-card-v23 ne-card-v24 ne-card-v25 ne-card-v26 ne-card-v27 ne-card-variant-summary"` +
    ` data-ne-product-card="auto"` +
    ` data-ne-product-id="${safeId}"` +
    ` data-ne-version="27"` +
    ` data-ne-variant="summary">` +
    `${imageHtml}` +
    `<div class="ne-card-body">${bodyInner}</div>` +
    `</div>`
  );
}

/** Full variant: 画像+スコア+価格+ハイライト+ストア+スペック表+レビュー+良い気になる+実測+クチコミ+最下部CTA */
export function buildFullCard(p: Product): string {
  const ctaUrl = (p.cta_url || '').trim();
  const safeId = escapeAttr(p.product_id);
  const safeTitle = escapeText(formatCardTitle(p));
  const imageHtml = buildImageHtml(p, ctaUrl);
  const scoreHtml = buildScoreSectionHtml(p);
  const priceHtml = buildPriceBlockHtml(p);
  const badgesHtml = buildBadgesHtml(p);
  const highlightsHtml = buildHighlightsHtml(p);
  const storesHtml = buildStoresHtml(p);
  const headinfoInner = `<h2 class="ne-card-title">${safeTitle}</h2>${scoreHtml}${priceHtml}${badgesHtml}${highlightsHtml}${storesHtml}`;
  const headerHtml = `<div class="ne-card-v27-header">${imageHtml}<div class="ne-card-v27-headinfo">${headinfoInner}</div></div>`;
  const tableHtml = buildSpecTableRows(p);
  const reviewHtml = buildReviewSectionHtml(p);
  const prosConsHtml = buildProsConsHtml(p);
  const measuredHtml = buildMeasuredSpecsHtml(p);
  const reviewsHtml = buildReviewsHtml(p);
  const bottomCtaHtml = buildBottomCtaHtml(p);
  return (
    `<div class="ne-product-card ne-card-v23 ne-card-v24 ne-card-v25 ne-card-v26 ne-card-v27 ne-card-variant-full"` +
    ` data-ne-product-card="auto"` +
    ` data-ne-product-id="${safeId}"` +
    ` data-ne-version="27"` +
    ` data-ne-variant="full">` +
    `${headerHtml}` +
    `${tableHtml}` +
    `${reviewHtml}` +
    `${prosConsHtml}` +
    `${measuredHtml}` +
    `${reviewsHtml}` +
    `${bottomCtaHtml}` +
    `</div>`
  );
}

/** Bottom variant: コピー + 価格inline + ストアボタン群 */
export function buildBottomCard(p: Product): string {
  const safeId = escapeAttr(p.product_id);
  const safeTitle = escapeText(formatCardTitle(p));
  const bottomCopy = (p.bottom_cta_copy || '').trim() || DEFAULT_BOTTOM_CTA_COPY;
  const copyHtml = `<p class="ne-card-bottom-copy">${escapeText(bottomCopy)}</p>`;
  const formatted = formatPriceValue(p.price_jpy);
  let priceInlineHtml: string;
  if (formatted) {
    const [ptxt, isNumeric] = formatted;
    const safePval = escapeText(ptxt);
    const taxHtml = isNumeric ? `<span class="ne-card-price-tax">(税込)</span>` : '';
    priceInlineHtml =
      `<div class="ne-card-price-inline">` +
      `<span>${safeTitle}</span>` +
      ` <span class="ne-card-price-value">${safePval}</span>` +
      `${taxHtml}` +
      `</div>`;
  } else {
    priceInlineHtml = `<div class="ne-card-price-inline"><span>${safeTitle}</span></div>`;
  }
  const storesHtml = buildStoresHtml(p);
  const bodyInner = `${copyHtml}${priceInlineHtml}${storesHtml}`;
  return (
    `<div class="ne-product-card ne-card-v23 ne-card-v24 ne-card-v25 ne-card-v26 ne-card-v27 ne-card-variant-bottom"` +
    ` data-ne-product-card="auto"` +
    ` data-ne-product-id="${safeId}"` +
    ` data-ne-version="27"` +
    ` data-ne-variant="bottom">` +
    `<div class="ne-card-body">${bodyInner}</div>` +
    `</div>`
  );
}

// ----------------------------------------------------------------- 挿入ロジック

/** テキストを取得（タグ除去、plaintext化） */
function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}

/** 記事中のne-product-card範囲リスト（depth-aware） */
function findProductCardRanges(html: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const openRe = /(<div\b[^>]*\bne-product-card\b[^>]*>)|(<div\b[^>]*>)|(<\/\s*div\s*>)/gi;
  let m: RegExpExecArray | null;
  let inCard = false;
  let cardStart = -1;
  let depth = 0;
  // We do a state-machine pass
  const pcardRe = /\bne-product-card\b/i;
  const allDivOpen = /<div\b[^>]*>/gi;
  const allDivClose = /<\/\s*div\s*>/gi;

  // Collect all <div> positions with their type (product-card start / generic open / close)
  type Tok = { pos: number; end: number; isPCard: boolean; isClose: boolean };
  const toks: Tok[] = [];
  let mo: RegExpExecArray | null;
  allDivOpen.lastIndex = 0;
  while ((mo = allDivOpen.exec(html)) !== null) {
    toks.push({ pos: mo.index, end: mo.index + mo[0].length, isPCard: pcardRe.test(mo[0]), isClose: false });
  }
  allDivClose.lastIndex = 0;
  while ((mo = allDivClose.exec(html)) !== null) {
    toks.push({ pos: mo.index, end: mo.index + mo[0].length, isPCard: false, isClose: true });
  }
  toks.sort((a, b) => a.pos - b.pos);

  void openRe; // suppress unused warning

  for (const tok of toks) {
    if (!inCard) {
      if (!tok.isClose && tok.isPCard) {
        inCard = true;
        cardStart = tok.pos;
        depth = 1;
      }
    } else {
      if (!tok.isClose) {
        depth++;
      } else {
        depth--;
        if (depth === 0) {
          ranges.push([cardStart, tok.end]);
          inCard = false;
          cardStart = -1;
        }
      }
    }
  }
  return ranges;
}

function isInsideProductCard(pos: number, ranges: Array<[number, number]>): boolean {
  for (const [s, e] of ranges) {
    if (s <= pos && pos < e) return true;
  }
  return false;
}

/** テーブル範囲リスト（relatedCards.ts findTableRanges 移植） */
function findTableRanges(html: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const lower = html.toLowerCase();
  const open = /<table\b/gi;
  let m: RegExpExecArray | null;
  let scanFrom = 0;
  while ((m = open.exec(html)) !== null) {
    if (m.index < scanFrom) continue;
    const start = m.index;
    let cursor = m.index + 6;
    let depth = 1;
    let end = html.length;
    while (cursor < html.length) {
      const openIdx = lower.indexOf('<table', cursor);
      const closeIdx = lower.indexOf('</table>', cursor);
      if (closeIdx === -1) { end = html.length; break; }
      if (openIdx !== -1 && openIdx < closeIdx) { depth++; cursor = openIdx + 6; continue; }
      depth--;
      cursor = closeIdx + 8;
      if (depth === 0) { end = cursor; break; }
    }
    ranges.push([start, end]);
    scanFrom = end;
    open.lastIndex = end;
  }
  return ranges;
}

/** h2 位置リスト（商品カード内除外） */
function findH2Positions(html: string, cardRanges: Array<[number, number]>): Array<{ start: number; innerText: string }> {
  const out: Array<{ start: number; innerText: string }> = [];
  const h2Re = /<h2\b[^>]*>/gi;
  const closeRe = /<\/\s*h2\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = h2Re.exec(html)) !== null) {
    const openStart = m.index;
    if (isInsideProductCard(openStart, cardRanges)) continue;
    closeRe.lastIndex = m.index + m[0].length;
    const cm = closeRe.exec(html);
    if (!cm) continue;
    const inner = html.slice(m.index + m[0].length, cm.index);
    const innerText = stripTags(inner);
    out.push({ start: openStart, innerText });
  }
  return out;
}

/** 既存 product_id + variant の冪等チェック */
function articleHasVariant(html: string, productId: string, variant: string): boolean {
  const escapedId = productId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<div\\b[^>]*?data-ne-product-id\\s*=\\s*["']${escapedId}["'][^>]*>`, 'gi');
  const varRe = /data-ne-variant\s*=\s*["']([^"']*)["']/i;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    const vm = varRe.exec(tag);
    if (vm && vm[1].trim().toLowerCase() === variant) return true;
  }
  return false;
}

/** 本文中に商品名/aliasが出現するか（既存カード/table/<a>内を除外） */
function findFirstMentionOutsideCards(
  html: string,
  candidates: string[],
  cardRanges: Array<[number, number]>,
  tableRanges: Array<[number, number]>
): number | null {
  // <a>...</a> の範囲も除外
  const aRanges: Array<[number, number]> = [];
  const aRe = /<a\b[^>]*>/gi;
  const aCloseRe = /<\/\s*a\s*>/gi;
  let am: RegExpExecArray | null;
  while ((am = aRe.exec(html)) !== null) {
    const aStart = am.index;
    aCloseRe.lastIndex = am.index + am[0].length;
    const ac = aCloseRe.exec(html);
    if (ac) aRanges.push([aStart, ac.index + ac[0].length]);
  }

  const allExcluded = [...cardRanges, ...tableRanges, ...aRanges];
  let earliest: number | null = null;
  for (const cand of candidates) {
    if (!cand) continue;
    let idx = html.indexOf(cand);
    while (idx !== -1) {
      let inside = false;
      for (const [s, e] of allExcluded) {
        if (s <= idx && idx < e) { inside = true; break; }
      }
      if (!inside) {
        if (earliest === null || idx < earliest) earliest = idx;
        break;
      }
      idx = html.indexOf(cand, idx + 1);
    }
  }
  return earliest;
}

/**
 * 記事 HTML に商品カード（summary/full/bottom）を挿入する（冪等）。
 *
 * 選定: priority 昇順で最有力1商品。商品名/aliasが本文に出現する商品のみ対象。
 * 配置:
 *   summary  = 最初の h2 直前（h2が2つ未満の場合スキップ）
 *   full     = 最初の言及位置（ブロック境界）、無ければ2つ目 h2 直前
 *   bottom   = 「まとめ/結論/最後に/おわりに」h2 直前
 * 冪等: data-ne-product-id が既にある商品はスキップ。
 * 挿入は末尾側から行い index ずれを防ぐ。
 */
export function insertProductCards(html: string, opts?: { productId?: string }): string {
  if (!html) return html;

  const products = loadProducts();
  if (!products.length) return html;

  // priority 昇順ソート
  const sorted = [...products].sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));

  let chosen: Product | null = null;
  const cardRanges = findProductCardRanges(html);
  const tableRanges = findTableRanges(html);

  // おすすめ商品ルールで明示指定された商品があれば、本文言及に依らずそれを採用する。
  if (opts?.productId) {
    chosen = sorted.find((p) => p.product_id === opts.productId && p.cta_url) ?? null;
  }

  // 指定が無い/該当しない場合は従来どおり「本文言及 × priority」で最有力1商品を自動検出
  if (!chosen) {
    for (const p of sorted) {
      if (!p.cta_url) continue;
      const candidates = [p.name, ...(p.aliases || [])].filter(Boolean) as string[];
      const mentionIdx = findFirstMentionOutsideCards(html, candidates, cardRanges, tableRanges);
      if (mentionIdx !== null) {
        chosen = p;
        break;
      }
    }
  }

  if (!chosen) return html;

  const pid = chosen.product_id;

  // 挿入する variant を決定（末尾から順に収集してまとめて末尾→先頭順で適用）
  type Insert = { pos: number; order: number; html: string; variant: string };
  const inserts: Insert[] = [];

  // カード内h2を除いた現在状態でのh2位置（挿入前に計算）
  const h2s = findH2Positions(html, cardRanges);

  // bottom: 「まとめ/結論/最後に/おわりに」h2直前
  if (!articleHasVariant(html, pid, 'bottom')) {
    let bottomPos: number | null = null;
    for (const h2 of h2s) {
      if (CONCLUSION_RE.test(h2.innerText)) { bottomPos = h2.start; break; }
    }
    if (bottomPos != null) {
      inserts.push({ pos: bottomPos, order: 2, html: buildBottomCard(chosen), variant: 'bottom' });
    }
  }

  // full: 最初の言及位置のブロック境界、なければ2つ目h2直前
  if (!articleHasVariant(html, pid, 'full')) {
    const candidates = [chosen.name, ...(chosen.aliases || [])].filter(Boolean) as string[];
    const mentionIdx = findFirstMentionOutsideCards(html, candidates, cardRanges, tableRanges);
    let fullPos: number | null = null;
    if (mentionIdx != null) {
      // 言及位置直後の段落境界(</p>の次) or ブロック開始を探す
      const afterMention = html.indexOf('</p>', mentionIdx);
      if (afterMention !== -1) {
        fullPos = afterMention + 4;
      } else if (h2s.length >= 2) {
        fullPos = h2s[1].start;
      }
    } else if (h2s.length >= 2) {
      fullPos = h2s[1].start;
    }
    if (fullPos != null) {
      inserts.push({ pos: fullPos, order: 1, html: buildFullCard(chosen), variant: 'full' });
    }
  }

  // summary: 最初のh2直前（h2が2つ以上の場合のみ）
  if (!articleHasVariant(html, pid, 'summary')) {
    if (h2s.length >= 2) {
      inserts.push({ pos: h2s[0].start, order: 0, html: buildSummaryCard(chosen), variant: 'summary' });
    }
  }

  if (!inserts.length) return html;

  // 末尾側から挿入（index ずれ防止）。同一 pos では order 降順（bottomが先、summaryが後）
  inserts.sort((a, b) => b.pos - a.pos || b.order - a.order);

  let out = html;
  for (const ins of inserts) {
    out = out.slice(0, ins.pos) + ins.html + '\n' + out.slice(ins.pos);
  }
  return out;
}

// ----------------------------------------------------------------- CSS（v23+v24+v25+v26+v27 結合）

export const PRODUCT_CARD_CSS: string = [
  // v23 EC base
  "/* wp-article-rewriter product-card (Sprint 23 EC) */ .ne-product-card { background: #fff; margin: 32px auto; font-family: 'Noto Sans JP', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; } .ne-product-card.ne-card-v23 { display: flex; flex-direction: row; gap: 24px; max-width: 720px; margin: 32px auto; padding: 20px; background: #fff; border-radius: 10px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08); border: 1px solid #f0f0f0; } .ne-product-card.ne-card-v23 .ne-card-image { flex: 0 0 280px; max-width: 280px; } .ne-product-card.ne-card-v23 .ne-card-image a { display: block; text-decoration: none; } .ne-product-card.ne-card-v23 .ne-card-image img { width: 100%; height: auto; aspect-ratio: 1 / 1; object-fit: cover; border-radius: 6px; display: block; } .ne-product-card.ne-card-v23:not(:has(.ne-card-image)) .ne-card-body { flex: 1 1 100%; } .ne-product-card.ne-card-v23 .ne-card-body { flex: 1 1 auto; min-width: 0; } .ne-product-card.ne-card-v23 .ne-card-title { margin: 0 0 8px 0 !important; font-size: 1.25em !important; font-weight: 800 !important; color: #111 !important; line-height: 1.4 !important; background: none !important; border: none !important; border-left: none !important; padding: 0 !important; display: block !important; } .ne-product-card.ne-card-v23 .ne-card-price { margin: 8px 0; } .ne-product-card.ne-card-v23 .ne-card-price-value { font-size: 1.9em; font-weight: 800; color: #dc2626; letter-spacing: -0.02em; } .ne-product-card.ne-card-v23 .ne-card-price-tax { font-size: 0.85em; color: #666; margin-left: 4px; } .ne-product-card.ne-card-v23 .ne-card-rating { margin: 4px 0 8px; font-size: 0.95em; color: #333; } .ne-product-card.ne-card-v23 .ne-card-rating-stars { color: #dc2626; margin-right: 6px; letter-spacing: 1px; } .ne-product-card.ne-card-v23 .ne-card-rating-value { font-weight: 700; color: #111; margin-right: 6px; } .ne-product-card.ne-card-v23 .ne-card-rating-count { color: #666; } .ne-product-card.ne-card-v23 .ne-card-badges { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 12px; } .ne-product-card.ne-card-v23 .ne-card-badge { display: inline-block; padding: 4px 10px; background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; border-radius: 999px; font-size: 0.8em; font-weight: 700; } .ne-product-card.ne-card-v23 .ne-card-spec { width: 100%; border-collapse: collapse; margin: 8px 0 14px; font-size: 0.92em; } .ne-product-card.ne-card-v23 .ne-card-spec th, .ne-product-card.ne-card-v23 .ne-card-spec td { padding: 6px 8px; border-bottom: 1px solid #eee; vertical-align: top; color: #111; text-align: left; line-height: 1.5; } .ne-product-card.ne-card-v23 .ne-card-spec th { width: 30%; min-width: 5em; font-weight: 700; background: transparent; } .ne-product-card.ne-card-v23 .ne-card-cta { display: flex; flex-direction: column; align-items: center; gap: 2px; background: #111; color: #fff; padding: 14px 18px; border-radius: 8px; border: 1px solid #dc2626; text-decoration: none; font-weight: 700; transition: transform 200ms ease, background 200ms ease; margin-top: 4px; } .ne-product-card.ne-card-v23 .ne-card-cta:hover { background: #dc2626; color: #fff; transform: translateY(-1px); } .ne-product-card.ne-card-v23 .ne-card-cta-price { font-size: 1.05em; } .ne-product-card.ne-card-v23 .ne-card-cta-label { font-size: 0.95em; opacity: 0.95; } @media (max-width: 767px) { .ne-product-card.ne-card-v23 { flex-direction: column; gap: 14px; padding: 16px; } .ne-product-card.ne-card-v23 .ne-card-image { flex: 0 0 auto; max-width: 100%; } .ne-product-card.ne-card-v23 .ne-card-image img { aspect-ratio: auto; max-height: 360px; object-fit: cover; } .ne-product-card.ne-card-v23 .ne-card-title { font-size: 1.15em; } .ne-product-card.ne-card-v23 .ne-card-price-value { font-size: 1.7em; } } @media (min-width: 768px) { .ne-product-card.ne-card-v23 { flex-direction: row; } }",
  // v24 variants
  " /* wp-article-rewriter product-card (Sprint 24 variants) */ .ne-product-card.ne-card-v24 .ne-card-highlights { display: flex; flex-wrap: wrap; gap: 6px; list-style: none; padding: 0; margin: 8px 0 12px; } .ne-product-card.ne-card-v24 .ne-card-highlight { display: inline-block; padding: 4px 10px; background: #fee2e2; color: #dc2626; border-radius: 999px; font-size: 0.85em; font-weight: 700; } .ne-product-card.ne-card-v24 .ne-card-highlight::before { content: \"\\2605 \"; margin-right: 2px; } .ne-product-card.ne-card-variant-summary { margin: 18px auto 28px; padding: 14px; min-height: 200px; } .ne-product-card.ne-card-variant-summary .ne-card-image { flex: 0 0 180px; max-width: 180px; } .ne-product-card.ne-card-variant-summary .ne-card-title { font-size: 1.1em; margin-bottom: 6px; } .ne-product-card.ne-card-variant-summary .ne-card-summary-copy { margin: 6px 0 8px; font-size: 0.95em; color: #333; line-height: 1.55; } .ne-product-card.ne-card-variant-full { /* Sprint 23 既存寸法を継承 */ } .ne-product-card.ne-card-variant-bottom { flex-direction: column; align-items: stretch; gap: 8px; margin: 24px auto; padding: 14px 18px; min-height: 100px; max-height: none; height: auto; overflow: visible; background: #fff7f7; border: 1px solid #fecaca; } .ne-product-card.ne-card-variant-bottom .ne-card-body { display: flex; flex-direction: column; gap: 6px; } .ne-product-card.ne-card-variant-bottom .ne-card-bottom-copy { margin: 0; font-size: 1.05em; font-weight: 700; color: #dc2626; } .ne-product-card.ne-card-variant-bottom .ne-card-price-inline { font-size: 0.9em; color: #111; } .ne-product-card.ne-card-variant-bottom .ne-card-price-inline .ne-card-price-value { font-size: 1.2em; font-weight: 800; color: #dc2626; margin-left: 6px; } .ne-product-card.ne-card-variant-bottom .ne-card-price-inline .ne-card-price-tax { font-size: 0.8em; color: #666; margin-left: 2px; } .ne-product-card.ne-card-variant-bottom .ne-card-cta { margin-top: 4px; padding: 10px 14px; } @media (max-width: 767px) { .ne-product-card.ne-card-variant-summary .ne-card-image { flex: 0 0 auto; max-width: 100%; } .ne-product-card.ne-card-variant-bottom { max-height: none; } }",
  // v25 2ボタン + 関連カード
  " /* wp-article-rewriter product-card (Sprint 25 Amazon + related-card) */ .ne-card-cta-group { display: flex; gap: 12px; margin-top: 16px; align-items: stretch; } .ne-card-cta-group[data-ne-cta-buttons=\"1\"] .ne-card-cta { flex: 1; } .ne-card-cta-group[data-ne-cta-buttons=\"2\"] .ne-card-cta { flex: 1 1 50%; } .ne-card-cta-group .ne-card-cta { display: flex; align-items: center; justify-content: center; padding: 14px 20px; border-radius: 8px; font-weight: 700; font-size: 15px; text-decoration: none; transition: transform 0.1s, box-shadow 0.2s; border: none; } .ne-card-cta-group .ne-card-cta-official { background: #ef6c00; color: #ffffff; box-shadow: 0 2px 6px rgba(239, 108, 0, 0.35); } .ne-card-cta-group .ne-card-cta-official:hover { background: #e65100; transform: translateY(-1px); box-shadow: 0 4px 10px rgba(239, 108, 0, 0.45); color: #ffffff; } .ne-card-cta-group .ne-card-cta-amazon { background: #ffffff; color: #b26500; border: 2px solid #ff9900; box-shadow: none; } .ne-card-cta-group .ne-card-cta-amazon:hover { background: #fff8ec; transform: translateY(-1px); color: #b26500; } .ne-related-card { display: block; margin: 1.5em 0; border: 1px solid #e5e7eb; border-radius: 8px; background: #ffffff; overflow: hidden; transition: box-shadow 0.2s; } .ne-related-card:hover { box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08); } .ne-related-card a { display: flex; align-items: stretch; text-decoration: none; color: inherit; } .ne-related-card-thumb { flex: 0 0 160px; margin: 0; } .ne-related-card-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; } .ne-related-card-body { flex: 1; padding: 12px 16px; display: flex; flex-direction: column; justify-content: center; } .ne-related-card-label { font-size: 11px; color: #dc2626; font-weight: 700; letter-spacing: 0.05em; } .ne-related-card-title { margin: 4px 0 0; font-size: 15px; font-weight: 600; color: #111827; line-height: 1.4; } .ne-related-card-no-thumb .ne-related-card-body { padding: 16px; } @media (max-width: 640px) { .ne-card-cta-group { flex-direction: column; } .ne-related-card a { flex-direction: column; } .ne-related-card-thumb { flex: 0 0 auto; aspect-ratio: 520 / 300; } }",
  // v26 関連カードv2
  " /* wp-article-rewriter product-card (Sprint 26 related-card-v2, Sprint 30.4 wpautop-safe, Sprint 30.6 横並びリデザイン) */ .ne-related-card-v2 { display: flex; flex-direction: row; align-items: stretch; gap: 16px; margin: 28px 0; padding: 16px; border: 1px solid #dbe6f3; border-left: 4px solid #2563eb; border-radius: 8px; background: #eaf3fe; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08); overflow: hidden; text-decoration: none; transition: box-shadow 0.2s ease, transform 0.2s ease; } .ne-related-card-v2:hover { box-shadow: 0 4px 14px rgba(37, 99, 235, 0.18); transform: translateY(-2px); } .ne-related-card-v2__thumb { flex: 0 0 200px; max-width: 200px; aspect-ratio: 16 / 9; margin: 0; overflow: hidden; border-radius: 8px; } .ne-related-card-v2__thumb a { display: block; width: 100%; height: 100%; } .ne-related-card-v2__thumb img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.3s ease; } .ne-related-card-v2:hover .ne-related-card-v2__thumb img { transform: scale(1.04); } .ne-related-card-v2__body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 6px; } .ne-related-card-v2__label { color: #2563eb; font-weight: 700; font-size: 0.8em; letter-spacing: 0.02em; } .ne-related-card-v2__title { background: none !important; border: none !important; border-left: none !important; padding: 0 !important; margin: 0 !important; display: block !important; font-size: 1.15em !important; font-weight: 700 !important; line-height: 1.4 !important; color: #1a1a1a !important; } .ne-related-card-v2__title a { color: inherit; text-decoration: none; } .ne-related-card-v2:hover .ne-related-card-v2__title { color: #2563eb !important; } .ne-related-card-v2__desc { color: #666666; font-size: 0.88em; line-height: 1.6; margin: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; } .ne-related-card-v2__arrow { display: inline-block; align-self: flex-start; background: #ef6c00; color: #ffffff !important; font-weight: 700; font-size: 0.85em; text-decoration: none !important; text-align: center; padding: 7px 16px; border-radius: 6px; margin-top: 6px; transition: background 0.2s ease, transform 0.2s ease; } .ne-related-card-v2:hover .ne-related-card-v2__arrow { background: #e65100; transform: translateX(4px); } .ne-related-card-v2:not(:has(.ne-related-card-v2__thumb)) { padding: 20px; } @media (max-width: 640px) { .ne-related-card-v2 { flex-direction: column; } .ne-related-card-v2__thumb { flex: 0 0 auto; max-width: 100%; width: 100%; aspect-ratio: 16 / 9; } } .ne-product-card.ne-card-v26 { /* v26 marker class — visual rules inherited from v25 */ }",
  // v27 リッチカード
  " /* wp-article-rewriter product-card (Sprint 28 v27 リッチ化 mybest 風) */ .ne-highlight { background: linear-gradient(transparent 60%, #fef08a 60%); padding: 0 0.1em; font-weight: 700; } .ne-product-card.ne-card-v27 { font-family: 'Noto Sans JP', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #111; background: #fff; } .ne-product-card.ne-card-v27.ne-card-variant-full { display: block; max-width: 760px; margin: 32px auto; padding: 24px; border-radius: 12px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08); border: 1px solid #e5e7eb; } .ne-product-card.ne-card-v27 .ne-card-v27-header { display: flex; flex-direction: row; gap: 1.5em; align-items: flex-start; margin-bottom: 20px; } .ne-product-card.ne-card-v27 .ne-card-v27-header > .ne-card-image { flex: 0 0 auto; width: 40%; max-width: 320px; min-width: 200px; } .ne-product-card.ne-card-v27 .ne-card-v27-header > .ne-card-image img { width: 100%; height: auto; max-height: 320px; object-fit: contain; display: block; border-radius: 8px; } .ne-product-card.ne-card-v27 .ne-card-v27-headinfo { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 0.8em; } .ne-product-card.ne-card-v27 .ne-card-v27-headinfo > h2, .ne-product-card.ne-card-v27 .ne-card-v27-headinfo > .ne-card-title { margin: 0; font-size: 1.25em; line-height: 1.4; word-break: normal; overflow-wrap: break-word; writing-mode: horizontal-tb; } .ne-product-card.ne-card-v27 .ne-card-v27-stores, .ne-product-card.ne-card-v27 .ne-card-v27-score-overall, .ne-product-card.ne-card-v27 .ne-card-v27-score-dimensions, .ne-product-card.ne-card-v27 .ne-card-v27-review-para, .ne-product-card.ne-card-v27 .ne-card-v27-pros-cons, .ne-product-card.ne-card-v27 .ne-card-v27-measured { writing-mode: horizontal-tb; } .ne-product-card.ne-card-v27 .ne-card-v27-score { background: #fff5f5; border-radius: 8px; padding: 12px 16px; margin: 12px 0; } .ne-product-card.ne-card-v27 .ne-card-v27-score-overall { display: flex; align-items: baseline; gap: 6px; margin-bottom: 8px; } .ne-product-card.ne-card-v27 .ne-card-v27-score-label { font-size: 0.9em; color: #555; } .ne-product-card.ne-card-v27 .ne-card-v27-score-value { font-size: 2.2em; font-weight: 800; color: #1a3d5c; letter-spacing: -0.02em; } .ne-product-card.ne-card-v27 .ne-card-v27-score-unit { font-size: 0.85em; color: #666; } .ne-product-card.ne-card-v27 .ne-card-v27-score-dimensions { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; list-style: none; padding: 0; margin: 0; } .ne-product-card.ne-card-v27 .ne-card-v27-score-dim { display: flex; flex-direction: column; gap: 4px; padding: 6px 5px; background: #fff; border-radius: 6px; font-size: 0.85em; min-width: 0; } .ne-product-card.ne-card-v27 .ne-card-v27-score-dim-label { color: #555; font-weight: 600; font-size: 0.74em; letter-spacing: -0.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center; } .ne-product-card.ne-card-v27 .ne-card-v27-score-dim-bar { display: block; height: 4px; background: linear-gradient(90deg, #1a3d5c var(--score, 0%), #e5e7eb var(--score, 0%)); border-radius: 2px; } .ne-product-card.ne-card-v27 .ne-card-v27-score-dim-value { font-weight: 700; color: #1a3d5c; text-align: right; } .ne-product-card.ne-card-v27 .ne-card-v27-stores { display: grid; grid-template-columns: 1fr; gap: 8px; margin: 16px 0; } .ne-product-card.ne-card-v27.ne-card-variant-bottom .ne-card-v27-stores { grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); } .ne-product-card.ne-card-v27.ne-card-variant-bottom .ne-card-v27-store { flex-direction: column; justify-content: center; gap: 2px; padding: 10px 8px; text-align: center; } .ne-product-card.ne-card-v27 .ne-card-v27-store { display: flex; flex-direction: row; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 16px; border-radius: 8px; text-decoration: none; color: #fff; font-weight: 700; font-size: 0.92em; text-align: center; transition: transform 200ms ease, box-shadow 200ms ease; } .ne-product-card.ne-card-v27 .ne-card-v27-store:hover { transform: translateY(-1px); box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2); color: #fff; } .ne-product-card.ne-card-v27 .ne-card-v27-store-official { background: #ef6c00; box-shadow: 0 2px 6px rgba(239, 108, 0, 0.35); } .ne-product-card.ne-card-v27 .ne-card-v27-store-official:hover { background: #e65100; } .ne-product-card.ne-card-v27 .ne-card-v27-store-rakuten { background: #ffffff; color: #bf0000; border: 2px solid #bf0000; } .ne-product-card.ne-card-v27 .ne-card-v27-store-rakuten:hover { background: #fff5f5; color: #bf0000; } .ne-product-card.ne-card-v27 .ne-card-v27-store-amazon { background: #ffffff; color: #b26500; border: 2px solid #ff9900; } .ne-product-card.ne-card-v27 .ne-card-v27-store-amazon:hover { background: #fff8ec; color: #b26500; } .ne-product-card.ne-card-v27 .ne-card-v27-store-yahoo { background: #ffffff; color: #d6002f; border: 2px solid #ff0033; } .ne-product-card.ne-card-v27 .ne-card-v27-store-yahoo:hover { background: #fff5f7; color: #d6002f; } .ne-product-card.ne-card-v27 .ne-card-v27-store-label { font-size: 0.85em; opacity: 0.95; } .ne-product-card.ne-card-v27 .ne-card-v27-store-price { font-size: 1.05em; font-weight: 800; } .ne-product-card.ne-card-v27 .ne-card-v27-review { margin: 24px 0; } .ne-product-card.ne-card-v27 .ne-card-v27-review-h2 { font-size: 1.15em !important; font-weight: 800 !important; color: #1a3d5c !important; border: none !important; border-left: 4px solid #1a3d5c !important; padding: 0 0 0 10px !important; margin: 0 0 14px !important; line-height: 1.4; } .ne-product-card.ne-card-v27 .ne-card-v27-review-para { margin: 0 0 1em; font-size: 0.95em; line-height: 1.7; color: #222; } .ne-product-card.ne-card-v27 .ne-card-v27-review-para .ne-highlight { background: linear-gradient(transparent 60%, #fef3c7 60%); } .ne-product-card.ne-card-v27 .ne-card-v27-pros-cons { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 20px 0; } .ne-product-card.ne-card-v27 .ne-card-v27-pros, .ne-product-card.ne-card-v27 .ne-card-v27-cons { padding: 12px 16px; border-radius: 8px; } .ne-product-card.ne-card-v27 .ne-card-v27-pros { background: #fff5f5; border: 1px solid #dc2626; } .ne-product-card.ne-card-v27 .ne-card-v27-cons { background: #f5f5f5; border: 1px solid #d1d5db; } .ne-product-card.ne-card-v27 .ne-card-v27-pros h4, .ne-product-card.ne-card-v27 .ne-card-v27-cons h4 { margin: 0 0 8px !important; padding: 0 !important; font-size: 1em !important; font-weight: 700 !important; } .ne-product-card.ne-card-v27 .ne-card-v27-pros h4 { color: #dc2626 !important; } .ne-product-card.ne-card-v27 .ne-card-v27-cons h4 { color: #555 !important; } .ne-product-card.ne-card-v27 .ne-card-v27-pros ul, .ne-product-card.ne-card-v27 .ne-card-v27-cons ul { margin: 0; padding-left: 1.2em; font-size: 0.9em; line-height: 1.6; } .ne-product-card.ne-card-v27 .ne-card-v27-measured { margin: 20px 0; background: #f9fafb; border-radius: 8px; padding: 14px 16px; } .ne-product-card.ne-card-v27 .ne-card-v27-measured h4 { margin: 0 0 8px !important; padding: 0 !important; font-size: 1em !important; font-weight: 700 !important; color: #1a3d5c !important; } .ne-product-card.ne-card-v27 .ne-card-v27-measured-table { width: 100%; border-collapse: collapse; font-size: 0.92em; } .ne-product-card.ne-card-v27 .ne-card-v27-measured-table th, .ne-product-card.ne-card-v27 .ne-card-v27-measured-table td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; text-align: left; vertical-align: top; } .ne-product-card.ne-card-v27 .ne-card-v27-measured-table th { width: 35%; font-weight: 700; color: #555; } .ne-product-card.ne-card-v27 .ne-card-v27-reviews { margin: 20px 0 0; } .ne-product-card.ne-card-v27 .ne-card-v27-reviews h4 { margin: 0 0 8px !important; padding: 0 !important; font-size: 1em !important; font-weight: 700 !important; color: #1a3d5c !important; } .ne-product-card.ne-card-v27 .ne-card-v27-reviews-empty-message { margin: 0; padding: 12px 14px; background: #f3f4f6; color: #6b7280; border-radius: 6px; font-size: 0.9em; text-align: center; } .ne-product-card.ne-card-v27 .ne-card-v27-reviews-scroll { display: flex; gap: 12px; overflow-x: auto; padding: 6px 0 10px; } .ne-product-card.ne-card-v27 .ne-card-v27-review-card { flex: 0 0 280px; padding: 12px; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; font-size: 0.9em; } .ne-product-card.ne-card-v27.ne-card-variant-summary { display: flex; flex-direction: row; gap: 16px; max-width: 720px; margin: 24px auto; padding: 16px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08); border: 1px solid #e5e7eb; background: #fff; } .ne-product-card.ne-card-v27.ne-card-variant-summary .ne-card-v27-summary-score { display: flex; align-items: baseline; gap: 4px; margin: 8px 0; } .ne-product-card.ne-card-v27.ne-card-variant-bottom { max-width: 720px; margin: 28px auto; padding: 16px 20px; border-radius: 12px; background: #fffbf2; border: 1px solid #fde68a; } @media (max-width: 767px) { .ne-product-card.ne-card-v27 .ne-card-v27-header { flex-direction: column; } .ne-product-card.ne-card-v27 .ne-card-v27-header > .ne-card-image { flex: 0 0 auto; width: 100%; max-width: none; min-width: 0; } .ne-product-card.ne-card-v27 .ne-card-v27-header > .ne-card-image img { max-height: 280px; object-fit: cover; width: 100%; } } @media (max-width: 640px) { .ne-product-card.ne-card-v27 .ne-card-v27-score-dimensions { grid-template-columns: repeat(2, minmax(0, 1fr)); } .ne-product-card.ne-card-v27 .ne-card-v27-pros-cons { grid-template-columns: 1fr; } .ne-product-card.ne-card-v27.ne-card-variant-summary { flex-direction: column; } } .ne-product-card table th, .ne-product-card table td { border-color: #dbe6f3 !important; } .ne-product-card .ne-card-spec th { border-bottom: 1px solid #dbe6f3 !important; } .ne-product-card .ne-card-v27-cta-bottom { display: flex; flex-direction: column; gap: 8px; margin-top: 20px; } .ne-product-card .ne-card-v27-cta-bottom .ne-card-v27-cta-main { display: flex; align-items: center; justify-content: center; gap: 10px; background: #ef6c00; color: #ffffff !important; font-weight: 700; font-size: 1.05em; padding: 15px 20px; border-radius: 8px; text-decoration: none; box-shadow: 0 2px 6px rgba(239, 108, 0, 0.35); transition: background 0.2s ease, transform 0.1s ease; } .ne-product-card .ne-card-v27-cta-bottom .ne-card-v27-cta-main:hover { background: #e65100; transform: translateY(-1px); color: #ffffff !important; } .ne-product-card .ne-card-v27-cta-bottom .ne-card-v27-cta-main-price { font-size: 0.9em; font-weight: 800; opacity: 0.95; } .ne-product-card .ne-card-v27-cta-bottom .ne-card-v27-cta-sub { display: flex; gap: 8px; } .ne-product-card .ne-card-v27-cta-bottom .ne-card-v27-cta-subbtn { flex: 1; text-align: center; padding: 9px 10px; border-radius: 6px; font-size: 0.85em; font-weight: 700; text-decoration: none; background: #ffffff; } .ne-product-card .ne-card-v27-cta-bottom .ne-card-v27-cta-sub-amazon { color: #b26500; border: 2px solid #ff9900; } .ne-product-card .ne-card-v27-cta-bottom .ne-card-v27-cta-sub-amazon:hover { background: #fff8ec; color: #b26500; } .ne-product-card .ne-card-v27-cta-bottom .ne-card-v27-cta-sub-yahoo { color: #d6002f; border: 2px solid #ff0033; } .ne-product-card .ne-card-v27-cta-bottom .ne-card-v27-cta-sub-yahoo:hover { background: #fff5f7; color: #d6002f; }",
].join('');
