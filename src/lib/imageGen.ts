/**
 * 画像生成プロバイダー切替対応のラッパー。
 *
 * 現在のデフォルト: Pollinations.ai (完全無料、APIキー不要、Flux モデルベース)
 *   - https://image.pollinations.ai/prompt/{prompt}?width=...&height=...
 *
 * 将来候補: Gemini 2.5 Flash Image (Nano Banana, 有料tier必要)
 *           Cloudflare Workers AI (無料tier あり)
 */

export interface GenerateImageOptions {
  prompt: string;
  /** "16:9" "1:1" "4:3" など */
  aspectRatio?: string;
  /** override default provider */
  provider?: 'pollinations' | 'gemini';
  /** Pollinations.ai のモデル: flux / flux-realism / flux-anime / turbo */
  pollModel?: string;
  /** seed (再現性) */
  seed?: number;
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

function aspectToWH(aspect: string): { w: number; h: number } {
  switch (aspect) {
    case '1:1': return { w: 1024, h: 1024 };
    case '4:3': return { w: 1280, h: 960 };
    case '16:9':
    default:    return { w: 1280, h: 720 };
  }
}

async function generateWithPollinations(opts: GenerateImageOptions): Promise<GenerateImageResult> {
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
  const timer = setTimeout(() => ac.abort(), 90_000);
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
    if (e.name === 'AbortError') throw new ImageGenError(408, 'Pollinations API がタイムアウトしました（90秒）');
    throw new ImageGenError(500, e.message);
  } finally {
    clearTimeout(timer);
  }
}

// 互換のため残す: 将来 Gemini Image に課金後切り替え可能
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

export async function generateImage(opts: GenerateImageOptions): Promise<GenerateImageResult> {
  const provider = opts.provider || (process.env.IMAGE_PROVIDER as 'pollinations' | 'gemini' | undefined) || 'pollinations';
  if (provider === 'gemini') return generateWithGemini(opts);
  return generateWithPollinations(opts);
}

/** プロンプトテンプレート: アイキャッチ */
export function buildEyecatchPrompt(opts: {
  title: string;
  keywords: string[];
  style?: string;
}): string {
  const style = opts.style || 'modern flat illustration, clean, professional, soft pastel colors, blog header style, no text';
  return `${style}. Blog article header image about: ${opts.title}. Theme keywords: ${opts.keywords.join(', ')}. Bright, friendly, conceptual. No text or letters in the image.`;
}

/** プロンプトテンプレート: h2 見出し */
export function buildH2Prompt(opts: {
  h2Text: string;
  articleTitle: string;
  style?: string;
}): string {
  const style = opts.style || 'flat illustration, soft pastel colors, blog section image, no text';
  return `${style}. Section illustration for blog topic: "${opts.h2Text}" (article context: ${opts.articleTitle}). Symbolic, conceptual. No text or letters in the image.`;
}
