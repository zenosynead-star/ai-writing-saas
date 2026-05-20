/**
 * リライト機能用: 取得HTMLから記事構造を抽出する軽量パーサ。
 * 外部依存（cheerio等）を使わず、正規表現＋簡易ステートマシンで実装。
 *
 * 抽出対象:
 * - <title>
 * - <meta name="description">
 * - 本文と思われる領域から h2-h4 ツリーと段落テキスト
 *
 * ノイズ除去:
 * - <script>, <style>, <nav>, <header>, <footer>, <aside> のブロックを除外
 * - 主要なコンテンツコンテナ (article, main, [role=main]) を優先
 */

export interface ParsedHeading {
  level: number;
  text: string;
  children: ParsedHeading[];
}

export interface ParsedArticle {
  title: string;
  metaDescription: string;
  ogTitle?: string;
  ogDescription?: string;
  headings: ParsedHeading[];
  paragraphs: string[];
  bodyText: string;
  wordCount: number;
  bodyHtml: string;
}

/** タグの中身を取り出す（最も外側のマッチ、属性無視）。 */
function extract(html: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = html.match(re);
  return m ? m[1] : null;
}

/** <meta name="X" content="Y"> あるいは property="X" content="Y" の content を返す。 */
function extractMeta(html: string, name: string, attr: 'name' | 'property' = 'name'): string {
  const re = new RegExp(`<meta\\s+[^>]*${attr}=["']${name}["'][^>]*>`, 'i');
  const m = html.match(re);
  if (!m) return '';
  const content = m[0].match(/content=["']([^"']*)["']/i);
  return content ? decodeEntities(content[1]) : '';
}

/** 危険・ノイズタグのブロックを除去 */
function stripNoiseTags(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
}

/**
 * 主要コンテンツコンテナを優先的に取り出す。
 * article > main > [role=main] > body の順で試す。
 */
function findMainContainer(html: string): string {
  for (const tag of ['article', 'main']) {
    const found = extract(html, tag);
    if (found && found.length > 200) return found;
  }
  // role=main コンテナ
  const roleMatch = html.match(/<(div|section)\b[^>]*role=["']main["'][^>]*>([\s\S]*?)<\/\1>/i);
  if (roleMatch && roleMatch[2].length > 200) return roleMatch[2];
  // フォールバック: body 全体
  const body = extract(html, 'body');
  return body || html;
}

const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

function decodeEntities(s: string): string {
  return s.replace(/&[a-z#0-9]+;/gi, (m) => {
    if (ENTITY_MAP[m]) return ENTITY_MAP[m];
    const num = m.match(/^&#(\d+);$/);
    if (num) return String.fromCharCode(Number(num[1]));
    const hex = m.match(/^&#x([0-9a-f]+);$/i);
    if (hex) return String.fromCharCode(parseInt(hex[1], 16));
    return m;
  });
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

/** 順序通りの見出し配列を h2-h4 階層ツリーに変換 */
function buildHeadingTree(flat: { level: number; text: string }[]): ParsedHeading[] {
  const roots: ParsedHeading[] = [];
  const stack: ParsedHeading[] = [];
  for (const h of flat) {
    const node: ParsedHeading = { level: h.level, text: h.text, children: [] };
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }
    stack.push(node);
  }
  return roots;
}

export function parseArticle(rawHtml: string): ParsedArticle {
  const cleaned = stripNoiseTags(rawHtml);

  // タイトル系
  const title = stripTags(extract(rawHtml, 'title') || '');
  const metaDescription = extractMeta(rawHtml, 'description', 'name');
  const ogTitle = extractMeta(rawHtml, 'og:title', 'property');
  const ogDescription = extractMeta(rawHtml, 'og:description', 'property');

  // 本文領域
  const main = findMainContainer(cleaned);

  // h2-h4 を順序通りに抽出
  const headingRe = /<h([234])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  const flatHeadings: { level: number; text: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(main)) !== null) {
    const text = stripTags(m[2]);
    if (text) flatHeadings.push({ level: Number(m[1]), text });
  }
  const headings = buildHeadingTree(flatHeadings);

  // 段落 (p 要素のテキストを抽出)
  const paragraphs: string[] = [];
  const pRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  while ((m = pRe.exec(main)) !== null) {
    const text = stripTags(m[1]);
    if (text.length > 20) paragraphs.push(text);
  }

  const bodyText = stripTags(main);
  const wordCount = bodyText.length;

  // 本文HTMLの簡易クリーン版: 主要コンテンツのみ
  const bodyHtml = main.trim();

  return {
    title,
    metaDescription,
    ogTitle: ogTitle || undefined,
    ogDescription: ogDescription || undefined,
    headings,
    paragraphs,
    bodyText,
    wordCount,
    bodyHtml,
  };
}

/** プロンプトに渡すための見出しツリーをMarkdown風文字列に */
export function headingsToMarkdown(headings: ParsedHeading[]): string {
  const lines: string[] = [];
  const walk = (nodes: ParsedHeading[]) => {
    for (const n of nodes) {
      lines.push(`${'#'.repeat(n.level)} ${n.text}`);
      if (n.children.length) walk(n.children);
    }
  };
  walk(headings);
  return lines.join('\n');
}
