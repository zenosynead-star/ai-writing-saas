import Anthropic from '@anthropic-ai/sdk';

// 要件定義書 11.2 LLMゲートウェイ設計
// 各LLM APIを抽象化し、モデルエイリアスを管理するレイヤー

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
  high_quality: process.env.ANTHROPIC_MODEL_HIGH || 'claude-opus-4-7',
  balanced: process.env.ANTHROPIC_MODEL_BALANCED || 'claude-sonnet-4-6',
  low_cost: process.env.ANTHROPIC_MODEL_LOW || 'claude-haiku-4-5-20251001',
};

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not configured. Set it in .env');
    }
    client = new Anthropic({ apiKey });
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
  /** prompt-cache the system prompt across requests */
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

  try {
    return JSON.parse(cleaned) as T;
  } catch (err) {
    throw new Error(`Failed to parse JSON from LLM output: ${(err as Error).message}\nRaw: ${text.slice(0, 500)}`);
  }
}

export async function generate(opts: GenerateOptions): Promise<GenerateResult> {
  const c = getClient();
  const model = MODEL_MAP[opts.logicalModel ?? 'balanced'];

  const system = opts.system
    ? opts.cacheSystem
      ? [{ type: 'text' as const, text: opts.system, cache_control: { type: 'ephemeral' as const } }]
      : opts.system
    : undefined;

  const resp = await c.messages.create({
    model,
    max_tokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature ?? 0.7,
    system,
    messages: [{ role: 'user', content: opts.user }],
  });

  const text = resp.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('\n');

  return {
    content: text,
    actualModel: resp.model,
    inputTokens: resp.usage.input_tokens,
    outputTokens: resp.usage.output_tokens,
    cacheReadTokens: (resp.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0,
    cacheCreationTokens: (resp.usage as { cache_creation_input_tokens?: number }).cache_creation_input_tokens ?? 0,
  };
}

/** 全社共通のシステムプロンプト基底 */
export const BASE_SYSTEM = `あなたはSEOおよびLLMO（生成AI検索最適化）の専門家として動作するAIアシスタントです。
日本のWebマーケティング業界のベストプラクティス、Googleの品質評価ガイドライン（Search Quality Evaluator Guidelines）、E-E-A-T、Needs Met基準を深く理解しています。
ユーザーの指示に対し、SEOプロフェッショナルのノウハウを反映した高品質な出力を生成してください。
出力フォーマットの指定があれば必ず厳守し、JSONを求められた場合は前後に説明文を付けず純粋なJSONのみを返してください。`;
