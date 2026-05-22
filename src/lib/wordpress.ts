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

function authHeader(creds: WpCredentials): string {
  const token = Buffer.from(`${creds.username}:${creds.appPassword.replace(/\s+/g, '')}`).toString('base64');
  return `Basic ${token}`;
}

async function wpRequest(
  creds: WpCredentials,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = `${creds.siteUrl.replace(/\/$/, '')}/wp-json/wp/v2${path}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 60_000);
  try {
    const resp = await fetch(url, {
      ...init,
      signal: ac.signal,
      headers: {
        Authorization: authHeader(creds),
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

export interface CreatePostInput {
  title: string;
  content: string;     // HTML
  excerpt?: string;
  status?: 'draft' | 'publish' | 'future';
  featuredMediaId?: number;
  meta?: Record<string, string>;
  date?: string;        // ISO8601 (status='future' のときの予約投稿時刻)
}

export interface CreatedPost {
  id: number;
  link: string;
  status: string;
}

export async function createPost(creds: WpCredentials, input: CreatePostInput): Promise<CreatedPost> {
  const body: Record<string, unknown> = {
    title: input.title,
    content: input.content,
    status: input.status || 'draft',
  };
  if (input.excerpt) body.excerpt = input.excerpt;
  if (input.featuredMediaId) body.featured_media = input.featuredMediaId;
  if (input.date) body.date = input.date;

  const resp = await wpRequest(creds, '/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new WpError(resp.status, `記事投稿失敗 (HTTP ${resp.status}): ${await resp.text().then((t) => t.slice(0, 200))}`);
  }
  const data = (await resp.json()) as { id: number; link: string; status: string };
  return { id: data.id, link: data.link, status: data.status };
}
