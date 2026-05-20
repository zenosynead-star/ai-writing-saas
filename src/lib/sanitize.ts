import DOMPurify from 'isomorphic-dompurify';

/**
 * AI生成HTMLを安全にする（XSS対策）。
 * <script>/<iframe>/<embed> や on* イベントハンドラを除去。
 * 生成記事に必要な以下のタグは許可。
 */
const ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'br', 'hr',
  'strong', 'em', 'b', 'i', 'u', 'mark', 'small', 's',
  'a',
  'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
  'blockquote', 'q', 'cite',
  'code', 'pre', 'kbd',
  'span', 'div',
  'figure', 'figcaption',
  'img',
];

const ALLOWED_ATTR = [
  'href', 'target', 'rel', 'title',
  'src', 'alt', 'width', 'height',
  'class', 'id',
  'colspan', 'rowspan',
];

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_TAGS: ['script', 'style', 'iframe', 'embed', 'object', 'form', 'input', 'button'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur', 'style'],
    ALLOW_DATA_ATTR: false,
  });
}
