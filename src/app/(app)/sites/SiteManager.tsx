'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Site {
  id: string;
  domain: string;
  type: string;
  businessArea: string | null;
  searchConsoleConnected: boolean;
  keywordCount: number;
}

export default function SiteManager({ initialSites }: { initialSites: Site[] }) {
  const router = useRouter();
  const [sites, setSites] = useState(initialSites);
  const [domain, setDomain] = useState('');
  const [type, setType] = useState<'own' | 'competitor'>('own');
  const [businessArea, setBusinessArea] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await fetch('/api/sites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain, type, businessArea: businessArea || null }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error || '登録に失敗しました');
      return;
    }
    setSites((prev) => [{ ...data.site, keywordCount: 0 }, ...prev]);
    setDomain('');
    setBusinessArea('');
    router.refresh();
  };

  const remove = async (id: string) => {
    if (!confirm('このサイトを削除しますか？関連キーワード・順位データも削除されます。')) return;
    const res = await fetch(`/api/sites/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setSites((prev) => prev.filter((s) => s.id !== id));
      router.refresh();
    }
  };

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h2 className="font-bold mb-4">サイト追加</h2>
        <form onSubmit={add} className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-5">
            <label className="label">ドメイン</label>
            <input
              className="input"
              placeholder="example.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              required
              pattern="[a-zA-Z0-9\-\.]+"
            />
          </div>
          <div className="md:col-span-3">
            <label className="label">タイプ</label>
            <select className="input" value={type} onChange={(e) => setType(e.target.value as 'own' | 'competitor')}>
              <option value="own">自社</option>
              <option value="competitor">競合</option>
            </select>
          </div>
          <div className="md:col-span-3">
            <label className="label">事業領域（任意）</label>
            <input
              className="input"
              placeholder="例: BtoB SaaS"
              value={businessArea}
              onChange={(e) => setBusinessArea(e.target.value)}
            />
          </div>
          <div className="md:col-span-1 flex items-end">
            <button type="submit" disabled={loading} className="btn-primary w-full">追加</button>
          </div>
        </form>
        {error && <div className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">{error}</div>}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-3 text-slate-600 font-medium">ドメイン</th>
              <th className="text-left px-4 py-3 text-slate-600 font-medium">タイプ</th>
              <th className="text-left px-4 py-3 text-slate-600 font-medium">事業領域</th>
              <th className="text-right px-4 py-3 text-slate-600 font-medium">KW数</th>
              <th className="text-right px-4 py-3 text-slate-600 font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sites.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">サイトはまだ登録されていません</td></tr>
            )}
            {sites.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">{s.domain}</td>
                <td className="px-4 py-3">
                  <span className={`badge ${s.type === 'own' ? 'bg-brand-100 text-brand-700' : 'bg-amber-100 text-amber-700'}`}>
                    {s.type === 'own' ? '自社' : '競合'}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600">{s.businessArea || '-'}</td>
                <td className="px-4 py-3 text-right text-slate-600">{s.keywordCount}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => remove(s.id)} className="text-red-600 hover:text-red-700 text-xs">削除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
