'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV: Array<{ href: string; label: string; icon: React.ReactNode; match: (p: string) => boolean }> = [
  {
    href: '/dashboard',
    label: 'ダッシュボード',
    match: (p) => p === '/dashboard',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]"><path d="M3 3h6v8H3V3zm0 10h6v4H3v-4zm8 0h6v-8h-6v8zm0-10v4h6V3h-6z" /></svg>
    ),
  },
  {
    href: '/articles/new',
    label: '記事作成',
    match: (p) => p.startsWith('/articles/new') || p.includes('/wizard'),
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]"><path d="M13.586 3.586a2 2 0 112.828 2.828l-8.5 8.5a2 2 0 01-.878.51l-3 .857a.5.5 0 01-.617-.617l.857-3a2 2 0 01.51-.878l8.5-8.5z" /></svg>
    ),
  },
  {
    href: '/articles',
    label: '記事一覧',
    match: (p) => p === '/articles' || (p.startsWith('/articles/') && !p.includes('/wizard') && !p.startsWith('/articles/new')),
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]"><path d="M3 4h14v2H3V4zm0 5h14v2H3V9zm0 5h10v2H3v-2z" /></svg>
    ),
  },
  {
    href: '/rewrite',
    label: 'リライト',
    match: (p) => p.startsWith('/rewrite'),
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]"><path d="M4 4a2 2 0 012-2h5l5 5v9a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm9 7l-3 3-1.5-1.5L7 16h7l-1-1v-4z" /></svg>
    ),
  },
  {
    href: '/sites',
    label: 'サイト管理',
    match: (p) => p.startsWith('/sites'),
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM7 8a3 3 0 116 0 3 3 0 01-6 0z" clipRule="evenodd" /></svg>
    ),
  },
  {
    href: '/settings/wordpress',
    label: 'WordPress連携',
    match: (p) => p.startsWith('/settings'),
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]"><path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.53 1.53 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.53 1.53 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.53 1.53 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.532 1.532 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.53 1.53 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.53 1.53 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.53 1.53 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" /></svg>
    ),
  },
];

export default function Sidebar() {
  const pathname = usePathname() || '';
  return (
    <aside className="hidden md:flex md:flex-col md:fixed md:inset-y-0 md:w-64 bg-navy-deep text-white z-20">
      <div className="px-5 py-5 border-b border-white/10">
        <Link href="/dashboard" className="block">
          <div className="font-bold text-lg leading-tight">
            AI Writing <span className="text-teal">Studio</span>
          </div>
          <div className="text-[11px] text-white/50 mt-0.5">SEO / LLMO プラットフォーム</div>
        </Link>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV.map((item) => {
          const active = item.match(pathname);
          return (
            <Link key={item.href} href={item.href} className={`nav-item ${active ? 'nav-item-active' : ''}`}>
              <span className={active ? 'text-teal' : 'text-white/60'}>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="px-5 py-4 border-t border-white/10">
        <Link href="/articles/new" className="btn-primary w-full">
          + 新規記事作成
        </Link>
      </div>
    </aside>
  );
}
