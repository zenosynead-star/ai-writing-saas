/**
 * サーバー間の内部 POST（Node 標準 http/https を使用）。
 *
 * 本文生成(最大5万字の多段増補)・画像(直列)・WP公開は1記事で数分〜十数分かかることがある。
 * グローバル fetch(undici) は既定で約300秒のヘッダタイムアウトに当たり "fetch failed" で落ちるため、
 * Node 標準の http(s) で明示的に長いタイムアウト(30分)を設定して最後まで待てるようにする。
 *
 * 例外は投げない（{ok:false} を返す）。呼び出し側はそれを失敗として扱いリトライする。
 */
import http from 'node:http';
import https from 'node:https';

const REQUEST_TIMEOUT_MS = 30 * 60 * 1000; // 30分（長文生成の上限を考慮）

export function internalBaseUrl(): string {
  if (process.env.INTERNAL_BASE_URL) return process.env.INTERNAL_BASE_URL.replace(/\/$/, '');
  return `http://127.0.0.1:${process.env.PORT || '8008'}`;
}

export function internalPost<T = Record<string, unknown>>(
  path: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; data: T }> {
  const url = new URL(`${internalBaseUrl()}${path}`);
  const payload = JSON.stringify(body ?? {});
  const lib = url.protocol === 'https:' ? https : http;
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');

  return new Promise((resolve) => {
    let settled = false;
    const done = (r: { ok: boolean; status: number; data: T }) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    const req = lib.request(
      {
        hostname: url.hostname,
        port,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (c) => {
          raw += c;
        });
        res.on('end', () => {
          let data: T;
          try {
            data = JSON.parse(raw) as T;
          } catch {
            data = {} as T;
          }
          const status = res.statusCode || 0;
          done({ ok: status >= 200 && status < 300, status, data });
        });
      },
    );

    req.on('timeout', () => {
      req.destroy(new Error('internal request timeout'));
    });
    req.on('error', () => {
      done({ ok: false, status: 0, data: {} as T });
    });
    req.write(payload);
    req.end();
  });
}
