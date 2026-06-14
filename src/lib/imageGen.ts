/**
 * 画像生成プロバイダー切替対応のラッパー。
 *
 * 既定(本番): Vertex AI **Nano Banana Pro `gemini-3-pro-image-preview`**（GCPプロジェクト
 *   form-collector-v2、**location=global 限定**。日本語タイトルを画像内に高精度描画）。
 *   失敗時は Pollinations へフォールバックして「必ず画像」を出す。
 * ※Gemini 3 系(Nano Banana Pro)は **global ロケーションのみ**（us-central1 等の地域は 404）。
 *   無印 Nano Banana `gemini-2.5-flash-image` は us-central1/global 両対応（コード既定値）。
 * ※AI Studio 経路は `IMAGE_PROVIDER=aistudio`＋課金有効キー＋AI Studio用モデルID 指定時のみ。
 * プロンプトは wp-article-rewriter 準拠（日本語タイトルを中央に描いたアイキャッチ風イラスト）。
 */

import { sanitizeUserInput } from './llm';
import { generateVertexImage, VertexImageError } from './vertexImageGen';
import { generateAiStudioImagen } from './aiStudioImagen';

export interface GenerateImageOptions {
  prompt: string;
  aspectRatio?: string;
  /** 'aistudio' = AI Studio Imagen(既定・wp-rewriter統一) / 'vertex' = Vertex / 'gemini' = AI Studio gemini-image / 'pollinations' = 無料Flux */
  provider?: 'aistudio' | 'vertex' | 'pollinations' | 'gemini';
  pollModel?: string;
  seed?: number;
  /** @deprecated 旧Imagen用の日本語タイトル合成。nanobanana方式(画像内テキストなし)では未使用。 */
  overlayTitle?: string;
}

export interface GenerateImageResult {
  base64: string;
  mimeType: string;
  modelUsed: string;
}

export class ImageGenError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

/**
 * Nano Banana(Vertex gemini-2.5-flash-image)向けの画像プロンプト。wp-article-rewriter の
 * 本番テンプレ準拠で、topic を「日本語タイトルを中央に大きく描いたアイキャッチ風イラスト」に包む。
 */
export function nanoBananaPrompt(topic: string): string {
  const t = (topic || '').trim() || 'ブログ記事';
  return (
    `${t}。日本語のタイトル文字「${t}」を画像中央に大きく、正確で読みやすく描画する。` +
    `テーマに関連するモチーフ(人物キャラクターや関連アイテム)を周囲に配置。` +
    `パステル調のフラットイラスト、明るく親しみやすい配色、ブログのアイキャッチ/ヘッダー風、16:9アスペクト比。` +
    `日本語の漢字・ひらがな・カタカナを正確に描画し、誤字や英単語・記号の混入を避ける。`
  );
}

function aspectToWH(aspect: string): { w: number; h: number } {
  switch (aspect) {
    case '1:1': return { w: 1024, h: 1024 };
    case '4:3': return { w: 1280, h: 960 };
    case '16:9':
    default:    return { w: 1280, h: 720 };
  }
}

async function callPollinationsOnce(opts: GenerateImageOptions): Promise<GenerateImageResult> {
  const { w, h } = aspectToWH(opts.aspectRatio || '16:9');
  const model = opts.pollModel || 'flux';
  const params = new URLSearchParams({
    width: String(w),
    height: String(h),
    model,
    nologo: 'true',
    enhance: 'true',
  });
  if (opts.seed) params.set('seed', String(opts.seed));

  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(opts.prompt)}?${params.toString()}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 120_000);
  try {
    const resp = await fetch(url, { signal: ac.signal });
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      throw new ImageGenError(resp.status, `Pollinations API ${resp.status}: ${t.slice(0, 200)}`);
    }
    const ct = resp.headers.get('content-type') || 'image/jpeg';
    if (!/^image\//.test(ct)) {
      throw new ImageGenError(502, `unexpected content-type: ${ct}`);
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    return {
      base64: buf.toString('base64'),
      mimeType: ct.split(';')[0],
      modelUsed: `pollinations-${model}`,
    };
  } catch (err) {
    if (err instanceof ImageGenError) throw err;
    const e = err as Error;
    if (e.name === 'AbortError') throw new ImageGenError(408, 'Pollinations API がタイムアウトしました（120秒）');
    throw new ImageGenError(500, e.message);
  } finally {
    clearTimeout(timer);
  }
}

async function generateWithPollinations(opts: GenerateImageOptions): Promise<GenerateImageResult> {
  let lastErr: ImageGenError | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await callPollinationsOnce(opts);
    } catch (e) {
      const err = e as ImageGenError;
      lastErr = err;
      const retryable = err.statusCode === 402 || err.statusCode === 408 || err.statusCode === 429 || err.statusCode === 500 || err.statusCode === 502 || err.statusCode === 503;
      if (!retryable || attempt === 2) break;
      const wait = err.statusCode === 402 ? 8000 + attempt * 4000 : 3000 + attempt * 2000;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr ?? new ImageGenError(500, 'Pollinations: unknown');
}

async function generateWithGemini(opts: GenerateImageOptions): Promise<GenerateImageResult> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new ImageGenError(500, 'GOOGLE_API_KEY 未設定');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [{ text: opts.prompt + (opts.aspectRatio ? `\n\nAspect ratio: ${opts.aspectRatio}` : '') }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new ImageGenError(resp.status, `Gemini Image ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const data = (await resp.json()) as { candidates?: Array<{ content?: { parts?: Array<{ inline_data?: { data: string; mime_type: string }; inlineData?: { data: string; mimeType: string } }> } }> };
  for (const p of data.candidates?.[0]?.content?.parts || []) {
    const inline = p.inline_data || p.inlineData;
    if (inline?.data) {
      const mime = (inline as { mime_type?: string; mimeType?: string }).mime_type || (inline as { mimeType?: string }).mimeType || 'image/png';
      return { base64: inline.data, mimeType: mime, modelUsed: 'gemini-2.5-flash-image' };
    }
  }
  throw new ImageGenError(502, '画像データなし');
}

/** Vertex(Imagen) を最大5回リトライ。終端失敗は throw（呼び出し側がフォールバック）。 */
async function generateVertexWithRetry(opts: GenerateImageOptions): Promise<GenerateImageResult> {
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await generateVertexImage({ prompt: opts.prompt, aspectRatio: opts.aspectRatio });
    } catch (e) {
      const ve = e instanceof VertexImageError ? e : null;
      // 設定不備(SA/プロジェクト/トークン)はリトライしても無駄 → 即終端
      const isConfig = !!ve && /SERVICE_ACCOUNT|PROJECT_ID|access token|未設定/i.test(ve.message);
      const retryable = !!ve && !isConfig && [429, 503, 408, 500, 502, 504].includes(ve.statusCode);
      if (retryable && attempt < maxAttempts - 1) {
        const wait = 4000 * Math.pow(1.8, attempt) + Math.random() * 1000; // 4s,7.2s,12.9s,23.3s(+jitter)
        console.warn(`[imageGen] Vertex ${ve?.statusCode} retry ${attempt + 1}/${maxAttempts} in ${Math.round(wait)}ms`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw e;
    }
  }
  throw new ImageGenError(500, 'Vertex: 予期せぬループ終了');
}

function errMsg(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 140);
}

/**
 * 画像生成。既定は Vertex(Imagen 3 Fast) → Pollinations。
 * `IMAGE_PROVIDER=aistudio` の時のみ AI Studio → Vertex → Pollinations のチェーン。
 * いずれも最終的に **常に画像を返す**（「必ず画像」を担保）。
 */
export async function generateImage(opts: GenerateImageOptions): Promise<GenerateImageResult> {
  const provider =
    opts.provider ||
    (process.env.IMAGE_PROVIDER as 'aistudio' | 'vertex' | 'pollinations' | 'gemini' | undefined) ||
    'vertex';

  if (provider === 'pollinations') return generateWithPollinations(opts);
  if (provider === 'gemini') return generateWithGemini(opts);

  if (provider === 'aistudio') {
    try {
      return await generateAiStudioImagen({ prompt: opts.prompt, aspectRatio: opts.aspectRatio });
    } catch (e) {
      console.warn('[imageGen] AI Studio Imagen 失敗 → Vertex フォールバック:', errMsg(e));
    }
    try {
      return await generateVertexWithRetry(opts);
    } catch (e) {
      console.warn('[imageGen] Vertex 失敗 → Pollinations フォールバック:', errMsg(e));
      return generateWithPollinations(opts);
    }
  }

  // provider === 'vertex'
  try {
    return await generateVertexWithRetry(opts);
  } catch (e) {
    console.warn('[imageGen] Vertex 失敗 → Pollinations フォールバック:', errMsg(e));
    return generateWithPollinations(opts);
  }
}

/**
 * h2 セクションの情報。`body` は h2 直下の本文プレーンテキスト(任意)。
 */
export interface H2Section {
  text: string;
  body?: string;
}

/**
 * 記事のタイトル/見出しを日本語のまま nanobanana テンプレに包む（英訳しない＝wp-rewriter 統一）。
 * Nano Banana は日本語タイトルを画像内に描けるため、翻訳せず日本語をそのまま topic にする
 * （LLM 翻訳呼び出しも不要になり高速・安定）。
 */
export async function buildOptimizedImagePrompts(opts: {
  title: string;
  keywords: string[];
  h2Texts?: string[];
  h2Sections?: H2Section[];
  leadBody?: string;
}): Promise<{ eyecatch: string; h2: string[] }> {
  const sections: H2Section[] =
    opts.h2Sections && opts.h2Sections.length > 0
      ? opts.h2Sections
      : (opts.h2Texts || []).map((t) => ({ text: t }));
  const h2Texts = sections.map((s) => s.text);
  const title = sanitizeUserInput(opts.title);
  return {
    eyecatch: nanoBananaPrompt(title),
    h2: h2Texts.map((t) => nanoBananaPrompt(sanitizeUserInput(t) || title)),
  };
}

/** アイキャッチ用テンプレ（フォールバック）。タイトルを日本語のまま描画する。 */
export function buildEyecatchPrompt(opts: { title: string; keywords: string[] }): string {
  return nanoBananaPrompt(opts.title);
}

/** h2 見出し用テンプレ（翻訳失敗時のフォールバック）。 */
export function buildH2Prompt(opts: { h2Text: string; articleTitle: string }): string {
  return nanoBananaPrompt(opts.h2Text || opts.articleTitle);
}
