'use client';

import { useState } from 'react';
import type { WizardState } from '../Wizard';

export default function Step4Options({
  articleId,
  state,
  setState,
  onPrev,
  onNext,
}: {
  articleId: string;
  state: WizardState;
  setState: (fn: (s: WizardState) => WizardState) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const [toneSample, setToneSample] = useState(state.toneSample);
  const [volumeSpec, setVolumeSpec] = useState(state.volumeSpec || '指定なし');
  const [model, setModel] = useState<'low_cost' | 'balanced' | 'high_quality'>(state.modelChoice || 'balanced');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveAndNext = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/articles/${articleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toneSample, volumeSpec, modelChoice: model }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '保存に失敗しました');
        return;
      }
      setState((s) => ({ ...s, toneSample, volumeSpec, modelChoice: model }));
      onNext();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold">ステップ 4: 本文生成オプション</h2>
        <p className="text-sm text-slate-600 mt-1">
          本文生成の設定を行います。デフォルトのままでも問題ありません。
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="label">本文量指定</label>
          <div className="flex gap-2">
            {(['充実', '指定なし', '簡潔'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setVolumeSpec(v)}
                className={`px-4 py-2 rounded text-sm font-medium border ${
                  volumeSpec === v ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label">AIモデル選択</label>
          <div className="grid grid-cols-3 gap-2">
            <ModelOption
              active={model === 'low_cost'}
              onClick={() => setModel('low_cost')}
              title="標準"
              cost="Flash-Lite"
              desc="安定・最速（推奨）"
            />
            <ModelOption
              active={model === 'balanced'}
              onClick={() => setModel('balanced')}
              title="高性能"
              cost="Flash"
              desc="混雑時はLite自動切替"
            />
            <ModelOption
              active={model === 'high_quality'}
              onClick={() => setModel('high_quality')}
              title="最高性能"
              cost="Pro"
              desc="無料枠超は自動でLite"
            />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            ※ 無料tier運用のため、Flash / Pro が混雑・上限到達時は自動でFlash-Liteへフォールバックします。
          </p>
        </div>

        <div>
          <label className="label">文体サンプル（任意、200字以内）</label>
          <textarea
            className="input min-h-[100px]"
            placeholder="この文体を参考にしてください、というサンプル文を貼り付けてください。空欄の場合は「です・ます」調で生成されます。"
            value={toneSample}
            onChange={(e) => setToneSample(e.target.value.slice(0, 200))}
          />
          <div className="text-xs text-slate-500 text-right">{toneSample.length}/200</div>
        </div>
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm space-y-1">
        <div className="font-medium text-slate-700 mb-2">生成内容のサマリ</div>
        <div className="text-slate-600">タイトル: <span className="text-slate-900">{state.title}</span></div>
        <div className="text-slate-600">キーワード: <span className="text-slate-900">{state.keywords.join('、')}</span></div>
        <div className="text-slate-600">見出し数: <span className="text-slate-900">{state.headings.length}件</span></div>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">{error}</div>}

      <div className="flex justify-between gap-2 pt-4 border-t border-slate-200">
        <button onClick={onPrev} className="btn-secondary">← 戻る</button>
        <button onClick={saveAndNext} disabled={loading} className="btn-primary">
          次へ：本文生成 →
        </button>
      </div>
    </div>
  );
}

function ModelOption({
  active,
  onClick,
  title,
  cost,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  cost: string;
  desc: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`p-4 rounded-lg border text-left transition-colors ${
        active ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="font-bold text-slate-900 text-sm">{title}</span>
        <span className="text-xs text-brand-700 font-medium">{cost}</span>
      </div>
      <div className="text-xs text-slate-600">{desc}</div>
    </button>
  );
}
