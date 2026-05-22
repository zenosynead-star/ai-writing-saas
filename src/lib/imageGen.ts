/**
 * Gemini 2.5 Flash Image (Nano Banana) を使った画像生成。
 * @google/generative-ai SDK の現バージョンが画像出力に未対応のため、REST API を直接叩く。
 */

const MODEL = 'gemini-2.5-flash-image';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface GenerateImageOptions {
  prompt: string;
  /** "16:9" "1:1" "4:3" など。Gemini Image はプロンプト内で指定する形 */
  aspectRatio?: string;
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

export async function generateImage(opts: GenerateImageOptions): Promise<GenerateImageResult> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new ImageGenError(500, 'GOOGLE_API_KEY が設定されていません');

  const aspectHint = opts.aspectRatio ? `\n\nAspect ratio: ${opts.aspectRatio}` : '';
  const url = `${API_BASE}/${MODEL}:generateContent?key=${apiKey}`;

  const body = {
    contents: [{ parts: [{ text: opts.prompt + aspectHint }] }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const errBody = await resp.text();
      throw new ImageGenError(resp.status, `Gemini Image API ${resp.status}: ${errBody.slice(0, 300)}`);
    }
    const data = (await resp.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ inline_data?: { data: string; mime_type: string }; inlineData?: { data: string; mimeType: string } }> } }>;
    };
    const parts = data.candidates?.[0]?.content?.parts || [];
    for (const p of parts) {
      const inline = p.inline_data || p.inlineData;
      if (inline?.data) {
        return {
          base64: inline.data,
          mimeType: (inline as { mime_type?: string; mimeType?: string }).mime_type || (inline as { mimeType?: string }).mimeType || 'image/png',
          modelUsed: MODEL,
        };
      }
    }
    throw new ImageGenError(502, '画像データが返されませんでした');
  } catch (err) {
    if (err instanceof ImageGenError) throw err;
    const e = err as Error;
    if (e.name === 'AbortError') throw new ImageGenError(408, '画像生成がタイムアウトしました（60秒）');
    throw new ImageGenError(500, e.message);
  } finally {
    clearTimeout(timer);
  }
}

/** 記事情報から画像生成プロンプトを組み立てる */
export function buildEyecatchPrompt(opts: {
  title: string;
  keywords: string[];
  style?: string;
}): string {
  const style = opts.style || 'modern flat illustration, clean, professional, blog header style';
  return `Create a horizontal blog header image (16:9) for the following article. ${style}.
Article title: ${opts.title}
Keywords: ${opts.keywords.join(', ')}
No text or letters in the image. Bright, friendly atmosphere.`;
}

export function buildH2Prompt(opts: {
  h2Text: string;
  articleTitle: string;
  style?: string;
}): string {
  const style = opts.style || 'flat illustration, soft colors, blog section image';
  return `Create a horizontal section image (16:9) that visually represents the following blog section. ${style}.
Article title: ${opts.articleTitle}
Section heading: ${opts.h2Text}
No text or letters in the image. Symbolic, conceptual illustration.`;
}
