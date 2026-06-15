'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';

type RowStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'stopped';
type ImageMode = 'none' | 'eyecatch' | 'full';
type WpPublish = 'none' | 'draft' | 'publish';

interface Row {
  keyword: string;
  articleId?: string;
  title?: string;
  status: RowStatus;
  stage?: string;
  error?: string;
  pub?: string;
  wpLink?: string;
}

// サーバーから返ってくるジョブステータスの型
interface BulkStatusItem {
  articleId: string;
  keyword: string;
  title?: string;
  state: 'pending' | 'processing' | 'done' | 'failed' | 'stopped';
  stage: string;
  note?: string;
  pub?: string;
  wpLink?: string;
}
interface BulkStatusCounts {
  total: number;
  done: number;
  failed: number;
  processing: number;
  pending: number;
  stopped: number;
}
interface BulkStatusResponse {
  job: { id: string; status: 'running' | 'done' | 'stopped'; total: number };
  items: BulkStatusItem[];
  skipped: Array<{ keyword: string; existingId: string; existingTitle: string; wpLink?: string }>;
  counts: BulkStatusCounts;
}

const LS_KEY = 'aw_bulk_job_id';
const POLL_INTERVAL_MS = 4000;

/** サーバーの item.state を Row の status にマッピング */
function itemStateToRowStatus(state: BulkStatusItem['state']): RowStatus {
  switch (state) {
    case 'processing': return 'running';
    case 'done':       return 'done';
    case 'failed':     return 'failed';
    case 'stopped':    return 'stopped';
    case 'pending':
    default:           return 'pending';
  }
}

/** BulkStatusResponse を Row[] に変換 */
function buildRows(data: BulkStatusResponse): Row[] {
  const skippedRows: Row[] = data.skipped.map((s) => ({
    keyword: s.keyword,
    articleId: s.existingId,
    title: s.existingTitle,
    status: 'skipped' as RowStatus,
    wpLink: s.wpLink,
  }));
  const itemRows: Row[] = data.items.map((item) => ({
    keyword: item.keyword,
    articleId: item.articleId,
    title: item.title,
    status: itemStateToRowStatus(item.state),
    stage: item.stage,
    error: item.note,
    pub: item.pub,
    wpLink: item.wpLink,
  }));
  return [...skippedRows, ...itemRows];
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
  const [wpPublish, setWpPublish] = useState<WpPublish>('none');
  const [targetChars, setTargetChars] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [counts, setCounts] = useState<BulkStatusCounts | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ポーリング継続フラグ（アンマウント時に false）
  const pollingRef = useRef(false);

  const keywords = input
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  /** ポーリング停止 */
  const stopPolling = () => {
    pollingRef.current = false;
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  /** 1回のステータス取得 → rows/counts 更新 → 完了判定 */
  const fetchStatus = async (id: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/articles/bulk/status?jobId=${encodeURIComponent(id)}`);
      if (!res.ok) {
        // 4xx/5xx はエラー表示せずポーリング継続（瞬断扱い）
        return false;
      }
      const data: BulkStatusResponse = await res.json();
      setRows(buildRows(data));
      setCounts(data.counts);

      // 完了条件: job が done/stopped かつ処理中・待機中が 0
      const finished =
        (data.job.status === 'done' || data.job.status === 'stopped') &&
        data.counts.processing === 0 &&
        data.counts.pending === 0;
      return finished;
    } catch {
      // ネットワーク瞬断は握りつぶしてポーリング継続
      return false;
    }
  };

  /** 再帰 setTimeout でポーリング */
  const scheduleNextPoll = (id: string) => {
    if (!pollingRef.current) return;
    // 多重起動（StrictMode の effect 二重実行や復元と開始の競合）でタイマーが重複し
    // leak しないよう、既存のタイマーを必ず解除してから張り直す。
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      if (!pollingRef.current) return;
      const finished = await fetchStatus(id);
      if (finished || !pollingRef.current) {
        stopPolling();
        setRunning(false);
        setStopping(false);
      } else {
        scheduleNextPoll(id);
      }
    }, POLL_INTERVAL_MS);
  };

  /** ジョブ ID を受け取りポーリング開始 */
  const startPolling = async (id: string) => {
    pollingRef.current = true;
    setJobId(id);
    localStorage.setItem(LS_KEY, id);

    // 即時1回取得してから interval 開始
    const finished = await fetchStatus(id);
    if (finished) {
      stopPolling();
      setRunning(false);
      setStopping(false);
    } else if (pollingRef.current) {
      scheduleNextPoll(id);
    }
  };

  /** マウント時: localStorage に jobId があれば復元 */
  useEffect(() => {
    const savedId = localStorage.getItem(LS_KEY);
    if (!savedId) return;

    (async () => {
      try {
        const res = await fetch(`/api/articles/bulk/status?jobId=${encodeURIComponent(savedId)}`);
        if (!res.ok) return;
        const data: BulkStatusResponse = await res.json();
        setRows(buildRows(data));
        setCounts(data.counts);
        setJobId(savedId);

        const isRunning =
          data.job.status === 'running' ||
          data.counts.processing > 0 ||
          data.counts.pending > 0;
        if (isRunning) {
          setRunning(true);
          pollingRef.current = true;
          scheduleNextPoll(savedId);
        }
      } catch {
        // 復元失敗は無視
      }
    })();

    return () => {
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** アンマウント時にタイマー解除 */
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, []);

  const start = async () => {
    setError(null);
    if (keywords.length === 0) {
      setError('キーワードを1行に1つずつ入力してください');
      return;
    }
    setRunning(true);
    setStopping(false);
    setRows([]);
    setCounts(null);

    try {
      const res = await fetch('/api/articles/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords,
          skipPublished,
          model,
          useCompetitor,
          useWebSearch,
          imageMode,
          wpPublish,
          targetChars,
          parallelism,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '一括生成ジョブの作成に失敗しました');
        setRunning(false);
        return;
      }

      // skipped のみ表示（生成対象なし）
      if (!data.jobId) {
        const skippedRows: Row[] = (data.skipped ?? []).map(
          (s: { keyword: string; existingId: string; existingTitle: string; wpLink?: string }) => ({
            keyword: s.keyword,
            articleId: s.existingId,
            title: s.existingTitle,
            status: 'skipped' as RowStatus,
            wpLink: s.wpLink,
          }),
        );
        setRows(skippedRows);
        setError(
          skippedRows.length > 0
            ? 'すべて WordPress で公開中のため、新規生成はありませんでした。'
            : '生成対象がありませんでした。',
        );
        setRunning(false);
        return;
      }

      await startPolling(data.jobId as string);
    } catch (e) {
      setError((e as Error).message);
      setRunning(false);
    }
  };

  const handleStop = async () => {
    if (!jobId) return;
    setStopping(true);
    try {
      await fetch('/api/articles/bulk/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
      // ポーリングは継続して stopped 状態になるのを待つ
    } catch {
      // 失敗しても UI 上は停止リクエスト中のまま、次のポーリングで状態確認
    }
  };

  const handleReset = () => {
    stopPolling();
    localStorage.removeItem(LS_KEY);
    setJobId(null);
    setRows([]);
    setCounts(null);
    setRunning(false);
    setStopping(false);
    setError(null);
  };

  // 表示用カウント
  const doneCount = counts?.done ?? rows.filter((r) => r.status === 'done').length;
  const failedCount = counts?.failed ?? rows.filter((r) => r.status === 'failed').length;
  const skippedCount = rows.filter((r) => r.status === 'skipped').length;
  const publishedCount = rows.filter((r) => r.pub === '公開済み').length;
  const genTotal = counts?.total ?? rows.filter((r) => r.status !== 'skipped').length;

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
              {([2, 3, 4] as const).map((n) => (
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
          <div>
            <span className="label">WordPress公開</span>
            <div className="flex gap-1.5">
              {([['none', 'なし'], ['draft', '下書き'], ['publish', '即公開']] as const).map(([v, l]) => (
                <button
                  key={v}
                  onClick={() => setWpPublish(v)}
                  disabled={running}
                  className={`px-3 py-1.5 rounded-[5px] text-sm font-bold border ${
                    wpPublish === v ? 'bg-teal text-white border-teal' : 'bg-white text-navy border-line hover:bg-bluepaper'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="label">目標文字数</span>
            <div className="flex gap-1.5">
              {([[0, '自動'], [10000, '1万字'], [20000, '2万字'], [30000, '3万字'], [50000, '5万字']] as const).map(([v, l]) => (
                <button
                  key={v}
                  onClick={() => setTargetChars(v)}
                  disabled={running}
                  className={`px-3 py-1.5 rounded-[5px] text-sm font-bold border ${
                    targetChars === v ? 'bg-teal text-white border-teal' : 'bg-white text-navy border-line hover:bg-bluepaper'
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

        <div className="flex items-center gap-3">
          {!running && rows.length > 0 ? (
            <button onClick={handleReset} className="btn-primary">
              新規に一括作成
            </button>
          ) : (
            <button onClick={start} disabled={running || keywords.length === 0} className="btn-primary">
              {running ? `生成中… (${doneCount}/${genTotal})` : `${keywords.length} 記事を一括生成`}
            </button>
          )}
          {running && (
            <button
              onClick={handleStop}
              disabled={stopping}
              className="px-4 py-2 rounded-[5px] text-sm font-bold border-2 border-red-500 text-red-600 bg-white hover:bg-red-50 disabled:opacity-60"
            >
              {stopping ? '停止中…' : '■ 緊急停止'}
            </button>
          )}
        </div>
        {running && (
          <p className="text-xs text-sub">
            ※ サーバー側でジョブが処理中です（4秒ごとに進捗を更新）。タブを閉じても処理は継続し、再度開くと自動復元します。
            {stopping && ' ／ 停止リクエスト受付：実行中の記事が終わり次第とまります。'}
          </p>
        )}
        {wpPublish !== 'none' && (
          <p className="text-xs text-amber-600">
            ※ WordPress{wpPublish === 'publish' ? '即公開' : '下書き'}ON: 本文→画像→{wpPublish === 'publish' ? '公開' : '下書き投稿'}まで自動。
            公開には画像が必須のため、画像「なし」でもアイキャッチを自動生成します。
            {wpPublish === 'publish' && ' 即公開でも薬機法リスク「高」の記事は自動で下書き保留にします。'}
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
        {targetChars >= 30000 && (
          <p className="text-xs text-amber-600">
            ※ 目標文字数{Math.round(targetChars / 10000)}万字: h2セクション単位で多段増補するため、1記事の生成に10〜20分かかります。同時実行数は低め（2〜3）推奨。
          </p>
        )}
        {targetChars === 0 ? (
          <p className="text-xs text-sub">
            ※ 目標文字数「自動」: 競合分析の平均文字数×1.3（競合が取得できない場合は約3,500字）。長文を確実に出すには文字数を指定してください。
          </p>
        ) : (
          <p className="text-xs text-sub">
            ※ 目標文字数 {targetChars.toLocaleString()} 字を必達目標に多段増補します（競合分析の結果より優先）。
          </p>
        )}
        {skipPublished && !running && (
          <p className="text-xs text-sub">
            ※「公開済みはスキップ」ON: 同じキーワードで WordPress に<strong>公開中</strong>の記事がある行のみ生成しません（ゴミ箱・下書き・予約・非公開は対象外＝再生成できます）。
          </p>
        )}
      </div>

      {rows.length > 0 && (
        <div className="card p-6">
          <h2 className="section-title mb-4">
            生成状況（{doneCount}/{genTotal} 生成完了
            {publishedCount > 0 ? ` ・ ${publishedCount}件公開` : ''}
            {failedCount > 0 ? ` ・ ${failedCount}件失敗` : ''}
            {skippedCount > 0 ? ` ・ ${skippedCount}件スキップ` : ''}）
          </h2>
          <ul className="divide-y divide-line">
            {rows.map((r, i) => (
              <li key={r.articleId || `row-${i}`} className="py-3 flex items-center gap-3">
                <StatusIcon status={r.status} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-navy truncate">{r.title || r.keyword}</div>
                  {r.title && <div className="text-xs text-sub truncate">KW: {r.keyword}</div>}
                  {r.status === 'running' && r.stage && (
                    <div className="text-xs text-teal-mid">{r.stage}</div>
                  )}
                  {r.status === 'skipped' && (
                    <div className="text-xs text-amber-600">
                      WordPress で公開中のためスキップ
                      {r.wpLink && (
                        <>
                          {' '}
                          <a href={r.wpLink} target="_blank" rel="noopener noreferrer" className="underline">
                            記事を見る ↗
                          </a>
                        </>
                      )}
                    </div>
                  )}
                  {r.pub && (
                    <div
                      className={`text-xs ${
                        r.pub.startsWith('公開失敗')
                          ? 'text-red-600'
                          : r.pub.includes('保留')
                            ? 'text-amber-600'
                            : 'text-teal-mid font-bold'
                      }`}
                    >
                      WP: {r.pub}
                      {r.wpLink && (
                        <>
                          {' '}
                          <a href={r.wpLink} target="_blank" rel="noopener noreferrer" className="underline">
                            記事を見る ↗
                          </a>
                        </>
                      )}
                    </div>
                  )}
                  {r.error && <div className="text-xs text-red-600">{r.error}</div>}
                </div>
                {(r.status === 'done' || r.status === 'skipped') && r.articleId && (
                  <Link href={`/articles/${r.articleId}`} className="text-sm font-bold text-teal-mid hover:underline shrink-0">
                    {r.status === 'skipped' ? '既存記事' : '編集'} →
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
  if (status === 'done')    return <span className="step-dot step-dot-done w-6 h-6 text-[10px]">✓</span>;
  if (status === 'running') return <span className="w-6 h-6 rounded-full border-2 border-teal border-t-transparent animate-spin shrink-0" />;
  if (status === 'failed')  return <span className="step-dot w-6 h-6 text-[10px] bg-red-100 text-red-600">!</span>;
  if (status === 'skipped') return <span className="step-dot w-6 h-6 text-[10px] bg-amber-100 text-amber-700">⏭</span>;
  if (status === 'stopped') return <span className="step-dot w-6 h-6 text-[10px] bg-gray-200 text-gray-600">■</span>;
  return <span className="step-dot step-dot-todo w-6 h-6 text-[10px]">·</span>;
}
