import { NextRequest, NextResponse } from 'next/server';
import { runBulkProcessor, isBulkProcessing } from '@/lib/bulkProcessor';

/**
 * 一括生成ジョブの処理を起動する。
 *  - body { jobId } : そのジョブを処理（一括作成APIが fire-and-forget で叩く）
 *  - body 無し       : 全 running ジョブの pending/stall を処理（watchdog systemd timer が叩く）
 *
 * 処理はバックグラウンドで走らせ、応答は即返す（pm2 永続プロセスで継続）。
 * 途中でプロセスが死んでも watchdog timer が pending/stall を拾って自動再開する。
 * 認証は付けない（systemd timer の curl から叩くため。getCurrentUser=default-user 運用）。
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { jobId?: string };
  const jobId = typeof body?.jobId === 'string' && body.jobId ? body.jobId : undefined;
  void runBulkProcessor(jobId).catch((e) => console.error('[bulk/process]', e));
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ processing: isBulkProcessing() });
}
