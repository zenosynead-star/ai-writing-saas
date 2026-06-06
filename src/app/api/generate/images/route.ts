import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  generateImage,
  buildEyecatchPrompt,
  buildH2Prompt,
  buildOptimizedImagePrompts,
  ImageGenError,
} from '@/lib/imageGen';
import { embedH2Images, countH2 } from '@/lib/imageEmbed';
import { z } from 'zod';

const Schema = z.object({
  articleId: z.string(),
  scope: z.enum(['all', 'eyecatch', 'h2']).default('all'),
  /** scope='h2' のとき、特定の h2 だけ生成する場合の index */
  h2Index: z.number().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    const parsed = Schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
    }
    const { articleId, scope, h2Index } = parsed.data;

    const article = await prisma.article.findFirst({
      where: { id: articleId, userId: user.id },
      include: { headings: { where: { level: 2 }, orderBy: { order: 'asc' } } },
    });
    if (!article) return NextResponse.json({ error: 'Article not found' }, { status: 404 });
    if (!article.title) {
      return NextResponse.json({ error: 'タイトルが未設定です' }, { status: 400 });
    }

    const keywords = JSON.parse(article.keywords || '[]') as string[];
    const generated: Array<{ id: string; kind: string; h2Index: number | null }> = [];
    const errors: Array<{ kind: string; h2Index?: number; error: string }> = [];

    // 本文 HTML から h2 と各 h2 直下本文を抽出 (画像プロンプトのコンテキスト化のため)
    type Section = { text: string; body: string };
    const sectionsFromBody: Section[] = [];
    let leadBody = '';
    if (article.bodyHtml) {
      const html = article.bodyHtml;
      // 先頭〜最初の h2 までを leadBody とみなす
      const firstH2 = html.search(/<h2\b/i);
      const head = firstH2 > 0 ? html.slice(0, firstH2) : html.slice(0, 2000);
      leadBody = stripTags(head).slice(0, 800);

      // 各 h2 の見出しと、直下から次の h2 までの本文を切り出す
      const h2Re = /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi;
      const matches: Array<{ text: string; start: number; end: number }> = [];
      let m: RegExpExecArray | null;
      while ((m = h2Re.exec(html)) !== null) {
        matches.push({
          text: stripTags(m[1] || ''),
          start: m.index,
          end: m.index + m[0].length,
        });
      }
      for (let i = 0; i < matches.length; i++) {
        const cur = matches[i];
        const next = matches[i + 1];
        const sectionHtml = html.slice(cur.end, next ? next.start : html.length);
        sectionsFromBody.push({
          text: cur.text,
          body: stripTags(sectionHtml).slice(0, 600),
        });
      }
    }

    // headings テーブルしかない場合のフォールバック
    const allSections: Section[] = sectionsFromBody.length > 0
      ? sectionsFromBody
      : article.headings.map((h) => ({ text: h.text, body: '' }));
    const allH2Texts = allSections.map((s) => s.text);

    // 個別 h2 指定でも AI 最適化プロンプトを使う(本文反映のため)
    // 全 h2 のコンテキストで一括計算して、指定 index だけ使う方式
    const useOptimized = allH2Texts.length > 0;
    let prompts: { eyecatch: string; h2: string[] };
    if (useOptimized) {
      prompts = await buildOptimizedImagePrompts({
        title: article.title,
        keywords,
        h2Sections: allSections,
        leadBody,
      });
    } else {
      // フォールバック: テンプレート
      prompts = {
        eyecatch: buildEyecatchPrompt({ title: article.title, keywords }),
        h2: allH2Texts.map((t) => buildH2Prompt({ h2Text: t, articleTitle: article.title })),
      };
    }

    // アイキャッチ
    if (scope === 'all' || scope === 'eyecatch') {
      try {
        await prisma.articleImage.deleteMany({ where: { articleId, kind: 'eyecatch' } });
        const img = await generateImage({
          prompt: prompts.eyecatch,
          aspectRatio: '16:9',
          overlayTitle: article.title,
        });
        const saved = await prisma.articleImage.create({
          data: {
            articleId,
            kind: 'eyecatch',
            h2Index: null,
            mimeType: img.mimeType,
            dataBase64: img.base64,
            prompt: prompts.eyecatch,
            modelUsed: img.modelUsed,
          },
        });
        await prisma.article.update({
          where: { id: articleId },
          data: { featuredImageId: saved.id },
        });
        generated.push({ id: saved.id, kind: 'eyecatch', h2Index: null });
      } catch (e) {
        errors.push({ kind: 'eyecatch', error: (e as Error).message });
      }
    }

    // h2 見出し画像
    if (scope === 'all' || scope === 'h2') {
      const targetIndexes = h2Index !== undefined
        ? [h2Index]
        : allH2Texts.map((_, i) => i);

      for (const idx of targetIndexes) {
        if (idx < 0 || idx >= allH2Texts.length) continue;
        try {
          await prisma.articleImage.deleteMany({ where: { articleId, kind: 'h2', h2Index: idx } });
          const prompt = prompts.h2[idx] || buildH2Prompt({ h2Text: allH2Texts[idx], articleTitle: article.title });
          const img = await generateImage({
            prompt,
            aspectRatio: '16:9',
            overlayTitle: allH2Texts[idx],
          });
          const saved = await prisma.articleImage.create({
            data: {
              articleId,
              kind: 'h2',
              h2Index: idx,
              mimeType: img.mimeType,
              dataBase64: img.base64,
              prompt,
              modelUsed: img.modelUsed,
            },
          });
          generated.push({ id: saved.id, kind: 'h2', h2Index: idx });
        } catch (e) {
          errors.push({ kind: 'h2', h2Index: idx, error: (e as Error).message });
        }
        // Pollinations の同一IP並列制限対策(4秒間隔)
        if (targetIndexes.length > 1) {
          await new Promise((r) => setTimeout(r, 4000));
        }
      }
    }

    // 本文HTMLに h2 画像を自動挿入
    let embedNote: string | undefined;
    if (article.bodyHtml && countH2(article.bodyHtml) > 0) {
      const allH2Images = await prisma.articleImage.findMany({
        where: { articleId, kind: 'h2' },
        orderBy: { h2Index: 'asc' },
      });
      if (allH2Images.length > 0) {
        const refs = allH2Images.map((i) => ({
          id: i.id,
          h2Index: i.h2Index ?? 0,
          alt: allH2Texts[i.h2Index ?? 0],
        }));
        const newBody = embedH2Images(article.bodyHtml, refs);
        if (newBody !== article.bodyHtml) {
          await prisma.article.update({
            where: { id: articleId },
            data: { bodyHtml: newBody },
          });
          embedNote = `${refs.length}枚を本文に挿入`;
        }
      }
    }

    return NextResponse.json({ generated, errors, embedNote });
  } catch (err) {
    if (err instanceof ImageGenError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    console.error('[images]', err);
    return NextResponse.json({ error: 'サーバー内部エラー' }, { status: 500 });
  }
}

/** HTML タグを除去してプレーンテキスト化(空白も正規化)。 */
function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<figure\b[\s\S]*?<\/figure>/gi, '') // 既存挿入画像を除外
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// 記事の画像一覧取得
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  const articleId = req.nextUrl.searchParams.get('articleId');
  if (!articleId) return NextResponse.json({ error: 'articleId required' }, { status: 400 });
  const article = await prisma.article.findFirst({ where: { id: articleId, userId: user.id } });
  if (!article) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const images = await prisma.articleImage.findMany({
    where: { articleId },
    orderBy: [{ kind: 'asc' }, { h2Index: 'asc' }],
    select: { id: true, kind: true, h2Index: true, mimeType: true, createdAt: true, prompt: true },
  });
  return NextResponse.json({ images, featuredImageId: article.featuredImageId });
}
