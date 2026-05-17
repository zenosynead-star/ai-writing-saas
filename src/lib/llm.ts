import { GoogleGenerativeAI, type GenerationConfig } from '@google/generative-ai';

// 要件定義書 11.2 LLMゲートウェイ設計
// 各LLM APIを抽象化し、モデルエイリアスを管理するレイヤー
// 現在はGoogle Gemini API（無料tier）を実装。将来的にOpenAI/Anthropic等を追加可能。

export type LogicalModel = 'high_quality' | 'balanced' | 'low_cost';
export type TaskType =
  | 'keyword'
  | 'title'
  | 'heading'
  | 'body'
  | 'advice'
  | 'rewrite'
  | 'llmo_parse'
  | 'image_prompt';

const MODEL_MAP: Record<LogicalModel, string> = {
  high_quality: process.env.GEMINI_MODEL_HIGH || 'gemini-2.5-pro',
  balanced: process.env.GEMINI_MODEL_BALANCED || 'gemini-2.5-flash',
  low_cost: process.env.GEMINI_MODEL_LOW || 'gemini-2.5-flash-lite',
};

let client: GoogleGenerativeAI | null = null;
function getClient(): GoogleGenerativeAI {
  if (!client) {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error('GOOGLE_API_KEY is not configured. Set it in .env (https://aistudio.google.com/ で発行)');
    }
    client = new GoogleGenerativeAI(apiKey);
  }
  return client;
}

export interface GenerateOptions {
  logicalModel?: LogicalModel;
  taskType: TaskType;
  system?: string;
  user: string;
  maxTokens?: number;
  jsonMode?: boolean;
  temperature?: number;
  /** （Anthropic互換のため残す。Geminiには独自キャッシュなし） */
  cacheSystem?: boolean;
}

export interface GenerateResult {
  content: string;
  actualModel: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

// Prompt-injection sanitization (要件定義書 11.2.1)
export function sanitizeUserInput(input: string): string {
  return input
    .replace(/\[INST\]|\[\/INST\]/gi, '')
    .replace(/<\|system\|>|<\|assistant\|>|<\|user\|>/gi, '')
    .replace(/ignore (the )?(previous|above) instructions?/gi, '[filtered]')
    .replace(/system prompt:/gi, '[filtered]:')
    .slice(0, 20000);
}

export function extractJson<T = unknown>(text: string): T {
  // Strip code fences if present
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();

  // Find first { ... } or [ ... ]
  const firstBrace = cleaned.search(/[\[{]/);
  if (firstBrace > 0) cleaned = cleaned.slice(firstBrace);

  // Trim trailing junk after last closing brace
  const lastBrace = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
  if (lastBrace > 0 && lastBrace < cleaned.length - 1) {
    cleaned = cleaned.slice(0, lastBrace + 1);
  }

  try {
    return JSON.parse(cleaned) as T;
  } catch (err) {
    throw new Error(`Failed to parse JSON from LLM output: ${(err as Error).message}\nRaw: ${text.slice(0, 500)}`);
  }
}

export async function generate(opts: GenerateOptions): Promise<GenerateResult> {
  const c = getClient();
  const modelName = MODEL_MAP[opts.logicalModel ?? 'balanced'];

  const generationConfig: GenerationConfig = {
    maxOutputTokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature ?? 0.7,
  };
  if (opts.jsonMode) {
    generationConfig.responseMimeType = 'application/json';
  }

  const model = c.getGenerativeModel({
    model: modelName,
    systemInstruction: opts.system,
    generationConfig,
  });

  const resp = await model.generateContent(opts.user);
  const text = resp.response.text();
  const usage = resp.response.usageMetadata;

  return {
    content: text,
    actualModel: modelName,
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: usage?.candidatesTokenCount ?? 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };
}

/** 全社共通のシステムプロンプト基底 */
export const BASE_SYSTEM = `あなたはSEOおよびLLMO（生成AI検索最適化）の専門家として動作するAIアシスタントです。
日本のWebマーケティング業界のベストプラクティス、Googleの品質評価ガイドライン（Search Quality Evaluator Guidelines）、E-E-A-T、Needs Met基準を深く理解しています。
ユーザーの指示に対し、SEOプロフェッショナルのノウハウを反映した高品質な出力を生成してください。
出力フォーマットの指定があれば必ず厳守し、JSONを求められた場合は前後に説明文を付けず純粋なJSONのみを返してください。`;
