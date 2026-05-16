import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import LogoutButton from '@/components/LogoutButton';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="font-bold text-xl text-brand-700">
              AI Writing SaaS
            </Link>
            <nav className="hidden md:flex items-center gap-1 text-sm">
              <Link href="/dashboard" className="px-3 py-1.5 rounded hover:bg-slate-100 text-slate-700">ダッシュボード</Link>
              <Link href="/articles" className="px-3 py-1.5 rounded hover:bg-slate-100 text-slate-700">記事一覧</Link>
              <Link href="/articles/new" className="px-3 py-1.5 rounded hover:bg-slate-100 text-slate-700">記事作成</Link>
              <Link href="/sites" className="px-3 py-1.5 rounded hover:bg-slate-100 text-slate-700">サイト管理</Link>
              <Link href="/plan" className="px-3 py-1.5 rounded hover:bg-slate-100 text-slate-700">プラン・課金</Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-xs text-slate-500">クレジット残高</div>
              <div className="text-base font-bold text-brand-700">{user.currentCredits.toLocaleString()}</div>
            </div>
            <div className="hidden sm:block text-sm text-slate-600 border-l border-slate-200 pl-3">
              {user.name}
              <div className="text-xs text-slate-400">{user.plan.name}プラン</div>
            </div>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
