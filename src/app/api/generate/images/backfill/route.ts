import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { generateImage } from '@/lib/imageGen';
import { z } from 'zod';

/**
 * 画像バックフィル: 「つなぎ」のプレースホルダー画像を、後から本物の AI 画像に自動差し替えする。
 *
 * 画像生成は generateImage が必ず1枚返す（最終フォールバック=ローカルのプレースホルダー）。
 * Vertex のクォータ超過(429)等でプレースホルダーになった画像は isPlaceholder=true で記録される。
 * このエンドポイントは後でそれらを再生成し、本物が取れたら DB を差し替える。
 * 公開済み(wpPostId あり)の記事は WP 投稿も更新して本物画像を反映する（best-effort）。
 *
 * 自動実行: VPS の systemd timer が定期的に POST する（Vertex クォータ回復後に自然に本物へ）。
 * 手動/特定記事: { articleId } 指定でその記事だけ。
 */
const Schema = z.object({
  articleId: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

function internalBase(): string {
  if (process.env.INTERNAL_BASE_URL) return process.env.INTERNAL_BASE_URL.replace(/\/$/, '');
  return `http://127.0.0.1:${process.env.PORT || '8008'}`;
}

/** 公開済み記事の WP 投稿を更新し、差し替えた本物画像を反映する（best-effort・現状ステータス維持）。 */
async function republish(articleId: string, status: string | null): Promise<boolean> {
  const body: Record<string, unknown> = { articleId, uploadImages: true, enhance: true, requireImages: false };
  if (status === 'publish' || status === 'draft' || status === 'future') body.status = status;
  const res = await fetch(`${internalBase()}/api/wordpress/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.ok;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    const parsed = Schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
    const { articleId, limit = 30 } = parsed.data;

    const placeholders = await prisma.articleImage.findMany({
      where: {
        isPlaceholder: true,
        article: { userId: user.id },
        ...(articleId ? { articleId } : {}),
      },
      include: { article: { select: { id: true, title: true, wpPostId: true, wpPostStatus: true } } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    let upgraded = 0;
    const toRepublish = new Map<string, { status: string | null }>();
    for (const ph of placeholders) {
      try {
        const img = await generateImage({
          prompt: ph.prompt,
          aspectRatio: '16:9',
          overlayTitle: ph.article.title || '',
        });
        // まだプレースホルダーしか取れない（クォータ未回復）なら据え置き、次回タイマーで再挑戦。
        if (img.modelUsed !== 'placeholder' && img.modelUsed !== 'placeholder-empty') {
          await prisma.articleImage.update({
            where: { id: ph.id },
            data: {
              dataBase64: img.base64,
              mimeType: img.mimeType,
              modelUsed: img.modelUsed,
              isPlaceholder: false,
            },
          });
          upgraded++;
          if (ph.article.wpPostId) toRepublish.set(ph.article.id, { status: ph.article.wpPostStatus });
        }
      } catch (e) {
        console.warn('[images/backfill] 再生成失敗:', (e as Error).message);
      }
    }

    // 公開済み記事は WP を更新して本物画像を反映（best-effort：失敗しても DB は差し替え済み）
    let republished = 0;
    for (const [aid, info] of toRepublish) {
      try {
        if (await republish(aid, info.status)) republished++;
      } catch (e) {
        console.warn('[images/backfill] 再公開失敗:', (e as Error).message);
      }
    }

    return NextResponse.json({
      scanned: placeholders.length,
      upgraded,
      republished,
      remaining: Math.max(0, placeholders.length - upgraded),
    });
  } catch (err) {
    console.error('[images/backfill]', err);
    return NextResponse.json({ error: 'サーバー内部エラー' }, { status: 500 });
  }
}

/** 残っているプレースホルダー画像数を返す（監視用）。 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    const count = await prisma.articleImage.count({
      where: { isPlaceholder: true, article: { userId: user.id } },
    });
    return NextResponse.json({ pendingPlaceholders: count });
  } catch (err) {
    console.error('[images/backfill GET]', err);
    return NextResponse.json({ error: 'サーバー内部エラー' }, { status: 500 });
  }
}
