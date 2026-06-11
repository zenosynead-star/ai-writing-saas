'use client';

import { useState } from 'react';
import { ProgressBar } from '@/components/ProgressBar';
import type { WizardState } from '../Wizard';

interface HeadingNode {
  level: number;
  text: string;
  children: HeadingNode[];
}

export default function Step3Headings({
  articleId,
  state,
  setState,
  onPrev,
  onNext,
  onCreditsChange,
}: {
  articleId: string;
  state: WizardState;
  setState: (fn: (s: WizardState) => WizardState) => void;
  onPrev: () => void;
  onNext: () => void;
  onCreditsChange: () => void;
}) {
  const initialTree = state.headings.length > 0
    ? rebuildTreeFromFlat(state.headings)
    : [];

  const [tree, setTree] = useState<HeadingNode[]>(initialTree);
  const [persona, setPersona] = useState(state.persona);
  const [searchIntent, setSearchIntent] = useState(state.searchIntent);
  const [latentNeeds, setLatentNeeds] = useState<string[]>(state.latentNeeds);
  const [customInstruction, setCustomInstruction] = useState(state.customInstruction);
  const [useCompetitor, setUseCompetitor] = useState(true);
  const [competitor, setCompetitor] = useState<{ sources: number; avgWordCount: number } | null>(null);
  const [cooccurrenceWords, setCooccurrenceWords] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/generate/headings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleId, customInstruction, useCompetitorAnalysis: useCompetitor }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '見出し生成に失敗しました');
        return;
      }
      setTree(data.headings);
      setPersona(data.estimated_persona || '');
      setSearchIntent(data.search_intent || '');
      setLatentNeeds(data.latent_needs || []);
      setCompetitor(data.competitor || null);
      setCooccurrenceWords(data.cooccurrenceWords || []);
      onCreditsChange();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const updateText = (path: number[], newText: string) => {
    setTree((prev) => {
      const next = structuredClone(prev);
      let nodes = next;
      for (let i = 0; i < path.length - 1; i++) {
        nodes = nodes[path[i]].children;
      }
      nodes[path[path.length - 1]].text = newText;
      return next;
    });
  };

  const removeNode = (path: number[]) => {
    setTree((prev) => {
      const next = structuredClone(prev);
      let nodes = next;
      for (let i = 0; i < path.length - 1; i++) {
        nodes = nodes[path[i]].children;
      }
      nodes.splice(path[path.length - 1], 1);
      return next;
    });
  };

  const moveUp = (path: number[]) => {
    setTree((prev) => {
      const next = structuredClone(prev);
      let nodes = next;
      for (let i = 0; i < path.length - 1; i++) {
        nodes = nodes[path[i]].children;
      }
      const i = path[path.length - 1];
      if (i === 0) return prev;
      [nodes[i - 1], nodes[i]] = [nodes[i], nodes[i - 1]];
      return next;
    });
  };

  const moveDown = (path: number[]) => {
    setTree((prev) => {
      const next = structuredClone(prev);
      let nodes = next;
      for (let i = 0; i < path.length - 1; i++) {
        nodes = nodes[path[i]].children;
      }
      const i = path[path.length - 1];
      if (i === nodes.length - 1) return prev;
      [nodes[i], nodes[i + 1]] = [nodes[i + 1], nodes[i]];
      return next;
    });
  };

  const addSibling = (path: number[]) => {
    setTree((prev) => {
      const next = structuredClone(prev);
      let nodes = next;
      for (let i = 0; i < path.length - 1; i++) {
        nodes = nodes[path[i]].children;
      }
      const i = path[path.length - 1];
      const level = nodes[i]?.level ?? 2;
      nodes.splice(i + 1, 0, { level, text: '新しい見出し', children: [] });
      return next;
    });
  };

  const addChild = (path: number[]) => {
    setTree((prev) => {
      const next = structuredClone(prev);
      let nodes = next;
      for (let i = 0; i < path.length; i++) {
        if (i === path.length - 1) {
          const parent = nodes[path[i]];
          parent.children.push({ level: parent.level + 1, text: '新しい見出し', children: [] });
        } else {
          nodes = nodes[path[i]].children;
        }
      }
      return next;
    });
  };

  const addTopLevel = () => {
    setTree((prev) => [...prev, { level: 2, text: '新しいh2見出し', children: [] }]);
  };

  const saveAndNext = async () => {
    if (tree.length === 0) {
      setError('見出しを少なくとも1つ作成してください');
      return;
    }
    setLoading(true);
    const flatHeadings = flattenTree(tree);
    const res = await fetch(`/api/articles/${articleId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        persona,
        searchIntent,
        latentNeeds,
        customInstruction,
        headings: flatHeadings,
      }),
    });
    setLoading(false);
    if (res.ok) {
      const data = await res.json();
      setState((s) => ({
        ...s,
        persona,
        searchIntent,
        latentNeeds,
        customInstruction,
        headings: data.article.headings,
      }));
      onNext();
    } else {
      setError('保存に失敗しました');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="section-title">ステップ 3: 見出し構成生成</h2>
        <p className="text-sm text-sub mt-2">
          記事の品質を最も左右する工程です。競合上位の見出しを実分析し、E-E-A-TとNeeds Met基準に沿った構成をAIが提案します。
        </p>
      </div>

      <div className="space-y-3">
        <label className="label">追加指示（任意・最終構成に反映）</label>
        <textarea
          className="input min-h-[80px]"
          placeholder="例: 主婦層向けに敬語多めで、メリット・デメリットの比較表を含めてください"
          value={customInstruction}
          onChange={(e) => setCustomInstruction(e.target.value)}
        />
        <label className="flex items-start gap-2.5 p-3 rounded-[5px] bg-bluepaper border border-teal/20 cursor-pointer">
          <input
            type="checkbox"
            checked={useCompetitor}
            onChange={(e) => setUseCompetitor(e.target.checked)}
            className="mt-0.5 accent-teal w-4 h-4"
          />
          <span className="text-sm">
            <span className="font-bold text-navy">競合分析を使う（推奨）</span>
            <span className="block text-xs text-sub mt-0.5">
              検索上位サイトの見出しと共起語を実取得し、網羅性の高い構成を生成します（+10〜30秒）
            </span>
          </span>
        </label>
        <button onClick={generate} disabled={loading} className="btn-primary">
          {loading ? '生成中…' : tree.length > 0 ? '見出し再生成' : 'AIで見出し生成'}
        </button>
        {loading && <ProgressBar active={true} estimateSec={useCompetitor ? 45 : 20} label={useCompetitor ? '競合分析 + 見出し構成生成中' : '見出し構成生成中'} />}
      </div>

      {competitor && competitor.sources > 0 && (
        <div className="rounded-[10px] border border-teal/20 bg-white overflow-hidden">
          <div className="bg-teal-grad px-4 py-2.5 flex items-center gap-2">
            <svg viewBox="0 0 20 20" fill="white" className="w-4 h-4"><path d="M10 2a8 8 0 100 16 8 8 0 000-16zM9 5h2v6H9V5zm0 8h2v2H9v-2z" /></svg>
            <span className="text-sm font-bold text-white">競合分析の結果</span>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex gap-6 text-sm">
              <div>
                <span className="text-sub text-xs block">分析した上位サイト</span>
                <span className="font-bold text-navy-deep text-lg">{competitor.sources}<span className="text-xs font-normal ml-0.5">件</span></span>
              </div>
              <div>
                <span className="text-sub text-xs block">競合の平均文字数</span>
                <span className="font-bold text-navy-deep text-lg">{competitor.avgWordCount.toLocaleString()}<span className="text-xs font-normal ml-0.5">字</span></span>
              </div>
            </div>
            {cooccurrenceWords.length > 0 && (
              <div>
                <span className="text-sub text-xs block mb-1.5">上位記事の共起語（構成に反映済み）</span>
                <div className="flex flex-wrap gap-1.5">
                  {cooccurrenceWords.map((w) => (
                    <span key={w} className="chip">{w}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {(persona || searchIntent || latentNeeds.length > 0) && (
        <div className="bg-brand-50 border border-brand-200 rounded-lg p-4 text-sm space-y-2">
          {persona && (
            <div>
              <span className="font-medium text-brand-700">推定ペルソナ:</span>{' '}
              <span className="text-slate-700">{persona}</span>
            </div>
          )}
          {searchIntent && (
            <div>
              <span className="font-medium text-brand-700">検索意図:</span>{' '}
              <span className="text-slate-700">{searchIntent}</span>
            </div>
          )}
          {latentNeeds.length > 0 && (
            <div>
              <span className="font-medium text-brand-700">潜在ニーズ:</span>{' '}
              <span className="text-slate-700">{latentNeeds.join('、')}</span>
            </div>
          )}
        </div>
      )}

      {tree.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-slate-700">見出しツリー（編集・並び替え可能）</div>
            <button onClick={addTopLevel} className="btn-secondary text-xs">+ h2追加</button>
          </div>
          <div className="border border-slate-200 rounded-lg p-3 space-y-1 max-h-[600px] overflow-y-auto">
            <TreeRender
              nodes={tree}
              path={[]}
              onUpdate={updateText}
              onRemove={removeNode}
              onMoveUp={moveUp}
              onMoveDown={moveDown}
              onAddSibling={addSibling}
              onAddChild={addChild}
            />
          </div>
        </div>
      )}

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">{error}</div>}

      <div className="flex justify-between gap-2 pt-4 border-t border-slate-200">
        <button onClick={onPrev} className="btn-secondary">← 戻る</button>
        <button onClick={saveAndNext} disabled={tree.length === 0 || loading} className="btn-primary">
          次へ：オプション →
        </button>
      </div>
    </div>
  );
}

function TreeRender({
  nodes,
  path,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
  onAddSibling,
  onAddChild,
}: {
  nodes: HeadingNode[];
  path: number[];
  onUpdate: (p: number[], t: string) => void;
  onRemove: (p: number[]) => void;
  onMoveUp: (p: number[]) => void;
  onMoveDown: (p: number[]) => void;
  onAddSibling: (p: number[]) => void;
  onAddChild: (p: number[]) => void;
}) {
  return (
    <>
      {nodes.map((node, i) => {
        const childPath = [...path, i];
        const indent = (node.level - 2) * 16;
        return (
          <div key={childPath.join('-')}>
            <div className="flex items-center gap-1 group py-0.5" style={{ paddingLeft: indent }}>
              <span className="text-xs font-bold text-brand-600 w-7">h{node.level}</span>
              <input
                className="flex-1 px-2 py-1 text-sm rounded border border-transparent hover:border-slate-200 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400 bg-transparent"
                value={node.text}
                onChange={(e) => onUpdate(childPath, e.target.value)}
              />
              <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 text-xs">
                <IconBtn onClick={() => onMoveUp(childPath)} title="上へ">↑</IconBtn>
                <IconBtn onClick={() => onMoveDown(childPath)} title="下へ">↓</IconBtn>
                <IconBtn onClick={() => onAddSibling(childPath)} title="同レベルで追加">+</IconBtn>
                {node.level < 6 && <IconBtn onClick={() => onAddChild(childPath)} title="子見出しを追加">⤓</IconBtn>}
                <IconBtn onClick={() => onRemove(childPath)} title="削除" danger>×</IconBtn>
              </div>
            </div>
            {node.children.length > 0 && (
              <TreeRender
                nodes={node.children}
                path={childPath}
                onUpdate={onUpdate}
                onRemove={onRemove}
                onMoveUp={onMoveUp}
                onMoveDown={onMoveDown}
                onAddSibling={onAddSibling}
                onAddChild={onAddChild}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

function IconBtn({ onClick, title, children, danger }: { onClick: () => void; title: string; children: React.ReactNode; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-6 h-6 rounded text-xs flex items-center justify-center ${
        danger ? 'text-red-500 hover:bg-red-50' : 'text-slate-500 hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  );
}

function flattenTree(tree: HeadingNode[]) {
  const out: Array<{ level: number; text: string; parentIdx: number | null; order: number }> = [];
  let order = 0;
  const walk = (nodes: HeadingNode[], parentIdx: number | null) => {
    for (const n of nodes) {
      const idx = out.length;
      out.push({ level: n.level, text: n.text, parentIdx, order: order++ });
      if (n.children.length) walk(n.children, idx);
    }
  };
  walk(tree, null);
  return out;
}

function rebuildTreeFromFlat(
  flat: Array<{ id: string; level: number; text: string; parentId: string | null; order: number }>,
): HeadingNode[] {
  const map = new Map<string, HeadingNode & { id: string }>();
  const roots: HeadingNode[] = [];
  for (const f of flat) {
    map.set(f.id, { id: f.id, level: f.level, text: f.text, children: [] });
  }
  for (const f of flat) {
    const node = map.get(f.id)!;
    if (f.parentId && map.has(f.parentId)) {
      map.get(f.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}
