/**
 * Google Indexing API クライアント（公開直後の URL_UPDATED 通知 = 「すぐフェッチ」）。
 * wp-article-rewriter の indexing/client.py を TS 移植。
 *
 * SA は env GOOGLE_INDEXING_SERVICE_ACCOUNT_JSON で渡す（JSON文字列 or ファイルパスの両対応）。
 * SA は対象 Search Console プロパティのオーナーである必要がある。
 * 失敗しても呼び出し側を止めない（ソフトエラー: 例外を投げず結果オブジェクトを返す）。
 *
 * 注意: Indexing API は本来 JobPosting / BroadcastEvent 向け。一般記事への利用は
 * Google 規約上グレー（運用者判断）。
 */

import { GoogleAuth, type JWTInput } from 'google-auth-library';

const INDEXING_ENDPOINT = 'https://indexing.googleapis.com/v3/urlNotifications:publish';
const INDEXING_SCOPE = 'https://www.googleapis.com/auth/indexing';

let cachedAuth: GoogleAuth | null = null;

/** GOOGLE_INDEXING_SERVICE_ACCOUNT_JSON (JSON文字列 or パス) から GoogleAuth を遅延生成。未設定なら null。 */
function getAuth(): GoogleAuth | null {
  if (cachedAuth) return cachedAuth;
  const raw = (process.env.GOOGLE_INDEXING_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) return null;
  try {
    if (raw.startsWith('{')) {
      const creds = JSON.parse(raw) as JWTInput;
      cachedAuth = new GoogleAuth({ credentials: creds, scopes: [INDEXING_SCOPE] });
    } else {
      cachedAuth = new GoogleAuth({ keyFile: raw, scopes: [INDEXING_SCOPE] });
    }
  } catch {
    return null;
  }
  return cachedAuth;
}

export interface IndexingResult {
  ok: boolean;
  /** SA 未設定や URL 空など、送信せずに見送ったケース */
  skipped?: boolean;
  status?: number;
  message: string;
}

/**
 * 1 URL を Indexing API に通知する。常に結果を返し、例外は投げない。
 * SA 未設定なら skipped:true で安全に no-op。
 */
export async function requestIndexing(
  url: string,
  type: 'URL_UPDATED' | 'URL_DELETED' = 'URL_UPDATED',
): Promise<IndexingResult> {
  const u = (url || '').trim();
  if (!u) return { ok: false, skipped: true, message: 'url が空のためスキップ' };

  const auth = getAuth();
  if (!auth) {
    return {
      ok: false,
      skipped: true,
      message: 'GOOGLE_INDEXING_SERVICE_ACCOUNT_JSON 未設定のためインデックス通知をスキップ',
    };
  }

  try {
    const client = await auth.getClient();
    const tok = await client.getAccessToken();
    if (!tok.token) return { ok: false, message: 'Indexing API: access token を取得できませんでした' };

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 20_000);
    try {
      const resp = await fetch(INDEXING_ENDPOINT, {
        method: 'POST',
        signal: ac.signal,
        headers: { Authorization: `Bearer ${tok.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: u, type }),
      });
      if (resp.ok) return { ok: true, status: resp.status, message: 'OK' };
      const t = await resp.text().catch(() => '');
      return { ok: false, status: resp.status, message: `Indexing API HTTP ${resp.status}: ${t.slice(0, 200)}` };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    return { ok: false, message: `Indexing API 接続失敗: ${(e as Error).message}` };
  }
}
