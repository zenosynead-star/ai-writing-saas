import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  uploadMedia,
  createPost,
  updatePost,
  setMediaAltText,
  listCategories,
  resolveTagIds,
  WpError,
  type WpCredentials,
} from '@/lib/wordpress';
import { stripExistingH2Images } from '@/lib/imageEmbed';
import { generateImage } from '@/lib/imageGen';
import { generate, extractJson, BASE_SYSTEM } from '@/lib/llm';
import { CATEGORY_PICK_PROMPT, PHARMA_CHECK_PROMPT } from '@/lib/prompts';
import { requestIndexing } from '@/lib/indexing';
import { prependStyleBlock } from '@/lib/articleEnhance/styles';
import { insertFunnelCards } from '@/lib/articleEnhance/relatedCards';
import { insertProductCards } from '@/lib/articleEnhance/productCards';
import { pickProductId } from '@/lib/productRules';
import { normalizeForWpautop } from '@/lib/articleEnhance/wpautop';
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
  /** 公開前に記事品質強化（デザインCSS/商品カード/関連記事/見出し画像）を適用するか */
  enhance: z.boolean().optional().default(true),
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
    const { articleId, connectionId, status, publishAt, uploadImages, pharmaGate, requireImages, enhance } =
      parsed.data;

    const article = await prisma.article.findFirst({
      where: { id: articleId, userId: user.id },
      include: { headings: { where: { level: 2 }, orderBy: { order: 'asc' } }, articleImages: true },
    });
    if (!article) return NextResponse.json({ error: 'Article not found' }, { status: 404 });
    if (!article.bodyHtml) return NextResponse.json({ error: '本文が未生成です' }, { status: 400 });

    // 本文が極端に短い（＝自動生成のフォールバック・スケルトンしか入っていない）記事は公開しない。
    // 生成APIは「エラーを出さず最後まで」方針で degraded でも completed 保存するため、
    // 中身の無い記事が自動公開フローでそのまま本番公開される事故を公開段で防ぐ。
    const MIN_PUBLISH_CHARS = 1200;
    const plainBodyLen = article.bodyHtml.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().length;
    if (plainBodyLen < MIN_PUBLISH_CHARS) {
      return NextResponse.json(
        {
          error: `本文の生成が不完全なため公開を中止しました（本文約${plainBodyLen}文字）。再生成してから公開してください。`,
          degraded: true,
        },
        { status: 400 },
      );
    }

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

      // placeholder(手抜き画像)は WP に出さない。本物の h2 画像のみアップロード&挿入する
      // （backfill が本物化したら、次回公開でこの経路に乗って挿入される）。
      const h2Imgs = article.articleImages
        .filter((i) => i.kind === 'h2' && typeof i.h2Index === 'number' && !i.isPlaceholder)
        .sort((a, b) => (a.h2Index ?? 0) - (b.h2Index ?? 0));
      if (h2Imgs.length > 0) {
        // h2 ごとに事前にメディアアップロード(直列、Pollinations 同様WPサーバの並列負荷も考慮)
        const uploadedByH2Index = new Map<number, { url: string; alt: string }>();
        for (const img of h2Imgs) {
          const idx = img.h2Index ?? 0;
          const altText = `${article.title} - セクション${idx + 1}`;
          // 容量対策で公開後に base64 を空にした記事の再公開/バックフィル時は、
          // 保存済みプロンプトから画像を作り直してからアップロードする（再公開を壊さない）。
          let b64 = img.dataBase64;
          let mime = img.mimeType;
          if (!b64) {
            try {
              const re = await generateImage({ prompt: img.prompt, aspectRatio: '16:9', overlayTitle: altText });
              // 再生成でも本物が取れず placeholder 止まりなら、WP には出さず isPlaceholder を立て直す。
              // (公開後に base64 をクリアすると後段の updateMany 後は isPlaceholder=false のまま
              //  残るため、立て直さないと backfill タイマーが拾えず手抜き画像が WP に固定される)
              const stillPlaceholder = re.modelUsed === 'placeholder' || re.modelUsed === 'placeholder-empty';
              if (stillPlaceholder) {
                if (!img.isPlaceholder) {
                  await prisma.articleImage
                    .update({ where: { id: img.id }, data: { isPlaceholder: true } })
                    .catch(() => {});
                }
                // b64 は空のまま → 下の continue でこの h2 はスキップ（backfill が後で本物化）
              } else {
                b64 = re.base64;
                mime = re.mimeType;
              }
            } catch (e) {
              console.warn('[wordpress/publish] h2画像 再生成失敗:', (e as Error).message);
            }
          }
          if (!b64) continue; // 画像が無い / placeholder 止まりならこの h2 はスキップ
          const uploaded = await uploadMedia(creds, {
            filename: `h2-${article.id}-${idx}.${(mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg')}`,
            mimeType: mime,
            dataBase64: b64,
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
          return `${match}\n<figure class="ne-heading-image" data-ne-heading-image="auto"><img src="${up.url}" alt="${safeAlt.replace(/"/g, '&quot;')}" loading="lazy" decoding="async" /></figure>\n`;
        });
      }
    }

    // ===== タグ自動: 記事のターゲットKW全体を「半角スペース連結の1タグ」にしてWPタグに =====
    // 例: ["ゲーミングチェア","買取"] → 1タグ「ゲーミングチェア 買取」。
    // 読点や全角スペースの半角スペース化は resolveTagIds 側で行う（空要素は内部でスキップ）。
    const keywords = JSON.parse(article.keywords || '[]') as string[];
    let tagIds: number[] = [];
    if (keywords.length > 0) {
      tagIds = await resolveTagIds(creds, [keywords.join(' ')]).catch(() => []);
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

    // ===== 記事品質強化: デザインCSS（cv2026）を記事冒頭に注入（公開段=sanitize後なので保持される）=====
    // Stage 2/3 で商品カード・関連記事ファネルもこの前段で bodyHtml に挿入していく。
    if (enhance) {
      // おすすめ商品ルールで推奨商品を決定（生成時に確定済みなら優先、無ければ公開先サイトのルールで解決）
      let productId: string | null = article.featuredProductId || null;
      if (!productId) {
        try {
          const rules = await prisma.productRule.findMany({ where: { wpConnectionId: conn.id } });
          productId = pickProductId({
            keywords,
            title: article.title,
            rules: rules.map((r) => ({ keyword: r.keyword, productId: r.productId, enabled: r.enabled, order: r.order })),
            defaultProductId: conn.defaultProductId,
          });
        } catch (e) {
          console.warn('[wordpress/publish] product rule resolution skipped:', (e as Error).message);
        }
      }
      // 商品カード（ルール選定商品を優先、無ければ商品マスター言及検出）を挿入
      bodyHtml = insertProductCards(bodyHtml, { productId: productId || undefined });
      // 関連記事ファネル（マネーページ/中間ページへの関連カード）を挿入
      bodyHtml = insertFunnelCards(bodyHtml, { keywords, title: article.title });
      // デザインCSS <style> を記事冒頭へ（カード類の後＝CSSが最上部に来る）
      bodyHtml = prependStyleBlock(bodyHtml);
      // 最後に wpautop 相当の正規化（WP の wpautop がカード/figure を <p> 化して壊すのを防ぐ・冪等）
      bodyHtml = normalizeForWpautop(bodyHtml);
    }

    // 記事投稿: 既に WP 記事がある（wpPostId）なら更新、無ければ新規作成（再公開での重複を防ぐ）
    const postInput = {
      title: article.title,
      content: bodyHtml,
      excerpt: article.metaDescription || undefined,
      status: effectiveStatus,
      featuredMediaId,
      categories: categoryIds.length ? categoryIds : undefined,
      tags: tagIds.length ? tagIds : undefined,
      date: publishAt,
    };
    const post = article.wpPostId
      ? await updatePost(creds, article.wpPostId, postInput)
      : await createPost(creds, postInput);

    await prisma.article.update({
      where: { id: articleId },
      data: { wpPostId: post.id, wpPostStatus: post.status },
    });

    // ===== 容量対策: 公開済みの h2 画像は WP 側に存在するので、DB の base64 を空にして肥大化を防ぐ =====
    // (アイキャッチは記事一覧のサムネ用に保持。再公開/バックフィル時は上の h2 処理が base64 を作り直す。)
    // Neon の容量上限(画像base64が主因で512MB到達)対策。失敗しても公開は成功扱い。
    if (uploadImages) {
      await prisma.articleImage
        .updateMany({ where: { articleId, kind: 'h2' }, data: { dataBase64: '' } })
        .catch(() => {});
    }

    // 公開時のみ Google Indexing API に即通知（ソフト・失敗しても公開は成功扱い）
    let indexRequested = false;
    if (effectiveStatus === 'publish' && post.link) {
      const idx = await requestIndexing(post.link);
      indexRequested = idx.ok;
      if (!idx.ok && !idx.skipped) console.warn('[wordpress/publish] indexing 失敗:', idx.message);
    }

    return NextResponse.json({
      ok: true,
      postId: post.id,
      link: post.link,
      status: post.status,
      heldForPharma,
      indexRequested,
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
