import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * 一括生成ジョブの進捗を返す（クライアントがポーリング）。?jobId=... 指定。
 * 画面を更新/離脱しても、jobId さえ控えていればここから状態を復元できる。
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    const jobId = req.nextUrl.searchParams.get('jobId');
    if (!jobId) return NextResponse.json({ error: 'jobId が必要です' }, { status: 400 });

    const job = await prisma.bulkJob.findFirst({ where: { id: jobId, userId: user.id } });
    if (!job) return NextResponse.json({ error: 'ジョブが見つかりません' }, { status: 404 });

    const arts = await prisma.article.findMany({
      where: { bulkJobId: jobId },
      select: {
        id: true,
        title: true,
        keywords: true,
        bulkState: true,
        bulkStage: true,
        bulkNote: true,
        bulkPub: true,
        bulkWpLink: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const items = arts.map((a) => {
      let kw = '';
      try {
        const k = JSON.parse(a.keywords || '[]');
        if (Array.isArray(k)) kw = k.join(' ');
      } catch {
        /* ignore */
      }
      return {
        articleId: a.id,
        keyword: kw,
        title: a.title || undefined,
        state: a.bulkState || 'pending',
        stage: a.bulkStage || '',
        note: a.bulkNote || undefined,
        pub: a.bulkPub || undefined,
        wpLink: a.bulkWpLink || undefined,
      };
    });

    let skipped: unknown[] = [];
    try {
      const s = JSON.parse(job.skipped || '[]');
      if (Array.isArray(s)) skipped = s;
    } catch {
      skipped = [];
    }

    const counts = {
      total: job.total,
      done: items.filter((i) => i.state === 'done').length,
      failed: items.filter((i) => i.state === 'failed').length,
      processing: items.filter((i) => i.state === 'processing').length,
      pending: items.filter((i) => i.state === 'pending').length,
      stopped: items.filter((i) => i.state === 'stopped').length,
    };

    return NextResponse.json({
      job: { id: job.id, status: job.status, total: job.total },
      items,
      skipped,
      counts,
    });
  } catch (err) {
    console.error('[bulk/status]', err);
    return NextResponse.json({ error: 'サーバー内部エラー' }, { status: 500 });
  }
}
