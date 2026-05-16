import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import ArticleEditor from './ArticleEditor';

export default async function ArticleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = (await getCurrentUser())!;
  const article = await prisma.article.findFirst({
    where: { id, userId: user.id },
    include: { headings: { orderBy: { order: 'asc' } } },
  });
  if (!article) notFound();
  if (article.status !== 'completed') {
    redirect(`/articles/${article.id}/wizard`);
  }

  const keywords = JSON.parse(article.keywords || '[]') as string[];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link href="/articles" className="text-sm text-slate-500 hover:text-slate-700">← 記事一覧</Link>
          <h1 className="text-2xl font-bold mt-1">{article.title}</h1>
          <div className="text-xs text-slate-500 mt-1">
            キーワード: {keywords.join(', ')} ・ {article.modelUsed} ・ 消費 {article.totalCreditsUsed} CR
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/articles/${article.id}/wizard`} className="btn-secondary">ステップ画面に戻る</Link>
        </div>
      </div>

      <ArticleEditor articleId={article.id} initialHtml={article.bodyHtml || ''} initialMeta={article.metaDescription || ''} />
    </div>
  );
}
