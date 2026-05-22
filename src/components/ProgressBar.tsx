'use client';

import { useEffect, useState } from 'react';

/**
 * 経過秒数を返すフック。`active` が true の間だけ tick する。
 */
export function useElapsed(active: boolean): number {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    if (!active) {
      setSec(0);
      return;
    }
    setSec(0);
    const start = Date.now();
    const id = setInterval(() => {
      setSec((Date.now() - start) / 1000);
    }, 200);
    return () => clearInterval(id);
  }, [active]);
  return sec;
}

/**
 * 推定時間ベースのプログレスバー。
 * elapsed が estimateSec を超えると progress は緩やかに 100% に漸近(95%でストップ)。
 * 完了後は onComplete を外から呼んで 100% にする想定（active=false にする）。
 */
export function ProgressBar({
  active,
  estimateSec,
  label,
  step,
  total,
}: {
  active: boolean;
  estimateSec: number;
  label?: string;
  step?: number;
  total?: number;
}) {
  const elapsed = useElapsed(active);
  if (!active) return null;

  // ロジスティック的に 0→95% へ。推定時間で約 80%、その後 95% に漸近
  const ratio = elapsed / estimateSec;
  const pct = Math.min(95, ratio < 1 ? ratio * 80 : 80 + (1 - Math.exp(-(ratio - 1))) * 15);

  const fmtSec = (s: number) => {
    if (s < 60) return `${s.toFixed(1)}秒`;
    return `${Math.floor(s / 60)}分${(s % 60).toFixed(0)}秒`;
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <div className="text-slate-700 font-medium flex items-center gap-2">
          <Spinner />
          {label || '生成中…'}
          {typeof step === 'number' && typeof total === 'number' && (
            <span className="text-slate-500">({step}/{total})</span>
          )}
        </div>
        <div className="text-slate-500 tabular-nums">
          {fmtSec(elapsed)} / 目安 {fmtSec(estimateSec)}
        </div>
      </div>
      <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-brand-500 transition-all duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      {elapsed > estimateSec * 1.5 && (
        <div className="text-xs text-amber-700">
          目安時間を超過しています。混雑時は通常より時間がかかります(最大2分)。もうしばらくお待ちください。
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-3 w-3 text-brand-600" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
