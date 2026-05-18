import Link from 'next/link';

// (app) 配下はDBアクセスを伴うため動的レンダリングに固定（ビルド時 prerender を回避）
export const dynamic = 'force-dynamic';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="font-bold text-xl text-brand-700">
              AI Writing Tool
            </Link>
            <nav className="hidden md:flex items-center gap-1 text-sm">
              <Link href="/dashboard" className="px-3 py-1.5 rounded hover:bg-slate-100 text-slate-700">ダッシュボード</Link>
              <Link href="/articles" className="px-3 py-1.5 rounded hover:bg-slate-100 text-slate-700">記事一覧</Link>
              <Link href="/articles/new" className="px-3 py-1.5 rounded hover:bg-slate-100 text-slate-700">記事作成</Link>
              <Link href="/sites" className="px-3 py-1.5 rounded hover:bg-slate-100 text-slate-700">サイト管理</Link>
            </nav>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
