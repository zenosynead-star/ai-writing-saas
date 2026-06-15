import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * 直近の「実行中(running)」一括ジョブの jobId を返す。
 * localStorage に jobId が無くても（更新後・別端末・別ブラウザ）、/articles/bulk を開けば
 * 進行中のキューを必ず再表示できるようにするためのフォールバック。
 * 実行中が無ければ jobId=null（＝完了済みジョブを勝手に再表示しない＝クリーンなフォーム）。
 */
// 引数なし GET なので、ビルド時に prerender されて jobId が固定キャッシュ（常に null）に
// ならないよう、毎回サーバーで評価させる（internal-links と同じ作法）。
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await getCurrentUser();
    const running = await prisma.bulkJob.findFirst({
      where: { userId: user.id, status: 'running' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    return NextResponse.json({ jobId: running?.id ?? null });
  } catch (err) {
    console.error('[bulk/latest]', err);
    return NextResponse.json({ jobId: null });
  }
}
