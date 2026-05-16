'use client';

import { useRouter } from 'next/navigation';

export default function LogoutButton() {
  const router = useRouter();
  const onClick = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
    router.refresh();
  };
  return (
    <button onClick={onClick} className="btn-secondary text-xs px-3 py-1.5">
      ログアウト
    </button>
  );
}
