'use client';

import { useState } from 'react';
import Link from 'next/link';

type RowStatus = 'pending' | 'running' | 'done' | 'failed';
interface Row {
  keyword: string;
  articleId?: string;
  title?: string;
  status: RowStatus;
  error?: string;
}

export default function BulkGenerator() {
  const [input, setInput] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [model, setModel] = useState<'low_cost' | 'balanced' | 'high_quality'>('balanced');
  const [useCompetitor, setUseCompetitor] = useState(true);
  const [useWebSearch, setUseWebSearch] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const keywords = input
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const start = async () => {
    setError(null);
    if (keywords.length === 0) {
      setError('キーワードを1行に1つずつ入力してください');
      return;
    }
    setRunning(true);

    // 1. 一括で draft 記事作成
    let created: Array<{ id: string; keyword: string }> = [];
    try {
      const res = await fetch('/api/articles/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '記事の一括作成に失敗しました');
        setRunning(false);
        return;
      }
      created = data.created;
    } catch (e) {
      setError((e as Error).message);
      setRunning(false);
      return;
    }

    const initial: Row[] = created.map((c) => ({ keyword: c.keyword, articleId: c.id, status: 'pending' }));
    setRows(initial);

    // 2. 1記事ずつ順次フル生成
    for (let i = 0; i < created.length; i++) {
      setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, status: 'running' } : r)));
      try {
        const res = await fetch('/api/generate/auto', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            articleId: created[i].id,
            useCompetitorAnalysis: useCompetitor,
            useWebSearch,
            model,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, status: 'failed', error: data.error } : r)));
        } else {
          setRows((prev) =>
            prev.map((r, idx) => (idx === i ? { ...r, status: 'done', title: data.title } : r)),
          );
        }
      } catch (e) {
        setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, status: 'failed', error: (e as Error).message } : r)));
      }
    }

    setRunning(false);
  };

  const doneCount = rows.filter((r) => r.status === 'done').length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy-deep">一括記事生成</h1>
        <p className="text-sm text-sub mt-1">
          上位表示したいキーワードを1行に1つずつ入力 → 各キーワードからタイトル・見出し・本文を自動生成します。
        </p>
      </div>

      <div className="card p-6 space-y-4">
        <div>
          <label className="label">キーワード（1行に1記事ぶん。スペース区切りで複数KWを1記事に）</label>
          <textarea
            className="input min-h-[160px] font-mono text-sm"
            placeholder={'ゲーミングチェア おすすめ\n昇降デスク 電動\nオフィスチェア 腰痛'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={running}
          />
          <div className="text-xs text-sub text-right mt-1">{keywords.length} 記事ぶん</div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div>
            <span className="label">AIモデル</span>
            <div className="flex gap-1.5">
              {([['low_cost', '標準'], ['balanced', '高性能'], ['high_quality', '最高']] as const).map(([v, l]) => (
                <button
                  key={v}
                  onClick={() => setModel(v)}
                  disabled={running}
                  className={`px-3 py-1.5 rounded-[5px] text-sm font-bold border ${
                    model === v ? 'bg-teal text-white border-teal' : 'bg-white text-navy border-line hover:bg-bluepaper'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm mt-5">
            <input type="checkbox" checked={useCompetitor} onChange={(e) => setUseCompetitor(e.target.checked)} disabled={running} className="accent-teal w-4 h-4" />
            <span className="font-bold text-navy">競合分析</span>
          </label>
          <label className="flex items-center gap-2 text-sm mt-5">
            <input type="checkbox" checked={useWebSearch} onChange={(e) => setUseWebSearch(e.target.checked)} disabled={running} className="accent-teal w-4 h-4" />
            <span className="font-bold text-navy">Web検索で最新化</span>
          </label>
        </div>

        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">{error}</div>}

        <button onClick={start} disabled={running || keywords.length === 0} className="btn-primary">
          {running ? `生成中… (${doneCount}/${rows.length})` : `${keywords.length} 記事を一括生成`}
        </button>
        {running && (
          <p className="text-xs text-sub">
            ※ 1記事あたり2〜4分。完了までこのタブを開いたままにしてください。
          </p>
        )}
      </div>

      {rows.length > 0 && (
        <div className="card p-6">
          <h2 className="section-title mb-4">生成状況（{doneCount}/{rows.length} 完了）</h2>
          <ul className="divide-y divide-line">
            {rows.map((r, i) => (
              <li key={i} className="py-3 flex items-center gap-3">
                <StatusIcon status={r.status} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-navy truncate">{r.title || r.keyword}</div>
                  {r.title && <div className="text-xs text-sub truncate">KW: {r.keyword}</div>}
                  {r.error && <div className="text-xs text-red-600">{r.error}</div>}
                </div>
                {r.status === 'done' && r.articleId && (
                  <Link href={`/articles/${r.articleId}`} className="text-sm font-bold text-teal-mid hover:underline shrink-0">
                    開く →
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: RowStatus }) {
  if (status === 'done') return <span className="step-dot step-dot-done w-6 h-6 text-[10px]">✓</span>;
  if (status === 'running') return <span className="w-6 h-6 rounded-full border-2 border-teal border-t-transparent animate-spin shrink-0" />;
  if (status === 'failed') return <span className="step-dot w-6 h-6 text-[10px] bg-red-100 text-red-600">!</span>;
  return <span className="step-dot step-dot-todo w-6 h-6 text-[10px]">·</span>;
}
