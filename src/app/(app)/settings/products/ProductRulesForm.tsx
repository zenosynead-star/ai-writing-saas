'use client';

import { useState } from 'react';

interface ProductChoice {
  product_id: string;
  name: string;
  price_jpy: number | null;
}
interface Rule {
  keyword: string;
  productId: string;
  enabled: boolean;
}
interface Conn {
  id: string;
  siteUrl: string;
  isDefault: boolean;
  defaultProductId: string | null;
  rules: Rule[];
}

export default function ProductRulesForm({
  products,
  connections,
}: {
  products: ProductChoice[];
  connections: Conn[];
}) {
  const [conns, setConns] = useState<Conn[]>(connections);
  const [selId, setSelId] = useState<string>(connections[0]?.id || '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const sel = conns.find((c) => c.id === selId) || conns[0];

  const updateSel = (patch: Partial<Conn>) => {
    setMsg(null);
    setConns((prev) => prev.map((c) => (c.id === sel.id ? { ...c, ...patch } : c)));
  };
  const addRule = () =>
    updateSel({ rules: [...sel.rules, { keyword: '', productId: products[0]?.product_id || '', enabled: true }] });
  const updateRule = (i: number, patch: Partial<Rule>) =>
    updateSel({ rules: sel.rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) });
  const removeRule = (i: number) => updateSel({ rules: sel.rules.filter((_, idx) => idx !== i) });
  const moveRule = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= sel.rules.length) return;
    const next = [...sel.rules];
    [next[i], next[j]] = [next[j], next[i]];
    updateSel({ rules: next });
  };

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch('/api/settings/product-rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId: sel.id,
          defaultProductId: sel.defaultProductId || null,
          rules: sel.rules
            .filter((r) => r.keyword.trim() && r.productId)
            .map((r) => ({ keyword: r.keyword.trim(), productId: r.productId, enabled: r.enabled })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setMsg({ type: 'err', text: data.error || '保存に失敗しました' });
      else setMsg({ type: 'ok', text: '保存しました' });
    } catch (e) {
      setMsg({ type: 'err', text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const productLabel = (p: ProductChoice) =>
    `${p.name}${p.price_jpy ? `（¥${p.price_jpy.toLocaleString('en-US')}）` : ''}`;

  return (
    <div className="card p-6 space-y-5">
      {conns.length > 1 && (
        <div>
          <label className="label">対象サイト</label>
          <select
            className="input"
            value={sel.id}
            onChange={(e) => {
              setSelId(e.target.value);
              setMsg(null);
            }}
          >
            {conns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.siteUrl}
                {c.isDefault ? '（デフォルト）' : ''}
              </option>
            ))}
          </select>
        </div>
      )}
      {conns.length === 1 && (
        <div className="text-xs text-sub">
          対象サイト: <span className="font-bold text-navy">{sel.siteUrl}</span>
        </div>
      )}

      <div>
        <label className="label">デフォルト商品（どのルールにも一致しない場合に推奨）</label>
        <select
          className="input"
          value={sel.defaultProductId || ''}
          onChange={(e) => updateSel({ defaultProductId: e.target.value || null })}
        >
          <option value="">（指定なし：本文で言及された自社商品を自動選定）</option>
          {products.map((p) => (
            <option key={p.product_id} value={p.product_id}>
              {productLabel(p)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="label mb-0">キーワード一致ルール（上から順に判定・最初の一致を採用）</label>
          <button onClick={addRule} disabled={saving} className="text-sm font-bold text-teal-mid hover:underline">
            ＋ ルールを追加
          </button>
        </div>

        {sel.rules.length === 0 ? (
          <p className="text-xs text-sub py-2">
            ルール未設定です。「＋ ルールを追加」で「キーワードに〇〇を含む → 商品△△」を作成できます。
          </p>
        ) : (
          <ul className="space-y-2">
            {sel.rules.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 bg-bluepaper/40 border border-line rounded-md p-2">
                <span className="text-xs text-sub shrink-0">キーワードに</span>
                <input
                  className="input flex-1 min-w-[120px] !py-1.5"
                  placeholder="例: PUレザー"
                  value={r.keyword}
                  onChange={(e) => updateRule(i, { keyword: e.target.value })}
                  disabled={saving}
                />
                <span className="text-xs text-sub shrink-0">を含む →</span>
                <select
                  className="input flex-1 min-w-[160px] !py-1.5"
                  value={r.productId}
                  onChange={(e) => updateRule(i, { productId: e.target.value })}
                  disabled={saving}
                >
                  {products.map((p) => (
                    <option key={p.product_id} value={p.product_id}>
                      {productLabel(p)}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1 text-xs text-navy shrink-0">
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={(e) => updateRule(i, { enabled: e.target.checked })}
                    disabled={saving}
                    className="accent-teal w-4 h-4"
                  />
                  有効
                </label>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => moveRule(i, -1)}
                    disabled={saving || i === 0}
                    className="px-2 py-1 text-xs border border-line rounded disabled:opacity-30 hover:bg-white"
                    aria-label="上へ"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => moveRule(i, 1)}
                    disabled={saving || i === sel.rules.length - 1}
                    className="px-2 py-1 text-xs border border-line rounded disabled:opacity-30 hover:bg-white"
                    aria-label="下へ"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => removeRule(i)}
                    disabled={saving}
                    className="px-2 py-1 text-xs border border-line rounded text-red-600 hover:bg-red-50"
                    aria-label="削除"
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {msg && (
        <div
          className={`text-sm rounded p-3 ${
            msg.type === 'ok' ? 'text-teal-mid bg-teal-50 border border-teal-200' : 'text-red-600 bg-red-50 border border-red-200'
          }`}
        >
          {msg.text}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? '保存中…' : '保存する'}
        </button>
        <span className="text-xs text-sub">この設定は次回以降の記事生成・公開から反映されます。</span>
      </div>
    </div>
  );
}
