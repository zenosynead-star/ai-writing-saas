import { GoogleGenerativeAI, type GenerationConfig } from '@google/generative-ai';
import { spawn } from 'child_process';

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

// E2Eテスト結果（2026-05-20）に基づくモデル選定:
// - gemini-2.5-pro: 無料tier では使用不可（quota=0）→ 安定モデルにフォールバック
// - gemini-2.5-flash: 容量逼迫で 503 頻発 → 同上
// - gemini-2.5-flash-lite: 安定動作（無料tier 1500req/日）→ デフォルト採用
const MODEL_MAP: Record<LogicalModel, string> = {
  high_quality: process.env.GEMINI_MODEL_HIGH || 'gemini-2.5-flash-lite',
  balanced: process.env.GEMINI_MODEL_BALANCED || 'gemini-2.5-flash-lite',
  low_cost: process.env.GEMINI_MODEL_LOW || 'gemini-2.5-flash-lite',
};

// 503/429 時のフォールバック先候補
// 注意: gemini-1.5-* は 2026年初頭にAPI v1betaで廃止 (404)
//        gemini-2.0-flash は無料tier quota=0
//        現状で安定動作するのは 2.5/2.0 の flash-lite のみ
const FALLBACK_MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash-lite',
];

// TEXT_PROVIDER=claude のとき使う、ローカル Claude Code CLI のモデルエイリアス。
// 自社利用: Gemini API の代わりに、サブスク認証の `claude -p` を VPS 上でシェル実行する。
const CLAUDE_MODEL_MAP: Record<LogicalModel, string> = {
  high_quality: process.env.CLAUDE_MODEL_HIGH || 'opus',
  balanced: process.env.CLAUDE_MODEL_BALANCED || 'sonnet',
  low_cost: process.env.CLAUDE_MODEL_LOW || 'sonnet',
};

/**
 * 複数のAPIキーをサポート。
 * GOOGLE_API_KEY, GOOGLE_API_KEY_2, GOOGLE_API_KEY_3 ... をすべて拾う。
 * ローテーション + 429/503 自動切替で実質 quota を増やす。
 */
function getApiKeys(): string[] {
  const keys: string[] = [];
  // primary
  if (process.env.GOOGLE_API_KEY) keys.push(process.env.GOOGLE_API_KEY);
  // additional: GOOGLE_API_KEY_2, _3, ... 検索
  for (let i = 2; i <= 9; i++) {
    const k = process.env[`GOOGLE_API_KEY_${i}`];
    if (k) keys.push(k);
  }
  return keys;
}

const clientCache = new Map<string, GoogleGenerativeAI>();
function getClient(apiKey: string): GoogleGenerativeAI {
  let c = clientCache.get(apiKey);
  if (!c) {
    c = new GoogleGenerativeAI(apiKey);
    clientCache.set(apiKey, c);
  }
  return c;
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

/**
 * Try to repair an incomplete JSON string (e.g. truncated due to maxTokens).
 * Walks the bracket stack and closes any remaining open braces/brackets.
 * Also removes a dangling partial object/array element at the end.
 */
function repairTruncatedJson(text: string): string {
  // Walk char-by-char tracking string state and bracket depth
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  let lastValidEnd = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = false; }
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}') {
      if (stack[stack.length - 1] === '{') stack.pop();
      if (stack.length === 1 && (stack[0] === '[' || stack[0] === '{')) lastValidEnd = i;
    }
    else if (ch === ']') {
      if (stack[stack.length - 1] === '[') stack.pop();
      if (stack.length === 0) lastValidEnd = i;
    }
  }

  // If parseable as-is, return
  if (stack.length === 0) return text;

  // Truncate to last complete element + close brackets
  let truncated = lastValidEnd >= 0 ? text.slice(0, lastValidEnd + 1) : text;
  // Remove trailing comma if any
  truncated = truncated.replace(/,\s*$/, '');

  // Now close stack from the un-truncated original (recompute depth in truncated)
  const reStack: string[] = [];
  let inStr2 = false;
  let esc2 = false;
  for (let i = 0; i < truncated.length; i++) {
    const ch = truncated[i];
    if (esc2) { esc2 = false; continue; }
    if (inStr2) {
      if (ch === '\\') { esc2 = true; continue; }
      if (ch === '"') inStr2 = false;
      continue;
    }
    if (ch === '"') { inStr2 = true; continue; }
    if (ch === '{' || ch === '[') reStack.push(ch);
    else if (ch === '}' && reStack[reStack.length - 1] === '{') reStack.pop();
    else if (ch === ']' && reStack[reStack.length - 1] === '[') reStack.pop();
  }

  // Close remaining brackets in reverse order
  while (reStack.length) {
    const open = reStack.pop();
    truncated += open === '{' ? '}' : ']';
  }
  return truncated;
}

export function extractJson<T = unknown>(text: string): T {
  let cleaned = text.trim();

  // Strip code fences if present
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();

  // Find first { ... } or [ ... ]
  const firstBrace = cleaned.search(/[\[{]/);
  if (firstBrace > 0) cleaned = cleaned.slice(firstBrace);

  // Trim trailing junk after last closing brace (best effort)
  const lastBrace = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
  if (lastBrace > 0 && lastBrace < cleaned.length - 1) {
    cleaned = cleaned.slice(0, lastBrace + 1);
  }

  // Attempt 1: direct parse
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Attempt 2: repair truncated JSON and try again
    try {
      const repaired = repairTruncatedJson(cleaned);
      return JSON.parse(repaired) as T;
    } catch (err2) {
      throw new Error(`AI出力のJSON解析に失敗しました。もう一度お試しください。(${(err2 as Error).message.slice(0, 80)})`);
    }
  }
}

class UpstreamError extends Error {
  constructor(public statusCode: number, public retryable: boolean, message: string) {
    super(message);
  }
}

function classifyError(err: unknown): UpstreamError {
  const msg = (err as Error).message || String(err);
  // 404 / モデル廃止・未発見 - リトライ不要、別モデルへ即フォールバック
  if (/404|not found|is not supported for generateContent/i.test(msg)) {
    return new UpstreamError(404, false, msg);
  }
  // 429 / Quota exceeded
  if (/429|quota|exceeded your current quota/i.test(msg)) {
    return new UpstreamError(429, false, msg);
  }
  // 503 / overloaded / Service Unavailable
  if (/503|UNAVAILABLE|overloaded|currently experiencing high demand/i.test(msg)) {
    return new UpstreamError(503, true, msg);
  }
  // 500 / Internal
  if (/500|INTERNAL/i.test(msg)) {
    return new UpstreamError(500, true, msg);
  }
  // network/timeout
  if (/timeout|ECONNRESET|ETIMEDOUT/i.test(msg)) {
    return new UpstreamError(504, true, msg);
  }
  return new UpstreamError(0, false, msg);
}

async function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function callModelOnce(
  modelName: string,
  apiKey: string,
  opts: GenerateOptions,
): Promise<GenerateResult> {
  const c = getClient(apiKey);
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

/**
 * Claude Code CLI (headless `claude -p`) で生成する。
 * VPS に Claude Code をインストールし、サブスクの長期トークン
 * (CLAUDE_CODE_OAUTH_TOKEN) で認証して非対話実行する。
 * 自社利用向け: Gemini API の代わりに固定費のサブスク枠で記事生成する。
 */
function claudeCliGenerate(opts: GenerateOptions): Promise<GenerateResult> {
  const model = CLAUDE_MODEL_MAP[opts.logicalModel ?? 'balanced'];
  const bin = process.env.CLAUDE_CLI_PATH || 'claude';
  const fullPrompt =
    (opts.system ? `${opts.system}\n\n` : '') +
    opts.user +
    (opts.jsonMode
      ? '\n\n（重要: 出力は純粋なJSONのみ。前後に説明文・マークダウン・コードフェンス```を一切付けないこと。）'
      : '');

  return new Promise<GenerateResult>((resolve, reject) => {
    const args = ['-p', '--output-format', 'json', '--model', model];
    let child;
    try {
      child = spawn(bin, args, {
        env: process.env,
        timeout: 300_000,
        cwd: process.env.CLAUDE_CLI_CWD || undefined,
      });
    } catch (e) {
      return reject(new UpstreamError(500, false, `claude CLI 起動失敗: ${(e as Error).message}`));
    }

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (e) =>
      reject(new UpstreamError(500, false, `claude CLI 実行失敗: ${e.message}（VPSにClaude Codeが入っているか確認）`)),
    );
    child.on('close', (code) => {
      if (code !== 0) {
        const msg = (stderr || stdout).slice(0, 300) || `claude exited code ${code}`;
        const retryable = /limit|overload|429|503|529|timeout/i.test(msg);
        return reject(new UpstreamError(retryable ? 503 : 502, retryable, `claude CLI エラー: ${msg}`));
      }
      try {
        const env = JSON.parse(stdout) as {
          result?: string;
          is_error?: boolean;
          usage?: {
            input_tokens?: number;
            output_tokens?: number;
            cache_read_input_tokens?: number;
            cache_creation_input_tokens?: number;
          };
        };
        const text = typeof env.result === 'string' ? env.result : '';
        if (env.is_error || !text) {
          return reject(new UpstreamError(502, false, `claude 応答異常: ${stdout.slice(0, 200)}`));
        }
        resolve({
          content: text,
          actualModel: `claude-${model}`,
          inputTokens: env.usage?.input_tokens ?? 0,
          outputTokens: env.usage?.output_tokens ?? 0,
          cacheReadTokens: env.usage?.cache_read_input_tokens ?? 0,
          cacheCreationTokens: env.usage?.cache_creation_input_tokens ?? 0,
        });
      } catch (e) {
        reject(new UpstreamError(502, false, `claude 応答のJSON解析失敗: ${(e as Error).message}`));
      }
    });

    child.stdin.on('error', () => {/* EPIPE 無視 */});
    child.stdin.write(fullPrompt);
    child.stdin.end();
  });
}

// プロセス起動以降のキー使用カウンタ。ローテーション開始位置として使う。
let keyRotationCounter = 0;

/**
 * Robust generate():
 *  - 複数の API キーをラウンドロビン
 *  - 各キーで model フォールバックチェーンを試す
 *  - 429 / 404 はリトライ不要で次のキー or モデルへ
 *  - 503 / 500 / timeout は exp backoff でリトライ
 */
export async function generate(opts: GenerateOptions): Promise<GenerateResult> {
  // TEXT_PROVIDER=claude のときは、Gemini API ではなくローカル Claude Code CLI を使う。
  // 503系(混雑/一時上限)は指数バックオフで最大3回リトライ。
  if ((process.env.TEXT_PROVIDER || 'gemini').toLowerCase() === 'claude') {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await claudeCliGenerate(opts);
      } catch (e) {
        lastErr = e;
        const up = e instanceof UpstreamError ? e : null;
        if (!up || !up.retryable) throw e;
        await sleep(1500 * Math.pow(2, attempt)); // 1.5s, 3s, 6s
      }
    }
    throw lastErr ?? new UpstreamError(500, false, 'claude 生成に失敗しました');
  }

  const requested = MODEL_MAP[opts.logicalModel ?? 'balanced'];
  const tryOrder = [requested, ...FALLBACK_MODELS.filter((m) => m !== requested)];

  const allKeys = getApiKeys();
  if (allKeys.length === 0) {
    throw new UpstreamError(500, false, 'GOOGLE_API_KEY が設定されていません');
  }

  // ローテーション: 開始位置をずらして負荷分散
  const startIndex = keyRotationCounter % allKeys.length;
  keyRotationCounter++;
  const keys = [...allKeys.slice(startIndex), ...allKeys.slice(0, startIndex)];

  let lastError: UpstreamError | null = null;
  for (const apiKey of keys) {
    for (const modelName of tryOrder) {
      // 各キー×モデルで最大3回 exp backoff
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await callModelOnce(modelName, apiKey, opts);
        } catch (err) {
          const upstream = classifyError(err);
          lastError = upstream;
          if (upstream.statusCode === 429) {
            // このキーのquota枯渇 → 次のキー/モデルへ即時切替
            break;
          }
          if (upstream.statusCode === 404) {
            // モデル廃止 → 次のモデルへ
            break;
          }
          if (!upstream.retryable) {
            throw upstream;
          }
          // 503/500/timeout の場合、同じキー+モデルで exp backoff
          const wait = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
          await sleep(wait);
        }
      }
    }
  }
  throw lastError ?? new UpstreamError(500, false, 'unknown LLM error');
}

/**
 * Map upstream LLM error to user-facing HTTP response shape.
 */
export function llmErrorToResponse(err: unknown): { status: number; body: { error: string } } {
  if (err instanceof UpstreamError) {
    if (err.statusCode === 429) {
      return {
        status: 429,
        body: {
          error:
            'Gemini API のレート制限に達しました。1分後に再試行するか、無料枠の1日上限（1,500リクエスト/日）を超過している場合は、日本時間17時のリセットまでお待ちください。',
        },
      };
    }
    if (err.statusCode === 503 || err.statusCode === 504) {
      return { status: 503, body: { error: 'AI APIが現在混雑しています。10〜30秒待ってから再試行してください。' } };
    }
    if (err.statusCode === 500) {
      return { status: 502, body: { error: 'AI APIで内部エラーが発生しました。再試行してください。' } };
    }
  }
  const msg = (err as Error).message || 'Unknown error';
  // JSON parse error: pass through (already user-facing)
  if (/AI出力のJSON解析/.test(msg)) {
    return { status: 502, body: { error: msg } };
  }
  return { status: 500, body: { error: 'サーバー内部エラーが発生しました。' } };
}

/** 全社共通のシステムプロンプト基底 */
export const BASE_SYSTEM = `あなたはSEOおよびLLMO（生成AI検索最適化）の専門家として動作するAIアシスタントです。
日本のWebマーケティング業界のベストプラクティス、Googleの品質評価ガイドライン（Search Quality Evaluator Guidelines）、E-E-A-T、Needs Met基準を深く理解しています。
ユーザーの指示に対し、SEOプロフェッショナルのノウハウを反映した高品質な出力を生成してください。
出力フォーマットの指定があれば必ず厳守し、JSONを求められた場合は前後に説明文を付けず純粋なJSONのみを返してください。`;
