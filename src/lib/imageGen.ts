/**
 * 画像生成プロバイダー切替対応のラッパー。
 *
 * 現在のデフォルト: Pollinations.ai (完全無料、APIキー不要、Flux モデルベース)
 * 将来候補: Gemini 2.5 Flash Image (Nano Banana, 有料tier必要)
 */

import { generate as llmGenerate, BASE_SYSTEM, sanitizeUserInput } from './llm';
import { generateVertexImage, VertexImageError } from './vertexImageGen';
import { overlayTitleBar } from './imageOverlay';

export interface GenerateImageOptions {
  prompt: string;
  aspectRatio?: string;
  /** 'vertex' = Vertex AI Gemini 3.1 Flash Image (Nano Banana 2、本命) */
  provider?: 'vertex' | 'pollinations' | 'gemini';
  pollModel?: string;
  seed?: number;
  /**
   * 指定すると生成後に Canvas で「黄色バー + 白文字+黒縁取り」のタイトルを上部に overlay する。
   * Imagen 4 等は日本語テキスト描画が崩壊するための補正処理。
   */
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

  // Vertex: 429/503/500+ は指数バックオフでリトライ、400(safety) のみ Pollinations フォールバック
  if (provider === 'vertex') {
    const maxAttempts = 5;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const r = await generateVertexImage({ prompt: opts.prompt, aspectRatio: opts.aspectRatio });
        // 日本語タイトルが指定されていれば Canvas で overlay (Imagen 系は日本語が崩れるため)
        if (opts.overlayTitle) {
          try {
            const overlaid = await overlayTitleBar(r.base64, opts.overlayTitle);
            return { base64: overlaid, mimeType: 'image/png', modelUsed: `${r.modelUsed}+overlay` };
          } catch (oe) {
            console.warn('[imageGen] overlay failed, return raw image:', (oe as Error).message);
            return { base64: r.base64, mimeType: r.mimeType, modelUsed: r.modelUsed };
          }
        }
        return { base64: r.base64, mimeType: r.mimeType, modelUsed: r.modelUsed };
      } catch (e) {
        lastErr = e;
        if (e instanceof VertexImageError) {
          // 429 / 503 / 500+ / 408 → リトライ
          const retryable = e.statusCode === 429 || e.statusCode === 503 || e.statusCode === 408 || e.statusCode === 500 || e.statusCode === 502 || e.statusCode === 504;
          if (retryable && attempt < maxAttempts - 1) {
            const wait = 4000 * Math.pow(1.8, attempt) + Math.random() * 1000; // 4s, 7.2s, 12.9s, 23.3s (+jitter)
            console.warn(`[imageGen] Vertex ${e.statusCode} retry ${attempt + 1}/${maxAttempts} in ${Math.round(wait)}ms: ${e.message.slice(0, 100)}`);
            await new Promise((r) => setTimeout(r, wait));
            continue;
          }
          // 400 (safety block 等) は Pollinations にフォールバック (画像は得る、テキストは諦める)
          if (e.statusCode === 400) {
            console.warn('[imageGen] Vertex 400 (safety?) → Pollinations フォールバック:', e.message.slice(0, 100));
            return generateWithPollinations(opts);
          }
        }
        throw e;
      }
    }
    throw lastErr ?? new ImageGenError(500, 'Vertex unknown failure');
  }
  if (provider === 'gemini') return generateWithGemini(opts);
  return generateWithPollinations(opts);
}

/**
 * h2 セクションの情報。
 * `body` には h2 直下の本文プレーンテキスト(最大 ~1200 文字)を入れる。
 */
export interface H2Section {
  text: string;
  body?: string;
}

/**
 * 本文を「固有名詞・数値・固有概念」が密になるよう凝縮する。
 * 装飾的なフィラー(括弧書きの読み仮名・「〜は…です」助詞句・括弧書きの例示等)を除去。
 */
function condenseBody(body: string, maxLen: number): string {
  return body
    // 括弧書きの注釈/例示(30字以内)を削除
    .replace(/[（(][^）)]{1,30}[）)]/g, '')
    // 「以下」「次のような」等の接続フィラー
    .replace(/(?:以下のような|次のような|これは|これらの|そして|また、|さらに、|なお、)/g, '')
    // 連続する空白・全角空白を1つに
    .replace(/[\s　]+/g, ' ')
    .trim()
    .slice(0, maxLen);
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
    leadBody: opts.leadBody ? condenseBody(sanitizeUserInput(opts.leadBody), 1400) : '',
    sections: sections.map((s) => ({
      text: sanitizeUserInput(s.text),
      body: s.body ? condenseBody(sanitizeUserInput(s.body), 1200) : '',
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

  // Vertex (Imagen 4) 向け: パステルフラットイラスト + 中央白ボックスタイトル領域
  // **2段階プロンプト**: ①本文から concrete elements を列挙 → ②それを描画するシーン構成 → ③Imagen 用最終プロンプト
  if (isVertexProvider()) {
    const userPrompt = `You are an art director for a Japanese lifestyle/tech blog header image.
Generate optimized image specifications for **Imagen 4**, in this EXACT visual style:

# Reference image style (THIS is what we are emulating)
- **Pastel-toned flat illustration** (NOT photograph, NOT 3D, NOT anime cel-shaded). Bright, friendly, warm.
- **16:9 horizontal blog header**
- **Composition**: 1 standing character on the LEFT, 1 sitting (or different pose) character on the RIGHT. Both are friendly Japanese characters appropriate to the article topic.
- **Decorative houseplants (potted plants / foliage)** on both sides of the canvas (e.g. a monstera in a pot left foreground, hanging plant right corner)
- **Center area = LARGE EMPTY ROUNDED WHITE CARD** (sized about 60% width × 36% height of the canvas, centered). This box will hold the title — leave it COMPLETELY EMPTY (no text inside, just a clean white rectangle with a thin dark border).
- **Background**: pastel sky-blue / cream / mint / pale yellow gradient or simple shapes. Cheerful, modern.
- **Clean thin outlines**, flat fill colors, no heavy shadows
- A pastel base palette + ONE bright accent (sunny yellow / coral pink / mint green)
- The characters' actions and the props around them must reflect the article topic (cooking utensils / suitcases / gaming chair / etc. as appropriate)
- Optional: 2-4 small SHORT-text speech bubbles or small product tags AROUND the characters (NOT inside the center white card), each with a 3-8 character Japanese label drawn from the body content

Article context:
- Title (Japanese): ${inputData.title}
- Keywords: ${inputData.keywords.join(', ')}
${inputData.leadBody ? `- 記事冒頭リード: ${inputData.leadBody}\n` : ''}
- h2 sections (見出し + 直下本文):
${sectionsBlock}

# Your task (TWO-STAGE per image)
For the eyecatch and each h2, do BOTH stages:

**Stage A — Concrete extraction (Japanese):**
Read the body summary and extract 5-8 distinct CONCRETE visual elements that the image MUST show. Each element is a noun phrase (3-12 Japanese chars) representing a product name, number, named concept, action, or environment item. Examples:
- リモワ理由 body → ["グルーヴ加工","TSAロック","マルチホイール","1898年創業","ポリカーボネート","アルミ筐体"]
- ダイエット基本 body → ["PFCバランス","GI値表","食事順序の矢印","ハリスベネディクト式","1400kcal目標","活動係数"]

**Stage B — Visual plan (Japanese, 1-3 lines):**
Describe HOW to compose those elements: who is where, what they're doing, left/right split if any, background, props per side.

**Stage C — Final Imagen prompt (English, 150-220 words):**
Write the actual prompt for Imagen 4. It MUST:
- Begin with "Pastel-toned flat illustration, Japanese blog header, 16:9 landscape."
- Mention "Center 60% width × 36% height: a clean empty rounded WHITE CARD with thin dark border — leave COMPLETELY EMPTY (NO TEXT INSIDE), reserved for a post-processing title overlay."
- Describe the surrounding scene: standing character on LEFT (describe their pose, outfit, what they hold), sitting/different-pose character on RIGHT (describe pose, what they hold/do), decorative POTTED PLANTS / HOUSEPLANTS on both side foreground/corner
- **EXPLICITLY name every concreteElement from Stage A** somewhere in the prompt (as scene objects, prop labels, or speech-bubble content around — NOT inside — the center card)
- Optionally add 2-4 small speech bubbles or product tags AROUND the characters (left margin or right margin, NOT in the center area) with their **exact Japanese label text** in quotes like "small speech bubble saying 「TSAロック」"
- End with "Pastel sky-blue/cream background, [accent color] highlights, clean thin outlines, flat fill colors, bright and cheerful."
- Aside from the small bubble/tag labels, NO other text — especially NO text inside the center white card

# Output (pure JSON, no fences, no commentary)
{
  "eyecatch": {
    "concreteElements": ["...", "...", "...", "..."],
    "visualPlan": "...",
    "prompt": "Pastel-toned flat illustration, Japanese blog header, 16:9 landscape. Center 60% width × 36% height: clean empty rounded WHITE CARD with thin dark border — COMPLETELY EMPTY, no text. LEFT: standing young Japanese ... [pose, outfit, holds X]. RIGHT: sitting young Japanese ... [pose, holds Y]. Decorative potted plants (monstera in pot left foreground, hanging plant right corner). 3 small speech bubbles in margins saying \\"...\\", \\"...\\", \\"...\\". [Naming every concreteElement]. Pastel sky-blue and cream background, sunny yellow highlights, clean thin outlines, flat fill colors, bright and cheerful."
  },
  "h2": [
    {
      "concreteElements": ["...", "...", "...", "...", "..."],
      "visualPlan": "...",
      "prompt": "Pastel-toned flat illustration, Japanese blog header, 16:9 landscape. Center 60% × 36%: clean empty rounded WHITE CARD with thin dark border — COMPLETELY EMPTY, no text. LEFT: standing character ... RIGHT: sitting/different-pose character ... Potted plants on both sides. Speech bubbles in margins saying \\"...\\", \\"...\\", \\"...\\", \\"...\\". [Naming every concreteElement]. Pastel background, [accent] highlights, clean thin outlines, flat fill colors."
    }
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

/** 構造化 LLM 出力(2段階版)。 */
interface StructuredImageSpec {
  concreteElements?: string[];
  visualPlan?: string;
  prompt?: string;
}

/**
 * 構造化 spec を Imagen 用の最終プロンプトに正規化する。
 * concreteElements と visualPlan を強制的に prompt 文末に append して、
 * LLM が prompt 内で言及し損ねた要素も Imagen に確実に届くようにする。
 */
function specToImagenPrompt(spec: StructuredImageSpec | string | undefined, fallback: string): string {
  if (!spec) return fallback;
  if (typeof spec === 'string') return spec || fallback;
  const base = (spec.prompt || '').trim();
  if (!base) return fallback;
  const elements = (spec.concreteElements || []).filter((s) => typeof s === 'string' && s.trim()).slice(0, 12);
  const plan = (spec.visualPlan || '').trim();
  const parts: string[] = [base];
  if (elements.length > 0) {
    parts.push(
      `\n\nMUST visually include every one of these concrete elements (as scene objects, speech-bubble labels, or product tags): ${elements
        .map((e) => `「${e}」`)
        .join(', ')}.`,
    );
  }
  if (plan) {
    parts.push(`\nLayout plan: ${plan}`);
  }
  return parts.join('');
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
      maxTokens: 8000,
      jsonMode: true,
      temperature: 0.8,
    });
    const text = res.content.trim();
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(cleaned) as {
      eyecatch?: string | StructuredImageSpec;
      h2?: Array<string | StructuredImageSpec>;
    };
    const eyecatchFallback = buildEyecatchPrompt(opts);
    const h2Fallback = (i: number) => buildH2Prompt({ h2Text: opts.h2Texts[i], articleTitle: opts.title });
    return {
      eyecatch: specToImagenPrompt(parsed.eyecatch, eyecatchFallback),
      h2:
        parsed.h2 && parsed.h2.length >= opts.h2Texts.length
          ? parsed.h2.slice(0, opts.h2Texts.length).map((s, i) => specToImagenPrompt(s, h2Fallback(i)))
          : opts.h2Texts.map((_t, i) => h2Fallback(i)),
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
 * 参考記事 (naturaledge.jp/media の heading-91-...png) と同じスタイル:
 *  - Warm anime-style (Ghibli / Shinkai 風) slice-of-life illustration
 *  - 1-2 friendly Japanese characters interacting with the topic
 *  - Thick clean outlines, vivid pastel + bright accent
 *  - 16:9 horizontal, large rounded gothic title bar at top
 *  - 3-5 speech bubbles with short Japanese phrases drawn from topic
 *  - Imagen 4 で日本語タイトル描画
 */
export function buildEyecatchPrompt(opts: {
  title: string;
  keywords: string[];
}): string {
  if (isVertexProvider()) {
    return `Pastel-toned flat illustration, Japanese blog header, 16:9 landscape. Center 60% width × 36% height: clean empty rounded WHITE CARD with thin dark border — COMPLETELY EMPTY, no text inside. LEFT: a standing young Japanese character (friendly pose, appropriate to ${opts.keywords.join(', ')}). RIGHT: a sitting or different-pose young Japanese character. Decorative POTTED PLANTS / HOUSEPLANTS on both sides (e.g. monstera in pot left foreground, hanging plant right corner). 2-4 small speech bubbles in the margins (NOT in the center card) with SHORT Japanese labels 3-8 chars like ${opts.keywords.slice(0, 3).map((k) => `「${k}」`).join(' ')}. Pastel sky-blue and cream background, sunny yellow highlights, clean thin outlines, flat fill colors, bright and cheerful. NO other text, NO headlines, NO words inside the center card.`;
  }
  // フォトリアル(Pollinations)版フォールバック
  return `Hyper-realistic, eye-catching editorial photograph for a blog article titled "${opts.title}". Keywords: ${opts.keywords.join(', ')}. Cinematic lighting with golden hour glow, vibrant saturated colors, shallow depth of field, sharp focus on the main subject. Premium magazine quality, 8k resolution. Rule-of-thirds composition with a dynamic camera angle. Emotionally engaging, attention-grabbing, makes the viewer want to read more. Modern editorial aesthetic. NO TEXT, NO LETTERS, NO WATERMARKS. 16:9 horizontal landscape orientation.`;
}

export function buildH2Prompt(opts: {
  h2Text: string;
  articleTitle: string;
}): string {
  if (isVertexProvider()) {
    return `Pastel-toned flat illustration, Japanese blog section header, 16:9 landscape (article: "${opts.articleTitle}"). Center 60% × 36%: clean empty rounded WHITE CARD with thin dark border — COMPLETELY EMPTY, no text. LEFT: standing young Japanese character relevant to section topic "${opts.h2Text}". RIGHT: sitting or different-pose young Japanese character also relevant. Decorative potted plants / houseplants on both sides. 2-4 small speech bubbles in margins with SHORT Japanese labels (3-8 chars each) derived from "${opts.h2Text}". Pastel sky-blue/cream background with one bright accent color, clean thin outlines, flat fill colors, bright and friendly. NO text inside the center card, NO large headlines anywhere.`;
  }
  // フォトリアル(Pollinations)版フォールバック
  return `Hyper-realistic editorial photograph illustrating the topic: "${opts.h2Text}" (from a Japanese blog article about "${opts.articleTitle}"). Cinematic lighting, vibrant colors, sharp focus, shallow depth of field. Concrete photographic scene with real people, objects, or environments related to the topic. Premium magazine quality, 8k resolution. Engaging and visually intriguing composition. NO TEXT, NO LETTERS, NO WATERMARKS. 16:9 horizontal landscape.`;
}

function isVertexProvider(): boolean {
  return (process.env.IMAGE_PROVIDER || 'pollinations').toLowerCase() === 'vertex';
}
