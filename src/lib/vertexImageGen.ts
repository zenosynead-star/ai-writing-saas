/**
 * Vertex AI 画像生成クライアント (Imagen + Gemini Image 両対応)
 *
 * モデル名で自動的にエンドポイント形式を切替:
 *   - imagen-*           → :predict + instances/parameters 形式 (Imagen 3/4)
 *   - gemini-*-image     → :generateContent + contents/responseModalities 形式
 *
 * 認証: Service Account JSON → OAuth 2.0 access token → Bearer header
 *
 * 既定モデル: gemini-3.1-flash-image (Nano Banana 2) — 日本語ネイティブ・高品質。
 * VERTEX_IMAGE_MODEL で上書き可。imagen-* を指定すると predict 形式に自動切替:
 *   - imagen-4.0-fast-generate-001: $0.04/画像、~5秒
 *   - imagen-3.0-fast-generate-001: $0.02/画像、~3秒
 */

import { GoogleAuth, type JWTInput } from 'google-auth-library';

export interface VertexImageOptions {
  prompt: string;
  aspectRatio?: string;
}

export interface VertexImageResult {
  base64: string;
  mimeType: string;
  modelUsed: string;
}

export class VertexImageError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

let cachedAuth: GoogleAuth | null = null;

function getAuth(): GoogleAuth {
  if (cachedAuth) return cachedAuth;
  const json = process.env.VERTEX_SERVICE_ACCOUNT_JSON;
  if (!json) {
    throw new VertexImageError(500, 'VERTEX_SERVICE_ACCOUNT_JSON が設定されていません');
  }
  let creds: JWTInput;
  try {
    creds = JSON.parse(json) as JWTInput;
  } catch (e) {
    throw new VertexImageError(500, `VERTEX_SERVICE_ACCOUNT_JSON が不正な JSON: ${(e as Error).message}`);
  }
  cachedAuth = new GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  return cachedAuth;
}

async function getAccessToken(): Promise<string> {
  const auth = getAuth();
  const client = await auth.getClient();
  const tok = await client.getAccessToken();
  if (!tok.token) {
    throw new VertexImageError(401, 'Vertex AI access token を取得できませんでした');
  }
  return tok.token;
}

/**
 * モデル名から呼び出し形式を判定:
 *   - "imagen-*"          → predict
 *   - "gemini-*-image"    → generateContent
 */
function detectModelMode(model: string): 'imagen' | 'gemini' {
  if (/^imagen/i.test(model)) return 'imagen';
  return 'gemini';
}

interface VertexConfig {
  projectId: string;
  location: string;
  model: string;
}

function getVertexConfig(): VertexConfig {
  const projectId = (process.env.VERTEX_PROJECT_ID || '').trim();
  if (!projectId) {
    throw new VertexImageError(500, 'VERTEX_PROJECT_ID が設定されていません');
  }
  return {
    projectId,
    location: (process.env.VERTEX_LOCATION || 'us-central1').trim(),
    model: (process.env.VERTEX_IMAGE_MODEL || 'gemini-3.1-flash-image').trim(),
  };
}

async function callVertex(
  cfg: VertexConfig,
  endpoint: 'predict' | 'generateContent',
  body: unknown,
): Promise<Response> {
  const token = await getAccessToken();
  const url =
    `https://${cfg.location}-aiplatform.googleapis.com/v1` +
    `/projects/${cfg.projectId}/locations/${cfg.location}` +
    `/publishers/google/models/${cfg.model}:${endpoint}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 120_000);
  try {
    return await fetch(url, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Imagen (predict) 形式での画像生成。
 * Gemini Image とリクエスト/レスポンス形式が違うので別関数。
 */
async function generateImagenViaPredict(
  cfg: VertexConfig,
  opts: VertexImageOptions,
): Promise<VertexImageResult> {
  const body = {
    instances: [{ prompt: opts.prompt }],
    parameters: {
      sampleCount: 1,
      aspectRatio: opts.aspectRatio || '16:9',
      safetyFilter: 'block_only_high',
    },
  };
  let resp: Response;
  try {
    resp = await callVertex(cfg, 'predict', body);
  } catch (e) {
    const err = e as Error;
    if (err.name === 'AbortError') {
      throw new VertexImageError(408, 'Imagen タイムアウト（120秒）');
    }
    throw new VertexImageError(500, `Imagen 接続失敗: ${err.message}`);
  }
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new VertexImageError(resp.status, `Imagen ${resp.status}: ${txt.slice(0, 300)}`);
  }
  const data = (await resp.json()) as {
    predictions?: Array<{
      bytesBase64Encoded?: string;
      mimeType?: string;
      raiFilteredReason?: string;
      safetyAttributes?: { blocked?: boolean };
    }>;
  };
  const preds = data.predictions || [];
  if (preds.length === 0) {
    throw new VertexImageError(502, 'Imagen レスポンスに predictions がありません');
  }
  const first = preds[0];
  if (first.raiFilteredReason || first.safetyAttributes?.blocked) {
    throw new VertexImageError(400, `Imagen safety filter: ${first.raiFilteredReason || 'blocked'}`);
  }
  if (!first.bytesBase64Encoded) {
    throw new VertexImageError(502, 'Imagen レスポンスに bytesBase64Encoded がありません');
  }
  return {
    base64: first.bytesBase64Encoded,
    mimeType: first.mimeType || 'image/png',
    modelUsed: `vertex-${cfg.model}`,
  };
}

/**
 * Gemini Image (generateContent) 形式での画像生成。
 */
async function generateGeminiImage(
  cfg: VertexConfig,
  opts: VertexImageOptions,
): Promise<VertexImageResult> {
  const aspect = opts.aspectRatio || '16:9';
  const text = `${opts.prompt}\n\nAspect ratio: ${aspect}.`;
  const body = {
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: { responseModalities: ['IMAGE'] },
  };
  let resp: Response;
  try {
    resp = await callVertex(cfg, 'generateContent', body);
  } catch (e) {
    const err = e as Error;
    if (err.name === 'AbortError') {
      throw new VertexImageError(408, 'Gemini Image タイムアウト（120秒）');
    }
    throw new VertexImageError(500, `Gemini Image 接続失敗: ${err.message}`);
  }
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new VertexImageError(resp.status, `Gemini Image ${resp.status}: ${txt.slice(0, 300)}`);
  }
  const data = (await resp.json()) as {
    promptFeedback?: { blockReason?: string };
    candidates?: Array<{
      finishReason?: string;
      content?: {
        parts?: Array<{
          inline_data?: { data: string; mime_type: string };
          inlineData?: { data: string; mimeType: string };
        }>;
      };
    }>;
  };
  if (data.promptFeedback?.blockReason) {
    throw new VertexImageError(400, `safety block: ${data.promptFeedback.blockReason}`);
  }
  const candidates = data.candidates || [];
  if (candidates.length === 0) {
    throw new VertexImageError(502, 'Gemini Image レスポンスに candidates がありません');
  }
  const first = candidates[0];
  if (first.finishReason && ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT'].includes(first.finishReason)) {
    throw new VertexImageError(400, `finishReason=${first.finishReason}`);
  }
  const parts = first.content?.parts || [];
  for (const p of parts) {
    const inline = p.inline_data || p.inlineData;
    if (inline?.data) {
      const mime =
        (inline as { mime_type?: string }).mime_type ||
        (inline as { mimeType?: string }).mimeType ||
        'image/png';
      return { base64: inline.data, mimeType: mime, modelUsed: `vertex-${cfg.model}` };
    }
  }
  throw new VertexImageError(502, 'Gemini Image レスポンスに inline_data が無い');
}

export async function generateVertexImage(opts: VertexImageOptions): Promise<VertexImageResult> {
  const cfg = getVertexConfig();
  const mode = detectModelMode(cfg.model);
  if (mode === 'imagen') {
    return generateImagenViaPredict(cfg, opts);
  }
  return generateGeminiImage(cfg, opts);
}
