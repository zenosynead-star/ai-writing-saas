import sanitizeHtmlLib from 'sanitize-html';

/**
 * AI生成HTMLを安全にする（XSS対策）。
 * sanitize-html を使用（pure JS / SSR で安全に動く / 依存軽量）。
 * <script>/<iframe>/<embed> や on* イベントハンドラを除去。
 */
export function sanitizeHtml(html: string): string {
  return sanitizeHtmlLib(html, {
    allowedTags: [
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
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel', 'title'],
      img: ['src', 'alt', 'width', 'height', 'title'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan'],
      '*': ['class', 'id'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    // on* イベントハンドラと style は default で禁止
    disallowedTagsMode: 'discard',
    transformTags: {
      a: (tagName, attribs) => ({
        tagName: 'a',
        attribs: {
          ...attribs,
          rel: 'noopener noreferrer',
          target: '_blank',
        },
      }),
    },
  });
}
