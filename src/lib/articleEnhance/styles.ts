/**
 * 記事に注入するデザイン CSS（wp-article-rewriter restyle "cv2026" プリセット移植）。
 *
 * リテラが公開する記事は SANGO テーマ素のままで装飾が弱い。wp-rewriter と同じ
 * cv2026 CSS（濃青下線 h2 / 黄マーカー strong / 淡青の表 / フラットなチェックリスト /
 * SANGO カスタマイザー手書き CSS を !important で無効化）を `<style data-ne-restyle>`
 * として記事冒頭に注入し、本番の公開記事と同等の見た目に揃える。
 *
 * accent は cv2026 既定の濃青 #2563eb。セレクタは wp-rewriter と同一
 * (.entry-content / .post-content / article) なので同じ CSS が効く。
 * Stage 2(関連カード) / Stage 3(商品カード) の CSS も ARTICLE_CSS に結合していく。
 *
 * 注入は「公開段（sanitize 後）」で行う。生成時 sanitize は <style> を除去するが、
 * publish route は sanitize 後の bodyHtml に対して prepend するため保持される。
 * 移植元: wp-article-rewriter `src/wp_article_rewriter/restyle/styles.py:235-460`
 */

import { PRODUCT_CARD_CSS } from './productCards';

/** 重複挿入防止マーカー（この属性を持つ <style> があれば再注入しない）。 */
export const RESTYLE_MARKER = 'data-ne-restyle';

const ACCENT = '#2563eb'; // cv2026 既定の濃青（青=リンクの学習効果で CTR 最大化）

/** cv2026 本体（見出し/本文/strong/リンク/リスト/表/blockquote + カード leak ガード）。 */
const CV2026_CSS = `
/* リテラ articleEnhance restyle (cv2026) */
.entry-content h2, .post-content h2, article h2 {
  position: static !important;
  background: transparent !important;
  color: #222222 !important;
  border-left: none !important;
  border-bottom: 3px solid ${ACCENT} !important;
  padding: 0 0 10px 2px !important;
  margin: 2.5em 0 1em !important;
  font-size: 1.5em !important;
  font-weight: 700 !important;
  line-height: 1.4 !important;
  letter-spacing: 0.01em;
}
.entry-content h2::before, .entry-content h2::after,
article h2::before, article h2::after { content: none !important; border: none !important; }
.entry-content h3, .post-content h3, article h3 {
  display: block !important;
  background: transparent !important;
  color: #222222 !important;
  border-bottom: none !important;
  border-left: 4px solid ${ACCENT} !important;
  border-radius: 0 !important;
  padding: 2px 0 2px 12px !important;
  margin: 2em 0 0.8em !important;
  font-size: 1.25em !important;
  font-weight: 700 !important;
  line-height: 1.45 !important;
}
.entry-content h4, article h4 {
  position: static !important;
  background: transparent !important;
  color: #222222 !important;
  padding: 0 !important;
  margin: 1.6em 0 0.6em !important;
  font-size: 1.1em !important;
  font-weight: 700 !important;
}
.entry-content h4::before, .entry-content h4::after,
article h4::before, article h4::after { content: none !important; border: none !important; }
.entry-content p, .post-content p, article p {
  font-size: 16px;
  line-height: 1.8;
  color: #333333;
  margin: 0 0 1.6em;
}
.entry-content strong, article strong {
  background: linear-gradient(transparent 60%, #ffe896 40%);
  font-weight: 700;
  color: #222222;
  padding: 0 1px;
}
.entry-content p > a, .entry-content li > a {
  color: ${ACCENT};
  text-decoration: underline;
  text-underline-offset: 3px;
  font-weight: 600;
}
.entry-content ul {
  border: none !important;
  background: #f7f8fa !important;
  border-radius: 8px;
  padding: 14px 18px 14px 14px !important;
  margin: 1.2em 0 1.6em;
  list-style: none;
}
.entry-content ul li {
  position: relative;
  padding: 4px 0 4px 26px !important;
  margin: 0;
  line-height: 1.7 !important;
  color: #333333 !important;
  font-size: 15.5px;
}
.entry-content ul li::before {
  content: "✓";
  position: absolute;
  left: 4px;
  top: 4px;
  color: ${ACCENT};
  font-weight: 700;
}
.entry-content ol { margin: 1.2em 0 1.6em; padding-left: 1.6em; }
.entry-content ol li { line-height: 1.7; color: #333333; padding: 3px 0; }
.entry-content ol li::marker { color: ${ACCENT}; font-weight: 700; }
.ne-product-card h2, .ne-product-card h3, .ne-product-card h4 {
  border: none !important;
  margin-top: 0 !important;
}
.ne-product-card ul { background: transparent !important; padding: 0 !important; }
.ne-product-card ul li::before { content: none !important; }
.ne-related-card-v2 h3 { border: none !important; padding: 0 !important; margin: 0 !important; }
.entry-content table {
  width: 100%;
  max-width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  border: 1px solid #dbe6f3;
  border-top: 2px solid ${ACCENT};
  border-radius: 0 0 8px 8px;
  overflow: hidden;
  margin: 1.2em 0 1.8em;
  table-layout: auto;
  background: #ffffff;
}
.entry-content table th {
  background: #eef5ff !important;
  color: #1d3f6e !important;
  font-weight: 700;
  padding: 12px 10px;
  border-bottom: 1px solid #dbe6f3;
  text-align: left;
  font-size: 14.5px;
  word-break: break-word;
  overflow-wrap: break-word;
}
.entry-content table td {
  padding: 12px 10px;
  border-bottom: 1px solid #dbe6f3;
  color: #333333;
  font-size: 14.5px;
  line-height: 1.6;
  background: #ffffff;
  word-break: break-word;
  overflow-wrap: break-word;
}
.entry-content table tr:nth-child(even) td { background: #f7fafd; }
.entry-content table tr:last-child td { border-bottom: none; }
.entry-content blockquote {
  border-left: 4px solid ${ACCENT};
  background: #eaf3fe;
  border-radius: 0 8px 8px 0;
  padding: 14px 18px;
  margin: 1.4em 0;
  color: #333333;
  font-style: normal;
}
time.pubdate.entry-time { display: none !important; }
.entry-meta .pubdate { display: none !important; }
@media (max-width: 767px) {
  .entry-content table { display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .entry-content h2 { font-size: 1.35em !important; }
  .entry-content h3 { font-size: 1.17em !important; }
  .entry-content table th, .entry-content table td { padding: 9px 8px; font-size: 13.5px; }
}`;

/** 見出し画像（ne-heading-image）の見せ方。wp-rewriter の figure を整列・角丸・中央寄せ。 */
const HEADING_IMAGE_CSS = `
.entry-content figure.ne-heading-image, article figure.ne-heading-image {
  margin: 1.2em auto 1.6em;
  text-align: center;
}
.entry-content figure.ne-heading-image img, article figure.ne-heading-image img {
  width: 100%;
  max-width: 760px;
  height: auto;
  border-radius: 10px;
  display: block;
  margin: 0 auto;
}`;

/** 関連記事カード v2（wp-rewriter `product_card/styles.py:_build_v26_css` 移植。accent #2563eb / arrow 橙 #ef6c00、編集記事風の淡青フラットカード）。 */
const RELATED_CARD_CSS = `
/* リテラ articleEnhance related-card-v2 (wpautop-safe editorial card) */
.ne-related-card-v2 {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  gap: 16px;
  margin: 28px 0;
  padding: 16px;
  border: 1px solid #dbe6f3;
  border-left: 4px solid #2563eb;
  border-radius: 8px;
  background: #eaf3fe;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  overflow: hidden;
  text-decoration: none;
  transition: box-shadow 0.2s ease, transform 0.2s ease;
}
.ne-related-card-v2:hover { box-shadow: 0 4px 14px rgba(37,99,235,0.18); transform: translateY(-2px); }
.ne-related-card-v2__thumb { flex: 0 0 200px; max-width: 200px; aspect-ratio: 16 / 9; margin: 0; overflow: hidden; border-radius: 8px; }
.ne-related-card-v2__thumb a { display: block; width: 100%; height: 100%; }
.ne-related-card-v2__thumb img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.3s ease; }
.ne-related-card-v2:hover .ne-related-card-v2__thumb img { transform: scale(1.04); }
.ne-related-card-v2__body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 6px; }
.ne-related-card-v2__label { color: #2563eb; font-weight: 700; font-size: 0.8em; letter-spacing: 0.02em; }
.ne-related-card-v2__title {
  background: none !important;
  border: none !important;
  border-left: none !important;
  padding: 0 !important;
  margin: 0 !important;
  display: block !important;
  font-size: 1.15em !important;
  font-weight: 700 !important;
  line-height: 1.4 !important;
  color: #1a1a1a !important;
}
.ne-related-card-v2__title a { color: inherit; text-decoration: none; }
.ne-related-card-v2:hover .ne-related-card-v2__title { color: #2563eb !important; }
.ne-related-card-v2__desc {
  color: #666666;
  font-size: 0.88em;
  line-height: 1.6;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.ne-related-card-v2__arrow {
  display: inline-block;
  align-self: flex-start;
  background: #ef6c00;
  color: #ffffff !important;
  font-weight: 700;
  font-size: 0.85em;
  text-decoration: none !important;
  text-align: center;
  padding: 7px 16px;
  border-radius: 6px;
  margin-top: 6px;
  transition: background 0.2s ease, transform 0.2s ease;
}
.ne-related-card-v2:hover .ne-related-card-v2__arrow { background: #e65100; transform: translateX(4px); }
.ne-related-card-v2:not(:has(.ne-related-card-v2__thumb)) { padding: 20px; }
@media (max-width: 640px) {
  .ne-related-card-v2 { flex-direction: column; }
  .ne-related-card-v2__thumb { flex: 0 0 auto; max-width: 100%; width: 100%; aspect-ratio: 16 / 9; }
}`;

/**
 * 記事に注入する CSS 全体（cv2026 + 見出し画像 + 関連カード + 商品カード v27）。
 */
export const ARTICLE_CSS = [CV2026_CSS, HEADING_IMAGE_CSS, RELATED_CARD_CSS, PRODUCT_CARD_CSS].join('\n');

/** `<style data-ne-restyle="auto">…</style>` を生成。 */
export function buildStyleBlock(): string {
  return `<style ${RESTYLE_MARKER}="auto">${ARTICLE_CSS}</style>`;
}

/**
 * 記事 HTML の冒頭にデザイン CSS の <style> ブロックを付与する（冪等）。
 * 既に data-ne-restyle 付き <style> があれば二重注入を避けてそのまま返す。
 */
export function prependStyleBlock(html: string): string {
  if (!html) return html;
  if (html.includes(`${RESTYLE_MARKER}=`)) return html;
  return `${buildStyleBlock()}\n${html}`;
}
