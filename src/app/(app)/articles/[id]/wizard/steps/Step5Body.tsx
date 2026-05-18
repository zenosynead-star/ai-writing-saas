'use client';

import { useState } from 'react';
import type { WizardState } from '../Wizard';

export default function Step5Body({
  articleId,
  state,
  setState,
  onPrev,
  onComplete,
  onCreditsChange,
}: {
  articleId: string;
  state: WizardState;
  setState: (fn: (s: WizardState) => WizardState) => void;
  onPrev: () => void;
  onComplete: () => void;
  onCreditsChange: () => void;
}) {
  const [bodyHtml, setBodyHtml] = useState(state.bodyHtml);
  const [meta, setMeta] = useState(state.metaDescription);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setError(null);
    setLoading(true);
    try {
      const model = (typeof window !== 'undefined' && sessionStorage.getItem(`article-${articleId}-model`)) || 'balanced';
      const res = await fetch('/api/generate/body', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleId, model }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '本文生成に失敗しました');
        return;
      }
      setBodyHtml(data.bodyHtml);
      setMeta(data.metaDescription || '');
      setState((s) => ({ ...s, bodyHtml: data.bodyHtml, metaDescription: data.metaDescription || '' }));
      onCreditsChange();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const completeArticle = async () => {
    setLoading(true);
    await fetch(`/api/articles/${articleId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed', bodyHtml, metaDescription: meta }),
    });
    setLoading(false);
    onComplete();
  };

  const wordCount = bodyHtml.replace(/<[^>]+>/g, '').length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold">ステップ 5: 本文生成</h2>
        <p className="text-sm text-slate-600 mt-1">
          {state.headings.length}個の見出しに沿って、3000字以上のSEO最適化本文を生成します。
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={generate} disabled={loading} className="btn-primary">
          {loading ? '生成中…（30〜90秒）' : bodyHtml ? '本文再生成' : '本文を生成する'}
        </button>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">{error}</div>}

      {bodyHtml && (
        <>
          <div className="flex items-center justify-between">
            <div className="text-sm text-slate-600">
              本文文字数: <strong>{wordCount.toLocaleString()}</strong> 字
            </div>
          </div>

          <div className="card p-6 max-h-[600px] overflow-y-auto">
            <div
              className="article-preview"
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />
            <style>{`
              .article-preview h2 { font-size: 1.4rem; font-weight: 700; margin-top: 1.5rem; margin-bottom: 0.5rem; color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.25rem; }
              .article-preview h3 { font-size: 1.15rem; font-weight: 700; margin-top: 1.25rem; margin-bottom: 0.5rem; color: #1e293b; }
              .article-preview h4 { font-size: 1rem; font-weight: 700; margin-top: 1rem; margin-bottom: 0.5rem; color: #334155; }
              .article-preview p { margin: 0.6rem 0; line-height: 1.85; }
              .article-preview ul, .article-preview ol { padding-left: 1.5rem; margin: 0.4rem 0; }
              .article-preview li { margin: 0.2rem 0; line-height: 1.7; }
              .article-preview strong { color: #4f46e5; font-weight: 700; }
              .article-preview table { border-collapse: collapse; width: 100%; margin: 0.8rem 0; }
              .article-preview th, .article-preview td { border: 1px solid #cbd5e1; padding: 0.4rem; text-align: left; }
              .article-preview th { background-color: #f1f5f9; font-weight: 600; }
            `}</style>
          </div>

          {meta && (
            <div className="card p-4 text-sm">
              <div className="text-xs font-medium text-slate-500 mb-1">メタディスクリプション</div>
              <div className="text-slate-700">{meta}</div>
            </div>
          )}
        </>
      )}

      <div className="flex justify-between gap-2 pt-4 border-t border-slate-200">
        <button onClick={onPrev} className="btn-secondary">← 戻る</button>
        <button onClick={completeArticle} disabled={!bodyHtml || loading} className="btn-primary">
          完成 → エディタへ
        </button>
      </div>
    </div>
  );
}
