'use client';

import { useState } from 'react';
import Link from 'next/link';

type RowStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';
type ImageMode = 'none' | 'eyecatch' | 'full';
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
  const [skipPublished, setSkipPublished] = useState(true);
  const [parallelism, setParallelism] = useState(3);
  const [imageMode, setImageMode] = useState<ImageMode>('none');
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

    // 1. 一括で draft 記事作成（skipPublished=true なら公開済みの同KW記事はスキップ）
    let created: Array<{ id: string; keyword: string }> = [];
    let skipped: Array<{ keyword: string; existingId: string; existingTitle: string }> = [];
    try {
      const res = await fetch('/api/articles/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords, skipPublished }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '記事の一括作成に失敗しました');
        setRunning(false);
        return;
      }
      created = data.created || [];
      skipped = data.skipped || [];
    } catch (e) {
      setError((e as Error).message);
      setRunning(false);
      return;
    }

    const skippedRows: Row[] = skipped.map((s) => ({
      keyword: s.keyword,
      articleId: s.existingId,
      title: s.existingTitle,
      status: 'skipped',
    }));

    if (created.length === 0) {
      setRows(skippedRows);
      setError(
        skippedRows.length > 0
          ? 'すべて公開済み（WordPress投稿済み）のため、新規生成はありませんでした。'
          : '生成対象がありませんでした。',
      );
      setRunning(false);
      return;
    }

    const createdRows: Row[] = created.map((c) => ({ keyword: c.keyword, articleId: c.id, status: 'pending' }));
    setRows([...skippedRows, ...createdRows]);

    // 2. 複数記事を同時並列でフル生成（本文→任意で画像）。行は articleId で特定。
    const genOne = async (aid: string) => {
      setRows((prev) => prev.map((r) => (r.articleId === aid ? { ...r, status: 'running' } : r)));

      // 2-1. 本文生成
      let title: string | undefined;
      try {
        const res = await fetch('/api/generate/auto', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ articleId: aid, useCompetitorAnalysis: useCompetitor, useWebSearch, model }),
        });
        const data = await res.json();
        if (!res.ok) {
          setRows((prev) => prev.map((r) => (r.articleId === aid ? { ...r, status: 'failed', error: data.error } : r)));
          return;
        }
        title = data.title;
      } catch (e) {
        setRows((prev) => prev.map((r) => (r.articleId === aid ? { ...r, status: 'failed', error: (e as Error).message } : r)));
        return;
      }

      // 2-2. 画像生成（任意）。本文は完成済みなので、画像が失敗しても done 扱い＋注記にする。
      let imgError: string | undefined;
      if (imageMode !== 'none') {
        // タイトルを先に反映しつつ status は running のまま（＝画像生成中）
        setRows((prev) => prev.map((r) => (r.articleId === aid ? { ...r, title } : r)));
        try {
          const ir = await fetch('/api/generate/images', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ articleId: aid, scope: imageMode === 'full' ? 'all' : 'eyecatch' }),
          });
          const idata = (await ir.json().catch(() => ({}))) as {
            error?: string;
            generated?: unknown[];
            errors?: Array<{ error?: string }>;
          };
          if (!ir.ok) {
            // 致命的失敗（認証/タイトル未設定/ImageGenError 等）
            imgError = idata.error || '画像生成に失敗しました';
          } else if (idata.errors && idata.errors.length > 0) {
            // 200 でも個別画像が失敗するケース（images route は部分失敗を errors[] で返す）
            const gen = idata.generated?.length ?? 0;
            const failed = idata.errors.length;
            const first = idata.errors[0]?.error;
            imgError = gen === 0 ? `生成失敗（${first || '不明なエラー'}）` : `${failed}枚失敗`;
          }
        } catch (e) {
          imgError = (e as Error).message;
        }
      }

      setRows((prev) =>
        prev.map((r) =>
          r.articleId === aid ? { ...r, status: 'done', title, error: imgError ? `画像: ${imgError}` : undefined } : r,
        ),
      );
    };

    // concurrency 本のワーカーで created を前から順に消化（cursor は同期更新なので競合なし）
    const concurrency = Math.max(1, Math.min(parallelism, created.length));
    let cursor = 0;
    const worker = async () => {
      while (cursor < created.length) {
        const idx = cursor;
        cursor += 1;
        await genOne(created[idx].id);
      }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    setRunning(false);
  };

  const doneCount = rows.filter((r) => r.status === 'done').length;
  const failedCount = rows.filter((r) => r.status === 'failed').length;
  const skippedCount = rows.filter((r) => r.status === 'skipped').length;
  const genTotal = rows.filter((r) => r.status !== 'skipped').length;

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
          <div>
            <span className="label">同時実行数</span>
            <div className="flex gap-1.5">
              {([2, 3, 4, 5] as const).map((n) => (
                <button
                  key={n}
                  onClick={() => setParallelism(n)}
                  disabled={running}
                  className={`px-3 py-1.5 rounded-[5px] text-sm font-bold border ${
                    parallelism === n ? 'bg-teal text-white border-teal' : 'bg-white text-navy border-line hover:bg-bluepaper'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="label">画像生成</span>
            <div className="flex gap-1.5">
              {([['none', 'なし'], ['eyecatch', 'アイキャッチ'], ['full', 'フル']] as const).map(([v, l]) => (
                <button
                  key={v}
                  onClick={() => setImageMode(v)}
                  disabled={running}
                  className={`px-3 py-1.5 rounded-[5px] text-sm font-bold border ${
                    imageMode === v ? 'bg-teal text-white border-teal' : 'bg-white text-navy border-line hover:bg-bluepaper'
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
          <label className="flex items-center gap-2 text-sm mt-5">
            <input type="checkbox" checked={skipPublished} onChange={(e) => setSkipPublished(e.target.checked)} disabled={running} className="accent-teal w-4 h-4" />
            <span className="font-bold text-navy">公開済みはスキップ</span>
          </label>
        </div>

        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">{error}</div>}

        <button onClick={start} disabled={running || keywords.length === 0} className="btn-primary">
          {running ? `生成中… (${doneCount}/${genTotal})` : `${keywords.length} 記事を一括生成`}
        </button>
        {running && (
          <p className="text-xs text-sub">
            ※ 同時 {parallelism} 件ずつ処理（1記事2〜4分{imageMode !== 'none' ? ' ＋画像数分' : ''}）。完了までこのタブを開いたままにしてください。
          </p>
        )}
        {imageMode !== 'none' && (
          <p className="text-xs text-amber-600">
            ※ 画像生成ON{imageMode === 'full' ? '（フル=アイキャッチ＋全見出し画像）' : '（アイキャッチ1枚）'}: 各記事に画像処理（数十秒〜数分）が追加され、Imagen の画像課金（約$0.04/枚）が発生する場合があります。画像ON時は同時実行数を低め（2〜3）推奨。
          </p>
        )}
        {parallelism >= 4 && (
          <p className="text-xs text-amber-600">
            ※ 同時実行数が多いほど Claude の利用上限・サーバー負荷に当たりやすくなります。失敗が増えたら数を下げてください。
          </p>
        )}
        {skipPublished && !running && (
          <p className="text-xs text-sub">
            ※「公開済みはスキップ」ON: 同じキーワードで既に WordPress へ投稿済みの記事がある行は生成しません。
          </p>
        )}
      </div>

      {rows.length > 0 && (
        <div className="card p-6">
          <h2 className="section-title mb-4">
            生成状況（{doneCount}/{genTotal} 生成完了
            {failedCount > 0 ? ` ・ ${failedCount}件失敗` : ''}
            {skippedCount > 0 ? ` ・ ${skippedCount}件は公開済みスキップ` : ''}）
          </h2>
          <ul className="divide-y divide-line">
            {rows.map((r, i) => (
              <li key={r.articleId ?? i} className="py-3 flex items-center gap-3">
                <StatusIcon status={r.status} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-navy truncate">{r.title || r.keyword}</div>
                  {r.title && <div className="text-xs text-sub truncate">KW: {r.keyword}</div>}
                  {r.status === 'skipped' && (
                    <div className="text-xs text-amber-600">公開済み（WordPress投稿済み）のためスキップ</div>
                  )}
                  {r.error && <div className="text-xs text-red-600">{r.error}</div>}
                </div>
                {(r.status === 'done' || r.status === 'skipped') && r.articleId && (
                  <Link href={`/articles/${r.articleId}`} className="text-sm font-bold text-teal-mid hover:underline shrink-0">
                    {r.status === 'skipped' ? '既存記事' : '開く'} →
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
  if (status === 'skipped') return <span className="step-dot w-6 h-6 text-[10px] bg-amber-100 text-amber-700">⏭</span>;
  return <span className="step-dot step-dot-todo w-6 h-6 text-[10px]">·</span>;
}
