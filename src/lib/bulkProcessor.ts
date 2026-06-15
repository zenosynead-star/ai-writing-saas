/**
 * 一括生成のサーバー側ジョブ処理（クライアント非依存・更新/離脱しても継続）。
 *
 * - 記事(Article)に bulkJobId/bulkState/bulkClaimedAt/bulkAttempts を持たせ、
 *   このプロセッサが pending と「stall(processing のまま claimedAt が古い)」を原子的に claim して
 *   本文→画像→公開 を実行する。
 * - 多重起動は同一プロセス内フラグ `processing` で防止（pm2 fork=単一プロセスなので有効）。
 *   さらに claim は楽観ロック(updateMany count===1)なので、万一並走しても二重処理しない。
 * - 失敗は bulkAttempts < MAX_ATTEMPTS の間 pending に戻して自動再試行。超えたら failed。
 * - 起動契機: ①一括作成APIが fire-and-forget で起動 ②watchdog systemd timer が定期起動
 *   （pm2 再起動でループが死んでも timer が pending/stall を拾って自動再開）。
 */
import { prisma } from './db';
import { internalPost } from './internalFetch';

// stall 判定の閾値。internalPost 1本のハードタイムアウトは 30分(internalFetch.REQUEST_TIMEOUT_MS)。
// 正常に走っているループは各ステージ開始時に bulkClaimedAt を更新(ハートビート)するので、
// 「claimedAt が古い」のは "単一ステージが 30分以上応答しない"＝事実上プロセス死亡/ハング時のみ。
// それでも誤検知で正常処理を横取りしないよう、内部タイムアウト(30分)＋余裕(5分)を取って 35分とする。
// （25分だと auto が 30分近く張り付く長文生成中に watchdog が同一記事を再claimし二重処理＝
//   画像/公開の二重課金・WP重複投稿を招くため不可）。
const STALL_MS = 35 * 60 * 1000;
const MAX_ATTEMPTS = 3; // これ以上失敗したら failed 確定

interface BulkParams {
  model: 'low_cost' | 'balanced' | 'high_quality';
  useCompetitor: boolean;
  useWebSearch: boolean;
  effImageMode: 'none' | 'eyecatch' | 'full';
  wpPublish: 'none' | 'draft' | 'publish';
  targetChars: number;
  /** 後方互換で保持するだけ（未使用）。処理は常に1件ずつ直列。worker を多重化してはいけない。 */
  parallelism: number;
}

// 同一プロセス内でプロセッサのループが多重に走らないようにするフラグ。
let processing = false;

export function isBulkProcessing(): boolean {
  return processing;
}

/**
 * 公開中ジョブ（jobId 指定時はそのジョブ）の pending/stall 記事を、claim できなくなるまで処理する。
 * 既に別ループが走っていれば何もしない（そのループが新規/stall を拾い続ける）。
 */
export async function runBulkProcessor(jobId?: string): Promise<{ started: boolean; processed: number }> {
  if (processing) return { started: false, processed: 0 };
  processing = true;
  let processed = 0;
  try {
    // ここに来た時点で processing は false→true。＝このプロセスで処理ループは走っていない。
    // よって 'processing' のまま残っている記事は前回ループがプロセス再起動等で死んだ「孤児」。
    // pending に戻し即再開できるようにする（35分の stall 待ちを回避＝再起動後すぐ自動再開）。
    await resetOrphans(jobId);
    // 「上から順に1件ずつ」処理する＝同時実行は常に1（createdAt 昇順 claim）。
    // 画像は IMAGE_MAX_CONCURRENCY で別途直列化されており、記事も直列にすることで
    //  ① 一覧の上から順に進む（ユーザー要望） ② Vertex への同時アクセスが減り 429 が減る。
    processed = await worker(jobId);
    await finalizeJobs(jobId);
  } finally {
    processing = false;
  }
  return { started: true, processed };
}

/**
 * 孤児( processing のまま残った記事 )を pending に戻す。runBulkProcessor の冒頭でのみ呼ぶ。
 * その時点で processing フラグは false→true 直後＝処理ループは非稼働なので、'processing' は
 * すべて前回ループの遺物（再起動/クラッシュで中断）。安全に pending へ戻して再開対象にできる。
 * 再 claim 時に bulkAttempts が増えるので、再起動を繰り返す記事は最終的に failed で止まる。
 */
async function resetOrphans(jobId?: string): Promise<void> {
  await prisma.article
    .updateMany({
      where: { bulkJobId: jobId ? jobId : { not: null }, bulkState: 'processing' },
      data: { bulkState: 'pending', bulkClaimedAt: null, bulkStage: '' },
    })
    .catch(() => {});
}

async function worker(jobId?: string): Promise<number> {
  let n = 0;
  for (let guard = 0; guard < 100000; guard++) {
    const aid = await claimOne(jobId);
    if (!aid) return n;
    await processArticle(aid);
    n += 1;
  }
  return n;
}

/** pending / stall の記事を1件、楽観ロックで claim する。claim できたら articleId を返す。 */
async function claimOne(jobId?: string): Promise<string | null> {
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
    // 楽観ロック: 候補時点と同じ条件を満たす場合のみ自分が claim 成功（count===1）。
    // stall(processing)の再claimでは bulkClaimedAt も where に含め、候補抽出〜update の隙間に
    // 元ループが setStage でハートビート更新したら奪わない（＝二重処理しない）ようにする。
    const where =
      c.bulkState === 'processing'
        ? { id: c.id, bulkState: 'processing', bulkClaimedAt: c.bulkClaimedAt }
        : { id: c.id, bulkState: c.bulkState };
    const res = await prisma.article.updateMany({
      where,
      data: { bulkState: 'processing', bulkClaimedAt: now, bulkAttempts: { increment: 1 } },
    });
    if (res.count !== 1) continue; // 他のワーカーが先に取った / ハートビートで更新された
    // 所属ジョブが停止/完了済みなら処理せず該当状態にして次へ。
    if (c.bulkJobId) {
      const job = await prisma.bulkJob.findUnique({ where: { id: c.bulkJobId }, select: { status: true } });
      if (job?.status === 'stopped') {
        await prisma.article
          .update({ where: { id: c.id }, data: { bulkState: 'stopped', bulkStage: '', bulkClaimedAt: null } })
          .catch(() => {});
        continue;
      }
    }
    return c.id;
  }
  return null;
}

async function processArticle(aid: string): Promise<void> {
  const art = await prisma.article.findUnique({ where: { id: aid }, select: { bulkJobId: true } });
  if (!art?.bulkJobId) return;
  const job = await prisma.bulkJob.findUnique({ where: { id: art.bulkJobId }, select: { params: true, status: true } });
  if (!job) {
    await safeUpdate(aid, { bulkState: 'failed', bulkStage: '', bulkNote: 'ジョブが見つかりません', bulkClaimedAt: null });
    return;
  }
  if (job.status === 'stopped') {
    await safeUpdate(aid, { bulkState: 'stopped', bulkStage: '', bulkClaimedAt: null });
    return;
  }
  let p: BulkParams;
  try {
    p = JSON.parse(job.params) as BulkParams;
  } catch {
    await safeUpdate(aid, { bulkState: 'failed', bulkStage: '', bulkNote: 'ジョブ設定の解析に失敗', bulkClaimedAt: null });
    return;
  }

  try {
    // 1. 本文生成（auto は no-error 設計だが、DB切断/タイムアウト等は throw 相当で拾う）
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
    // 生成が簡易内容(degraded)なら、画像課金・空公開を避けて done（注記付き）。
    if (auto.data?.degraded) {
      await safeUpdate(aid, {
        bulkState: 'done',
        bulkStage: '',
        bulkNote: '生成が簡易内容のため画像・公開をスキップ（再生成推奨）',
        bulkClaimedAt: null,
      });
      return;
    }

    // 2. 画像（本文は完成済みなので画像が失敗しても続行＋注記）。
    //    デプロイ等の再起動で internal 接続が切れると、画像は実際に保存できているのに
    //    internalPost が ok=false を返し「生成に失敗」と誤表示される。これを避けるため、
    //    呼び出し後に DB の保存済み画像(eyecatch)を確認し、無ければ再試行する。
    //    generateImage は必ず1枚返す設計なので、ルートが完走していれば eyecatch は必ず存在する。
    let note: string | undefined;
    if (p.effImageMode !== 'none') {
      await setStage(aid, '画像');
      const scope = p.effImageMode === 'full' ? 'all' : 'eyecatch';
      let haveImage = false;
      let partialNote: string | undefined;
      for (let attempt = 0; attempt < 3 && !haveImage; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 4000));
        const img = await internalPost<{ error?: string; generated?: unknown[]; errors?: Array<{ error?: string }> }>(
          '/api/generate/images',
          { articleId: aid, scope },
        );
        const eye = await prisma.articleImage.count({ where: { articleId: aid, kind: 'eyecatch' } });
        if (eye > 0) {
          haveImage = true; // 画像は揃っている（接続切れで ok=false でも誤「失敗」にしない）
          // h2 の一部が取れなかった分だけ注記（後で backfill タイマーが本物へ補完）。
          if (img.ok && img.data?.errors && img.data.errors.length > 0) {
            partialNote = `画像: ${img.data.errors.length}枚は後で自動補完されます`;
          }
        }
        // eyecatch がまだ無い＝ルートが完走していない（再起動等）→ 次の試行へ
      }
      note = haveImage ? partialNote : '画像: 一時的に取得できませんでした（記事編集から再生成できます）';
    }

    // 3. WordPress公開（任意）
    let pub: string | undefined;
    let wpLink: string | undefined;
    if (p.wpPublish !== 'none') {
      await setStage(aid, '公開');
      const pr = await internalPost<{ error?: string; status?: string; link?: string; heldForPharma?: boolean }>(
        '/api/wordpress/publish',
        { articleId: aid, status: p.wpPublish, uploadImages: true, pharmaGate: true, requireImages: true },
      );
      if (!pr.ok) {
        pub = `公開失敗: ${pr.data?.error || `HTTP ${pr.status}`}`;
      } else {
        wpLink = pr.data?.link;
        if (pr.data?.heldForPharma) pub = '薬機法リスク高 → 下書き保留';
        else if (pr.data?.status === 'publish') pub = '公開済み';
        else pub = pr.data?.status === 'draft' ? '下書き保存' : `投稿(${pr.data?.status})`;
      }
    }

    await safeUpdate(aid, {
      bulkState: 'done',
      bulkStage: '',
      bulkNote: note ?? null,
      bulkPub: pub ?? null,
      bulkWpLink: wpLink ?? null,
      bulkClaimedAt: null,
    });
  } catch (e) {
    const msg = ((e as Error).message || 'unknown').slice(0, 300);
    const cur = await prisma.article.findUnique({ where: { id: aid }, select: { bulkAttempts: true } });
    const attempts = cur?.bulkAttempts ?? MAX_ATTEMPTS;
    // 上限未満なら pending に戻して再試行（このループ/watchdog が再度拾う）。上限なら failed 確定。
    await safeUpdate(
      aid,
      attempts >= MAX_ATTEMPTS
        ? { bulkState: 'failed', bulkStage: '', bulkNote: msg, bulkClaimedAt: null }
        : { bulkState: 'pending', bulkStage: '', bulkNote: `再試行待ち(${attempts}/${MAX_ATTEMPTS}): ${msg}`, bulkClaimedAt: null },
    );
  }
}

/**
 * 現在ステージを更新する。あわせて bulkClaimedAt を「いま」に更新（ハートビート）して、
 * 長い処理が本文→画像→公開と複数ステージにまたがっても、stall 窓が単一ステージ
 * （internalPost 1本の上限=30分）に収まるようにする。これがないと、本文20分＋画像3分＋公開3分
 * のような正常処理を watchdog が 35分の途中で stall 誤認して横取りしうる。
 */
async function setStage(aid: string, stage: string): Promise<void> {
  await prisma.article
    .update({ where: { id: aid }, data: { bulkStage: stage, bulkClaimedAt: new Date() } })
    .catch(() => {});
}

async function safeUpdate(aid: string, data: Record<string, unknown>): Promise<void> {
  await prisma.article.update({ where: { id: aid }, data }).catch(() => {});
}

/** 対象ジョブで未処理(pending/processing)が無くなっていれば done にする。 */
async function finalizeJobs(jobId?: string): Promise<void> {
  const jobs = await prisma.bulkJob.findMany({
    where: { status: 'running', ...(jobId ? { id: jobId } : {}) },
    select: { id: true, total: true },
  });
  for (const j of jobs) {
    const [remaining, totalArticles] = await Promise.all([
      prisma.article.count({
        where: { bulkJobId: j.id, bulkState: { in: ['pending', 'processing'] } },
      }),
      prisma.article.count({ where: { bulkJobId: j.id } }),
    ]);
    // watchdog(jobId なし)が、作成API の create(job)→createMany(articles) の隙間に走ると、
    // まだ記事0件の running ジョブを remaining===0 で誤って done 化しうる。
    // 実際に作成予定の記事(total)が出揃っている時だけ done 化してこれを防ぐ。
    if (remaining === 0 && totalArticles >= j.total) {
      await prisma.bulkJob.update({ where: { id: j.id }, data: { status: 'done' } }).catch(() => {});
    }
  }
}
