'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';

// react-force-graph-3d は three.js / WebGL 依存で SSR 不可。クライアントのみで読み込む。
const ForceGraph3D = dynamic(() => import('react-force-graph-3d'), { ssr: false });

interface GNode {
  id: string;
  title: string;
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

  // react-force-graph はオブジェクトを mutate するためコピーして渡す
  const graphData = useMemo(
    () => (data ? { nodes: data.nodes.map((n) => ({ ...n })), links: data.links.map((l) => ({ ...l })) } : { nodes: [], links: [] }),
    [data],
  );

  const colorFor = (n: GNode) => {
    if (n.status === 'completed') return '#20c3ac'; // ティール
    if (n.status === 'generating') return '#f59e0b';
    if (n.status === 'failed') return '#dd2a2a';
    return '#94a3b8'; // draft = グレー
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy-deep">内部リンク 3Dマップ</h1>
        <p className="text-sm text-sub mt-1">
          各記事をノード、記事間の内部リンクを矢印で表示します。ドラッグで回転・スクロールでズーム・ノードクリックで詳細。
        </p>
      </div>

      {data && (
        <div className="flex flex-wrap gap-3">
          <Stat label="記事数" value={data.stats.articles} accent="navy" />
          <Stat label="内部リンク数" value={data.stats.links} accent="teal" />
          <Stat label="孤立記事(リンクなし)" value={data.stats.orphans} accent={data.stats.orphans > 0 ? 'amber' : 'teal'} />
        </div>
      )}

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">{error}</div>}

      <div className="card overflow-hidden relative" ref={wrapRef}>
        {!data && <div className="p-16 text-center text-sub text-sm">グラフを読み込み中…</div>}
        {data && data.nodes.length === 0 && (
          <div className="p-16 text-center text-sub text-sm">記事がまだありません。</div>
        )}
        {data && data.nodes.length > 0 && (
          <ForceGraph3D
            graphData={graphData}
            width={size.w}
            height={size.h}
            backgroundColor="#0e0d3a"
            nodeLabel={(n: object) => {
              const node = n as GNode;
              return `<div style="background:#fff;color:#171951;padding:6px 10px;border-radius:6px;font-size:12px;max-width:280px;font-weight:700">${escapeHtml(node.title)}<br><span style="font-weight:400;color:#717171">→${node.outDegree} / ←${node.inDegree}</span></div>`;
            }}
            nodeColor={(n: object) => colorFor(n as GNode)}
            nodeVal={(n: object) => 1 + (n as GNode).inDegree * 2}
            nodeOpacity={0.95}
            linkColor={() => 'rgba(32,195,172,0.5)'}
            linkWidth={0.6}
            linkDirectionalArrowLength={3.5}
            linkDirectionalArrowRelPos={1}
            linkDirectionalParticles={1}
            linkDirectionalParticleWidth={1.5}
            linkDirectionalParticleColor={() => '#3ead86'}
            onNodeClick={(n: object) => setSelected(n as GNode)}
          />
        )}
      </div>

      {selected && (
        <div className="card p-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-bold text-navy truncate">{selected.title}</div>
            <div className="text-xs text-sub mt-0.5">
              発リンク {selected.outDegree} / 被リンク {selected.inDegree} ・ {statusLabel(selected.status)}
            </div>
          </div>
          <Link href={`/articles/${selected.id}`} className="btn-secondary text-sm shrink-0">記事を開く →</Link>
        </div>
      )}

      <div className="flex flex-wrap gap-4 text-xs text-sub">
        <Legend color="#20c3ac" label="完了" />
        <Legend color="#f59e0b" label="生成中" />
        <Legend color="#94a3b8" label="下書き" />
        <Legend color="#dd2a2a" label="失敗" />
        <span>● 大きいノード = 被リンクが多い(SEO上重要)</span>
      </div>
    </div>
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

function statusLabel(s: string) {
  return s === 'completed' ? '完了' : s === 'generating' ? '生成中' : s === 'failed' ? '失敗' : '下書き';
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c));
}
