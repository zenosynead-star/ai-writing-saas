'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface WpConn {
  id: string;
  siteUrl: string;
  username: string;
  defaultStatus: string;
  isDefault: boolean;
}

export default function WordPressForm({ initialConnections }: { initialConnections: WpConn[] }) {
  const router = useRouter();
  const [conns, setConns] = useState(initialConnections);
  const [siteUrl, setSiteUrl] = useState('');
  const [username, setUsername] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [defaultStatus, setDefaultStatus] = useState<'draft' | 'publish' | 'future'>('draft');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const res = await fetch('/api/wordpress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteUrl, username, appPassword, defaultStatus }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '接続に失敗しました');
        return;
      }
      setSuccess(`接続成功: ${data.connectedAs} (${data.connection.siteUrl})`);
      setSiteUrl('');
      setUsername('');
      setAppPassword('');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('この接続を削除しますか?')) return;
    await fetch(`/api/wordpress?id=${id}`, { method: 'DELETE' });
    setConns((prev) => prev.filter((c) => c.id !== id));
    router.refresh();
  };

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h2 className="font-bold mb-4">新規接続を追加</h2>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">サイトURL</label>
            <input
              type="url"
              className="input"
              placeholder="https://blog.example.com"
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">ユーザー名</label>
              <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} required />
            </div>
            <div>
              <label className="label">Application Password</label>
              <input
                type="password"
                className="input"
                placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
                value={appPassword}
                onChange={(e) => setAppPassword(e.target.value)}
                required
              />
            </div>
          </div>
          <div>
            <label className="label">デフォルト投稿ステータス</label>
            <select className="input" value={defaultStatus} onChange={(e) => setDefaultStatus(e.target.value as 'draft' | 'publish' | 'future')}>
              <option value="draft">下書き</option>
              <option value="publish">公開</option>
              <option value="future">予約投稿</option>
            </select>
          </div>

          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">{error}</div>}
          {success && <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded p-3">{success}</div>}

          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? '接続テスト中…' : '接続して保存'}
          </button>
        </form>
      </div>

      <div className="card overflow-hidden">
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 font-bold">登録済み接続</div>
        {conns.length === 0 ? (
          <div className="p-6 text-sm text-slate-500 text-center">まだ接続がありません</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {conns.map((c) => (
              <li key={c.id} className="px-6 py-3 flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-900 truncate">{c.siteUrl}</div>
                  <div className="text-xs text-slate-500">
                    {c.username} / デフォルト: {c.defaultStatus === 'draft' ? '下書き' : c.defaultStatus === 'publish' ? '公開' : '予約'} {c.isDefault && '・既定'}
                  </div>
                </div>
                <button onClick={() => remove(c.id)} className="btn-danger text-xs">削除</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
