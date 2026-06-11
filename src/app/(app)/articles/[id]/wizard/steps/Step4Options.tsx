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
  const [referenceInfo, setReferenceInfo] = useState(state.referenceInfo || '');
  const [useWebSearch, setUseWebSearch] = useState(state.useWebSearch ?? false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveAndNext = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/articles/${articleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toneSample, volumeSpec, modelChoice: model, referenceInfo, useWebSearch }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '保存に失敗しました');
        return;
      }
      setState((s) => ({ ...s, toneSample, volumeSpec, modelChoice: model, referenceInfo, useWebSearch }));
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
        <h2 className="section-title">ステップ 4: 本文生成オプション</h2>
        <p className="text-sm text-sub mt-2">
          本文生成の設定を行います。デフォルトのままでも問題ありません。
        </p>
      </div>

      <div className="space-y-5">
        <div>
          <label className="label">本文量指定</label>
          <div className="flex gap-2">
            {(['充実', '指定なし', '簡潔'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setVolumeSpec(v)}
                className={`px-4 py-2 rounded-[5px] text-sm font-bold border transition-colors ${
                  volumeSpec === v ? 'bg-teal text-white border-teal' : 'bg-white text-navy border-line hover:bg-bluepaper'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {/* Web検索 ON/OFF */}
        <div>
          <label className="label">Web検索で最新情報を反映</label>
          <label className="flex items-start gap-2.5 p-3 rounded-[5px] bg-bluepaper border border-teal/20 cursor-pointer">
            <input
              type="checkbox"
              checked={useWebSearch}
              onChange={(e) => setUseWebSearch(e.target.checked)}
              className="mt-0.5 accent-teal w-4 h-4"
            />
            <span className="text-sm">
              <span className="font-bold text-navy">本文生成時にWeb検索を行う</span>
              <span className="block text-xs text-sub mt-0.5">
                最新の事実・数値を検索して本文に反映し、古い情報やハルシネーションを抑制します（生成が少し長くなります）
              </span>
            </span>
          </label>
        </div>

        {/* 参考情報インプット */}
        <div>
          <label className="label">参考情報インプット（任意）</label>
          <textarea
            className="input min-h-[100px]"
            placeholder="記事に必ず含めたい独自の一次情報・社内データ・実体験・製品仕様などを入力してください。ここに入れた内容を優先して本文に反映します。"
            value={referenceInfo}
            onChange={(e) => setReferenceInfo(e.target.value.slice(0, 8000))}
          />
          <div className="text-xs text-sub text-right">{referenceInfo.length}/8000</div>
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
          <p className="mt-2 text-xs text-sub">
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
          <div className="text-xs text-sub text-right">{toneSample.length}/200</div>
        </div>
      </div>

      <div className="bg-paper border border-line rounded-[10px] p-4 text-sm space-y-1">
        <div className="font-bold text-navy mb-2">生成内容のサマリ</div>
        <div className="text-sub">タイトル: <span className="text-ink">{state.title}</span></div>
        <div className="text-sub">キーワード: <span className="text-ink">{state.keywords.join('、')}</span></div>
        <div className="text-sub">見出し数: <span className="text-ink">{state.headings.length}件</span></div>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">{error}</div>}

      <div className="flex justify-between gap-2 pt-4 border-t border-line">
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
