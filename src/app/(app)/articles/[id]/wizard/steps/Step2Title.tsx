'use client';

import { useState } from 'react';
import { ProgressBar } from '@/components/ProgressBar';
import type { WizardState } from '../Wizard';

interface TitleSuggestion {
  title: string;
  type: string;
  char_count: number;
  appeal_point: string;
}

const TYPE_LABELS: Record<string, string> = {
  howto: 'ハウツー型',
  comparison: '比較型',
  problem: '問題提起型',
  conclusion_first: '結論先出し型',
};

export default function Step2Title({
  articleId,
  state,
  setState,
  onPrev,
  onNext,
  onCreditsChange,
}: {
  articleId: string;
  state: WizardState;
  setState: (fn: (s: WizardState) => WizardState) => void;
  onPrev: () => void;
  onNext: () => void;
  onCreditsChange: () => void;
}) {
  const [suggestions, setSuggestions] = useState<TitleSuggestion[]>([]);
  const [selectedTitle, setSelectedTitle] = useState(state.title);
  const [manualTitle, setManualTitle] = useState(state.title);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/generate/titles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'タイトル生成に失敗しました');
        return;
      }
      setSuggestions(data.titles);
      onCreditsChange();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const saveAndNext = async () => {
    const title = selectedTitle || manualTitle;
    if (!title.trim()) {
      setError('タイトルを選択または入力してください');
      return;
    }
    setLoading(true);
    const res = await fetch(`/api/articles/${articleId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    setLoading(false);
    if (res.ok) {
      setState((s) => ({ ...s, title }));
      onNext();
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold">ステップ 2: タイトル生成</h2>
        <p className="text-sm text-slate-600 mt-1">
          キーワード: <strong>{state.keywords.join('、')}</strong>
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <button onClick={generate} disabled={loading} className="btn-primary">
            {loading ? '生成中…' : suggestions.length > 0 ? 'タイトル再生成' : 'AIでタイトル生成'}
          </button>
          <span className="text-xs text-slate-500">4つの訴求軸でタイトル案を生成します</span>
        </div>
        {loading && <ProgressBar active={true} estimateSec={10} label="タイトル生成中" />}
      </div>

      {suggestions.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-medium text-slate-700">生成されたタイトル候補</div>
          <div className="space-y-2">
            {suggestions.map((s, i) => {
              const isSelected = selectedTitle === s.title;
              return (
                <button
                  key={i}
                  onClick={() => {
                    setSelectedTitle(s.title);
                    setManualTitle(s.title);
                  }}
                  className={`w-full text-left p-4 rounded-lg border transition-colors ${
                    isSelected ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className={`mt-0.5 w-5 h-5 rounded-full border-2 ${isSelected ? 'bg-brand-600 border-brand-600' : 'border-slate-300'} flex items-center justify-center text-white text-xs flex-shrink-0`}>
                      {isSelected ? '✓' : ''}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="badge bg-slate-100 text-slate-600">{TYPE_LABELS[s.type] || s.type}</span>
                        <span className="text-xs text-slate-500">{s.char_count}文字</span>
                      </div>
                      <div className="font-medium text-slate-900">{s.title}</div>
                      <div className="text-xs text-slate-500 mt-1">{s.appeal_point}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <label className="label">タイトル（編集可能）</label>
        <input
          className="input"
          value={manualTitle}
          onChange={(e) => {
            setManualTitle(e.target.value);
            setSelectedTitle(e.target.value);
          }}
          placeholder="ターゲットキーワードを必ず含むタイトルを入力"
        />
        <div className="text-xs text-slate-500 text-right">{manualTitle.length}文字（推奨: 28〜40文字）</div>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">{error}</div>}

      <div className="flex justify-between gap-2 pt-4 border-t border-slate-200">
        <button onClick={onPrev} className="btn-secondary">← 戻る</button>
        <button onClick={saveAndNext} disabled={!manualTitle.trim() || loading} className="btn-primary">
          次へ：見出し構成 →
        </button>
      </div>
    </div>
  );
}
