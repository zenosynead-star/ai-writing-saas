'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';

// react-force-graph-2d は canvas 描画(WebGL不要)。SSR 不可なのでクライアントのみ。
const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

interface GNode {
  id: string;
  title: string;
  keyword: string; // ターゲットKW（可視化の主ラベル）
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

const idOf = (v: string | { id: string }) => (typeof v === 'object' ? v.id : v);

export default function LinkGraph() {
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<GNode | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
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
      if (wrapRef.current) {
        setSize({ w: wrapRef.current.clientWidth, h: Math.max(420, window.innerHeight - 360) });
      }
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [data]);

  // react-force-graph は渡した links を mutate するためコピーを渡す（元 data.links は string id のまま保つ）
  const graphData = useMemo(
    () => (data ? { nodes: data.nodes.map((n) => ({ ...n })), links: data.links.map((l) => ({ ...l })) } : { nodes: [], links: [] }),
    [data],
  );

  // KW→KW のリンク関係を集計（data.links は string id のまま＝mutate を受けない）
  const { outMap, inMap, linkList, orphans } = useMemo(() => {
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
    const linkList = [...outMap.entries()]
      .map(([sid, targets]) => ({ source: byId.get(sid)!, targets }))
      .filter((e) => e.source)
      .sort((a, b) => b.targets.length - a.targets.length);
    const orphans = (data?.nodes || []).filter((n) => n.inDegree === 0 && n.outDegree === 0);
    return { outMap, inMap, linkList, orphans };
  }, [data]);

  // 選択中ノードの「関連ノード集合」（自分＋飛び先＋飛んでくる元）。これ以外は薄く描く。
  const neighborIds = useMemo(() => {
    if (!selected) return null;
    const s = new Set<string>([selected.id]);
    (outMap.get(selected.id) || []).forEach((n) => s.add(n.id));
    (inMap.get(selected.id) || []).forEach((n) => s.add(n.id));
    return s;
  }, [selected, outMap, inMap]);

  const isHub = (n: GNode) => n.inDegree >= 3;
  const nodeFill = (n: GNode) => (isHub(n) ? '#f59e0b' : '#16a394'); // ハブ=琥珀 / 通常=ティール
  const nodeRadius = (n: GNode) => 4 + Math.min(n.inDegree, 8) * 1.4;
  const linkTouchesSel = (l: GLink) => !!selected && (idOf(l.source) === selected.id || idOf(l.target) === selected.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy-deep">内部リンクマップ</h1>
        <p className="text-sm text-sub mt-1">
          <strong>公開中の記事</strong>をキーワードで表示。線は記事間の内部リンク（矢印＝リンクの向き）。
          <strong>ノードをクリックすると、そのKWに出入りするリンクだけが強調</strong>され、どこからどこへ飛んでいるかを追えます。
          下の「リンク一覧」でも一覧できます。
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

      <div className="card overflow-hidden relative bg-[#f7f9fc]" ref={wrapRef}>
        {!data && <div className="p-16 text-center text-sub text-sm">グラフを読み込み中…</div>}
        {data && data.nodes.length === 0 && (
          <div className="p-16 text-center text-sub text-sm">公開中の記事がまだありません。</div>
        )}
        {data && data.nodes.length > 0 && (
          <>
            <ForceGraph2D
              graphData={graphData}
              width={size.w}
              height={size.h}
              backgroundColor="#f7f9fc"
              cooldownTicks={120}
              d3VelocityDecay={0.3}
              nodeRelSize={1}
              nodeLabel={(n: object) => {
                const node = n as GNode;
                return `<div style="background:#171951;color:#fff;padding:5px 9px;border-radius:6px;font-size:12px;max-width:300px;font-weight:700">${escapeHtml(node.keyword)}<br><span style="font-weight:400;opacity:.8">${escapeHtml(node.title)}<br>飛ぶ先→${node.outDegree} / 飛んでくる←${node.inDegree}</span></div>`;
              }}
              nodeCanvasObject={(n: object, ctx: CanvasRenderingContext2D, globalScale: number) => {
                const node = n as GNode;
                const x = node.x ?? 0;
                const y = node.y ?? 0;
                const r = nodeRadius(node);
                const faded = !!neighborIds && !neighborIds.has(node.id);
                // ノード円
                ctx.beginPath();
                ctx.arc(x, y, r, 0, 2 * Math.PI);
                ctx.fillStyle = faded ? 'rgba(148,163,184,0.35)' : nodeFill(node);
                ctx.fill();
                if (selected?.id === node.id) {
                  ctx.lineWidth = 2 / globalScale;
                  ctx.strokeStyle = '#171951';
                  ctx.stroke();
                }
                // KWラベル（白ピル＋濃紺文字。常時表示）
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
                  ctx.fillStyle = 'rgba(255,255,255,0.88)';
                  ctx.fillRect(x - tw / 2 - px, ly - py, tw + px * 2, fontSize + py * 2);
                }
                ctx.fillStyle = faded ? 'rgba(100,116,139,0.45)' : '#171951';
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
                const link = l as GLink;
                if (!selected) return 'rgba(148,163,184,0.4)';
                return linkTouchesSel(link) ? 'rgba(22,163,148,0.95)' : 'rgba(203,213,225,0.18)';
              }}
              linkWidth={(l: object) => (linkTouchesSel(l as GLink) ? 2.5 : 1)}
              linkDirectionalArrowLength={(l: object) => (linkTouchesSel(l as GLink) ? 4.5 : 2.5)}
              linkDirectionalArrowRelPos={1}
              linkDirectionalArrowColor={(l: object) => (linkTouchesSel(l as GLink) ? '#0f766e' : 'rgba(148,163,184,0.5)')}
              onNodeClick={(n: object) => setSelected((prev) => (prev?.id === (n as GNode).id ? null : (n as GNode)))}
              onBackgroundClick={() => setSelected(null)}
            />
            <div className="absolute top-2 right-3 text-[11px] text-sub bg-white/80 rounded px-2 py-1 pointer-events-none">
              ドラッグで移動・スクロールで拡大／ノードをクリックで関連リンクを強調・背景クリックで解除
            </div>
          </>
        )}
      </div>

      {selected && (
        <div className="card p-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-bold text-navy truncate">{selected.keyword}</div>
              <div className="text-xs text-sub mt-0.5 truncate">{selected.title}</div>
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
              <span className="text-sub">このKWから飛ぶ先: </span>
              <KwLinks nodes={outMap.get(selected.id)!} color="teal" />
            </div>
          )}
          {(inMap.get(selected.id)?.length ?? 0) > 0 && (
            <div className="text-xs">
              <span className="text-sub">このKWへ飛んでくる元: </span>
              <KwLinks nodes={inMap.get(selected.id)!} color="navy" />
            </div>
          )}
        </div>
      )}

      {/* どのKWからどのKWへ飛んでいるか（明示一覧） */}
      {data && data.nodes.length > 0 && (
        <div className="card p-5">
          <h2 className="section-title mb-3">リンク一覧（どのKWからどのKWへ飛んでいるか）</h2>
          {linkList.length === 0 ? (
            <p className="text-sm text-sub">内部リンクがまだありません。記事内に他の公開記事へのリンク（関連記事など）を入れると、ここに表示されます。</p>
          ) : (
            <ul className="divide-y divide-line">
              {linkList.map(({ source, targets }) => (
                <li key={source.id} className="py-2.5 text-sm leading-relaxed">
                  <button
                    type="button"
                    onClick={() => setSelected(source)}
                    className="font-bold text-navy hover:underline text-left"
                  >
                    {source.keyword}
                  </button>
                  <span className="text-sub mx-1.5">→</span>
                  <KwLinks nodes={targets} color="teal" onPick={setSelected} />
                </li>
              ))}
            </ul>
          )}

          {orphans.length > 0 && (
            <div className="mt-4 pt-3 border-t border-line">
              <div className="text-xs font-bold text-amber-600 mb-1.5">
                どこからもリンクされていない公開記事（{orphans.length}件・内部リンク追加を推奨）
              </div>
              <div className="text-xs">
                <KwLinks nodes={orphans} color="amber" onPick={setSelected} />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-4 text-xs text-sub">
        <Legend color="#f59e0b" label="被リンク多（ハブ＝SEO上重要）" />
        <Legend color="#16a394" label="公開記事" />
        <span>● 大きいノード = 被リンクが多い ／ ラベル = 記事のキーワード</span>
      </div>
    </div>
  );
}

/** KW のリンク列（読点区切り）。クリックでそのノードを選択（グラフ強調）。 */
function KwLinks({ nodes, color, onPick }: { nodes: GNode[]; color: 'teal' | 'navy' | 'amber'; onPick?: (n: GNode) => void }) {
  const cls = color === 'navy' ? 'text-navy' : color === 'amber' ? 'text-amber-700' : 'text-teal-mid';
  return (
    <>
      {nodes.map((t, i) => (
        <span key={t.id}>
          {i > 0 && <span className="text-line">、</span>}
          {onPick ? (
            <button type="button" onClick={() => onPick(t)} className={`${cls} hover:underline`}>
              {t.keyword}
            </button>
          ) : (
            <Link href={`/articles/${t.id}`} className={`${cls} hover:underline`}>
              {t.keyword}
            </Link>
          )}
        </span>
      ))}
    </>
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

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block w-3 h-3 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c));
}
