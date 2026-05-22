import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { generateImage, buildEyecatchPrompt, buildH2Prompt, ImageGenError } from '@/lib/imageGen';
import { z } from 'zod';

const Schema = z.object({
  articleId: z.string(),
  /** 'all' = アイキャッチ + 全 h2 / 'eyecatch' / 'h2' */
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

    // アイキャッチ
    if (scope === 'all' || scope === 'eyecatch') {
      try {
        // 既存の eyecatch があれば削除
        await prisma.articleImage.deleteMany({ where: { articleId, kind: 'eyecatch' } });
        const prompt = buildEyecatchPrompt({ title: article.title, keywords });
        const img = await generateImage({ prompt, aspectRatio: '16:9' });
        const saved = await prisma.articleImage.create({
          data: {
            articleId,
            kind: 'eyecatch',
            h2Index: null,
            mimeType: img.mimeType,
            dataBase64: img.base64,
            prompt,
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
      const targets = h2Index !== undefined
        ? article.headings.slice(h2Index, h2Index + 1)
        : article.headings;
      for (let i = 0; i < targets.length; i++) {
        const idx = h2Index !== undefined ? h2Index : i;
        const h = targets[i];
        try {
          await prisma.articleImage.deleteMany({ where: { articleId, kind: 'h2', h2Index: idx } });
          const prompt = buildH2Prompt({ h2Text: h.text, articleTitle: article.title });
          const img = await generateImage({ prompt, aspectRatio: '16:9' });
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
        // RPM 制限対策で500ms 間隔
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    return NextResponse.json({ generated, errors });
  } catch (err) {
    if (err instanceof ImageGenError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    console.error('[images]', err);
    return NextResponse.json({ error: 'サーバー内部エラー' }, { status: 500 });
  }
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
