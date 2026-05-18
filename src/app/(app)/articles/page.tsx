import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

export default async function ArticlesPage() {
  const user = await getCurrentUser();
  const articles = await prisma.article.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: 'desc' },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">記事一覧</h1>
        <Link href="/articles/new" className="btn-primary">+ 新規記事作成</Link>
      </div>

      <div className="card">
        {articles.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <p className="mb-4">まだ記事はありません。</p>
            <Link href="/articles/new" className="btn-primary">最初の記事を作成</Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-600">タイトル</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">キーワード</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">ステータス</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">更新日</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {articles.map((a) => {
                const keywords = JSON.parse(a.keywords || '[]') as string[];
                const isCompleted = a.status === 'completed';
                const target = isCompleted ? `/articles/${a.id}` : `/articles/${a.id}/wizard`;
                return (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={target} className="font-medium text-slate-900 hover:text-brand-600">
                        {a.title || '（無題）'}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{keywords.slice(0, 3).join(', ')}{keywords.length > 3 ? '…' : ''}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={a.status} />
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500">{new Date(a.updatedAt).toLocaleDateString('ja-JP')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: '下書き', cls: 'bg-slate-100 text-slate-700' },
    generating: { label: '生成中', cls: 'bg-amber-100 text-amber-700' },
    completed: { label: '完了', cls: 'bg-green-100 text-green-700' },
    failed: { label: '失敗', cls: 'bg-red-100 text-red-700' },
  };
  const m = map[status] ?? map.draft;
  return <span className={`badge ${m.cls}`}>{m.label}</span>;
}
