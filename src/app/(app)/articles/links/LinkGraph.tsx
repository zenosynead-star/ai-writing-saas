'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import * as THREE from 'three';

// react-force-graph-3d は three.js / WebGL 依存で SSR 不可。クライアントのみで読み込む。
const ForceGraph3D = dynamic(() => import('react-force-graph-3d'), { ssr: false });

interface GNode {
  id: string;
  title: string;
  keyword: string; // ターゲットKW（可視化の主ラベル）
  status: string;
  outDegree: number;
  inDegree: number;
}
interface GLink {
  source: string;
  target: string;
}
interface GraphData {
  nodes: GNode[];
  links: GLink[];
  stats: { articles: number; links: number; orphans: number };
}

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
        setSize({ w: wrapRef.current.clientWidth, h: Math.max(480, window.innerHeight - 320) });
      }
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [data]);

  // react-force-graph はオブジェクトを mutate するためコピーして渡す（data.links は元のまま保つ）
  const graphData = useMemo(
    () => (data ? { nodes: data.nodes.map((n) => ({ ...n })), links: data.links.map((l) => ({ ...l })) } : { nodes: [], links: [] }),
    [data],
  );

  // KW→KW のリンク関係を集計（data.links は string id のまま＝force-graph の mutate を受けない）
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

  const colorFor = (n: GNode) => {
    if (n.inDegree >= 3) return '#f6b73c'; // 被リンク多 = ハブ(マネーページ等)を強調
    if (n.status === 'failed') return '#dd2a2a';
    return '#20c3ac'; // 公開記事(ティール)
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy-deep">内部リンクマップ</h1>
        <p className="text-sm text-sub mt-1">
          <strong>公開中の記事</strong>をノード、記事間の内部リンクを矢印で表示します。各ノードのラベルはその記事のキーワードです。
          下の「リンク一覧」で、どのキーワードからどのキーワードへ飛んでいるかを一覧できます。
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

      <div className="card overflow-hidden relative" ref={wrapRef}>
        {!data && <div className="p-16 text-center text-sub text-sm">グラフを読み込み中…</div>}
        {data && data.nodes.length === 0 && (
          <div className="p-16 text-center text-sub text-sm">公開中の記事がまだありません。</div>
        )}
        {data && data.nodes.length > 0 && (
          <ForceGraph3D
            graphData={graphData}
            width={size.w}
            height={size.h}
            backgroundColor="#0e0d3a"
            nodeLabel={(n: object) => {
              const node = n as GNode;
              return `<div style="background:#fff;color:#171951;padding:6px 10px;border-radius:6px;font-size:12px;max-width:300px;font-weight:700">${escapeHtml(node.keyword)}<br><span style="font-weight:400;color:#717171">${escapeHtml(node.title)}<br>飛ぶ先→${node.outDegree} / 飛んでくる←${node.inDegree}</span></div>`;
            }}
            nodeColor={(n: object) => colorFor(n as GNode)}
            nodeVal={(n: object) => 1 + (n as GNode).inDegree * 2}
            nodeOpacity={0.95}
            nodeThreeObjectExtend={true}
            nodeThreeObject={(n: object) => makeLabelSprite((n as GNode).keyword)}
            linkColor={() => 'rgba(32,195,172,0.55)'}
            linkWidth={0.7}
            linkDirectionalArrowLength={4}
            linkDirectionalArrowRelPos={1}
            linkDirectionalParticles={2}
            linkDirectionalParticleWidth={1.6}
            linkDirectionalParticleColor={() => '#f6b73c'}
            onNodeClick={(n: object) => setSelected(n as GNode)}
          />
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
                  <Link href={`/articles/${source.id}`} className="font-bold text-navy hover:underline">
                    {source.keyword}
                  </Link>
                  <span className="text-sub mx-1.5">→</span>
                  <KwLinks nodes={targets} color="teal" />
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
                <KwLinks nodes={orphans} color="amber" />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-4 text-xs text-sub">
        <Legend color="#f6b73c" label="被リンク多（ハブ＝SEO上重要）" />
        <Legend color="#20c3ac" label="公開記事" />
        <span>● 大きいノード = 被リンクが多い ／ ラベル = 記事のキーワード</span>
      </div>
    </div>
  );
}

/** KW のリンク列（カンマ区切り）。記事編集ページへのリンク。 */
function KwLinks({ nodes, color }: { nodes: GNode[]; color: 'teal' | 'navy' | 'amber' }) {
  const cls = color === 'navy' ? 'text-navy' : color === 'amber' ? 'text-amber-700' : 'text-teal-mid';
  return (
    <>
      {nodes.map((t, i) => (
        <span key={t.id}>
          {i > 0 && <span className="text-line">、</span>}
          <Link href={`/articles/${t.id}`} className={`${cls} hover:underline`}>
            {t.keyword}
          </Link>
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

/**
 * 3Dノードに常時表示するキーワードのテキストラベル（three の CanvasTexture スプライト）。
 * three-spritetext 等の追加依存なしで「記事のKWを可視化」する。nodeThreeObjectExtend=true で
 * 既定の球体に重ねて表示する。
 */
function makeLabelSprite(text: string): THREE.Sprite {
  const label = (text || '').length > 18 ? `${text.slice(0, 17)}…` : text || '（無題）';
  const fontSize = 40;
  const pad = 12;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = `700 ${fontSize}px sans-serif`;
  const textW = ctx.measureText(label).width;
  canvas.width = Math.ceil(textW + pad * 2);
  canvas.height = Math.ceil(fontSize + pad * 2);
  // canvas リサイズで ctx 状態が戻るので再設定
  ctx.font = `700 ${fontSize}px sans-serif`;
  ctx.textBaseline = 'middle';
  const w = canvas.width;
  const h = canvas.height;
  const r = 10;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(w, 0, w, h, r);
  ctx.arcTo(w, h, 0, h, r);
  ctx.arcTo(0, h, 0, 0, r);
  ctx.arcTo(0, 0, w, 0, r);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#171951';
  ctx.fillText(label, pad, h / 2 + 1);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  const textHeight = 6; // world units
  sprite.scale.set((textHeight * w) / h, textHeight, 1);
  sprite.position.set(0, 8, 0); // ノードの少し上に表示
  return sprite;
}
