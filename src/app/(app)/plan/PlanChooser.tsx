'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Plan {
  id: string;
  name: string;
  priceJpy: number;
  monthlyCredits: number;
  maxArticles: number;
  maxSites: number;
  maxRankKeywords: number;
  maxImages: number;
  extraUnitJpy: number;
}

export default function PlanChooser({ plans, currentPlanName }: { plans: Plan[]; currentPlanName: string }) {
  const router = useRouter();
  const [changing, setChanging] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const changePlan = async (planName: string) => {
    if (!confirm(`プランを「${planName}」に変更しますか？\n（MVP: 決済処理はモックで即時反映されます）`)) return;
    setChanging(planName);
    setError(null);
    try {
      const res = await fetch('/api/plan/change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'プラン変更に失敗しました');
        return;
      }
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setChanging(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium text-slate-700">プラン</div>
      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">{error}</div>}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        {plans.map((p) => {
          const isCurrent = p.name === currentPlanName;
          return (
            <div key={p.id} className={`card p-4 ${isCurrent ? 'ring-2 ring-brand-500' : ''}`}>
              <div className="flex items-baseline justify-between">
                <div className="font-bold text-slate-900">{p.name}</div>
                {isCurrent && <span className="badge bg-brand-100 text-brand-700 text-[10px]">現在</span>}
              </div>
              <div className="mt-2">
                <span className="text-2xl font-bold text-slate-900">¥{p.priceJpy.toLocaleString()}</span>
                <span className="text-xs text-slate-500"> /月</span>
              </div>
              <ul className="mt-3 space-y-1 text-xs text-slate-600">
                <li>月 {p.monthlyCredits.toLocaleString()} CR</li>
                <li>記事 {p.maxArticles}本/月</li>
                <li>サイト {p.maxSites.toLocaleString()}</li>
                <li>順位計測 {p.maxRankKeywords.toLocaleString()} KW</li>
                <li>追加 CR ¥{p.extraUnitJpy}/CR</li>
              </ul>
              <button
                onClick={() => changePlan(p.name)}
                disabled={isCurrent || changing !== null}
                className={`mt-4 w-full text-sm py-2 rounded font-medium ${
                  isCurrent ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50'
                }`}
              >
                {isCurrent ? '利用中' : changing === p.name ? '変更中…' : 'このプランに変更'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
