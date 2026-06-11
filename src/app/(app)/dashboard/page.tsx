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
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-navy-deep">ダッシュボード</h1>
          <p className="text-sm text-sub mt-1">SEO/LLMO 最適化された記事をAIで生成・管理</p>
        </div>
        <Link href="/articles/new" className="btn-primary">+ 新規記事作成</Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <StatCard label="作成記事数" value={articleCount.toString()} accent="teal" />
        <StatCard label="登録サイト数" value={siteCount.toString()} accent="navy" />
      </div>

      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="section-title">最近の記事</h2>
          <Link href="/articles" className="text-sm font-bold text-teal-mid hover:underline">すべて見る →</Link>
        </div>
        {recentArticles.length === 0 ? (
          <p className="text-sm text-sub">まだ記事はありません。<Link href="/articles/new" className="text-teal-mid font-bold hover:underline">最初の記事を作成</Link></p>
        ) : (
          <ul className="divide-y divide-line">
            {recentArticles.map((a) => (
              <li key={a.id} className="py-3 flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <Link href={a.status === 'completed' ? `/articles/${a.id}` : `/articles/${a.id}/wizard`} className="block font-bold text-navy hover:text-teal-mid truncate">
                    {a.title || '（無題）'}
                  </Link>
                  <div className="text-xs text-sub mt-0.5 flex items-center gap-2">
                    <StatusBadge status={a.status} />
                    <span>{new Date(a.updatedAt).toLocaleDateString('ja-JP')}</span>
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

function StatCard({ label, value, accent }: { label: string; value: string; accent: 'teal' | 'navy' }) {
  return (
    <div className="card p-5 relative overflow-hidden">
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${accent === 'teal' ? 'bg-teal' : 'bg-navy'}`} />
      <div className="text-xs text-sub pl-2">{label}</div>
      <div className="mt-2 text-3xl font-bold text-navy-deep pl-2">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    completed: { label: '完了', cls: 'bg-teal/10 text-teal-dark' },
    generating: { label: '生成中', cls: 'bg-amber-100 text-amber-700' },
    failed: { label: '失敗', cls: 'bg-red-50 text-red-600' },
    draft: { label: '下書き', cls: 'bg-line text-sub' },
  };
  const s = map[status] || map.draft;
  return <span className={`badge ${s.cls}`}>{s.label}</span>;
}
