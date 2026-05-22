'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ProgressBar } from '@/components/ProgressBar';

interface AnalyzeResult {
  url: string;
  title: string;
  metaDescription: string;
  headings: Array<{ level: number; text: string; children: AnalyzeResult['headings'] }>;
  headingsMarkdown: string;
  paragraphCount: number;
  wordCount: number;
  bodyPreview: string;
}

type RewriteMode = 'structure_preserve' | 'restructure' | 'partial';

const MODE_LABELS: Record<RewriteMode, { title: string; desc: string }> = {
  structure_preserve: {
    title: '構成維持・本文改善',
    desc: '見出し構造は変えず、本文を改善する。情報追加・冗長削除・E-E-A-T強化',
  },
  restructure: {
    title: '構成も再設計',
    desc: 'SEO観点で見出し構成自体を最適化。重複統合・抜け補完・FAQ追加',
  },
  partial: {
    title: '部分リライト',
    desc: 'リード文とまとめのみ刷新。中間見出しは触らない',
  },
};

export default function RewritePanel() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [mode, setMode] = useState<RewriteMode>('structure_preserve');
  const [additionalInstruction, setAdditionalInstruction] = useState('');
  const [model, setModel] = useState<'low_cost' | 'balanced' | 'high_quality'>('balanced');
  const [error, setError] = useState<string | null>(null);

  const analyze = async () => {
    setError(null);
    setResult(null);
    if (!url.trim()) {
      setError('URLを入力してください');
      return;
    }
    setAnalyzing(true);
    try {
      const res = await fetch('/api/rewrite/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '解析に失敗しました');
        return;
      }
      setResult(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAnalyzing(false);
    }
  };

  const generateRewrite = async () => {
    setError(null);
    if (!result) return;
    setGenerating(true);
    try {
      const res = await fetch('/api/rewrite/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: result.url,
          mode,
          additionalInstruction: additionalInstruction.trim() || undefined,
          model,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'リライト生成に失敗しました');
        return;
      }
      router.push(`/articles/${data.articleId}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Step 1: URL入力 */}
      <div className="card p-6 space-y-3">
        <div>
          <label className="label">1. リライト対象のURL</label>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              type="url"
              placeholder="https://example.com/article/123"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <button onClick={analyze} disabled={analyzing} className="btn-primary whitespace-nowrap">
              {analyzing ? '解析中…' : '解析'}
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-500">公開されているHTMLページのURL（最大2MB、20秒以内に取得できるもの）</p>
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">{error}</div>
      )}

      {/* Step 2: 解析結果プレビュー */}
      {result && (
        <div className="card p-6 space-y-4">
          <h2 className="font-bold">2. 解析結果</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div className="bg-slate-50 rounded p-3">
              <div className="text-xs text-slate-500">文字数</div>
              <div className="text-lg font-bold mt-1">{result.wordCount.toLocaleString()}</div>
            </div>
            <div className="bg-slate-50 rounded p-3">
              <div className="text-xs text-slate-500">段落数</div>
              <div className="text-lg font-bold mt-1">{result.paragraphCount}</div>
            </div>
            <div className="bg-slate-50 rounded p-3">
              <div className="text-xs text-slate-500">見出し数</div>
              <div className="text-lg font-bold mt-1">
                {countHeadings(result.headings)}
              </div>
            </div>
          </div>

          <div>
            <div className="text-xs font-medium text-slate-700">タイトル</div>
            <div className="text-sm text-slate-900 mt-1">{result.title}</div>
          </div>

          {result.metaDescription && (
            <div>
              <div className="text-xs font-medium text-slate-700">メタディスクリプション</div>
              <div className="text-sm text-slate-700 mt-1">{result.metaDescription}</div>
            </div>
          )}

          <div>
            <div className="text-xs font-medium text-slate-700">見出し構造</div>
            <div className="mt-1 max-h-64 overflow-y-auto text-sm bg-slate-50 rounded p-3 font-mono whitespace-pre-wrap">
              {result.headingsMarkdown || '(見出しなし)'}
            </div>
          </div>

          {result.bodyPreview && (
            <details className="text-sm">
              <summary className="cursor-pointer text-xs font-medium text-slate-700">本文プレビュー（最初の5段落）</summary>
              <div className="mt-2 text-slate-700 bg-slate-50 rounded p-3 whitespace-pre-wrap">
                {result.bodyPreview}
              </div>
            </details>
          )}
        </div>
      )}

      {/* Step 3: リライト設定 */}
      {result && (
        <div className="card p-6 space-y-4">
          <h2 className="font-bold">3. リライト設定</h2>

          <div>
            <label className="label">リライトモード</label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {(Object.keys(MODE_LABELS) as RewriteMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`p-3 rounded-lg border text-left transition-colors ${
                    mode === m
                      ? 'border-brand-500 bg-brand-50'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="font-bold text-slate-900 text-sm">{MODE_LABELS[m].title}</div>
                  <div className="text-xs text-slate-600 mt-1">{MODE_LABELS[m].desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">追加指示（任意）</label>
            <textarea
              className="input min-h-[80px]"
              placeholder="例: もっと初心者向けに、専門用語を減らしてください。"
              value={additionalInstruction}
              onChange={(e) => setAdditionalInstruction(e.target.value.slice(0, 1000))}
            />
            <div className="text-xs text-slate-500 text-right mt-1">{additionalInstruction.length}/1000</div>
          </div>

          <div>
            <label className="label">AIモデル</label>
            <div className="grid grid-cols-3 gap-2">
              {(['low_cost', 'balanced', 'high_quality'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setModel(m)}
                  className={`px-3 py-2 rounded text-sm font-medium border ${
                    model === m
                      ? 'bg-brand-600 text-white border-brand-600'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {m === 'low_cost' ? '標準' : m === 'balanced' ? '高性能' : '最高性能'}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              ※ 無料tierのため、Flash/Proは混雑時にFlash-Liteへ自動フォールバック
            </p>
          </div>

          <button
            onClick={generateRewrite}
            disabled={generating}
            className="btn-primary w-full py-3"
          >
            {generating ? 'リライト生成中…' : 'リライトを生成する'}
          </button>
          {generating && (
            <div className="bg-brand-50 border border-brand-200 rounded-lg p-4">
              <ProgressBar
                active={true}
                estimateSec={model === 'high_quality' ? 70 : model === 'balanced' ? 50 : 35}
                label="リライト生成中(URL取得→解析→AI再生成)"
              />
              <div className="mt-2 text-xs text-slate-600">
                完了後に新規記事として自動で保存され、編集画面に遷移します。
              </div>
            </div>
          )}
        </div>
      )}

      {analyzing && (
        <div className="bg-brand-50 border border-brand-200 rounded-lg p-4">
          <ProgressBar active={true} estimateSec={8} label="ページを取得・解析中" />
        </div>
      )}
    </div>
  );
}

function countHeadings(nodes: AnalyzeResult['headings']): number {
  let c = 0;
  const walk = (arr: AnalyzeResult['headings']) => {
    for (const n of arr) {
      c++;
      if (n.children) walk(n.children);
    }
  };
  walk(nodes);
  return c;
}
