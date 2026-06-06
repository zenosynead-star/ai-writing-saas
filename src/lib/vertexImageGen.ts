/**
 * Vertex AI Gemini Image (Nano Banana 2) クライアント
 *
 * wp-article-rewriter の VertexGeminiImageClient (Python) を TypeScript に移植。
 *
 * 認証: Service Account JSON → OAuth 2.0 access token → Bearer header
 * エンドポイント:
 *   POST https://{location}-aiplatform.googleapis.com/v1/
 *     projects/{project_id}/locations/{location}/publishers/google/
 *     models/{model}:generateContent
 *
 * モデル: gemini-3.1-flash-image (日本語テキスト描画が得意、~$0.04/画像)
 * Google Cloud の $300 Free Trial で実質無料利用可能。
 */

import { GoogleAuth, type JWTInput } from 'google-auth-library';

export interface VertexImageOptions {
  prompt: string;
  /** "16:9", "1:1", "9:16" など。Gemini-3.1 はプロンプト内で指定 */
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
 * Vertex AI Gemini Image で画像生成。
 * @param opts.prompt 生成プロンプト(英語または日本語可、Gemini 3.1 は両対応)
 * @param opts.aspectRatio "16:9" など(プロンプトに自動付加)
 */
export async function generateVertexImage(opts: VertexImageOptions): Promise<VertexImageResult> {
  const projectId = (process.env.VERTEX_PROJECT_ID || '').trim();
  if (!projectId) {
    throw new VertexImageError(500, 'VERTEX_PROJECT_ID が設定されていません');
  }
  const location = (process.env.VERTEX_LOCATION || 'us-central1').trim();
  const model = (process.env.VERTEX_IMAGE_MODEL || 'gemini-3.1-flash-image').trim();

  const token = await getAccessToken();
  const url =
    `https://${location}-aiplatform.googleapis.com/v1` +
    `/projects/${projectId}/locations/${location}` +
    `/publishers/google/models/${model}:generateContent`;

  const aspect = opts.aspectRatio || '16:9';
  const text = `${opts.prompt}\n\nAspect ratio: ${aspect}.`;

  const body = {
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: { responseModalities: ['IMAGE'] },
  };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 120_000);
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    clearTimeout(timer);
    const err = e as Error;
    if (err.name === 'AbortError') {
      throw new VertexImageError(408, `Vertex Gemini Image タイムアウト（120秒）`);
    }
    throw new VertexImageError(500, `Vertex Gemini Image 接続失敗: ${err.message}`);
  }
  clearTimeout(timer);

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new VertexImageError(resp.status, `Vertex Gemini Image ${resp.status}: ${txt.slice(0, 300)}`);
  }

  const data = (await resp.json()) as {
    promptFeedback?: { blockReason?: string };
    candidates?: Array<{
      finishReason?: string;
      content?: { parts?: Array<{ inline_data?: { data: string; mime_type: string }; inlineData?: { data: string; mimeType: string } }> };
    }>;
  };

  if (data.promptFeedback?.blockReason) {
    throw new VertexImageError(400, `safety block: ${data.promptFeedback.blockReason}`);
  }
  const candidates = data.candidates || [];
  if (candidates.length === 0) {
    throw new VertexImageError(502, 'Vertex Gemini Image レスポンスに candidates がありません');
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
      return { base64: inline.data, mimeType: mime, modelUsed: `vertex-${model}` };
    }
  }
  throw new VertexImageError(502, 'Vertex Gemini Image レスポンスに inline_data が無い');
}
