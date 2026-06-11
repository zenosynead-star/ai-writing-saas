import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import MobileNav from '@/components/MobileNav';

// (app) 配下はDBアクセスを伴うため動的レンダリングに固定（ビルド時 prerender を回避）
export const dynamic = 'force-dynamic';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen md:flex">
      {/* デスクトップ: 濃紺サイドバー */}
      <Sidebar />

      <div className="flex-1 min-w-0 md:ml-64">
        {/* モバイル: 上部バー */}
        <header className="md:hidden border-b border-line bg-navy-deep sticky top-0 z-20">
          <div className="px-4 py-3 flex items-center justify-between">
            <Link href="/dashboard" className="font-bold text-white">
              AI Writing <span className="text-teal">Studio</span>
            </Link>
            <MobileNav />
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-4 md:px-8 py-6 md:py-10">{children}</main>
      </div>
    </div>
  );
}
