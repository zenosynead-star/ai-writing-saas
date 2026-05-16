'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, referralCode: referralCode || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'サインアップに失敗しました');
        setLoading(false);
        return;
      }
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="card w-full max-w-md p-8">
        <h1 className="text-2xl font-bold mb-2">アカウント作成</h1>
        <p className="text-sm text-slate-600 mb-6">フリープランは50クレジット付き・クレカ不要</p>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="label">氏名</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
          </div>
          <div>
            <label className="label">メールアドレス</label>
            <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="label">パスワード（8文字以上・英大小・数字）</label>
            <input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          </div>
          <div>
            <label className="label">紹介コード（任意）</label>
            <input className="input" value={referralCode} onChange={(e) => setReferralCode(e.target.value)} maxLength={20} />
          </div>

          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">{error}</div>}

          <button type="submit" className="btn-primary w-full py-2.5" disabled={loading}>
            {loading ? '作成中...' : 'アカウント作成'}
          </button>
        </form>

        <div className="mt-6 text-sm text-center text-slate-600">
          すでにアカウントをお持ちですか？{' '}
          <Link href="/login" className="text-brand-600 hover:underline">ログイン</Link>
        </div>
      </div>
    </main>
  );
}
