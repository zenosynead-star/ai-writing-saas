'use client';

import { useState } from 'react';
import type { WizardState } from '../Wizard';

type Mode = 'direct' | 'theme';

interface KeywordSuggestion {
  keyword: string;
  search_intent: string;
  estimated_competition: string;
  estimated_volume?: number;
  rationale: string;
}

export default function Step1Keywords({
  articleId,
  state,
  setState,
  onNext,
  onCreditsChange,
}: {
  articleId: string;
  state: WizardState;
  setState: (fn: (s: WizardState) => WizardState) => void;
  onNext: () => void;
  onCreditsChange: () => void;
}) {
  const [mode, setMode] = useState<Mode>(state.keywords.length > 0 ? 'direct' : 'theme');
  const [theme, setTheme] = useState('');
  const [directInput, setDirectInput] = useState(state.keywords.join('\n'));
  const [suggestions, setSuggestions] = useState<KeywordSuggestion[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set(state.keywords));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const explore = async () => {
    if (!theme.trim()) {
      setError('テーマを入力してください');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/generate/keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleId, theme }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'キーワード探索に失敗しました');
        return;
      }
      setSuggestions(data.keywords);
      onCreditsChange();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (kw: string) => {
    const next = new Set(selected);
    if (next.has(kw)) next.delete(kw);
    else if (next.size < 5) next.add(kw);
    setSelected(next);
  };

  const finalKeywords = mode === 'direct'
    ? directInput.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 5)
    : Array.from(selected);

  const saveAndNext = async () => {
    if (finalKeywords.length === 0) {
      setError('キーワードを少なくとも1つ選択してください');
      return;
    }
    setLoading(true);
    const res = await fetch(`/api/articles/${articleId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords: finalKeywords }),
    });
    setLoading(false);
    if (res.ok) {
      setState((s) => ({ ...s, keywords: finalKeywords }));
      onNext();
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold">ステップ 1: ターゲットキーワード</h2>
        <p className="text-sm text-slate-600 mt-1">
          記事の起点となるキーワードを最大5つ決定します。直接入力か、テーマからAI提案を受けるか選択してください。
        </p>
      </div>

      <div className="flex gap-2 border-b border-slate-200">
        <ModeTab active={mode === 'direct'} onClick={() => setMode('direct')}>直接入力</ModeTab>
        <ModeTab active={mode === 'theme'} onClick={() => setMode('theme')}>テーマから探索（消費1CR）</ModeTab>
      </div>

      {mode === 'direct' && (
        <div className="space-y-2">
          <label className="label">キーワード（1行1つ、最大5つ）</label>
          <textarea
            className="input min-h-[120px]"
            placeholder="例:&#10;リモートワーク 集中力&#10;在宅勤務 効率化"
            value={directInput}
            onChange={(e) => setDirectInput(e.target.value)}
          />
          <div className="text-xs text-slate-500">{finalKeywords.length}/5キーワード</div>
        </div>
      )}

      {mode === 'theme' && (
        <div className="space-y-4">
          <div>
            <label className="label">テーマ</label>
            <div className="flex gap-2">
              <input
                className="input"
                placeholder="例: ダイエット、リモートワーク"
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
              />
              <button className="btn-primary whitespace-nowrap" onClick={explore} disabled={loading}>
                {loading ? '探索中…' : 'AIで探索'}
              </button>
            </div>
            <div className="text-xs text-slate-500 mt-1">SEO観点で20件提案します。クリックして最大5件を選択。</div>
          </div>

          {suggestions.length > 0 && (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="max-h-[400px] overflow-y-auto divide-y divide-slate-100">
                {suggestions.map((s) => {
                  const isSelected = selected.has(s.keyword);
                  return (
                    <button
                      key={s.keyword}
                      onClick={() => toggleSelect(s.keyword)}
                      className={`w-full text-left p-3 hover:bg-slate-50 transition-colors ${isSelected ? 'bg-brand-50' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`w-4 h-4 rounded border ${isSelected ? 'bg-brand-600 border-brand-600' : 'border-slate-300'} flex items-center justify-center text-white text-xs`}>
                              {isSelected ? '✓' : ''}
                            </span>
                            <span className="font-medium text-slate-900">{s.keyword}</span>
                          </div>
                          <div className="mt-1 ml-6 text-xs text-slate-500">{s.rationale}</div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 text-xs">
                          <span className="badge bg-slate-100 text-slate-600">{s.search_intent}</span>
                          <span className="badge bg-slate-100 text-slate-600">{s.estimated_competition}</span>
                          {s.estimated_volume && <span className="text-slate-500">{s.estimated_volume.toLocaleString()}</span>}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {selected.size > 0 && (
            <div className="text-sm text-slate-700 bg-brand-50 border border-brand-200 rounded p-3">
              選択中（{selected.size}/5）: {Array.from(selected).join('、')}
            </div>
          )}
        </div>
      )}

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">{error}</div>}

      <div className="flex justify-end gap-2 pt-4 border-t border-slate-200">
        <button onClick={saveAndNext} disabled={finalKeywords.length === 0 || loading} className="btn-primary">
          次へ：タイトル生成 →
        </button>
      </div>
    </div>
  );
}

function ModeTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-600 hover:text-slate-900'
      }`}
    >
      {children}
    </button>
  );
}
