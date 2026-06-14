/**
 * 競合分析パイプライン（リテラ相当のSEOロジックの心臓部）。
 *
 * フロー:
 *   1. Brave Search API でターゲットKWの上位 N 件 URL を取得
 *   2. 各ページを並列 fetchPage + parseArticle で取得・解析
 *   3. 上位サイトの見出し構造を集約（プロンプト注入用テキスト化）
 *   4. 本文・見出しから共起語（頻出キーフレーズ）を抽出
 *
 * 取得失敗・タイムアウトは握りつぶし、取れたものだけで分析する（可用性優先）。
 * Brave 無料枠は form-collector / infoproduct-collector と共有のため、
 * 1 記事につき検索リクエストは 1 回に抑える。
 */

import { fetchPage } from './fetcher';
import { parseArticle, headingsToMarkdown, type ParsedArticle, type ParsedHeading } from './htmlParser';

export interface CompetitorSource {
  url: string;
  title: string;
  wordCount: number;
  headingCount: number;
}

export interface CompetitorAnalysis {
  /** 検索に使ったクエリ */
  query: string;
  /** 実際に解析できた競合ページ */
  sources: CompetitorSource[];
  /** プロンプト注入用: サイトごとの見出しツリーをラベル付きで連結したテキスト */
  competitorHeadingsText: string;
  /** 共起語（頻出キーフレーズ）。多い順。 */
  cooccurrenceWords: string[];
  /** 競合上位の平均文字数（本文ボリュームの目安） */
  avgWordCount: number;
  /** 競合上位の最大文字数 */
  maxWordCount: number;
  /** 競合の平均見出し数（全レベル総数） */
  avgHeadingCount: number;
  /** 競合の最大見出し数（全レベル総数） */
  maxHeadingCount: number;
  /** 複数競合が共通で扱うトピック語（必須網羅の目安）。多い順。 */
  commonTopics: string[];
  /** 競合のタイトル一覧（タイトル設計の参考用） */
  competitorTitles: string[];
  /** 何件ヒットしたか（検索ボリュームの代理指標として参考表示） */
  totalEstimatedResults: number;
}

interface SearchHit {
  url: string;
  title: string;
  description?: string;
}

const BRAVE_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
const GOOGLE_CSE_ENDPOINT = 'https://www.googleapis.com/customsearch/v1';

/**
 * Brave Search API で上位 URL を取得する。
 * APIキーが無い / エラー / クォータ超過の場合は null（呼び出し側でフォールバック）。
 */
async function braveSearch(query: string, count: number): Promise<SearchHit[] | null> {
  const key = process.env.BRAVE_API_KEY;
  if (!key) return null;

  const params = new URLSearchParams({
    q: query,
    count: String(Math.min(count, 20)),
    country: 'JP',
    search_lang: 'jp',
    ui_lang: 'ja-JP',
    safesearch: 'moderate',
  });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15_000);
  try {
    const resp = await fetch(`${BRAVE_ENDPOINT}?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': key,
      },
      signal: ac.signal,
    });
    if (!resp.ok) {
      console.warn(`[competitorAnalysis] Brave ${resp.status}: ${(await resp.text()).slice(0, 160)}`);
      return null; // null = フォールバックを試す
    }
    const data = (await resp.json()) as {
      web?: { results?: Array<{ url: string; title: string; description?: string }> };
    };
    return (data.web?.results || []).map((r) => ({
      url: r.url,
      title: r.title,
      description: r.description,
    }));
  } catch (e) {
    console.warn('[competitorAnalysis] Brave fetch failed:', (e as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Google Custom Search JSON API で上位 URL を取得する（Brave のフォールバック）。
 * 無料枠 100 クエリ/日。
 */
async function googleCseSearch(query: string, count: number): Promise<SearchHit[] | null> {
  const key = process.env.GOOGLE_CSE_KEY;
  const cx = process.env.GOOGLE_CSE_CX;
  if (!key || !cx) return null;

  const params = new URLSearchParams({
    key,
    cx,
    q: query,
    num: String(Math.min(count, 10)), // CSE は最大 10
    hl: 'ja',
    gl: 'jp',
    lr: 'lang_ja',
  });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15_000);
  try {
    const resp = await fetch(`${GOOGLE_CSE_ENDPOINT}?${params.toString()}`, {
      headers: { Accept: 'application/json' },
      signal: ac.signal,
    });
    if (!resp.ok) {
      console.warn(`[competitorAnalysis] Google CSE ${resp.status}: ${(await resp.text()).slice(0, 160)}`);
      return null;
    }
    const data = (await resp.json()) as {
      items?: Array<{ link: string; title: string; snippet?: string }>;
    };
    return (data.items || []).map((r) => ({
      url: r.link,
      title: r.title,
      description: r.snippet,
    }));
  } catch (e) {
    console.warn('[competitorAnalysis] Google CSE fetch failed:', (e as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Gemini の Google Search グラウンディングで上位 URL を取得する（最終フォールバック）。
 * 専用の検索 API キー不要で、記事生成に使う GOOGLE_API_KEY をそのまま流用できる。
 * 返る URI は vertexaisearch のリダイレクト URL だが、fetchPage(redirect:follow) で実ページに解決される。
 */
async function geminiGroundingSearch(query: string): Promise<SearchHit[] | null> {
  const key = process.env.GOOGLE_API_KEY || process.env.GOOGLE_API_KEY_2;
  if (!key) return null;

  const model = process.env.GROUNDING_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: `「${query}」で検索し、上位の解説・比較記事のURLを列挙してください。` }] }],
    tools: [{ google_search: {} }],
  };

  // 503(高負荷)/ 429(レート) は短い指数バックオフでリトライ
  for (let attempt = 0; attempt < 3; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 20_000);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (!resp.ok) {
        const retryable = resp.status === 503 || resp.status === 429 || resp.status >= 500;
        console.warn(`[competitorAnalysis] Gemini grounding ${resp.status} (attempt ${attempt + 1}): ${(await resp.text()).slice(0, 120)}`);
        if (retryable && attempt < 2) {
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        return null;
      }
      const data = (await resp.json()) as {
        candidates?: Array<{
          groundingMetadata?: {
            groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
          };
        }>;
      };
      const chunks = data.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      const hits: SearchHit[] = [];
      const seen = new Set<string>();
      for (const c of chunks) {
        const uri = c.web?.uri;
        if (!uri || seen.has(uri)) continue;
        seen.add(uri);
        hits.push({ url: uri, title: c.web?.title || '' });
      }
      return hits;
    } catch (e) {
      console.warn(`[competitorAnalysis] Gemini grounding failed (attempt ${attempt + 1}):`, (e as Error).message);
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/**
 * 検索プロバイダの統合エントリ。
 * Brave → Google CSE → Gemini グラウンディング の順にフォールバック。
 * 環境ごとにどれか1つでも生きていれば競合分析が機能する。
 */
async function webSearch(query: string, count: number): Promise<{ results: SearchHit[]; provider: string }> {
  const brave = await braveSearch(query, count);
  if (brave && brave.length > 0) return { results: brave, provider: 'brave' };

  const google = await googleCseSearch(query, count);
  if (google && google.length > 0) return { results: google, provider: 'google_cse' };

  const grounding = await geminiGroundingSearch(query);
  if (grounding && grounding.length > 0) return { results: grounding, provider: 'gemini_grounding' };

  return { results: [], provider: 'none' };
}

/** SNS・動画・モール等、見出し分析に向かないドメインを除外 */
const EXCLUDED_HOST_PATTERNS = [
  /(^|\.)youtube\.com$/i,
  /(^|\.)youtu\.be$/i,
  /(^|\.)twitter\.com$/i,
  /(^|\.)x\.com$/i,
  /(^|\.)facebook\.com$/i,
  /(^|\.)instagram\.com$/i,
  /(^|\.)amazon\.co\.jp$/i,
  /(^|\.)rakuten\.co\.jp$/i,
  /(^|\.)pinterest\./i,
  /(^|\.)tiktok\.com$/i,
];

function isAnalyzableUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return !EXCLUDED_HOST_PATTERNS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

// 共起語抽出で除外する一般語・機能語・SEO定型語
const STOPWORDS = new Set([
  'こと', 'もの', 'これ', 'それ', 'ため', 'よう', 'とき', 'など', 'ところ', 'はず', 'わけ',
  '方法', '場合', '理由', '紹介', '解説', '比較', '一覧', '記事', '内容', '情報', '確認',
  'おすすめ', 'まとめ', 'ポイント', 'メリット', 'デメリット', '選び方', '注意', '基本',
  'について', 'における', 'ランキング', '徹底', '完全', 'ガイド', '最新', '人気', 'チェック',
  'こちら', 'さん', 'ます', 'です', 'する', 'なる', 'ある', 'いる', 'できる',
]);

/**
 * 競合の見出し・本文テキストから共起語（頻出キーフレーズ）を抽出する。
 * 形態素解析を使わず、漢字連続・カタカナ連続を正規表現で拾って頻度集計する軽量版。
 */
function extractCooccurrenceWords(texts: string[], topN = 25): string[] {
  const joined = texts.join(' ');
  const counts = new Map<string, number>();

  const bump = (word: string) => {
    const w = word.trim();
    if (w.length < 2 || w.length > 12) return;
    if (STOPWORDS.has(w)) return;
    if (/^[0-9０-９\s]+$/.test(w)) return;
    counts.set(w, (counts.get(w) || 0) + 1);
  };

  // 漢字（ひらがな送り仮名含む可）2-12文字の連続
  const kanjiRe = /[一-龯ヶ々]{2,12}/g;
  // カタカナ語 3-12文字（長音符・中黒含む）
  const katakanaRe = /[ァ-ー][ァ-ーー・]{2,11}/g;
  // 英数字混在の固有名詞っぽいトークン（製品名など、3-20文字）
  const alnumRe = /[A-Za-z][A-Za-z0-9._-]{2,19}/g;

  let m: RegExpExecArray | null;
  while ((m = kanjiRe.exec(joined)) !== null) bump(m[0]);
  while ((m = katakanaRe.exec(joined)) !== null) bump(m[0]);
  while ((m = alnumRe.exec(joined)) !== null) bump(m[0].toLowerCase());

  return [...counts.entries()]
    .filter(([, c]) => c >= 2) // 2回以上出現したものだけ（ノイズ除去）
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([w]) => w);
}

/** 見出しツリーの総数（全レベル）を数える。 */
function countHeadings(tree: ParsedHeading[]): number {
  let n = 0;
  const walk = (nodes: ParsedHeading[]) => {
    for (const x of nodes) {
      n++;
      walk(x.children);
    }
  };
  walk(tree);
  return n;
}

/** 見出しツリーを全レベルのテキスト配列に平坦化する。 */
function flattenHeadingTexts(tree: ParsedHeading[]): string[] {
  const out: string[] = [];
  const walk = (nodes: ParsedHeading[]) => {
    for (const x of nodes) {
      out.push(x.text);
      walk(x.children);
    }
  };
  walk(tree);
  return out;
}

/**
 * 複数競合が共通で扱うトピック語を抽出する（必須網羅トピックの目安）。
 * 各競合の見出し語を「競合ドキュメント頻度（何社が使っているか）」で集計し、
 * minCompetitors 社以上が使う語を多い順に返す（生の頻度でなく社数で見るのが要点）。
 */
function extractCommonTopics(perCompetitorHeadings: string[][], minCompetitors = 2, topN = 15): string[] {
  const df = new Map<string, number>();
  for (const headings of perCompetitorHeadings) {
    const joined = headings.join(' ');
    const inThis = new Set<string>();
    const tokens = [
      ...(joined.match(/[一-龯ヶ々]{2,12}/g) || []),
      ...(joined.match(/[ァ-ー][ァ-ーー・]{2,11}/g) || []),
      ...(joined.match(/[A-Za-z][A-Za-z0-9._-]{2,19}/g) || []).map((s) => s.toLowerCase()),
    ];
    for (const t of tokens) {
      const w = t.trim();
      if (w.length < 2 || w.length > 12) continue;
      if (STOPWORDS.has(w)) continue;
      if (/^[0-9０-９\s]+$/.test(w)) continue;
      inThis.add(w);
    }
    for (const t of inThis) df.set(t, (df.get(t) || 0) + 1);
  }
  return [...df.entries()]
    .filter(([, c]) => c >= minCompetitors)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([w]) => w);
}

/** 解析済み記事を「サイトN: タイトル / 見出しツリー」形式に整形 */
function formatCompetitorHeadings(parsed: Array<{ url: string; article: ParsedArticle }>): string {
  return parsed
    .map((p, i) => {
      const host = (() => {
        try {
          return new URL(p.url).hostname;
        } catch {
          return p.url;
        }
      })();
      const md = headingsToMarkdown(p.article.headings) || '(見出し抽出できず)';
      return `### 競合${i + 1}（${host}）: ${p.article.title}\n${md}`;
    })
    .join('\n\n');
}

/**
 * 本文生成用の「最新情報コンテキスト」を取得する。
 * Gemini grounding にテキスト回答を求め、その要約 + 参照ソースのタイトルを返す。
 * Web検索 ON のときに本文プロンプトの webContext に注入する。
 */
export async function fetchWebContext(query: string): Promise<string> {
  const key = process.env.GOOGLE_API_KEY || process.env.GOOGLE_API_KEY_2;
  if (!key) return '';
  const model = process.env.GROUNDING_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `「${query}」について、記事執筆の参考になる最新の事実・数値・トレンドを、信頼できる情報源に基づき箇条書きで簡潔にまとめてください。古い情報は避け、可能なら年月や具体的な数値を示してください。`,
          },
        ],
      },
    ],
    tools: [{ google_search: {} }],
  };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 25_000);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!resp.ok) return '';
    const data = (await resp.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        groundingMetadata?: { groundingChunks?: Array<{ web?: { title?: string } }> };
      }>;
    };
    const cand = data.candidates?.[0];
    const text = (cand?.content?.parts || []).map((p) => p.text || '').join('').trim();
    const sources = (cand?.groundingMetadata?.groundingChunks || [])
      .map((c) => c.web?.title)
      .filter(Boolean)
      .slice(0, 5);
    if (!text) return '';
    const srcLine = sources.length ? `\n参照: ${sources.join(' / ')}` : '';
    return `${text}${srcLine}`.slice(0, 3000);
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 競合分析のメインエントリ。
 * @param query   検索クエリ（通常はターゲットKWをスペース連結したもの）
 * @param opts.maxPages 解析する最大ページ数（デフォルト6）
 */
export async function analyzeCompetitors(
  query: string,
  opts: { maxPages?: number } = {},
): Promise<CompetitorAnalysis> {
  const maxPages = opts.maxPages ?? 8;

  const empty: CompetitorAnalysis = {
    query,
    sources: [],
    competitorHeadingsText: '',
    cooccurrenceWords: [],
    avgWordCount: 0,
    maxWordCount: 0,
    avgHeadingCount: 0,
    maxHeadingCount: 0,
    commonTopics: [],
    competitorTitles: [],
    totalEstimatedResults: 0,
  };

  const { results } = await webSearch(query, maxPages * 2);
  const total = results.length;
  if (results.length === 0) return empty;

  // 解析可能な URL を maxPages 件まで
  const targets = results.filter((r) => isAnalyzableUrl(r.url)).slice(0, maxPages);
  if (targets.length === 0) return { ...empty, totalEstimatedResults: total };

  // 並列取得・解析（個別失敗は無視）
  const settled = await Promise.allSettled(
    targets.map(async (r) => {
      const page = await fetchPage(r.url);
      const article = parseArticle(page.html);
      return { url: r.url, article };
    }),
  );

  const parsed = settled
    .filter(
      (s): s is PromiseFulfilledResult<{ url: string; article: ParsedArticle }> =>
        s.status === 'fulfilled' && s.value.article.headings.length > 0,
    )
    .map((s) => s.value);

  if (parsed.length === 0) {
    // 見出しは取れなかったが、検索結果のタイトル/説明だけでも返す
    return {
      ...empty,
      totalEstimatedResults: total,
      competitorTitles: targets.map((t) => t.title).filter(Boolean),
      cooccurrenceWords: extractCooccurrenceWords(
        targets.map((t) => `${t.title} ${t.description || ''}`),
      ),
    };
  }

  const sources: CompetitorSource[] = parsed.map((p) => ({
    url: p.url,
    title: p.article.title,
    wordCount: p.article.wordCount,
    headingCount: p.article.headings.length,
  }));

  const wordCounts = parsed.map((p) => p.article.wordCount);
  const headingCounts = parsed.map((p) => countHeadings(p.article.headings));
  const avgWordCount = Math.round(wordCounts.reduce((a, b) => a + b, 0) / parsed.length);
  const maxWordCount = Math.max(...wordCounts);
  const avgHeadingCount = Math.round(headingCounts.reduce((a, b) => a + b, 0) / parsed.length);
  const maxHeadingCount = Math.max(...headingCounts);
  const commonTopics = extractCommonTopics(parsed.map((p) => flattenHeadingTexts(p.article.headings)));

  // 共起語は見出し全文 + 各記事の先頭段落から抽出
  const textsForCooc: string[] = [];
  for (const p of parsed) {
    textsForCooc.push(headingsToMarkdown(p.article.headings));
    textsForCooc.push(p.article.paragraphs.slice(0, 8).join(' '));
  }
  const cooccurrenceWords = extractCooccurrenceWords(textsForCooc);

  return {
    query,
    sources,
    competitorHeadingsText: formatCompetitorHeadings(parsed),
    cooccurrenceWords,
    avgWordCount,
    maxWordCount,
    avgHeadingCount,
    maxHeadingCount,
    commonTopics,
    competitorTitles: parsed.map((p) => p.article.title).filter(Boolean),
    totalEstimatedResults: total,
  };
}
