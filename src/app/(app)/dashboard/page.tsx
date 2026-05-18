import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

export default async function DashboardPage() {
  const user = await getCurrentUser();

  const [recentArticles, articleCount, siteCount] = await Promise.all([
    prisma.article.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    }),
    prisma.article.count({ where: { userId: user.id } }),
    prisma.site.count({ where: { userId: user.id } }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">ダッシュボード</h1>
        <Link href="/articles/new" className="btn-primary">+ 新規記事作成</Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <StatCard label="作成記事数" value={articleCount.toString()} />
        <StatCard label="登録サイト数" value={siteCount.toString()} />
      </div>

      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold">最近の記事</h2>
          <Link href="/articles" className="text-sm text-brand-600 hover:underline">すべて見る</Link>
        </div>
        {recentArticles.length === 0 ? (
          <p className="text-sm text-slate-500">まだ記事はありません。<Link href="/articles/new" className="text-brand-600 hover:underline">最初の記事を作成</Link></p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recentArticles.map((a) => (
              <li key={a.id} className="py-3 flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <Link href={a.status === 'completed' ? `/articles/${a.id}` : `/articles/${a.id}/wizard`} className="block font-medium text-slate-900 hover:text-brand-600 truncate">
                    {a.title || '（無題）'}
                  </Link>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {a.status === 'completed' ? '完了' : a.status === 'generating' ? '生成中' : '下書き'}
                    ・ {new Date(a.updatedAt).toLocaleDateString('ja-JP')}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-5">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-bold text-slate-900">{value}</div>
    </div>
  );
}
