/**
 * WordPress REST API クライアント。
 * Application Password 認証で記事と画像を投稿する。
 *
 * WordPress 5.6+ で Application Passwords が標準搭載。
 * ユーザープロフィール画面で発行可能。
 */

export interface WpCredentials {
  siteUrl: string;     // https://blog.example.com
  username: string;
  appPassword: string; // "xxxx xxxx xxxx ..."
}

export class WpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

// Cloudflare/WAF が空UAリクエストを 521/403 で弾くサイトがあるため、必ず通常UAを付ける
const WP_USER_AGENT = 'Mozilla/5.0 (compatible; ai-writing-saas/1.0; +https://write.boot-up.jp)';

function authHeader(creds: WpCredentials): string {
  const token = Buffer.from(`${creds.username}:${creds.appPassword.replace(/\s+/g, '')}`).toString('base64');
  return `Basic ${token}`;
}

async function wpRequest(
  creds: WpCredentials,
  path: string,
  init: RequestInit = {},
  timeoutMs = 60_000,
): Promise<Response> {
  const url = `${creds.siteUrl.replace(/\/$/, '')}/wp-json/wp/v2${path}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      ...init,
      signal: ac.signal,
      headers: {
        Authorization: authHeader(creds),
        'User-Agent': WP_USER_AGENT,
        ...(init.headers || {}),
      },
    });
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

export async function testConnection(creds: WpCredentials): Promise<{ name: string; userId: number }> {
  const resp = await wpRequest(creds, '/users/me');
  if (!resp.ok) {
    throw new WpError(resp.status, `接続テスト失敗 (HTTP ${resp.status}): ${await resp.text().then((t) => t.slice(0, 200))}`);
  }
  const data = (await resp.json()) as { name?: string; id?: number };
  return { name: data.name || '', userId: data.id || 0 };
}

export interface UploadMediaInput {
  filename: string;
  mimeType: string;
  dataBase64: string;
  altText?: string;
}

export interface UploadedMedia {
  id: number;
  sourceUrl: string;
}

export async function uploadMedia(creds: WpCredentials, input: UploadMediaInput): Promise<UploadedMedia> {
  const buf = Buffer.from(input.dataBase64, 'base64');
  const blob = new Blob([buf], { type: input.mimeType });
  // WordPress media endpoint expects multipart/form-data via Content-Disposition header
  const url = `${creds.siteUrl.replace(/\/$/, '')}/wp-json/wp/v2/media`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 60_000);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        Authorization: authHeader(creds),
        'User-Agent': WP_USER_AGENT,
        'Content-Type': input.mimeType,
        'Content-Disposition': `attachment; filename="${input.filename}"`,
      },
      body: blob,
    });
    if (!resp.ok) {
      throw new WpError(resp.status, `メディアアップロード失敗 (HTTP ${resp.status}): ${await resp.text().then((t) => t.slice(0, 200))}`);
    }
    const data = (await resp.json()) as { id: number; source_url: string };
    return { id: data.id, sourceUrl: data.source_url };
  } finally {
    clearTimeout(timer);
  }
}

export async function setMediaAltText(creds: WpCredentials, mediaId: number, alt: string): Promise<void> {
  await wpRequest(creds, `/media/${mediaId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alt_text: alt }),
  });
}

export interface WpTerm {
  id: number;
  name: string;
}

/** 既存カテゴリ一覧を取得（最大100件） */
export async function listCategories(creds: WpCredentials): Promise<WpTerm[]> {
  const resp = await wpRequest(creds, '/categories?per_page=100&orderby=count&order=desc');
  if (!resp.ok) {
    throw new WpError(resp.status, `カテゴリ取得失敗 (HTTP ${resp.status})`);
  }
  const data = (await resp.json()) as Array<{ id: number; name: string }>;
  return data.map((c) => ({ id: c.id, name: c.name }));
}

/**
 * タグ名の配列から、対応するタグIDを返す。
 * 既存タグがあれば再利用、無ければ新規作成する。
 */
export async function resolveTagIds(creds: WpCredentials, names: string[]): Promise<number[]> {
  const ids: number[] = [];
  for (const raw of names) {
    // タグ名は半角スペースに正規化（読点「、」「，」や全角スペースを半角スペースへ、連続空白は1つに）
    const name = (raw || '').replace(/[、，]/g, ' ').replace(/　/g, ' ').replace(/\s+/g, ' ').trim();
    if (!name) continue;
    try {
      // 完全一致を検索
      const sresp = await wpRequest(creds, `/tags?search=${encodeURIComponent(name)}&per_page=20`);
      if (sresp.ok) {
        const found = (await sresp.json()) as Array<{ id: number; name: string }>;
        const exact = found.find((t) => t.name === name);
        if (exact) {
          ids.push(exact.id);
          continue;
        }
      }
      // 無ければ作成
      const cresp = await wpRequest(creds, '/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (cresp.ok) {
        const created = (await cresp.json()) as { id: number };
        ids.push(created.id);
      } else if (cresp.status === 400) {
        // term_exists: レスポンスから既存IDを拾う
        const body = (await cresp.json()) as { data?: { term_id?: number } };
        if (body.data?.term_id) ids.push(body.data.term_id);
      }
    } catch {
      // 個別タグの失敗は無視（投稿自体は続行）
    }
  }
  return [...new Set(ids)];
}

/**
 * WP に「指定キーワードの全トークンをタイトルに含む既存投稿」があれば返す（重複公開の防止用）。
 * 他ツール(wp-rewriter)や手動で公開した記事はこのアプリのDBに無いため、WP 本体を直接検索して判定する。
 * publish / future / draft / private を対象。1件でもタイトルに全トークンを含めば「同KWの記事が既にある」と見なす。
 */
export async function findExistingWpPostByKeywords(
  creds: WpCredentials,
  tokens: string[],
): Promise<{ id: number; title: string; link: string } | null> {
  const clean = tokens.map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (clean.length === 0) return null;
  // 短すぎるトークン(1文字や英字略語)は無関係なタイトルに部分一致して誤スキップを招くため、
  // タイトル包含の判定からは除外する(検索クエリには全トークンを使う)。
  // ただし全トークンが短い場合(例:KWが「机」1語)は、全トークンで判定して取りこぼしを防ぐ。
  const meaningful = clean.filter((t) => t.length >= 2);
  const matchTokens = meaningful.length > 0 ? meaningful : clean;
  try {
    const q = encodeURIComponent(clean.join(' '));
    // 重複チェックは一括作成で最大50回直列に走るため、無応答WPで全体を詰まらせないよう短めのタイムアウト
    const resp = await wpRequest(
      creds,
      `/posts?search=${q}&per_page=20&status=publish,future,draft,private&_fields=id,title,link`,
      {},
      15_000,
    );
    if (!resp.ok) return null;
    const posts = (await resp.json()) as Array<{ id: number; title?: { rendered?: string }; link?: string }>;
    for (const post of posts) {
      const title = (post.title?.rendered || '').toLowerCase();
      if (matchTokens.every((t) => title.includes(t))) {
        return { id: post.id, title: post.title?.rendered || '', link: post.link || '' };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export interface CreatePostInput {
  title: string;
  content: string;     // HTML
  excerpt?: string;
  status?: 'draft' | 'publish' | 'future';
  featuredMediaId?: number;
  categories?: number[];
  tags?: number[];
  meta?: Record<string, string>;
  date?: string;        // ISO8601 (status='future' のときの予約投稿時刻)
}

export interface CreatedPost {
  id: number;
  link: string;
  status: string;
}

function buildPostBody(input: CreatePostInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    title: input.title,
    content: input.content,
    status: input.status || 'draft',
  };
  if (input.excerpt) body.excerpt = input.excerpt;
  if (input.featuredMediaId) body.featured_media = input.featuredMediaId;
  if (input.categories && input.categories.length) body.categories = input.categories;
  if (input.tags && input.tags.length) body.tags = input.tags;
  if (input.date) body.date = input.date;
  return body;
}

export async function createPost(creds: WpCredentials, input: CreatePostInput): Promise<CreatedPost> {
  const resp = await wpRequest(creds, '/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildPostBody(input)),
  });
  if (!resp.ok) {
    throw new WpError(resp.status, `記事投稿失敗 (HTTP ${resp.status}): ${await resp.text().then((t) => t.slice(0, 200))}`);
  }
  const data = (await resp.json()) as { id: number; link: string; status: string };
  return { id: data.id, link: data.link, status: data.status };
}

/**
 * 既存記事を更新する（再公開時の重複作成を防ぐ）。WP REST は POST /posts/{id} が更新。
 */
export async function updatePost(
  creds: WpCredentials,
  postId: number,
  input: CreatePostInput,
): Promise<CreatedPost> {
  const resp = await wpRequest(creds, `/posts/${postId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildPostBody(input)),
  });
  if (!resp.ok) {
    throw new WpError(resp.status, `記事更新失敗 (HTTP ${resp.status}): ${await resp.text().then((t) => t.slice(0, 200))}`);
  }
  const data = (await resp.json()) as { id: number; link: string; status: string };
  return { id: data.id, link: data.link, status: data.status };
}
