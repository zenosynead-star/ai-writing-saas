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
import { renderPlaceholderImage } from './imageOverlay';

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

/** Vertex を最大 maxAttempts 回リトライ。終端失敗は throw（呼び出し側がフォールバック）。 */
async function generateVertexWithRetry(
  opts: GenerateImageOptions,
  cfgOverride?: { model?: string; location?: string },
  maxAttempts = 5,
): Promise<GenerateImageResult> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await generateVertexImage({ prompt: opts.prompt, aspectRatio: opts.aspectRatio }, cfgOverride);
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

/**
 * Vertex 主モデル(本番=Nano Banana Pro `gemini-3-pro-image-preview`@global、プレビュー枠で
 * クォータが厳しい)が 429 等で落ちた時の二次フォールバック設定。別枠クォータの
 * 無印 Nano Banana `gemini-2.5-flash-image`@us-central1 を返す。Pollinations へ落ちる前に
 * 「本物のAI画像」を取りに行くことで、一括生成時の手抜きプレースホルダー発生を減らす。
 * 主モデルと同一(モデル・ロケーション両方)なら null（二重実行しない）。env で調整/無効化可。
 */
function vertexFallbackCfg(): { model: string; location: string } | null {
  const model = (process.env.VERTEX_IMAGE_MODEL_FALLBACK ?? 'gemini-2.5-flash-image').trim();
  if (!model) return null; // 空文字を明示設定すればフォールバック無効
  const location = (process.env.VERTEX_LOCATION_FALLBACK || 'us-central1').trim();
  const primaryModel = (process.env.VERTEX_IMAGE_MODEL || 'gemini-2.5-flash-image').trim();
  const primaryLoc = (process.env.VERTEX_LOCATION || 'us-central1').trim();
  if (model === primaryModel && location === primaryLoc) return null;
  return { model, location };
}

/**
 * Vertex 主モデル → 無印フォールバックの順に試す。両方失敗で throw（呼び出し側が Pollinations へ）。
 * 主は最大5回リトライ、フォールバックは速さ優先で2回まで。
 */
async function generateVertexChain(opts: GenerateImageOptions): Promise<GenerateImageResult> {
  try {
    return await generateVertexWithRetry(opts); // 主: Nano Banana Pro(global)
  } catch (e) {
    // 設定不備(SA/プロジェクト/トークン未設定)は env 全体の問題で、無印モデルも同じ
    // VERTEX_PROJECT_ID 等を見るため必ず失敗する → 無駄打ちせず即 Pollinations へ。
    const isConfig =
      e instanceof VertexImageError && /SERVICE_ACCOUNT|PROJECT_ID|access token|未設定/i.test(e.message);
    const fb = isConfig ? null : vertexFallbackCfg();
    if (!fb) throw e;
    console.warn(`[imageGen] Vertex主モデル失敗 → 無印Vertex(${fb.model}@${fb.location})フォールバック:`, errMsg(e));
    return await generateVertexWithRetry(opts, fb, 2); // 別枠クォータの無印モデルで本物画像を取りに行く
  }
}

function errMsg(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 140);
}

// 画像API(Vertex Nano Banana Pro 等)の同時呼び出しを制限する。UI 同時実行を5に上げても、
// 実際に並走する画像生成は最大 IMAGE_MAX_CONCURRENCY 個までに絞り、429(レート制限)の集中を防ぐ。
// Nano Banana Pro はプレビュー枠でクォータが厳しいため既定 2（env IMAGE_MAX_CONCURRENCY で調整可）。
const IMAGE_MAX_CONCURRENCY = Math.max(1, Number(process.env.IMAGE_MAX_CONCURRENCY) || 2);
let imageActive = 0;
const imageWaiters: Array<() => void> = [];
async function withImageSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (imageActive >= IMAGE_MAX_CONCURRENCY) {
    await new Promise<void>((resolve) => imageWaiters.push(resolve));
  }
  imageActive++;
  try {
    return await fn();
  } finally {
    imageActive--;
    imageWaiters.shift()?.();
  }
}

/**
 * 画像生成（公開API）。同時実行数を IMAGE_MAX_CONCURRENCY で絞ってから実体を呼ぶ。
 * 既定は Vertex(Nano Banana Pro) → Pollinations。`IMAGE_PROVIDER=aistudio` の時のみ
 * AI Studio → Vertex → Pollinations のチェーン。いずれも最終的に **常に画像を返す**。
 */
export function generateImage(opts: GenerateImageOptions): Promise<GenerateImageResult> {
  return withImageSlot(() => generateImageInner(opts));
}

/** 1x1 透明PNG（canvas すら使えない理論上の最終保険）。 */
const TRANSPARENT_PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/**
 * ローカル生成のプレースホルダー画像（タイトル文字入りのブランド背景）。
 * ネットワーク・APIキー・クォータ不要なので「必ず1枚画像を入れる」最終フォールバック。
 * modelUsed='placeholder' で記録し、後段のバックフィルが本物のAI画像へ差し替える。
 */
function generatePlaceholderImage(opts: GenerateImageOptions): GenerateImageResult {
  const { w, h } = aspectToWH(opts.aspectRatio || '16:9');
  const text = (opts.overlayTitle || '').trim() || 'ブログ記事';
  try {
    return { base64: renderPlaceholderImage(text, w, h), mimeType: 'image/png', modelUsed: 'placeholder' };
  } catch (e) {
    console.warn('[imageGen] プレースホルダー描画失敗 → 透明PNG:', errMsg(e));
    return { base64: TRANSPARENT_PNG_1x1, mimeType: 'image/png', modelUsed: 'placeholder-empty' };
  }
}

/**
 * 画像生成の実体（プロバイダ選択＋フォールバックチェーン）。
 * 最終的に必ず画像を返す（throw しない）。全プロバイダ失敗時はローカルのプレースホルダーで「必ず1枚」入れる。
 */
async function generateImageInner(opts: GenerateImageOptions): Promise<GenerateImageResult> {
  const provider =
    opts.provider ||
    (process.env.IMAGE_PROVIDER as 'aistudio' | 'vertex' | 'pollinations' | 'gemini' | undefined) ||
    'vertex';
  try {
    if (provider === 'pollinations') return await generateWithPollinations(opts);
    if (provider === 'gemini') return await generateWithGemini(opts);

    if (provider === 'aistudio') {
      try {
        return await generateAiStudioImagen({ prompt: opts.prompt, aspectRatio: opts.aspectRatio });
      } catch (e) {
        console.warn('[imageGen] AI Studio Imagen 失敗 → Vertex フォールバック:', errMsg(e));
      }
      try {
        return await generateVertexChain(opts);
      } catch (e) {
        console.warn('[imageGen] Vertex(主+無印) 失敗 → Pollinations フォールバック:', errMsg(e));
      }
      return await generateWithPollinations(opts);
    }

    // provider === 'vertex'
    try {
      return await generateVertexChain(opts);
    } catch (e) {
      console.warn('[imageGen] Vertex(主+無印) 失敗 → Pollinations フォールバック:', errMsg(e));
    }
    return await generateWithPollinations(opts);
  } catch (e) {
    // 全プロバイダ失敗 → ローカル・プレースホルダーで必ず1枚入れる（後でバックフィルが本物に差し替え）
    console.warn('[imageGen] 全プロバイダ失敗 → プレースホルダー画像:', errMsg(e));
    return generatePlaceholderImage(opts);
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
