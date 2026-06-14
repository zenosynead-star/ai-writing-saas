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
import { CATEGORY_PICK_PROMPT, PHARMA_CHECK_PROMPT } from '@/lib/prompts';
import { z } from 'zod';

const Schema = z.object({
  articleId: z.string(),
  connectionId: z.string().optional(),
  status: z.enum(['draft', 'publish', 'future']).optional(),
  /** ISO8601 (status='future' で予約投稿) */
  publishAt: z.string().optional(),
  /** 画像を WordPress にアップロード→本文の <img src> を新URLに置換するか */
  uploadImages: z.boolean().default(true),
  /** status='publish' でも薬機法リスク high なら draft に降格して保留する */
  pharmaGate: z.boolean().optional().default(false),
  /** 画像が1枚も無い場合は公開を中止する（「必ず画像を入れる」運用） */
  requireImages: z.boolean().optional().default(false),
});

/** 記事の薬機法リスクを返す ('low'|'mid'|'high'|'unknown')。既存結果を優先し、無ければ薬機法チェックを実行。 */
async function assessPharmaRisk(articleId: string, bodyHtml: string, existing: string | null): Promise<string> {
  if (existing) {
    try {
      const j = JSON.parse(existing) as { risk_level?: string };
      if (j?.risk_level) return String(j.risk_level).toLowerCase();
    } catch {
      /* 壊れた既存結果は無視して再チェック */
    }
  }
  try {
    const res = await generate({
      logicalModel: 'low_cost',
      taskType: 'advice',
      system: BASE_SYSTEM,
      user: PHARMA_CHECK_PROMPT({ articleHtml: bodyHtml }),
      maxTokens: 3000,
      jsonMode: true,
    });
    const j = extractJson<{ risk_level?: string }>(res.content);
    await prisma.article
      .update({ where: { id: articleId }, data: { pharmaCheckJson: JSON.stringify(j) } })
      .catch(() => {});
    return String(j.risk_level || 'low').toLowerCase();
  } catch (e) {
    console.warn('[wordpress/publish] pharma-check 実行失敗 → unknown:', (e as Error).message);
    return 'unknown';
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    const parsed = Schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
    const { articleId, connectionId, status, publishAt, uploadImages, pharmaGate, requireImages } = parsed.data;

    const article = await prisma.article.findFirst({
      where: { id: articleId, userId: user.id },
      include: { headings: { where: { level: 2 }, orderBy: { order: 'asc' } }, articleImages: true },
    });
    if (!article) return NextResponse.json({ error: 'Article not found' }, { status: 404 });
    if (!article.bodyHtml) return NextResponse.json({ error: '本文が未生成です' }, { status: 400 });

    // 画像必須: 1枚も無ければ公開しない（「必ず画像を入れる」運用）
    if (requireImages && !article.articleImages.some((i) => i.kind === 'eyecatch' || i.kind === 'h2')) {
      return NextResponse.json(
        { error: '画像が無いため公開を中止しました（画像を生成してから公開してください）' },
        { status: 400 },
      );
    }

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

    // ===== 薬機法ゲート: 即公開希望でも risk=high なら draft に降格して保留 =====
    let effectiveStatus: 'draft' | 'publish' | 'future' =
      status || (conn.defaultStatus as 'draft' | 'publish' | 'future');
    let heldForPharma = false;
    if (pharmaGate && effectiveStatus === 'publish') {
      const risk = await assessPharmaRisk(article.id, article.bodyHtml, article.pharmaCheckJson);
      if (risk === 'high') {
        effectiveStatus = 'draft';
        heldForPharma = true;
        console.warn(`[wordpress/publish] 薬機法リスク高 → 下書き保留 article=${articleId}`);
      }
    }

    // 記事投稿
    const post = await createPost(creds, {
      title: article.title,
      content: bodyHtml,
      excerpt: article.metaDescription || undefined,
      status: effectiveStatus,
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
      heldForPharma,
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
