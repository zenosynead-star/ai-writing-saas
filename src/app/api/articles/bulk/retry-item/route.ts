import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { internalPost } from '@/lib/internalFetch';

/**
 * 一括生成の1記事だけを手動で再実行する（エラー行の「再実行」ボタン用）。
 *  - 公開だけ失敗（本文・画像は出来ている）→ bulkState='generated' にして再公開のみ。
 *  - 生成が不完全/失敗（本文が無い・簡易内容・生成失敗）→ bulkState='pending' にして本文から作り直し。
 * いずれも bulkAttempts/注記をリセットし、ジョブを running に戻してプロセッサを起動する。
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    const body = (await req.json().catch(() => ({}))) as { articleId?: string };
    const articleId = typeof body?.articleId === 'string' ? body.articleId : '';
    if (!articleId) return NextResponse.json({ error: 'articleId が必要です' }, { status: 400 });

    const article = await prisma.article.findFirst({
      where: { id: articleId, userId: user.id },
      select: { id: true, bulkJobId: true, bulkPub: true, bulkState: true, bodyHtml: true },
    });
    if (!article) return NextResponse.json({ error: '記事が見つかりません' }, { status: 404 });
    if (!article.bulkJobId) return NextResponse.json({ error: '一括ジョブに属していません' }, { status: 400 });

    // 既に処理中(生成中/公開中/公開待ち)なら再投入しない（連打やUIの表示遅延での二重処理を防ぐ）。
    // 再実行できるのは「終端」した行＝failed / done(公開失敗注記付き含む) のみ。
    if (
      article.bulkState === 'processing' ||
      article.bulkState === 'publishing' ||
      article.bulkState === 'generated' ||
      article.bulkState === 'pending'
    ) {
      return NextResponse.json({ ok: true, mode: 'already_active', jobId: article.bulkJobId });
    }

    // ジョブ設定（公開する設定か＝画像が必須か）を読む。
    const job = await prisma.bulkJob.findUnique({ where: { id: article.bulkJobId }, select: { params: true } });
    let needsImage = false; // wpPublish 有効時は公開に画像(eyecatch/h2)が必須
    if (job) {
      try {
        const p = JSON.parse(job.params) as { wpPublish?: string };
        needsImage = p.wpPublish === 'draft' || p.wpPublish === 'publish';
      } catch {
        /* params 壊れは needsImage=false 扱い（pending で作り直す方に倒れる） */
      }
    }

    // 公開だけ失敗（本文・画像は生成済み）なら再公開のみ。それ以外は本文から作り直し。
    // ただし公開に画像が必須なのに画像が1枚も無い場合は、generated に戻しても publish が
    // requireImages で再び失敗し「再公開ループ」になるので、pending で本文＋画像から作り直す。
    const publishFailedAfterBody =
      (article.bulkPub || '').startsWith('公開失敗') && !!article.bodyHtml && article.bodyHtml.length > 200;
    const hasImage = needsImage
      ? (await prisma.articleImage.count({ where: { articleId, kind: { in: ['eyecatch', 'h2'] } } })) > 0
      : true;
    const publishFailedButGenerated = publishFailedAfterBody && hasImage;
    const nextState = publishFailedButGenerated ? 'generated' : 'pending';

    // 終端状態(failed/done/stopped)からのみ遷移させる楽観ロック。プリチェック後に別経路で
    // 処理中へ変わった場合(TOCTOU)は count=0 になり二重投入を防ぐ。
    const moved = await prisma.article.updateMany({
      where: { id: articleId, bulkState: { in: ['failed', 'done', 'stopped'] } },
      data: {
        bulkState: nextState,
        bulkStage: nextState === 'generated' ? '公開待ち' : '',
        bulkAttempts: 0,
        bulkNote: null,
        bulkPub: null,
        bulkWpLink: null,
        bulkClaimedAt: null,
      },
    });
    if (moved.count !== 1) {
      // 直前に処理が始まった等で遷移できなかった → 二重投入せずそのまま継続扱い。
      return NextResponse.json({ ok: true, mode: 'already_active', jobId: article.bulkJobId });
    }

    // ジョブが done/stopped でもこの記事を処理できるよう running に戻す。
    await prisma.bulkJob.update({ where: { id: article.bulkJobId }, data: { status: 'running' } }).catch(() => {});

    // プロセッサ起動（即応答・バックグラウンド処理）。
    await internalPost('/api/articles/bulk/process', { jobId: article.bulkJobId }).catch(() => {});

    return NextResponse.json({ ok: true, mode: nextState === 'generated' ? 'republish' : 'regenerate', jobId: article.bulkJobId });
  } catch (err) {
    console.error('[bulk/retry-item]', err);
    return NextResponse.json({ error: 'サーバー内部エラー' }, { status: 500 });
  }
}
