/**
 * 本文の「競合超え」ボリューム制御（自動増補）。
 *
 * - computeTargetChars: 競合平均文字数 ×1.3 と下限 3500 の大きい方（上限 50000）を目標に。
 * - clampTargetChars: UI の手動指定値を許容範囲 [3500, 50000] に丸める。
 * - expandBodyIfShort: 生成本文が目標未満なら増補する。
 *     - 小〜中目標(<=12000): 本文全体を渡して増補（従来方式）。
 *     - 大目標(>12000): h2 セクション単位で分割増補。1回の claude 出力上限(数千字)を
 *       超えないよう各セクションを個別に按分目標まで厚くして再結合し、5万字級まで安定して伸ばす。
 */

import { generate, BASE_SYSTEM, type LogicalModel } from './llm';
import { EXPAND_BODY_PROMPT, EXPAND_SECTION_PROMPT } from './prompts';

const FLOOR = 3500;
const CEIL = 50000;
/** これを超える目標はセクション単位増補に切替（whole-doc だと1回の出力上限を超え失敗するため）。 */
const SECTION_MODE_THRESHOLD = 12000;

/** 目標文字数 = max(競合平均 ×1.3, 3500)、上限 50000。 */
export function computeTargetChars(avgWordCount?: number): number {
  const fromCompetitor = avgWordCount && avgWordCount > 0 ? Math.round(avgWordCount * 1.3) : 0;
  return Math.min(Math.max(fromCompetitor, FLOOR), CEIL);
}

/** UI の手動指定目標文字数を許容範囲 [3500, 50000] に丸める（未指定/不正は下限）。 */
export function clampTargetChars(n?: number): number {
  if (!n || n <= 0 || Number.isNaN(n)) return FLOOR;
  return Math.min(Math.max(Math.round(n), FLOOR), CEIL);
}

/** HTML を除いたプレーン本文の文字数。 */
export function plainTextLength(html: string): number {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim().length;
}

/** commonTopics のうち本文プレーンテキストに出現しないもの（未網羅トピック）。 */
function findMissingTopics(html: string, commonTopics?: string[]): string[] {
  if (!commonTopics || commonTopics.length === 0) return [];
  const plain = html.replace(/<[^>]+>/g, '');
  return commonTopics.filter((t) => t && !plain.includes(t));
}

function stripFences(s: string): string {
  return s
    .trim()
    .replace(/^```(?:html)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

/** 本文を「リード(最初の h2 より前)」と「各 h2 セクション」に分割する。 */
function splitIntoSections(html: string): { lead: string; sections: string[] } {
  const parts = html.split(/(?=<h2[\s>])/i);
  let lead = '';
  const sections: string[] = [];
  for (const p of parts) {
    if (!p) continue;
    if (/^<h2[\s>]/i.test(p)) sections.push(p);
    else lead += p; // h2 前のリード文（通常は冒頭の <p> 群）
  }
  return { lead, sections };
}

export interface ExpandOptions {
  html: string;
  title: string;
  targetChars: number;
  commonTopics?: string[];
  logicalModel: LogicalModel;
  maxPasses?: number;
}

type ExpandResult = { html: string; passes: number; finalChars: number };

/**
 * 小〜中目標(<=12000): 本文全体を渡して最大 maxPasses 回増補する（従来方式・冪等的）。
 * 増補結果が現状より短ければ破棄して終了（安全側）。
 */
async function expandWholeDoc(opts: ExpandOptions): Promise<ExpandResult> {
  let html = opts.html;
  // 目標が大きいほど増補回数を増やす。目標到達 or 頭打ち(+50字以下)で早期終了。
  const maxPasses = opts.maxPasses ?? Math.min(8, Math.max(1, Math.ceil((opts.targetChars - 3000) / 8000)));
  let passes = 0;

  for (let i = 0; i < maxPasses; i++) {
    const chars = plainTextLength(html);
    const missing = findMissingTopics(html, opts.commonTopics);
    if (chars >= opts.targetChars * 0.9 && missing.length === 0) break;

    try {
      const res = await generate({
        logicalModel: opts.logicalModel,
        taskType: 'body',
        system: BASE_SYSTEM,
        user: EXPAND_BODY_PROMPT({
          title: opts.title,
          currentChars: chars,
          targetChars: opts.targetChars,
          bodyHtml: html,
          missingTopics: missing,
        }),
        maxTokens: 16000,
        temperature: 0.6,
      });
      const expanded = stripFences(res.content);
      if (plainTextLength(expanded) > chars + 50) {
        html = expanded;
        passes++;
      } else {
        break;
      }
    } catch (e) {
      console.warn('[bodyExpand] 増補パス失敗（現状の本文を維持）:', (e as Error).message);
      break;
    }
  }

  return { html, passes, finalChars: plainTextLength(html) };
}

/**
 * 大目標(>12000): h2 セクション単位で増補する。
 * 各セクションを「(目標 - リード分) ÷ セクション数」を按分目標として個別に厚くし、再結合する。
 * 1回の claude 呼び出しは1セクション分(数千字)だけ生成するので出力上限に当たらず、
 * セクション数を積み上げることで合計 5万字級まで安定して到達できる。
 */
async function expandBySections(opts: ExpandOptions): Promise<ExpandResult> {
  const { lead, sections } = splitIntoSections(opts.html);
  // h2 が無い等で分割できなければ従来方式にフォールバック
  if (sections.length === 0) return expandWholeDoc(opts);

  const perTarget = Math.max(
    1500,
    Math.ceil((opts.targetChars - plainTextLength(lead)) / sections.length),
  );
  let passes = 0;

  // セクションは独立に増補できるため並列実行する。同時起動数は llm 側の claude セマフォ
  // (CLAUDE_MAX_CONCURRENCY) で上限制御されるため安全。直列だと「セクション数 × 1分超」で
  // タイムアウトしやすいので、並列化で実時間を大幅短縮する（順序は Promise.all が保持）。
  const out = await Promise.all(
    sections.map(async (sec) => {
      const cur = plainTextLength(sec);
      if (cur >= perTarget * 0.85) return sec;
      try {
        const res = await generate({
          logicalModel: opts.logicalModel,
          taskType: 'body',
          system: BASE_SYSTEM,
          user: EXPAND_SECTION_PROMPT({ title: opts.title, sectionHtml: sec, targetChars: perTarget }),
          maxTokens: 16000,
          temperature: 0.6,
        });
        const ex = stripFences(res.content);
        // <h2> 始まりで現状より十分長い妥当な結果のみ採用（崩れ・短縮・空は破棄して原文維持）
        if (/^<h2[\s>]/i.test(ex) && plainTextLength(ex) > cur + 50) {
          passes++;
          return ex;
        }
        return sec;
      } catch (e) {
        console.warn('[bodyExpand] セクション増補失敗（現状維持）:', (e as Error).message);
        return sec;
      }
    }),
  );

  const html = lead + out.join('');
  return { html, passes, finalChars: plainTextLength(html) };
}

/**
 * 本文が目標文字数の 90% 未満 or 必須トピック未網羅なら増補する。
 * 目標が大きい(>12000)ときは h2 セクション単位で増補して 5万字級まで安定して伸ばす。
 */
export async function expandBodyIfShort(opts: ExpandOptions): Promise<ExpandResult> {
  if (opts.targetChars > SECTION_MODE_THRESHOLD) {
    return expandBySections(opts);
  }
  return expandWholeDoc(opts);
}
