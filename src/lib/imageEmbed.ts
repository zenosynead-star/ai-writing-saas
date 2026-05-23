/**
 * 本文HTMLに h2 直後の <figure><img> を自動挿入するユーティリティ。
 * 既存の挿入済み画像があれば全削除してから入れ直すので、重複しない。
 */

export interface H2ImageRef {
  id: string;     // ArticleImage.id
  h2Index: number;
  alt?: string;
}

const MARKER_CLASS = 'awsaas-h2-image';

/** 既存の挿入済み画像 figure を全削除 */
export function stripExistingH2Images(html: string): string {
  // <figure class="awsaas-h2-image">...</figure> を改行も含めて削除
  return html.replace(
    new RegExp(`\\s*<figure\\b[^>]*class=["'][^"']*${MARKER_CLASS}[^"']*["'][^>]*>[\\s\\S]*?<\\/figure>\\s*`, 'gi'),
    '\n'
  );
}

/**
 * h2 直後に画像を挿入。
 * - 既存の挿入済み(マーカー付き)はまず削除
 * - h2Index で対応する画像を h2 の閉じタグ直後に <figure><img> として挿入
 */
export function embedH2Images(
  html: string,
  images: H2ImageRef[],
  imageBaseUrl = '/api/images',
): string {
  const stripped = stripExistingH2Images(html);

  // h2 要素を順に処理
  let h2Idx = 0;
  return stripped.replace(/(<h2\b[^>]*>([\s\S]*?)<\/h2>)/gi, (match, _full, inner) => {
    const img = images.find((i) => i.h2Index === h2Idx);
    h2Idx++;
    if (!img) return match;
    const alt = (img.alt || (inner as string).replace(/<[^>]+>/g, '').trim() || `セクション${h2Idx}`)
      .replace(/"/g, '&quot;');
    const figure = `\n<figure class="${MARKER_CLASS}"><img src="${imageBaseUrl}/${img.id}" alt="${alt}" loading="lazy" /></figure>\n`;
    return `${match}${figure}`;
  });
}

/** 本文HTML中の h2 数を数える */
export function countH2(html: string): number {
  return (html.match(/<h2\b/gi) || []).length;
}
