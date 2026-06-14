/**
 * WordPress `wpautop()` 相当の段落正規化を「保存前に」事前適用する。
 * wp-article-rewriter `wpautop_safe.py` の TS 移植。
 *
 * 真因: WordPress は記事表示時に `wpautop()` を再適用し、連続改行を <p> に変換する。
 * その際、関連カード/商品カード(div) 内の inline 要素(span/a)が <p> で包まれ、`</div>` が
 * <p> 内に閉じ込められてカード構造が壊れる（本番 post 3436 で実機確認）。
 *
 * 対処: 保存直前に wpautop 相当の正規化を済ませておく。WP の wpautop は冪等なので、
 * 「全段落が <p>、block 要素(カード/表/見出し/style)は <p> 非包含、余分な連続改行なし」に
 * 正規化済みの HTML は WP 側で再処理されても no-op になり、カードが壊れない。本関数も冪等。
 *
 * <pre> と <style> の中身は WP wpautop 同様プレースホルダで保護し、verbatim に保つ
 * （CSS の改行・記号を段落化で壊さないため）。LLM 非接触・WP 非接触の純粋関数。
 */

// WordPress formatting.php の wpautop が「<p>で包まない/前後に改行を入れる」block 要素。
const BLOCK_TAGS = [
  'table', 'thead', 'tfoot', 'caption', 'col', 'colgroup', 'tbody', 'tr', 'td', 'th', 'div', 'dl',
  'dd', 'dt', 'ul', 'ol', 'li', 'pre', 'form', 'map', 'area', 'blockquote', 'address', 'style', 'p',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'fieldset', 'legend', 'section', 'article', 'aside',
  'hgroup', 'header', 'footer', 'nav', 'figure', 'figcaption', 'details', 'menu', 'summary',
];
const ALLBLOCKS = `(?:${BLOCK_TAGS.join('|')})`;

/** <...> タグ内に限定して改行を空白へ置換（WP の _replace_in_html_tags 相当）。タグ外テキストは触らない。 */
function replaceNewlinesInTags(html: string): string {
  if (!html.includes('<')) return html;
  let out = '';
  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt < 0) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, lt);
    const gt = html.indexOf('>', lt);
    if (gt < 0) {
      out += html.slice(lt);
      break;
    }
    out += html.slice(lt, gt + 1).replace(/\n/g, ' ');
    i = gt + 1;
  }
  return out;
}

/**
 * `<tag ...>...</tag>` ブロックをプレースホルダへ退避（<pre>/<style> 保護）。WP wpautop と同じ手法。
 * store にプレースホルダ→原文を記録し、最後に restore する。
 */
function protectTag(html: string, tag: string, store: Record<string, string>): string {
  const openNeedle = `<${tag}`;
  if (!html.toLowerCase().includes(openNeedle)) return html;
  const close = `</${tag}>`;
  const parts = html.split(close);
  const last = parts.pop() ?? '';
  let rebuilt = '';
  parts.forEach((part, index) => {
    const start = part.toLowerCase().indexOf(openNeedle);
    if (start === -1) {
      // 壊れた構造（開きタグ無しの閉じタグ）はそのまま戻す
      rebuilt += part + close;
      return;
    }
    const placeholder = `<${tag} data-ne-protect-${tag}-${index}></${tag}>`;
    store[placeholder] = part.slice(start) + close;
    rebuilt += part.slice(0, start) + placeholder;
  });
  return rebuilt + last;
}

/**
 * WordPress `wpautop()` 相当の段落正規化を適用して返す（冪等）。
 * 保存前に通すことで、WP 側の wpautop がカード(block)を <p> 化して壊す事故を防ぐ。
 */
export function normalizeForWpautop(html: string): string {
  if (html == null) return '';
  if (html.trim() === '') return html;

  let pee = html + '\n\n';

  // <pre> / <style> の中身を保護（CSS や整形済みテキストを段落化で壊さない）
  const protectedStore: Record<string, string> = {};
  pee = protectTag(pee, 'pre', protectedStore);
  pee = protectTag(pee, 'style', protectedStore);

  pee = pee.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // block タグの直前/直後に \n\n を立て、各 block を独立段落にする（両側に入れるのが要点）
  pee = pee.replace(new RegExp(`(<${ALLBLOCKS}[\\s/>])`, 'g'), '\n\n$1');
  pee = pee.replace(new RegExp(`(</${ALLBLOCKS}>)`, 'g'), '$1\n\n');

  // タグ内に紛れた改行は段落判定の邪魔なので空白へ
  pee = replaceNewlinesInTags(pee);

  // 3 連以上の改行を 2 連へ圧縮
  pee = pee.replace(/\n\n+/g, '\n\n');

  // \n\n 区切りで段落化。block 要素で始まる段落は <p> で包まない、それ以外（本文/inline）は包む
  const startsWithBlock = new RegExp(`^</?${ALLBLOCKS}(?:\\s|/?>)`, 'i');
  const paragraphs = pee.split(/\n\s*\n/);
  const outParts: string[] = [];
  for (const part of paragraphs) {
    const stripped = part.trim();
    if (stripped === '') continue;
    outParts.push(startsWithBlock.test(stripped) ? stripped : `<p>${stripped}</p>`);
  }
  pee = outParts.join('\n');

  // 段落末尾に取り残された block 閉じタグ（例 inline CTA <a> 直後の </div>）を <p> の外へ押し出す
  pee = pee.replace(new RegExp(`(</${ALLBLOCKS}>)\\s*</p>`, 'g'), '</p>\n$1');
  // 段落先頭に食い込んだ block 開きタグを外へ
  pee = pee.replace(new RegExp(`<p>\\s*(<${ALLBLOCKS}[\\s/>])`, 'g'), '$1');
  // 空段落除去
  pee = pee.replace(/<p>\s*<\/p>/g, '');
  // <li> が <p> に包まれたら剥がす
  pee = pee.replace(/<p>\s*(<li[\s>][\s\S]*?)<\/p>/g, '$1');

  // 段落間の改行を 1 つに整え、前後の空行を除去（プレースホルダは 1 行なので位置は不変）
  pee = pee.replace(/\n\n+/g, '\n').replace(/^\n+|\n+$/g, '');

  // 保護した <pre>/<style> を最後に復元（改行整形より後に戻すことで CSS/整形済み
  // テキスト内の連続改行を verbatim に保つ。WP wpautop も script/style を最後まで保護する）
  for (const [placeholder, original] of Object.entries(protectedStore)) {
    pee = pee.split(placeholder).join(original);
  }

  return pee;
}
