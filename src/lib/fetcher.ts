/**
 * リライト機能用: 外部URLからHTMLを取得するシンプルなフェッチャ。
 * - 20秒タイムアウト
 * - 最大2MB
 * - User-Agentで一般的なブラウザを偽装（Cloudflare等の対策を緩和）
 */

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36';

export interface FetchResult {
  html: string;
  finalUrl: string;
  contentType: string;
}

export class FetchError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

export async function fetchPage(url: string): Promise<FetchResult> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new FetchError(400, 'URLの形式が不正です');
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new FetchError(400, 'http/https URLのみ対応しています');
  }
  // SSRF対策: ローカル/プライベートIP をブロック (簡易)
  const host = target.hostname;
  if (
    host === 'localhost' ||
    host.startsWith('127.') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    host.startsWith('169.254.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === '0.0.0.0' ||
    host.endsWith('.local')
  ) {
    throw new FetchError(400, '内部ネットワークへのアクセスは禁止されています');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(target.toString(), {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en;q=0.8',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!resp.ok) {
      throw new FetchError(resp.status, `取得失敗: HTTP ${resp.status}`);
    }
    const contentType = resp.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml/i.test(contentType)) {
      throw new FetchError(415, 'HTML以外のコンテンツは解析できません');
    }
    // size cap: read into buffer
    const reader = resp.body?.getReader();
    if (!reader) throw new FetchError(500, 'レスポンスボディが取得できません');
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        throw new FetchError(413, '取得サイズが上限(2MB)を超えました');
      }
      chunks.push(value);
    }
    const buf = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      buf.set(c, off);
      off += c.byteLength;
    }
    // charset 検出: (1) Content-Type ヘッダ → (2) HTML内の <meta charset> / http-equiv
    // 日本語サイトは Shift_JIS / EUC-JP を meta だけで宣言することが多いため両方見る。
    const normalizeCharset = (c: string): string => {
      const k = c.trim().toLowerCase().replace(/["']/g, '');
      if (/^(shift[-_]?jis|sjis|x-sjis|windows-31j|ms932|cp932)$/.test(k)) return 'shift_jis';
      if (/^(euc[-_]?jp|x-euc-jp)$/.test(k)) return 'euc-jp';
      if (/^(iso-2022-jp)$/.test(k)) return 'iso-2022-jp';
      return k || 'utf-8';
    };

    const headerCharset = contentType.match(/charset=([^;]+)/i)?.[1];
    let charset = headerCharset ? normalizeCharset(headerCharset) : '';

    // ヘッダに無い or utf-8 と出ているがバイト的に怪しい場合、meta から再検出
    if (!charset || charset === 'utf-8') {
      // ASCII 範囲の meta タグだけ読めればよいので latin1 で先頭をプレビュー
      const preview = new TextDecoder('latin1').decode(buf.subarray(0, 4096));
      const metaCharset =
        preview.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ||
        preview.match(/<meta[^>]+content=["'][^"']*charset=([\w-]+)/i)?.[1];
      if (metaCharset) {
        const norm = normalizeCharset(metaCharset);
        if (norm !== 'utf-8') charset = norm;
      }
    }
    if (!charset) charset = 'utf-8';

    let html: string;
    try {
      html = new TextDecoder(charset).decode(buf);
    } catch {
      html = new TextDecoder('utf-8').decode(buf);
    }
    return { html, finalUrl: resp.url || target.toString(), contentType };
  } catch (err) {
    if (err instanceof FetchError) throw err;
    const e = err as Error;
    if (e.name === 'AbortError') {
      throw new FetchError(408, `取得がタイムアウトしました（${TIMEOUT_MS / 1000}秒）`);
    }
    throw new FetchError(502, `取得に失敗しました: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
}
