'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { forceCollide } from 'd3-force';

// 2Dグラフ。canvas描画(WebGL不要)。SSR不可なのでクライアントのみ。
const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

interface GNode {
  id: string;
  title: string;
  keyword: string;
  status: string;
  outDegree: number;
  inDegree: number;
  x?: number;
  y?: number;
}
interface GLink {
  source: string | { id: string };
  target: string | { id: string };
}
interface GraphData {
  nodes: GNode[];
  links: { source: string; target: string }[];
  stats: { articles: number; links: number; orphans: number };
}
// react-force-graph のインスタンスメソッド（dynamic で型が消えるため最小限を自前定義）
interface FGMethods {
  d3Force: (name: string, force?: unknown) => { strength?: (s: number) => unknown; distance?: (d: number) => unknown } | undefined;
  d3ReheatSimulation?: () => void;
  zoomToFit?: (ms?: number, px?: number) => void;
}

const idOf = (v: string | { id: string }) => (typeof v === 'object' ? v.id : v);

export default function LinkGraph() {
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [showTable, setShowTable] = useState(false);
  const [selected, setSelected] = useState<GNode | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<FGMethods | undefined>(undefined);
  // 初期レイアウト確定時だけ画面に収める。以降のドラッグ等での再静止では
  // ユーザーのパン/ズームを尊重して自動フィットしない。
  const autoFitsLeft = useRef(0);
  const [size, setSize] = useState({ w: 800, h: 560 });

  useEffect(() => {
    fetch('/api/internal-links')
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    const update = () => {
      if (wrapRef.current) setSize({ w: wrapRef.current.clientWidth, h: Math.max(560, window.innerHeight - 280) });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [data]);

  const graphData = useMemo(
    () => (data ? { nodes: data.nodes.map((n) => ({ ...n })), links: data.links.map((l) => ({ ...l })) } : { nodes: [], links: [] }),
    [data],
  );

  // KW→KW を集計（data.links は string id のまま＝force-graph の mutate を受けない）
  const { outMap, inMap, rows } = useMemo(() => {
    const byId = new Map<string, GNode>((data?.nodes || []).map((n) => [n.id, n]));
    const outMap = new Map<string, GNode[]>();
    const inMap = new Map<string, GNode[]>();
    for (const l of data?.links || []) {
      const s = byId.get(l.source);
      const t = byId.get(l.target);
      if (!s || !t) continue;
      if (!outMap.has(s.id)) outMap.set(s.id, []);
      outMap.get(s.id)!.push(t);
      if (!inMap.has(t.id)) inMap.set(t.id, []);
      inMap.get(t.id)!.push(s);
    }
    const rows = (data?.nodes || [])
      .map((n) => ({ node: n, out: outMap.get(n.id) || [], inc: inMap.get(n.id) || [] }))
      .sort((a, b) => b.out.length + b.inc.length - (a.out.length + a.inc.length) || b.node.inDegree - a.node.inDegree);
    return { outMap, inMap, rows };
  }, [data]);

  const neighborIds = useMemo(() => {
    if (!selected) return null;
    const s = new Set<string>([selected.id]);
    (outMap.get(selected.id) || []).forEach((n) => s.add(n.id));
    (inMap.get(selected.id) || []).forEach((n) => s.add(n.id));
    return s;
  }, [selected, outMap, inMap]);

  const isHub = (n: GNode) => n.inDegree >= 3;
  const nodeFill = (n: GNode) => (isHub(n) ? '#f59e0b' : '#16a394');
  const nodeRadius = (n: GNode) => 5 + Math.min(n.inDegree, 8) * 1.5;
  const linkTouchesSel = (l: GLink) => !!selected && (idOf(l.source) === selected.id || idOf(l.target) === selected.id);

  // 重なり防止の力学を設定（反発を強め・リンク距離を確保・ノード(＋ラベル)同士の衝突回避）。
  // dynamic(lazy) で ref が遅れて入るため、用意できるまで少しリトライする。
  useEffect(() => {
    if (!data || data.nodes.length === 0) return;
    // 新しいデータでは「初期静止」と「力学適用後の再静止」の2回だけ自動フィット。
    autoFitsLeft.current = 2;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const apply = () => {
      if (cancelled) return;
      const fg = fgRef.current;
      if (!fg || typeof fg.d3Force !== 'function') {
        if (tries++ < 40) timer = setTimeout(apply, 150);
        else console.warn('[linkmap] ref not ready - anti-overlap forces NOT applied');
        return;
      }
      try {
        fg.d3Force('charge')?.strength?.(-300); // 反発を強めて全体を広げる
        fg.d3Force('link')?.distance?.(90); // リンクで近づきすぎない
        // ノード半径＋ラベルぶんの余白で衝突回避＝重ならない
        fg.d3Force('collide', forceCollide((n) => nodeRadius(n as unknown as GNode) + 30).iterations(2));
        fg.d3ReheatSimulation?.();
      } catch (e) {
        console.warn('[linkmap] force apply failed', (e as Error).message);
      }
    };
    apply();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [data]);

  const q = filter.trim().toLowerCase();
  const filteredRows = q
    ? rows.filter(
        (r) =>
          r.node.keyword.toLowerCase().includes(q) ||
          r.out.some((t) => t.keyword.toLowerCase().includes(q)) ||
          r.inc.some((t) => t.keyword.toLowerCase().includes(q)),
      )
    : rows;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy-deep">内部リンクマップ</h1>
        <p className="text-sm text-sub mt-1">
          <strong>公開中の記事</strong>をキーワードで表示。線は内部リンク（矢印＝向き）。
          <strong>ノードをクリックすると、そのKWに出入りするリンクだけ強調</strong>されます。ドラッグで移動・スクロールで拡大。
        </p>
      </div>

      {data && (
        <div className="flex flex-wrap gap-3">
          <Stat label="公開記事数" value={data.stats.articles} accent="navy" />
          <Stat label="内部リンク数" value={data.stats.links} accent="teal" />
          <Stat label="孤立記事(リンクなし)" value={data.stats.orphans} accent={data.stats.orphans > 0 ? 'amber' : 'teal'} />
        </div>
      )}

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">{error}</div>}

      {!data && <div className="card p-16 text-center text-sub text-sm">読み込み中…</div>}
      {data && data.nodes.length === 0 && (
        <div className="card p-16 text-center text-sub text-sm">公開中の記事がまだありません。</div>
      )}

      {data && data.nodes.length > 0 && (
        <>
          <div className="card overflow-hidden relative bg-[#f7f9fc]" ref={wrapRef}>
            <ForceGraph2D
              ref={fgRef as never}
              graphData={graphData}
              width={size.w}
              height={size.h}
              backgroundColor="#f7f9fc"
              cooldownTicks={200}
              warmupTicks={40}
              d3VelocityDecay={0.35}
              nodeRelSize={1}
              onEngineStop={() => {
                // 初期レイアウト確定ぶんだけフィット。以降(ドラッグ等の再静止)は
                // ユーザーのパン/ズームを保持して勝手に戻さない。
                if (autoFitsLeft.current > 0) {
                  autoFitsLeft.current -= 1;
                  fgRef.current?.zoomToFit?.(500, 60);
                }
              }}
              nodeLabel={(n: object) => {
                const node = n as GNode;
                return `<div style="background:#171951;color:#fff;padding:5px 9px;border-radius:6px;font-size:12px;max-width:300px;font-weight:700">${escapeHtml(node.keyword)}<br><span style="font-weight:400;opacity:.8">飛ぶ先→${node.outDegree} / 飛んでくる←${node.inDegree}</span></div>`;
              }}
              nodeCanvasObject={(n: object, ctx: CanvasRenderingContext2D, globalScale: number) => {
                const node = n as GNode;
                const x = node.x ?? 0;
                const y = node.y ?? 0;
                const r = nodeRadius(node);
                const faded = !!neighborIds && !neighborIds.has(node.id);
                ctx.beginPath();
                ctx.arc(x, y, r, 0, 2 * Math.PI);
                ctx.fillStyle = faded ? 'rgba(148,163,184,0.3)' : nodeFill(node);
                ctx.fill();
                if (selected?.id === node.id) {
                  ctx.lineWidth = 2 / globalScale;
                  ctx.strokeStyle = '#171951';
                  ctx.stroke();
                }
                const label = node.keyword;
                const fontSize = Math.max(2.5, 11 / globalScale);
                ctx.font = `600 ${fontSize}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                const tw = ctx.measureText(label).width;
                const px = 3 / globalScale;
                const py = 1.5 / globalScale;
                const ly = y + r + 2 / globalScale;
                if (!faded) {
                  ctx.fillStyle = 'rgba(255,255,255,0.9)';
                  ctx.fillRect(x - tw / 2 - px, ly - py, tw + px * 2, fontSize + py * 2);
                }
                ctx.fillStyle = faded ? 'rgba(100,116,139,0.4)' : '#171951';
                ctx.fillText(label, x, ly);
              }}
              nodePointerAreaPaint={(n: object, color: string, ctx: CanvasRenderingContext2D) => {
                const node = n as GNode;
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(node.x ?? 0, node.y ?? 0, nodeRadius(node) + 3, 0, 2 * Math.PI);
                ctx.fill();
              }}
              linkColor={(l: object) => {
                if (!selected) return 'rgba(148,163,184,0.45)';
                return linkTouchesSel(l as GLink) ? 'rgba(22,163,148,0.95)' : 'rgba(203,213,225,0.15)';
              }}
              linkWidth={(l: object) => (linkTouchesSel(l as GLink) ? 2.5 : 1)}
              linkDirectionalArrowLength={(l: object) => (linkTouchesSel(l as GLink) ? 5 : 3)}
              linkDirectionalArrowRelPos={1}
              onNodeClick={(n: object) => setSelected((prev) => (prev?.id === (n as GNode).id ? null : (n as GNode)))}
              onBackgroundClick={() => setSelected(null)}
            />
            <div className="absolute top-2 right-3 text-[11px] text-sub bg-white/85 rounded px-2 py-1 pointer-events-none">
              ノードをクリックで関連リンク強調・背景クリックで解除
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-sub">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-full" style={{ background: '#f59e0b' }} />被リンク多（ハブ＝SEO上重要）
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-full" style={{ background: '#16a394' }} />公開記事
            </span>
            <span>● 大きいほど被リンク多 ／ ラベル＝キーワード</span>
          </div>

          {selected && (
            <div className="card p-4 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-bold text-navy truncate">{selected.keyword}</div>
                  <div className="text-xs text-sub mt-0.5">
                    飛ぶ先 {selected.outDegree} / 飛んでくる {selected.inDegree}
                  </div>
                </div>
                <Link href={`/articles/${selected.id}`} className="btn-secondary text-sm shrink-0">
                  記事を開く →
                </Link>
              </div>
              {(outMap.get(selected.id)?.length ?? 0) > 0 && (
                <div className="text-xs">
                  <span className="text-sub">飛ぶ先: </span>
                  <span className="inline-flex flex-wrap gap-1.5 align-top">
                    <KwChips nodes={outMap.get(selected.id)!} tone="teal" />
                  </span>
                </div>
              )}
              {(inMap.get(selected.id)?.length ?? 0) > 0 && (
                <div className="text-xs">
                  <span className="text-sub">飛んでくる元: </span>
                  <span className="inline-flex flex-wrap gap-1.5 align-top">
                    <KwChips nodes={inMap.get(selected.id)!} tone="navy" />
                  </span>
                </div>
              )}
            </div>
          )}

          {/* 一覧表（任意・折りたたみ） */}
          <div>
            <button type="button" onClick={() => setShowTable((v) => !v)} className="text-sm font-bold text-teal-mid hover:underline">
              {showTable ? '▼ 一覧表を隠す' : '▶ 一覧表でも見る（KWごとの発リンク/被リンク）'}
            </button>
            {showTable && (
              <div className="mt-2 space-y-2">
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="キーワードで絞り込み…"
                  className="input max-w-xs text-sm"
                />
                <div className="card p-0 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-bluepaper text-left text-xs text-sub border-b border-line">
                          <th className="px-4 py-2.5 font-bold whitespace-nowrap w-[26%]">キーワード（公開記事）</th>
                          <th className="px-4 py-2.5 font-bold">発リンク → 飛び先キーワード</th>
                          <th className="px-4 py-2.5 font-bold">← 被リンク（飛んでくる元）</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {filteredRows.map(({ node, out, inc }) => (
                          <tr key={node.id} className="align-top hover:bg-bluepaper/40">
                            <td className="px-4 py-3">
                              <button
                                type="button"
                                onClick={() => setSelected(node)}
                                className="font-bold text-navy hover:underline text-left break-words"
                              >
                                {node.keyword}
                              </button>
                              {isHub(node) && (
                                <span className="ml-1.5 align-middle text-[10px] font-bold text-amber-700 bg-amber-100 rounded px-1.5 py-0.5">
                                  ハブ
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {out.length === 0 ? <span className="text-line">—</span> : <KwChips nodes={out} tone="teal" onPick={setSelected} />}
                            </td>
                            <td className="px-4 py-3">
                              {inc.length === 0 ? <span className="text-line">—</span> : <KwChips nodes={inc} tone="navy" onPick={setSelected} />}
                            </td>
                          </tr>
                        ))}
                        {filteredRows.length === 0 && (
                          <tr>
                            <td colSpan={3} className="px-4 py-8 text-center text-sub text-sm">
                              該当するキーワードがありません。
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** KW のチップ列。onPick ありはグラフ選択、なしは記事へ遷移。 */
function KwChips({ nodes, tone, onPick }: { nodes: GNode[]; tone: 'teal' | 'navy'; onPick?: (n: GNode) => void }) {
  const cls =
    tone === 'navy'
      ? 'bg-bluepaper text-navy hover:bg-navy hover:text-white'
      : 'bg-teal/10 text-teal-mid hover:bg-teal hover:text-white';
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {nodes.map((t) =>
        onPick ? (
          <button key={t.id} type="button" onClick={() => onPick(t)} className={`rounded px-2 py-0.5 text-xs transition-colors ${cls}`}>
            {t.keyword}
          </button>
        ) : (
          <Link key={t.id} href={`/articles/${t.id}`} className={`rounded px-2 py-0.5 text-xs transition-colors ${cls}`}>
            {t.keyword}
          </Link>
        ),
      )}
    </span>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent: 'navy' | 'teal' | 'amber' }) {
  const bar = accent === 'navy' ? 'bg-navy' : accent === 'amber' ? 'bg-amber-400' : 'bg-teal';
  return (
    <div className="card px-5 py-3 relative overflow-hidden min-w-[140px]">
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${bar}`} />
      <div className="text-xs text-sub pl-2">{label}</div>
      <div className="text-2xl font-bold text-navy-deep pl-2">{value}</div>
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c));
}
