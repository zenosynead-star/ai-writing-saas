import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { generateImage } from '@/lib/imageGen';
import { embedH2Images, countH2 } from '@/lib/imageEmbed';
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

/**
 * SaaSアプリ内プレビュー用の本文(bodyHtml の /api/images figure)を、現在の「本物」h2画像で
 * 入れ直す。embedH2Images は既存 figure を一旦全削除してから本物のみ挿入するので、
 * backfill で placeholder→本物 になった画像がアプリ内表示にも反映される（best-effort）。
 */
async function reembedBody(articleId: string): Promise<void> {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { bodyHtml: true },
  });
  if (!article?.bodyHtml || countH2(article.bodyHtml) === 0) return;
  const h2imgs = await prisma.articleImage.findMany({
    where: { articleId, kind: 'h2', isPlaceholder: false },
    orderBy: { h2Index: 'asc' },
    select: { id: true, h2Index: true },
  });
  const refs = h2imgs.map((i) => ({ id: i.id, h2Index: i.h2Index ?? 0 }));
  const newBody = embedH2Images(article.bodyHtml, refs);
  if (newBody !== article.bodyHtml) {
    await prisma.article.update({ where: { id: articleId }, data: { bodyHtml: newBody } });
  }
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
    // 既定は控えめ(15)。同時実行中の一括生成と競合して pooler/WP を圧迫しないため。
    const { articleId, limit = 15 } = parsed.data;

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
    const upgradedArticles = new Set<string>();
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
          upgradedArticles.add(ph.article.id);
          if (ph.article.wpPostId) toRepublish.set(ph.article.id, { status: ph.article.wpPostStatus });
        }
      } catch (e) {
        console.warn('[images/backfill] 再生成失敗:', (e as Error).message);
      }
      // pooler/WP を圧迫しないよう各項目の間に小休止（同時実行中の一括生成と競合させない）
      await new Promise((r) => setTimeout(r, 1500));
    }

    // 本物化した記事はアプリ内プレビュー本文も入れ直す（WP は下の republish で反映）
    for (const aid of upgradedArticles) {
      try {
        await reembedBody(aid);
      } catch (e) {
        console.warn('[images/backfill] 本文再挿入失敗:', (e as Error).message);
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
      // 各再公開(WP更新)の間にも小休止して WP/pooler 負荷を分散
      await new Promise((r) => setTimeout(r, 2000));
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
