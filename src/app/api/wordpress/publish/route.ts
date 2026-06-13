import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  uploadMedia,
  createPost,
  setMediaAltText,
  listCategories,
  resolveTagIds,
  WpError,
  type WpCredentials,
} from '@/lib/wordpress';
import { stripExistingH2Images } from '@/lib/imageEmbed';
import { generate, extractJson, BASE_SYSTEM } from '@/lib/llm';
import { CATEGORY_PICK_PROMPT } from '@/lib/prompts';
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
      // bodyHtmlには既に /api/images/{id} を指す<figure>が埋め込まれている可能性があるので、
      // 一度全部削除してから WP のメディアURLで挿入し直す
      bodyHtml = stripExistingH2Images(bodyHtml);

      const h2Imgs = article.articleImages
        .filter((i) => i.kind === 'h2' && typeof i.h2Index === 'number')
        .sort((a, b) => (a.h2Index ?? 0) - (b.h2Index ?? 0));
      if (h2Imgs.length > 0) {
        // h2 ごとに事前にメディアアップロード(直列、Pollinations 同様WPサーバの並列負荷も考慮)
        const uploadedByH2Index = new Map<number, { url: string; alt: string }>();
        for (const img of h2Imgs) {
          const idx = img.h2Index ?? 0;
          const altText = `${article.title} - セクション${idx + 1}`;
          const uploaded = await uploadMedia(creds, {
            filename: `h2-${article.id}-${idx}.${(img.mimeType.split('/')[1] || 'jpg').replace('jpeg', 'jpg')}`,
            mimeType: img.mimeType,
            dataBase64: img.dataBase64,
            altText,
          });
          uploadedByH2Index.set(idx, { url: uploaded.sourceUrl, alt: altText });
        }

        // h2 タグの直後に WP用 <figure> を挿入
        let h2Idx = 0;
        bodyHtml = bodyHtml.replace(/(<h2\b[^>]*>([\s\S]*?)<\/h2>)/gi, (match, _full, inner) => {
          const up = uploadedByH2Index.get(h2Idx);
          h2Idx++;
          if (!up) return match;
          const safeAlt = (inner as string).replace(/<[^>]+>/g, '').trim() || up.alt;
          return `${match}\n<figure class="wp-block-image size-large"><img src="${up.url}" alt="${safeAlt.replace(/"/g, '&quot;')}" /></figure>\n`;
        });
      }
    }

    // ===== タグ自動: 記事のターゲットKWをWPタグに =====
    const keywords = JSON.parse(article.keywords || '[]') as string[];
    let tagIds: number[] = [];
    if (keywords.length > 0) {
      tagIds = await resolveTagIds(creds, keywords).catch(() => []);
    }

    // ===== カテゴリ自動: 既存カテゴリからLLMが最適なものを選定 =====
    let categoryIds: number[] = [];
    try {
      const cats = await listCategories(creds);
      // WPデフォルトの「未分類/Uncategorized」は選択肢から除外
      const selectable = cats.filter((c) => !/^(未分類|uncategorized)$/i.test(c.name));
      if (selectable.length > 0) {
        const res = await generate({
          logicalModel: 'low_cost',
          taskType: 'llmo_parse',
          system: BASE_SYSTEM,
          user: CATEGORY_PICK_PROMPT({ title: article.title, keywords, categories: selectable }),
          maxTokens: 500,
          jsonMode: true,
        });
        const picked = extractJson<{ category_ids: number[] }>(res.content);
        const valid = new Set(selectable.map((c) => c.id));
        categoryIds = (picked.category_ids || []).filter((id) => valid.has(id)).slice(0, 2);
      }
    } catch (e) {
      console.warn('[wordpress/publish] category auto-assign skipped:', (e as Error).message);
    }

    // 記事投稿
    const post = await createPost(creds, {
      title: article.title,
      content: bodyHtml,
      excerpt: article.metaDescription || undefined,
      status: status || (conn.defaultStatus as 'draft' | 'publish' | 'future'),
      featuredMediaId,
      categories: categoryIds.length ? categoryIds : undefined,
      tags: tagIds.length ? tagIds : undefined,
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
      tagsSet: tagIds.length,
      categoriesSet: categoryIds.length,
    });
  } catch (err) {
    if (err instanceof WpError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    console.error('[wordpress/publish]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
