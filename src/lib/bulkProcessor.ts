/**
 * 一括生成のサーバー側ジョブ処理（クライアント非依存・更新/離脱しても継続）。
 *
 * 方式（ユーザー要望「並列処理してから上から1つずつ」）:
 *   - 生成フェーズ: 本文＋画像を **並列(parallelism件)** で生成 → 状態 'generated'（公開待ち）。
 *   - 公開フェーズ: 'generated' を **一覧の上から順(createdAt昇順)に1件ずつ** 公開 → 'done'。
 *     上の記事がまだ生成中なら、下が先に出来ても公開せず上を待つ（厳密に上から）。
 *   - wpPublish='none' のときは公開フェーズ無し（生成だけ並列）→ 直接 'done'。
 *
 * 状態(Article.bulkState): pending → processing(生成中) → generated(公開待ち)
 *                          → publishing(公開中) → done / failed / stopped
 * 多重起動はプロセス内フラグ＋claimの楽観ロックで防止。再起動はwatchdog timerが復帰。
 */
import { prisma } from './db';
import { internalPost } from './internalFetch';

const STALL_MS = 35 * 60 * 1000; // processing/publishing のまま動かなければ stall とみなし再実行
const MAX_ATTEMPTS = 3; // これ以上失敗したら failed 確定
const DEFAULT_GEN_CONCURRENCY = 2; // watchdog 起動時の既定 生成並列数
const PUBLISH_POLL_MS = 2500; // 上の記事の生成待ちのポーリング間隔
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface BulkParams {
  model: 'low_cost' | 'balanced' | 'high_quality';
  useCompetitor: boolean;
  useWebSearch: boolean;
  effImageMode: 'none' | 'eyecatch' | 'full';
  wpPublish: 'none' | 'draft' | 'publish';
  targetChars: number;
  parallelism: number; // 生成フェーズの並列数（公開は常に直列・上から順）
}

// 同一プロセス内でプロセッサのループが多重に走らないようにするフラグ。
let processing = false;
export function isBulkProcessing(): boolean {
  return processing;
}

/**
 * 生成(並列) ＋ 公開(直列・上から順) を、対象が無くなるまで走らせる。
 * 既に別ループが走っていれば何もしない。
 */
export async function runBulkProcessor(jobId?: string): Promise<{ started: boolean; processed: number }> {
  if (processing) return { started: false, processed: 0 };
  processing = true;
  let processed = 0;
  try {
    await resetOrphans(jobId);
    const genN = await resolveGenConcurrency(jobId);
    // 生成ワーカー(並列) と 公開ワーカー(1) を同時に走らせる。
    // 生成が 'generated' を積み、公開が上から順に取り出して公開する。
    const genWorkers = Array.from({ length: genN }, () => genWorker(jobId));
    const results = await Promise.all([...genWorkers, pubWorker(jobId)]);
    processed = results.reduce((a, b) => a + (b || 0), 0);
    await finalizeJobs(jobId);
  } finally {
    processing = false;
  }
  return { started: true, processed };
}

async function resolveGenConcurrency(jobId?: string): Promise<number> {
  if (jobId) {
    const job = await prisma.bulkJob.findUnique({ where: { id: jobId }, select: { params: true } });
    if (job) {
      try {
        const p = JSON.parse(job.params) as BulkParams;
        return Math.max(1, Math.min(p.parallelism || DEFAULT_GEN_CONCURRENCY, 4));
      } catch {
        /* fallthrough */
      }
    }
  }
  return DEFAULT_GEN_CONCURRENCY;
}

/**
 * 孤児を戻す。runBulkProcessor 冒頭でのみ呼ぶ（processing フラグ false→true 直後＝ループ非稼働）。
 * 生成の孤児 processing→pending、公開の孤児 publishing→generated。再起動後すぐ再開できる。
 * ただし processing のうち再試行枠を使い切った分(attempts>=MAX)は pending に戻しても二度と claim
 * されず（claimForGenerate は attempts<MAX のみ対象）、pending のまま残ると nextPublishable が
 * 'WAIT' を返し続けて pubWorker が永久に止まる。これは failed(terminal)にして滞留を防ぐ。
 */
async function resetOrphans(jobId?: string): Promise<void> {
  const scope = jobId ? { bulkJobId: jobId } : { bulkJobId: { not: null } };
  await prisma.article
    .updateMany({
      where: { ...scope, bulkState: 'processing', bulkAttempts: { gte: MAX_ATTEMPTS } },
      data: { bulkState: 'failed', bulkClaimedAt: null, bulkStage: '', bulkNote: '生成中に中断され、再試行上限に達したため失敗扱いにしました' },
    })
    .catch(() => {});
  await prisma.article
    .updateMany({
      where: { ...scope, bulkState: 'processing', bulkAttempts: { lt: MAX_ATTEMPTS } },
      data: { bulkState: 'pending', bulkClaimedAt: null, bulkStage: '' },
    })
    .catch(() => {});
  await prisma.article
    .updateMany({ where: { ...scope, bulkState: 'publishing' }, data: { bulkState: 'generated', bulkClaimedAt: null, bulkStage: '公開待ち' } })
    .catch(() => {});
}

// ===================== 生成フェーズ（並列） =====================

async function genWorker(jobId?: string): Promise<number> {
  let n = 0;
  for (let guard = 0; guard < 100000; guard++) {
    const aid = await claimForGenerate(jobId);
    if (!aid) return n;
    try {
      await generateArticle(aid);
    } catch (e) {
      // generateArticle が try の外（loadParams の DB 例外など）で投げた場合の保険。
      // attempts を見て terminal/pending を決める。pending に戻す際も attempts は
      // claim 時に increment 済みなので、上限到達分は failed にして永久滞留を防ぐ
      // （pending のまま attempts>=MAX だと再 claim されず pubWorker が無限 WAIT する）。
      const cur = await prisma.article.findUnique({ where: { id: aid }, select: { bulkAttempts: true } });
      const attempts = cur?.bulkAttempts ?? MAX_ATTEMPTS;
      await safeUpdate(
        aid,
        attempts >= MAX_ATTEMPTS
          ? { bulkState: 'failed', bulkStage: '', bulkNote: `生成に失敗しました: ${errMsg(e)}`, bulkClaimedAt: null }
          : { bulkState: 'pending', bulkStage: '', bulkNote: `再試行待ち(${attempts}/${MAX_ATTEMPTS}): ${errMsg(e)}`, bulkClaimedAt: null },
      );
    }
    n += 1;
  }
  return n;
}

/** pending / stall(processing) を1件 claim → processing。createdAt 昇順。 */
async function claimForGenerate(jobId?: string): Promise<string | null> {
  const now = new Date();
  const staleThreshold = new Date(now.getTime() - STALL_MS);
  const candidates = await prisma.article.findMany({
    where: {
      bulkJobId: jobId ? jobId : { not: null },
      bulkAttempts: { lt: MAX_ATTEMPTS },
      OR: [
        { bulkState: 'pending' },
        { bulkState: 'processing', bulkClaimedAt: { lt: staleThreshold } },
      ],
    },
    select: { id: true, bulkState: true, bulkClaimedAt: true, bulkJobId: true },
    take: 12,
    orderBy: { createdAt: 'asc' },
  });
  for (const c of candidates) {
    const where =
      c.bulkState === 'processing'
        ? { id: c.id, bulkState: 'processing', bulkClaimedAt: c.bulkClaimedAt }
        : { id: c.id, bulkState: c.bulkState };
    const res = await prisma.article.updateMany({
      where,
      data: { bulkState: 'processing', bulkClaimedAt: now, bulkAttempts: { increment: 1 } },
    });
    if (res.count !== 1) continue;
    if (c.bulkJobId && (await isJobStopped(c.bulkJobId))) {
      await safeUpdate(c.id, { bulkState: 'stopped', bulkStage: '', bulkClaimedAt: null });
      continue;
    }
    return c.id;
  }
  return null;
}

/** 本文＋画像を生成。wpPublish='none' なら done、そうでなければ generated（公開待ち）にする。 */
async function generateArticle(aid: string): Promise<void> {
  const p = await loadParams(aid);
  if (!p) return; // ジョブ無し/停止は loadParams 内で状態設定済み

  try {
    // 1. 本文生成
    await setStage(aid, '本文');
    const auto = await internalPost<{ ok?: boolean; title?: string; degraded?: boolean; error?: string }>(
      '/api/generate/auto',
      {
        articleId: aid,
        useCompetitorAnalysis: p.useCompetitor,
        useWebSearch: p.useWebSearch,
        model: p.model,
        targetCharsOverride: p.targetChars || undefined,
      },
    );
    if (!auto.ok) throw new Error(auto.data?.error || `本文生成失敗(HTTP ${auto.status})`);
    if (auto.data?.degraded) {
      await safeUpdate(aid, {
        bulkState: 'done',
        bulkStage: '',
        bulkNote: '生成が簡易内容のため画像・公開をスキップ（再生成推奨）',
        bulkClaimedAt: null,
      });
      return;
    }

    // 2. 画像（接続切れの誤「失敗」を避けるため DB の eyecatch を確認し、無ければ再試行）
    let note: string | undefined;
    if (p.effImageMode !== 'none') {
      await setStage(aid, '画像');
      const scope = p.effImageMode === 'full' ? 'all' : 'eyecatch';
      let haveImage = false;
      let partialNote: string | undefined;
      for (let attempt = 0; attempt < 3 && !haveImage; attempt++) {
        if (attempt > 0) await sleep(4000);
        const img = await internalPost<{ error?: string; generated?: unknown[]; errors?: Array<{ error?: string }> }>(
          '/api/generate/images',
          { articleId: aid, scope },
        );
        const eye = await prisma.articleImage.count({ where: { articleId: aid, kind: 'eyecatch' } });
        if (eye > 0) {
          haveImage = true;
          if (img.ok && img.data?.errors && img.data.errors.length > 0) {
            partialNote = `画像: ${img.data.errors.length}枚は後で自動補完されます`;
          }
        }
      }
      note = haveImage ? partialNote : '画像: 一時的に取得できませんでした（記事編集から再生成できます）';
    }

    // 3. 公開する設定なら「公開待ち(generated)」へ。しないなら done。
    if (p.wpPublish === 'none') {
      await safeUpdate(aid, { bulkState: 'done', bulkStage: '', bulkNote: note ?? null, bulkClaimedAt: null });
    } else {
      await safeUpdate(aid, { bulkState: 'generated', bulkStage: '公開待ち', bulkNote: note ?? null, bulkClaimedAt: null });
    }
  } catch (e) {
    const msg = errMsg(e);
    const cur = await prisma.article.findUnique({ where: { id: aid }, select: { bulkAttempts: true } });
    const attempts = cur?.bulkAttempts ?? MAX_ATTEMPTS;
    await safeUpdate(
      aid,
      attempts >= MAX_ATTEMPTS
        ? { bulkState: 'failed', bulkStage: '', bulkNote: msg, bulkClaimedAt: null }
        : { bulkState: 'pending', bulkStage: '', bulkNote: `再試行待ち(${attempts}/${MAX_ATTEMPTS}): ${msg}`, bulkClaimedAt: null },
    );
  }
}

// ===================== 公開フェーズ（直列・上から順） =====================

async function pubWorker(jobId?: string): Promise<number> {
  let n = 0;
  for (let guard = 0; guard < 1000000; guard++) {
    const next = await nextPublishable(jobId);
    if (next === 'DONE') return n; // 公開対象がもう無い（全て terminal）
    if (next === 'WAIT') {
      await sleep(PUBLISH_POLL_MS); // 上の記事が生成中 → できるまで待つ（厳密に上から順）
      continue;
    }
    // next = articleId（上から順で次に公開すべき generated 記事）。claim して公開。
    const claimed = await claimForPublish(next);
    if (!claimed) {
      await sleep(300); // 競合で取れなかった → 再評価
      continue;
    }
    try {
      await publishArticle(next);
    } catch (e) {
      // 公開失敗はキューを止めない（terminal=done にして注記、手動再公開可）。
      await safeUpdate(next, { bulkState: 'done', bulkStage: '', bulkPub: `公開失敗: ${errMsg(e)}`, bulkClaimedAt: null });
    }
    n += 1;
  }
  return n;
}

/**
 * 次に公開すべき記事を「上から順(createdAt昇順)」に決める。
 *  - 先頭から見て terminal(done/failed/skipped/stopped) はスキップ。
 *  - 最初の非terminal が 'generated' なら、それが次に公開する記事（これより上は全て terminal）。
 *  - 最初の非terminal が pending/processing/publishing なら、それが片付くまで先へ進めない → 'WAIT'。
 *  - 非terminal が皆無なら 'DONE'。
 */
async function nextPublishable(jobId?: string): Promise<'DONE' | 'WAIT' | string> {
  const arts = await prisma.article.findMany({
    where: { bulkJobId: jobId ? jobId : { not: null } },
    select: { id: true, bulkState: true },
    orderBy: { createdAt: 'asc' },
  });
  let anyNonTerminal = false;
  for (const a of arts) {
    const s = a.bulkState;
    if (s === 'done' || s === 'failed' || s === 'skipped' || s === 'stopped') continue;
    anyNonTerminal = true;
    if (s === 'generated') return a.id;
    return 'WAIT'; // pending/processing/publishing → 上のこれを待つ
  }
  return anyNonTerminal ? 'WAIT' : 'DONE';
}

/** generated → publishing を楽観ロックで claim。 */
async function claimForPublish(aid: string): Promise<boolean> {
  const res = await prisma.article.updateMany({
    where: { id: aid, bulkState: 'generated' },
    data: { bulkState: 'publishing', bulkStage: '公開', bulkClaimedAt: new Date() },
  });
  return res.count === 1;
}

async function publishArticle(aid: string): Promise<void> {
  const p = await loadParams(aid);
  if (!p) return; // ジョブ無し/停止時は loadParams 内で状態設定済み

  let pub: string | undefined;
  let wpLink: string | undefined;
  const pr = await internalPost<{ error?: string; status?: string; link?: string; heldForPharma?: boolean }>(
    '/api/wordpress/publish',
    { articleId: aid, status: p.wpPublish, uploadImages: true, pharmaGate: true, requireImages: true },
  );
  // 接続切れ(再起動等)で ok=false でも、実際には公開済みの場合があるので wpPostId を確認（誤「失敗」回避）。
  const fresh = await prisma.article.findUnique({ where: { id: aid }, select: { wpPostId: true, wpPostStatus: true } });
  if (fresh?.wpPostId) {
    wpLink = pr.data?.link;
    if (pr.data?.heldForPharma) pub = '薬機法リスク高 → 下書き保留';
    else if (fresh.wpPostStatus === 'publish') pub = '公開済み';
    else pub = fresh.wpPostStatus === 'draft' ? '下書き保存' : `投稿(${fresh.wpPostStatus})`;
  } else if (!pr.ok) {
    pub = `公開失敗: ${pr.data?.error || `HTTP ${pr.status}`}`;
  } else if (pr.data?.heldForPharma) {
    pub = '薬機法リスク高 → 下書き保留';
    wpLink = pr.data?.link;
  } else {
    pub = pr.data?.status === 'publish' ? '公開済み' : pr.data?.status === 'draft' ? '下書き保存' : `投稿(${pr.data?.status})`;
    wpLink = pr.data?.link;
  }
  // bulkNote(画像の注記)は上書きしない。公開結果だけ更新して done。
  await safeUpdate(aid, { bulkState: 'done', bulkStage: '', bulkPub: pub ?? null, bulkWpLink: wpLink ?? null, bulkClaimedAt: null });
}

// ===================== 補助 =====================

/** 記事のジョブ設定を読む。ジョブ無し→failed、停止→stopped を設定して null を返す。 */
async function loadParams(aid: string): Promise<BulkParams | null> {
  const art = await prisma.article.findUnique({ where: { id: aid }, select: { bulkJobId: true } });
  if (!art?.bulkJobId) {
    await safeUpdate(aid, { bulkState: 'failed', bulkStage: '', bulkNote: 'ジョブに紐づいていません', bulkClaimedAt: null });
    return null;
  }
  const job = await prisma.bulkJob.findUnique({ where: { id: art.bulkJobId }, select: { params: true, status: true } });
  if (!job) {
    await safeUpdate(aid, { bulkState: 'failed', bulkStage: '', bulkNote: 'ジョブが見つかりません', bulkClaimedAt: null });
    return null;
  }
  if (job.status === 'stopped') {
    await safeUpdate(aid, { bulkState: 'stopped', bulkStage: '', bulkClaimedAt: null });
    return null;
  }
  try {
    return JSON.parse(job.params) as BulkParams;
  } catch {
    await safeUpdate(aid, { bulkState: 'failed', bulkStage: '', bulkNote: 'ジョブ設定の解析に失敗', bulkClaimedAt: null });
    return null;
  }
}

async function isJobStopped(jobId: string): Promise<boolean> {
  const job = await prisma.bulkJob.findUnique({ where: { id: jobId }, select: { status: true } });
  return job?.status === 'stopped';
}

function errMsg(e: unknown): string {
  return ((e as Error)?.message || String(e) || 'unknown').slice(0, 300);
}

/**
 * 現在ステージを更新する。あわせて bulkClaimedAt を「いま」に更新（ハートビート）して、
 * 複数ステージ（本文→画像）にまたがっても stall 窓が単一ステージ(internalPost 1本=最大30分)に
 * 収まるようにする。これがないと正常処理を watchdog が stall 誤認して横取りしうる。
 */
async function setStage(aid: string, stage: string): Promise<void> {
  await prisma.article.update({ where: { id: aid }, data: { bulkStage: stage, bulkClaimedAt: new Date() } }).catch(() => {});
}

async function safeUpdate(aid: string, data: Record<string, unknown>): Promise<void> {
  await prisma.article.update({ where: { id: aid }, data }).catch(() => {});
}

/** 対象ジョブで未処理(pending/processing/generated/publishing)が無くなっていれば done にする。 */
async function finalizeJobs(jobId?: string): Promise<void> {
  const jobs = await prisma.bulkJob.findMany({
    where: { status: 'running', ...(jobId ? { id: jobId } : {}) },
    select: { id: true, total: true },
  });
  for (const j of jobs) {
    const [remaining, totalArticles] = await Promise.all([
      prisma.article.count({
        where: { bulkJobId: j.id, bulkState: { in: ['pending', 'processing', 'generated', 'publishing'] } },
      }),
      prisma.article.count({ where: { bulkJobId: j.id } }),
    ]);
    // watchdog が作成API の create(job)→createMany(articles) の隙間に走ると、記事0件の running を
    // 誤って done 化しうる。作成予定(total)が出揃っている時だけ done 化して防ぐ。
    if (remaining === 0 && totalArticles >= j.total) {
      await prisma.bulkJob.update({ where: { id: j.id }, data: { status: 'done' } }).catch(() => {});
    }
  }
}
