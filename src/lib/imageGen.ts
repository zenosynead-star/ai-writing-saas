/**
 * 画像生成プロバイダー切替対応のラッパー。
 *
 * 現在のデフォルト: Pollinations.ai (完全無料、APIキー不要、Flux モデルベース)
 * 将来候補: Gemini 2.5 Flash Image (Nano Banana, 有料tier必要)
 */

import { generate as llmGenerate, BASE_SYSTEM, sanitizeUserInput } from './llm';
import { generateVertexImage, VertexImageError } from './vertexImageGen';

export interface GenerateImageOptions {
  prompt: string;
  aspectRatio?: string;
  /** 'vertex' = Vertex AI Gemini 3.1 Flash Image (Nano Banana 2、本命) */
  provider?: 'vertex' | 'pollinations' | 'gemini';
  pollModel?: string;
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

export async function generateImage(opts: GenerateImageOptions): Promise<GenerateImageResult> {
  // env で IMAGE_PROVIDER を指定:
  //   'vertex'       → Vertex AI Gemini 3.1 Flash Image (Nano Banana 2、推奨)
  //   'gemini'       → AI Studio Gemini Image (有料tier必須、Free=quota 0)
  //   'pollinations' → Pollinations.ai (完全無料、Flux、日本語テキスト不可)
  const provider =
    opts.provider ||
    (process.env.IMAGE_PROVIDER as 'vertex' | 'pollinations' | 'gemini' | undefined) ||
    'pollinations';

  // Vertex 失敗時は Pollinations にフォールバック(可用性優先)
  if (provider === 'vertex') {
    try {
      const r = await generateVertexImage({ prompt: opts.prompt, aspectRatio: opts.aspectRatio });
      return { base64: r.base64, mimeType: r.mimeType, modelUsed: r.modelUsed };
    } catch (e) {
      if (e instanceof VertexImageError && (e.statusCode === 400 || e.statusCode === 408 || e.statusCode === 429 || e.statusCode >= 500)) {
        console.warn('[imageGen] Vertex 失敗 → Pollinations にフォールバック:', e.message);
        return generateWithPollinations(opts);
      }
      throw e;
    }
  }
  if (provider === 'gemini') return generateWithGemini(opts);
  return generateWithPollinations(opts);
}

/**
 * h2 セクションの情報。
 * `body` には h2 直下の本文プレーンテキスト(最大 ~600 文字)を入れる。
 */
export interface H2Section {
  text: string;
  body?: string;
}

/**
 * AI(Gemini text) で記事内容から英語の画像プロンプトを最適化生成。
 * 失敗時はフォールバック版テンプレートを返す。
 *
 * 旧 API (h2Texts: string[]) は下位互換として残す。
 * 新 API は h2Sections: { text, body }[] で h2 直下本文を渡せる。
 */
export async function buildOptimizedImagePrompts(opts: {
  title: string;
  keywords: string[];
  /** 旧 API: h2 見出しテキストのみ。h2Sections が未指定の場合に使う。*/
  h2Texts?: string[];
  /** 新 API: h2 見出し + 直下本文(プレーンテキスト)。優先される。*/
  h2Sections?: H2Section[];
  /** 記事冒頭の本文サマリ(プレーンテキスト最大 800 字程度)。eyecatch に使う。*/
  leadBody?: string;
}): Promise<{ eyecatch: string; h2: string[] }> {
  // 互換性レイヤ: h2Sections が無ければ h2Texts から生成
  const sections: H2Section[] = opts.h2Sections && opts.h2Sections.length > 0
    ? opts.h2Sections
    : (opts.h2Texts || []).map((t) => ({ text: t }));

  const inputData = {
    title: sanitizeUserInput(opts.title),
    keywords: opts.keywords.map(sanitizeUserInput),
    leadBody: opts.leadBody ? sanitizeUserInput(opts.leadBody).slice(0, 800) : '',
    sections: sections.map((s) => ({
      text: sanitizeUserInput(s.text),
      body: s.body ? sanitizeUserInput(s.body).slice(0, 600) : '',
    })),
  };
  const h2Texts = inputData.sections.map((s) => s.text);

  // 後方互換用に h2Texts だけのフォールバックも提供
  const fallbackOpts = { title: opts.title, keywords: opts.keywords, h2Texts };

  // 各セクションを「番号: 見出し / 本文要約」の形に整形
  const sectionsBlock = inputData.sections
    .map((s, i) => {
      const head = `${i + 1}. ${s.text}`;
      const body = s.body ? `\n   本文要約: ${s.body}` : '';
      return head + body;
    })
    .join('\n');

  // Vertex (Gemini Image / Nano Banana) は日本語テキストOK・インフォグラフィック向き
  if (isVertexProvider()) {
    const userPrompt = `You are an art director for a Japanese tech blog (naturaledge.jp style).
Generate optimized prompts for Gemini Image (Nano Banana) to produce **modern flat infographic illustrations** with Japanese headline text rendered cleanly inside the image.

Article context:
- Title (Japanese): ${inputData.title}
- Keywords: ${inputData.keywords.join(', ')}
${inputData.leadBody ? `- 記事冒頭(リード): ${inputData.leadBody}\n` : ''}
- h2 sections (Japanese, 各見出しの直下本文も併記):
${sectionsBlock}

Generate one prompt for the eyecatch hero image and one for each h2 section.

# Style requirements (apply to ALL prompts)
- Modern flat illustration, infographic style, soft pastel colors (light blue / cream / white)
- 16:9 horizontal aspect ratio
- Japanese headline text MUST be rendered prominently at the top of each image (this is the key feature)
- Below the headline: a clean grid (2-6 cells) with iconic illustrations
- Friendly, approachable Japanese tech-blog aesthetic
- No watermark, no human faces close-up

# Content rules (重要)
- 各 h2 の "本文要約" を必ず読み、その本文で具体的に言及されている**製品名・数値・固有の概念・チェック項目・比較軸**をイラスト/アイコン/小見出しとして画像内に反映すること
- 単なる「リクライニング機能のアイコン」ではなく、本文で語られている「角度の数値(135度/180度等)」「具体的な選定基準(耐荷重/ロック機構等)」「対象シーン(仮眠/集中ゲーミング等)」を絵に落とし込む
- The image MUST include the Japanese heading text exactly as given (一字一句正確に)
- Eyecatch: 記事タイトル + リード本文の核となる主張(誰の何の悩みをどう解決するか)を1枚に
- Each prompt 100-180 words, very specific about layout/colors/icons/labels

# Output (pure JSON, no fences, no commentary)
{
  "eyecatch": "Create a Japanese blog header (16:9) ... include Japanese title text \\"...\\" at top ... grid of N cells labeled in Japanese with \\"...\\", \\"...\\" ... pastel colors ...",
  "h2": [
    "Create a Japanese blog section image (16:9) ... include Japanese heading \\"...\\" ... grid of N cells, each labeled with concrete keywords from the section body like \\"...\\", \\"...\\" ...",
    ...
  ]
}`;
    return await tryLlmPrompts(userPrompt, fallbackOpts);
  }

  // Pollinations (Flux) 向け: 写真風プロンプト
  const userPrompt = `You are an expert visual director for blog hero images.
Generate optimal English image prompts for Flux/Stable Diffusion that will produce eye-catching, photo-realistic, professional editorial photographs.

Article context (in Japanese):
- Title: ${inputData.title}
- Keywords: ${inputData.keywords.join(', ')}
${inputData.leadBody ? `- Lead: ${inputData.leadBody}\n` : ''}
- h2 sections (in order, with body summary):
${sectionsBlock}

Generate one prompt for the eyecatch (hero image) and one prompt for each h2 section.

# Style requirements (apply to ALL prompts)
- Hyper-realistic editorial photograph, cinematic lighting, vibrant colors, shallow depth of field
- Premium magazine quality, 8k, sharp focus on subject
- Rule of thirds composition, dynamic angle, attention-grabbing
- Modern aesthetic, emotionally engaging
- 16:9 horizontal landscape orientation
- NO TEXT, NO LETTERS, NO WATERMARKS, NO TYPOGRAPHY anywhere in image

# Content guidelines
- For eyecatch: capture the article's lead/thesis with a striking, intriguing visual that makes readers want to click
- For each h2: visualize the SPECIFIC content described in that section's body summary (concrete objects/scenes/numbers mentioned)
- Make each scene CONCRETE and PHOTOGRAPHIC (real people, real objects, real places) — NOT abstract or symbolic
- Vary the subjects so the article doesn't feel monotonous
- Each prompt should be 80-140 words, descriptive and specific

# Output format (JSON only, no markdown fences, no explanation)
{
  "eyecatch": "Hyper-realistic editorial photograph showing ...",
  "h2": [
    "Hyper-realistic editorial photograph showing ... (for section 1, derived from its body)",
    "Hyper-realistic editorial photograph showing ... (for section 2, derived from its body)",
    ...
  ]
}`;

  return await tryLlmPrompts(userPrompt, fallbackOpts);
}

async function tryLlmPrompts(
  userPrompt: string,
  opts: { title: string; keywords: string[]; h2Texts: string[] },
): Promise<{ eyecatch: string; h2: string[] }> {
  try {
    const res = await llmGenerate({
      logicalModel: 'low_cost',
      taskType: 'image_prompt',
      system: BASE_SYSTEM,
      user: userPrompt,
      maxTokens: 4000,
      jsonMode: true,
      temperature: 0.8,
    });
    const text = res.content.trim();
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(cleaned) as { eyecatch?: string; h2?: string[] };
    return {
      eyecatch: parsed.eyecatch || buildEyecatchPrompt(opts),
      h2: parsed.h2 && parsed.h2.length >= opts.h2Texts.length
        ? parsed.h2.slice(0, opts.h2Texts.length)
        : opts.h2Texts.map((t) => buildH2Prompt({ h2Text: t, articleTitle: opts.title })),
    };
  } catch (err) {
    console.error('[buildOptimizedImagePrompts] fallback:', (err as Error).message);
    return {
      eyecatch: buildEyecatchPrompt(opts),
      h2: opts.h2Texts.map((t) => buildH2Prompt({ h2Text: t, articleTitle: opts.title })),
    };
  }
}

/**
 * Vertex Gemini Image (Nano Banana 2) 向けのプロンプトテンプレート。
 * wp-article-rewriter の `DEFAULT_PROMPT_TEMPLATE` を参考に、
 * 日本語タイトル + インフォグラフィック・フラットイラスト指定。
 *
 * 参考記事 (naturaledge.jp) と同じスタイル:
 *  - modern flat illustration
 *  - soft pastel colors (light blue / cream)
 *  - infographic style with grid layout
 *  - 日本語見出しテキスト OK (Gemini 3.1 が描画可能)
 */
export function buildEyecatchPrompt(opts: {
  title: string;
  keywords: string[];
}): string {
  if (isVertexProvider()) {
    return `Create a Japanese blog header image (16:9) for the article titled "${opts.title}". Style: modern flat illustration, infographic, soft pastel colors (light blue, cream, white background). Include the Japanese title text "${opts.title}" prominently at the top center. Below the title, show a clean grid layout with 2-4 illustrated product/concept cards related to: ${opts.keywords.join(', ')}. Friendly and approachable. Premium magazine-quality layout. No watermark, no faces close-up.`;
  }
  // フォトリアル(Pollinations)版フォールバック
  return `Hyper-realistic, eye-catching editorial photograph for a blog article titled "${opts.title}". Keywords: ${opts.keywords.join(', ')}. Cinematic lighting with golden hour glow, vibrant saturated colors, shallow depth of field, sharp focus on the main subject. Premium magazine quality, 8k resolution. Rule-of-thirds composition with a dynamic camera angle. Emotionally engaging, attention-grabbing, makes the viewer want to read more. Modern editorial aesthetic. NO TEXT, NO LETTERS, NO WATERMARKS. 16:9 horizontal landscape orientation.`;
}

export function buildH2Prompt(opts: {
  h2Text: string;
  articleTitle: string;
}): string {
  if (isVertexProvider()) {
    return `Create a Japanese blog section image (16:9) for the heading "${opts.h2Text}" in an article about "${opts.articleTitle}". Style: modern flat illustration, infographic, soft pastel colors (light blue, cream). Include the Japanese heading text "${opts.h2Text}" at the top. Below the heading, show a clean grid (3-6 cells) with illustrated icons/cards that visually break down the topic. Friendly characters and approachable design. Like a Japanese tech blog explainer. Premium magazine-quality layout. No watermark.`;
  }
  // フォトリアル(Pollinations)版フォールバック
  return `Hyper-realistic editorial photograph illustrating the topic: "${opts.h2Text}" (from a Japanese blog article about "${opts.articleTitle}"). Cinematic lighting, vibrant colors, sharp focus, shallow depth of field. Concrete photographic scene with real people, objects, or environments related to the topic. Premium magazine quality, 8k resolution. Engaging and visually intriguing composition. NO TEXT, NO LETTERS, NO WATERMARKS. 16:9 horizontal landscape.`;
}

function isVertexProvider(): boolean {
  return (process.env.IMAGE_PROVIDER || 'pollinations').toLowerCase() === 'vertex';
}
