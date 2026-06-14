/**
 * 本文の「競合超え」ボリューム制御（Part 2c 自動増補）。
 *
 * - computeTargetChars: 競合平均文字数 ×1.3 と 3500 の大きい方を目標文字数に。
 * - expandBodyIfShort: 生成本文が目標未満 or 必須トピック未網羅なら、既存構造を保ったまま
 *   EXPAND_BODY_PROMPT で最大 maxPasses 回増補する。十分なら何もしない（冪等的）。
 */

import { generate, BASE_SYSTEM, type LogicalModel } from './llm';
import { EXPAND_BODY_PROMPT } from './prompts';

/** 目標文字数 = max(競合平均 ×1.3, 3500)。競合データが無くても最低 3500。 */
export function computeTargetChars(avgWordCount?: number): number {
  const fromCompetitor = avgWordCount && avgWordCount > 0 ? Math.round(avgWordCount * 1.3) : 0;
  return Math.max(fromCompetitor, 3500);
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

/**
 * 本文が目標文字数の 90% 未満、または必須トピック未網羅なら増補する（最大 maxPasses 回）。
 * 増補結果が現状より短ければ破棄して終了（安全側）。
 */
export async function expandBodyIfShort(opts: {
  html: string;
  title: string;
  targetChars: number;
  commonTopics?: string[];
  logicalModel: LogicalModel;
  maxPasses?: number;
}): Promise<{ html: string; passes: number; finalChars: number }> {
  let html = opts.html;
  const maxPasses = opts.maxPasses ?? 2;
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
      // 増補が現状より長くなった時だけ採用（短縮・空は破棄）
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
