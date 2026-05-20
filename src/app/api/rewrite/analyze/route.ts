import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { fetchPage, FetchError } from '@/lib/fetcher';
import { parseArticle, headingsToMarkdown } from '@/lib/htmlParser';
import { z } from 'zod';

const Schema = z.object({ url: z.string().url() });

export async function POST(req: NextRequest) {
  try {
    await getCurrentUser(); // default user 自動作成
    const parsed = Schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'URLの形式が不正です' }, { status: 400 });
    }
    const { url } = parsed.data;

    const fetched = await fetchPage(url);
    const article = parseArticle(fetched.html);

    if (!article.title && article.wordCount < 200) {
      return NextResponse.json(
        { error: 'このページから記事と思われるコンテンツを抽出できませんでした' },
        { status: 422 },
      );
    }

    return NextResponse.json({
      url: fetched.finalUrl,
      title: article.title || article.ogTitle || '(タイトル取得失敗)',
      metaDescription: article.metaDescription || article.ogDescription || '',
      headings: article.headings,
      headingsMarkdown: headingsToMarkdown(article.headings),
      paragraphCount: article.paragraphs.length,
      wordCount: article.wordCount,
      bodyPreview: article.paragraphs.slice(0, 5).join('\n\n'),
    });
  } catch (err) {
    if (err instanceof FetchError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    console.error('[rewrite/analyze]', err);
    return NextResponse.json({ error: 'ページの解析に失敗しました' }, { status: 500 });
  }
}
