import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { uploadMedia, createPost, setMediaAltText, WpError, type WpCredentials } from '@/lib/wordpress';
import { z } from 'zod';

const Schema = z.object({
  articleId: z.string(),
  connectionId: z.string().optional(),
  status: z.enum(['draft', 'publish', 'future']).optional(),
  /** ISO8601 (status='future' で予約投稿) */
  publishAt: z.string().optional(),
  /** 画像を WordPress にアップロード→本文の <img src> を新URLに置換するか */
  uploadImages: z.boolean().default(true),
});

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    const parsed = Schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
    const { articleId, connectionId, status, publishAt, uploadImages } = parsed.data;

    const article = await prisma.article.findFirst({
      where: { id: articleId, userId: user.id },
      include: { headings: { where: { level: 2 }, orderBy: { order: 'asc' } }, articleImages: true },
    });
    if (!article) return NextResponse.json({ error: 'Article not found' }, { status: 404 });
    if (!article.bodyHtml) return NextResponse.json({ error: '本文が未生成です' }, { status: 400 });

    // 接続情報取得（指定 or default）
    const conn = connectionId
      ? await prisma.wpConnection.findFirst({ where: { id: connectionId, userId: user.id } })
      : await prisma.wpConnection.findFirst({ where: { userId: user.id, isDefault: true } });
    if (!conn) {
      return NextResponse.json({ error: 'WordPress 接続が設定されていません' }, { status: 400 });
    }
    const creds: WpCredentials = {
      siteUrl: conn.siteUrl,
      username: conn.username,
      appPassword: conn.appPassword,
    };

    let bodyHtml = article.bodyHtml;
    let featuredMediaId: number | undefined;

    if (uploadImages) {
      // アイキャッチをアップロード
      const eyecatch = article.articleImages.find((i) => i.kind === 'eyecatch');
      if (eyecatch) {
        const m = await uploadMedia(creds, {
          filename: `eyecatch-${article.id}.png`,
          mimeType: eyecatch.mimeType,
          dataBase64: eyecatch.dataBase64,
          altText: article.title,
        });
        await setMediaAltText(creds, m.id, article.title).catch(() => {});
        featuredMediaId = m.id;
      }

      // h2 画像をアップロードして本文に挿入
      const h2Imgs = article.articleImages
        .filter((i) => i.kind === 'h2' && typeof i.h2Index === 'number')
        .sort((a, b) => (a.h2Index ?? 0) - (b.h2Index ?? 0));
      if (h2Imgs.length > 0) {
        const h2Pattern = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
        let h2Idx = 0;
        const replacements: Array<{ matchIndex: number; imageUrl: string; alt: string }> = [];
        let m: RegExpExecArray | null;
        while ((m = h2Pattern.exec(bodyHtml)) !== null) {
          const img = h2Imgs.find((x) => x.h2Index === h2Idx);
          if (img) {
            const uploaded = await uploadMedia(creds, {
              filename: `h2-${article.id}-${h2Idx}.png`,
              mimeType: img.mimeType,
              dataBase64: img.dataBase64,
              altText: (m[1] || '').replace(/<[^>]+>/g, '').trim(),
            });
            replacements.push({ matchIndex: m.index, imageUrl: uploaded.sourceUrl, alt: (m[1] || '').replace(/<[^>]+>/g, '').trim() });
          }
          h2Idx++;
        }
        // 後ろから挿入（インデックスがずれないように）
        for (let i = replacements.length - 1; i >= 0; i--) {
          const r = replacements[i];
          const imgTag = `<figure class="wp-block-image size-large"><img src="${r.imageUrl}" alt="${r.alt}" /></figure>\n`;
          bodyHtml = bodyHtml.slice(0, r.matchIndex) + imgTag + bodyHtml.slice(r.matchIndex);
        }
      } else {
        // 既存の data: URL や /api/images/{id} を含む img タグはそのまま渡すと WP では表示されない可能性。
        // ここでは単純化してbodyHtmlをそのまま投稿
      }
    }

    // 記事投稿
    const post = await createPost(creds, {
      title: article.title,
      content: bodyHtml,
      excerpt: article.metaDescription || undefined,
      status: status || (conn.defaultStatus as 'draft' | 'publish' | 'future'),
      featuredMediaId,
      date: publishAt,
    });

    await prisma.article.update({
      where: { id: articleId },
      data: { wpPostId: post.id, wpPostStatus: post.status },
    });

    return NextResponse.json({
      ok: true,
      postId: post.id,
      link: post.link,
      status: post.status,
    });
  } catch (err) {
    if (err instanceof WpError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    console.error('[wordpress/publish]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
