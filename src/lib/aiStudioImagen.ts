/**
 * AI Studio (Generative Language API) Imagen クライアント。
 * wp-article-rewriter `heading_image/imagen_client.py` の TS 移植で、本番(wp-rewriter)の
 * 公開画像と**同一の生成方式に統一**するためのもの。
 *
 *   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:predict?key={k}
 *   body  { instances:[{prompt}], parameters:{ sampleCount, aspectRatio, safetyFilter } }
 *   resp  { predictions:[{ bytesBase64Encoded, mimeType }] }
 *
 * 既定モデル: imagen-3.0-fast-generate-001（wp-rewriter と同じ）。
 * APIキーは GEMINI_API_KEY(_2/_3) → GOOGLE_API_KEY(_2) の順にローテーション
 * （429/quota で次キー、5xx/ネットワークは指数バックオフ、401/403/safety は終端）。
 */

const AISTUDIO_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export class AiStudioImagenError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export interface AiStudioImagenResult {
  base64: string;
  mimeType: string;
  modelUsed: string;
}

/** GEMINI_API_KEY 群 → GOOGLE_API_KEY 群の順に、非空・重複排除でキーを集める（llm.ts と同流儀で _2.._9 連番も拾う）。 */
function collectKeys(): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  const add = (v: string | undefined) => {
    const t = (v || '').trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      keys.push(t);
    }
  };
  add(process.env.GEMINI_API_KEY);
  for (let i = 2; i <= 9; i++) add(process.env[`GEMINI_API_KEY_${i}`]);
  add(process.env.GOOGLE_API_KEY);
  for (let i = 2; i <= 9; i++) add(process.env[`GOOGLE_API_KEY_${i}`]);
  return keys;
}

function isQuotaMessage(s: string): boolean {
  return /quota|resource[_\s-]?exhausted|rate[_\s-]?limit/i.test(s);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffMs(attempt: number): number {
  return Math.min(60_000, 2000 * Math.pow(2, attempt));
}

async function parseImagenResponse(resp: Response, model: string): Promise<AiStudioImagenResult> {
  const data = (await resp.json()) as {
    predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string; raiFilteredReason?: string }>;
  };
  const preds = data.predictions || [];
  if (preds.length === 0) throw new AiStudioImagenError(502, 'AI Studio Imagen: predictions が空');
  const first = preds[0];
  if (first.raiFilteredReason) {
    throw new AiStudioImagenError(400, `AI Studio Imagen safety filter: ${first.raiFilteredReason}`);
  }
  if (!first.bytesBase64Encoded) {
    throw new AiStudioImagenError(502, 'AI Studio Imagen: bytesBase64Encoded がありません');
  }
  return {
    base64: first.bytesBase64Encoded,
    mimeType: first.mimeType || 'image/png',
    modelUsed: `aistudio-${model}`,
  };
}

/**
 * AI Studio Imagen で画像を1枚生成する。終端失敗時は AiStudioImagenError を投げる
 * （呼び出し側 imageGen.ts が Vertex→Pollinations へフォールバックする）。
 */
export async function generateAiStudioImagen(opts: {
  prompt: string;
  aspectRatio?: string;
}): Promise<AiStudioImagenResult> {
  const prompt = (opts.prompt || '').trim();
  if (!prompt) throw new AiStudioImagenError(400, 'prompt が空です');

  const keys = collectKeys();
  if (keys.length === 0) {
    throw new AiStudioImagenError(500, 'GEMINI_API_KEY / GOOGLE_API_KEY が未設定です');
  }

  const model = (process.env.IMAGE_MODEL || 'imagen-3.0-fast-generate-001').trim();
  const aspect = opts.aspectRatio || '16:9';
  const body = JSON.stringify({
    instances: [{ prompt }],
    parameters: { sampleCount: 1, aspectRatio: aspect, safetyFilter: 'block_only_high' },
  });

  const maxRetries = 3;
  let keyIndex = 0;
  let backoffAttempt = 0;

  // 429/quota → 次キー、尽きたら backoff。5xx/network → backoff。401/403/safety → 終端。
  while (true) {
    const url = `${AISTUDIO_BASE}/models/${model}:predict?key=${keys[keyIndex]}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 120_000);
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        signal: ac.signal,
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    } catch (e) {
      clearTimeout(timer);
      const err = e as Error;
      const isTimeout = err.name === 'AbortError';
      if (backoffAttempt < maxRetries) {
        await sleep(backoffMs(backoffAttempt++));
        continue;
      }
      throw new AiStudioImagenError(
        isTimeout ? 408 : 500,
        isTimeout ? 'AI Studio Imagen タイムアウト（120秒）' : `AI Studio Imagen 接続失敗: ${err.message}`,
      );
    } finally {
      clearTimeout(timer);
    }

    const status = resp.status;
    if (status === 200) return parseImagenResponse(resp, model);

    const text = await resp.text().catch(() => '');

    if (status === 429 || (status === 400 && isQuotaMessage(text))) {
      if (keyIndex < keys.length - 1) {
        keyIndex++;
        continue;
      }
      if (backoffAttempt < maxRetries) {
        await sleep(backoffMs(backoffAttempt++));
        continue;
      }
      throw new AiStudioImagenError(429, `AI Studio Imagen 429 全キー枯渇: ${text.slice(0, 200)}`);
    }

    if (status >= 500) {
      if (backoffAttempt < maxRetries) {
        await sleep(backoffMs(backoffAttempt++));
        continue;
      }
      throw new AiStudioImagenError(status, `AI Studio Imagen サーバーエラー ${status}: ${text.slice(0, 200)}`);
    }

    if (status === 401 || status === 403) {
      throw new AiStudioImagenError(status, `AI Studio Imagen 認証/権限失敗 (${status}): ${text.slice(0, 200)}`);
    }

    if (status === 400 && /safety|blocked/i.test(text)) {
      throw new AiStudioImagenError(400, `AI Studio Imagen safety filter: ${text.slice(0, 200)}`);
    }

    throw new AiStudioImagenError(status, `AI Studio Imagen ${status}: ${text.slice(0, 200)}`);
  }
}
