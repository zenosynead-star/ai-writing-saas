/**
 * 関連記事ファネル（wp-article-rewriter internal_link 移植）。
 *
 * マネーページ（おすすめ/ランキング = cv_priority 1）と中間ページ（選び方 = cv_priority 2）への
 * 「関連カード v2」を、記事の2つ目の h2 直前（primary）と「まとめ/結論」h2 直前（secondary）に
 * 配置して回遊・CV を高める。リテラの公開記事はインラインリンクのみで、この導線が無かった。
 *
 * HTML は wp-rewriter `internal_link/engine.py:build_related_card_v2_html` 準拠（wpautop 対策で
 * タグ間改行なしの1行化、root は <div>、クリックは内側の inline <a> に付与）。
 * ハブ定義は wp-rewriter `data/hub_articles.yaml` のスナップショット。
 * CSS は styles.ts の RELATED_CARD_CSS（.ne-related-card-v2）に同梱。
 */

export interface Hub {
  postId: number;
  cvPriority: 1 | 2; // 1=マネーページ(おすすめ/ランキング) / 2=中間ページ(選び方)
  title: string;
  url: string;
  targetKeywords: string[];
  anchorText: string;
  thumbnailUrl: string;
  description: string;
}

/** wp-rewriter data/hub_articles.yaml のスナップショット（マネーページ + 中間ページ）。 */
export const HUBS: Hub[] = [
  {
    postId: 445,
    cvPriority: 1,
    title: '【2026年最新】ゲーミングチェアおすすめ人気ランキング20選',
    url: 'https://www.naturaledge.jp/media/?p=445',
    targetKeywords: ['ゲーミングチェア おすすめ', 'ゲーミングチェア ランキング', 'ゲーミングチェア 比較'],
    anchorText: 'ゲーミングチェアおすすめ人気ランキング20選はこちら',
    thumbnailUrl: 'https://www.naturaledge.jp/media/wp-content/uploads/2026/02/1770072057.png',
    description:
      '長時間のゲームやデスクワークによる腰の痛みや疲れにお悩みではありませんか？ゲーミングチェアは、正しい姿勢を維持し、集中力を高めるための投資として最適です。',
  },
  {
    postId: 723,
    cvPriority: 1,
    title: '電動昇降デスクおすすめ10選',
    url: 'https://www.naturaledge.jp/media/?p=723',
    targetKeywords: ['電動昇降デスク おすすめ', '電動昇降デスク 比較', '昇降デスク おすすめ'],
    anchorText: '電動昇降デスクおすすめ10選はこちら',
    thumbnailUrl: 'https://www.naturaledge.jp/media/wp-content/uploads/2026/02/1772239059.png',
    description:
      '長時間のデスクワークによる腰痛・肩こりに悩んでいるなら、電動昇降デスクの導入が根本的な解決策になり得る。',
  },
  {
    postId: 760,
    cvPriority: 1,
    title: 'ゲーミングデスクおすすめ完全ガイド',
    url: 'https://www.naturaledge.jp/media/?p=760',
    targetKeywords: ['ゲーミングデスク おすすめ', 'ゲーミングデスク 選び方', 'ゲーミングデスク ランキング'],
    anchorText: 'ゲーミングデスクおすすめランキング完全ガイドはこちら',
    thumbnailUrl: '',
    description:
      'ゲーミングデスク選びで「サイズが足りなかった」「グラついて集中できない」といった失敗をしないために、天板サイズや形状・耐荷重・昇降機能など選び方の全ポイントを解説。',
  },
  {
    postId: 451,
    cvPriority: 2,
    title: '失敗しないゲーミングチェアの選び方',
    url: 'https://www.naturaledge.jp/media/?p=451',
    targetKeywords: ['ゲーミングチェア 選び方', 'ゲーミングチェア 日本製', 'ゲーミングチェア 国産'],
    anchorText: '失敗しないゲーミングチェアの選び方はこちら',
    thumbnailUrl: 'https://www.naturaledge.jp/media/wp-content/uploads/2026/02/1770074090.png',
    description:
      '「ゲーミングチェア日本製」で検索したあなたは、安価な海外製品の品質に不安を感じ、長く愛用できる確かな一脚をお探しではないでしょうか。',
  },
  {
    postId: 542,
    cvPriority: 2,
    title: '社長椅子の選び方決定版',
    url: 'https://www.naturaledge.jp/media/?p=542',
    targetKeywords: ['社長椅子 選び方', '社長椅子 おすすめ', '高級 オフィスチェア'],
    anchorText: '社長椅子の選び方決定版はこちら',
    thumbnailUrl: 'https://www.naturaledge.jp/media/wp-content/uploads/2026/02/1770253649.png',
    description:
      'オフィスの象徴であり激務を支える社長椅子。重厚感と、長時間でも疲れにくい機能性のどちらも妥協したくない方へ。',
  },
  {
    postId: 640,
    cvPriority: 2,
    title: '失敗しないリクライニング座椅子の選び方',
    url: 'https://www.naturaledge.jp/media/?p=640',
    targetKeywords: ['リクライニング座椅子 選び方', '座椅子 おすすめ', 'リクライニング 座椅子'],
    anchorText: '失敗しないリクライニング座椅子の選び方はこちら',
    thumbnailUrl: 'https://www.naturaledge.jp/media/wp-content/uploads/2026/02/1770742282-2.png',
    description:
      '自宅でのリラックスタイムやテレワークを快適にするリクライニング座椅子。種類が多く選び方に迷う方へ。',
  },
];

const FUNNEL_PRIMARY_LABEL = '🏆 人気記事';
const FUNNEL_PRIMARY_ARROW = 'ランキングを今すぐ見る →';
const FUNNEL_SECONDARY_LABEL = '▶ 合わせて読みたい';
const FUNNEL_SECONDARY_ARROW = '詳しく見る →';
const CONCLUSION_RE = /(まとめ|結論|最後に|おわりに)/;

function escapeAttr(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeText(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 関連カード v2 の HTML（1行・wpautop 安全）。root は div、クリックは inline <a> に付与。 */
export function buildRelatedCardV2(hub: Hub, label: string, arrow: string): string {
  const url = escapeAttr(hub.url);
  const titleText = escapeText(hub.anchorText || hub.title || '');
  const lbl = escapeText(label);
  const arr = escapeText(arrow);
  const pid = String(hub.postId);
  const inner = ` data-ne-internal-link="auto" data-ne-hub-post-id="${pid}"`;
  const thumb = hub.thumbnailUrl.trim()
    ? `<div class="ne-related-card-v2__thumb ne-related-card-thumb"><a href="${url}"${inner}><img src="${escapeAttr(hub.thumbnailUrl)}" alt="${titleText}" loading="lazy"></a></div>`
    : '';
  const desc = hub.description.trim()
    ? `<p class="ne-related-card-v2__desc ne-related-card-desc">${escapeText(hub.description)}</p>`
    : '';
  const body =
    `<div class="ne-related-card-v2__body ne-related-card-body">` +
    `<span class="ne-related-card-v2__label ne-related-card-label">${lbl}</span>` +
    `<h3 class="ne-related-card-v2__title ne-related-card-title"><a href="${url}"${inner}>${titleText}</a></h3>` +
    `${desc}` +
    `<a class="ne-related-card-v2__arrow ne-related-card-arrow" href="${url}"${inner}>${arr}</a>` +
    `</div>`;
  return (
    `<div class="ne-related-card-v2 ne-related-card"` +
    ` data-ne-internal-link="auto" data-ne-hub-post-id="${pid}" data-ne-version="2">` +
    `${thumb}${body}</div>`
  );
}

/**
 * スコアリングから除外する汎用トークン（wp-rewriter `_FUNNEL_STOP_TOKENS` 移植）。
 * 「おすすめ」「比較」等はどのハブの targetKeywords にも現れ、ほぼ全記事に頻出するため、
 * これをカウントすると「炊飯器記事の primary が昇降デスク」のような無関係記事への誤挿入を招く。
 * ドメイン名詞（「ゲーミングチェア」「電動昇降デスク」等）だけで採点する。
 */
const STOP_TOKENS: ReadonlySet<string> = new Set([
  'おすすめ',
  'ランキング',
  '比較',
  '選び方',
  '人気',
  '高級',
  '最新',
  '失敗しない',
  '効果',
  '日本製',
  '国産',
]);

/** KW を空白分割し、汎用語（STOP_TOKENS）を除いたドメイントークンのみ返す。 */
function domainTokens(kw: string): string[] {
  return kw
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t && !STOP_TOKENS.has(t));
}

/**
 * ハブの記事適合度スコア。汎用語を除いたドメイントークンで採点する
 * （全ドメイントークン一致=2、部分一致=1 の合計）。0 なら不適合＝挿入しない。
 * ドメイントークンを 1 つも持たない KW（汎用語のみ）はカウント対象外。
 */
function hubScore(hub: Hub, haystack: string): number {
  let score = 0;
  for (const kw of hub.targetKeywords) {
    const tk = domainTokens(kw);
    if (tk.length === 0) continue; // 汎用語のみの KW は誤マッチ防止のため無視
    const present = tk.filter((t) => haystack.includes(t)).length;
    if (present === tk.length) score += 2;
    else if (present > 0) score += 1;
  }
  return score;
}

function bestHub(cv: 1 | 2, haystack: string, excludePostId?: number): Hub | undefined {
  return HUBS.filter((h) => h.cvPriority === cv && h.postId !== excludePostId)
    .map((h) => ({ h, s: hubScore(h, haystack) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)[0]?.h;
}

/**
 * `<table>...</table>` の (start, end[exclusive]) を列挙する（ネスト対応の深さカウンタ）。
 * wp-rewriter `_find_table_ranges` 移植。閉じタグが無い壊れた HTML は末尾までを 1 範囲とする（安全側）。
 */
function findTableRanges(html: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const lower = html.toLowerCase();
  const open = /<table\b/gi;
  let m: RegExpExecArray | null;
  let scanFrom = 0;
  while ((m = open.exec(html)) !== null) {
    if (m.index < scanFrom) continue; // 既存範囲の内側で見つかった開始タグはスキップ
    const start = m.index;
    let cursor = m.index + 6;
    let depth = 1;
    let end = html.length;
    while (cursor < html.length) {
      const openIdx = lower.indexOf('<table', cursor);
      const closeIdx = lower.indexOf('</table>', cursor);
      if (closeIdx === -1) {
        end = html.length;
        break;
      }
      if (openIdx !== -1 && openIdx < closeIdx) {
        depth += 1;
        cursor = openIdx + 6;
        continue;
      }
      depth -= 1;
      cursor = closeIdx + 8;
      if (depth === 0) {
        end = cursor;
        break;
      }
    }
    ranges.push([start, end]);
    scanFrom = end;
    open.lastIndex = end;
  }
  return ranges;
}

/** 挿入 index が table の内側に来たら table 末尾（exclusive end）へ送る（foster-parenting で全幅飛び出すのを防ぐ）。 */
function tableSafeIndex(index: number, ranges: Array<[number, number]>): number {
  let idx = index;
  for (const [s, e] of ranges) {
    if (s < idx && idx < e) idx = e;
  }
  return idx;
}

/**
 * 記事 HTML に関連記事ファネルを挿入する（冪等）。
 * primary（マネーページ=cv1）を2つ目の h2 直前、secondary（中間=cv2）を「まとめ」h2 直前に配置。
 * 適合するハブが無ければ挿入しない。商品カード内/表内には入らない（h2 境界=トップレベルに挿入）。
 */
export function insertFunnelCards(html: string, opts: { keywords: string[]; title: string }): string {
  if (!html) return html;
  const haystack = `${opts.title} ${(opts.keywords || []).join(' ')}`.toLowerCase();
  const primary = bestHub(1, haystack);
  const secondary = bestHub(2, haystack, primary?.postId);

  const alreadyPresent = (pid: number) => html.includes(`data-ne-hub-post-id="${pid}"`);

  // h2 開始タグ位置を収集
  const h2starts: number[] = [];
  const h2re = /<h2\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = h2re.exec(html)) !== null) h2starts.push(m.index);

  // table 内（td/th セル内に h2 がある異常出力など）に挿入 index が来たら末尾へ送るための範囲。
  // <table> 内に block カードを入れると wpautop の foster-parenting で .entry-content 外へ飛び出す。
  const tableRanges = findTableRanges(html);

  // order: 0=primary / 1=secondary。同一 pos での挿入順を文書順（primary が上）に固定するために使う。
  const inserts: Array<{ pos: number; order: 0 | 1; card: string }> = [];

  if (primary && !alreadyPresent(primary.postId)) {
    const pos = h2starts.length >= 2 ? h2starts[1] : h2starts.length === 1 ? h2starts[0] : html.length;
    inserts.push({ pos: tableSafeIndex(pos, tableRanges), order: 0, card: buildRelatedCardV2(primary, FUNNEL_PRIMARY_LABEL, FUNNEL_PRIMARY_ARROW) });
  }

  if (secondary && !alreadyPresent(secondary.postId)) {
    let pos = html.length;
    const ch2 = /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi;
    let mm: RegExpExecArray | null;
    while ((mm = ch2.exec(html)) !== null) {
      const inner = (mm[1] || '').replace(/<[^>]+>/g, '');
      if (CONCLUSION_RE.test(inner)) {
        pos = mm.index;
        break;
      }
    }
    inserts.push({ pos: tableSafeIndex(pos, tableRanges), order: 1, card: buildRelatedCardV2(secondary, FUNNEL_SECONDARY_LABEL, FUNNEL_SECONDARY_ARROW) });
  }

  // 右（末尾側）から挿入して index ずれを防ぐ。同一 pos のときは order 降順
  // （secondary を先に挿入）にすることで、結果の文書順は primary が上・secondary が下に固定される。
  // primary と secondary が同じ pos（例: h2 が 0/1 個でどちらも末尾）でも 2 枚が同位置で正しく順に並ぶ。
  inserts.sort((a, b) => b.pos - a.pos || b.order - a.order);
  let out = html;
  for (const ins of inserts) {
    out = out.slice(0, ins.pos) + ins.card + '\n' + out.slice(ins.pos);
  }
  return out;
}
