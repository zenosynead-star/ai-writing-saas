import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * 一括生成の緊急停止。ジョブを stopped にし、未着手(pending)の記事も stopped にする。
 * 処理中(processing)の記事は完了まで進む（プロセッサが次の claim 前にジョブ停止を見て止まる）。
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    const body = (await req.json().catch(() => ({}))) as { jobId?: string };
    const jobId = typeof body?.jobId === 'string' ? body.jobId : '';
    if (!jobId) return NextResponse.json({ error: 'jobId が必要です' }, { status: 400 });

    const job = await prisma.bulkJob.findFirst({ where: { id: jobId, userId: user.id } });
    if (!job) return NextResponse.json({ error: 'ジョブが見つかりません' }, { status: 404 });

    await prisma.bulkJob.update({ where: { id: jobId }, data: { status: 'stopped' } });
    await prisma.article.updateMany({
      where: { bulkJobId: jobId, bulkState: 'pending' },
      data: { bulkState: 'stopped', bulkStage: '' },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[bulk/stop]', err);
    return NextResponse.json({ error: 'サーバー内部エラー' }, { status: 500 });
  }
}
