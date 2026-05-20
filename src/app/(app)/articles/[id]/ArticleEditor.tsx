'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { sanitizeHtml } from '@/lib/sanitize';

interface Advice {
  category: string;
  suggestion: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  experience: '経験談',
  data: '一次データ',
  expert: '専門家コメント',
  visual: 'ビジュアル',
  niche: 'ニッチ情報',
};

export default function ArticleEditor({
  articleId,
  initialHtml,
  initialMeta,
  initialAdvice,
}: {
  articleId: string;
  initialHtml: string;
  initialMeta: string;
  initialAdvice?: Advice[];
}) {
  const router = useRouter();
  const [html, setHtml] = useState(initialHtml);
  const [meta, setMeta] = useState(initialMeta);
  const [tab, setTab] = useState<'preview' | 'html' | 'meta' | 'advice'>('preview');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [advice, setAdvice] = useState<Advice[]>(initialAdvice || []);
  const [adviceLoading, setAdviceLoading] = useState(false);

  const wordCount = html.replace(/<[^>]+>/g, '').length;
  const safeHtml = useMemo(() => sanitizeHtml(html), [html]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/articles/${articleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bodyHtml: html, metaDescription: meta }),
      });
      if (res.ok) {
        setSavedAt(new Date());
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '保存に失敗しました');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(html);
      alert('HTMLをクリップボードにコピーしました');
    } catch (err) {
      setError('クリップボードへのコピーに失敗しました');
    }
  };

  const exportMarkdown = () => {
    const md = html
      .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n')
      .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n')
      .replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n')
      .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
      .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
      .replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1')
      .replace(/<\/?(ul|ol|p|table|tbody|tr|td|th)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\n\s*\n+/g, '\n\n')
      .trim();
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `article-${articleId}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const deleteArticle = async () => {
    if (!confirm('この記事を削除しますか？この操作は取り消せません。')) return;
    setError(null);
    try {
      const res = await fetch(`/api/articles/${articleId}`, { method: 'DELETE' });
      if (res.ok) {
        router.push('/articles');
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '削除に失敗しました');
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const generateAdvice = async () => {
    setAdviceLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/generate/advice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'アドバイス生成に失敗しました');
        return;
      }
      setAdvice(data.advices);
      setTab('advice');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAdviceLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded p-1 overflow-x-auto max-w-full">
          <TabButton active={tab === 'preview'} onClick={() => setTab('preview')}>プレビュー</TabButton>
          <TabButton active={tab === 'html'} onClick={() => setTab('html')}>HTML</TabButton>
          <TabButton active={tab === 'meta'} onClick={() => setTab('meta')}>メタ</TabButton>
          <TabButton active={tab === 'advice'} onClick={() => setTab('advice')}>
            アドバイス{advice.length > 0 && ` (${advice.length})`}
          </TabButton>
        </div>
        <div className="flex items-center gap-2 text-sm flex-wrap">
          <span className="text-slate-500">{wordCount}文字</span>
          {savedAt && <span className="text-xs text-green-600">保存済 {savedAt.toLocaleTimeString('ja-JP')}</span>}
          <button onClick={save} disabled={saving} className="btn-primary text-sm">{saving ? '保存中…' : '保存'}</button>
          <button onClick={copyToClipboard} className="btn-secondary text-sm">HTMLコピー</button>
          <button onClick={exportMarkdown} className="btn-secondary text-sm">MDダウンロード</button>
          <button onClick={deleteArticle} className="btn-danger text-sm">削除</button>
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-600 hover:text-red-800 text-xs ml-2">×</button>
        </div>
      )}

      {tab === 'preview' && (
        <div className="card p-8 prose prose-slate max-w-none">
          <div
            className="article-preview"
            dangerouslySetInnerHTML={{ __html: safeHtml }}
          />
          <style>{`
            .article-preview h2 { font-size: 1.5rem; font-weight: 700; margin-top: 2rem; margin-bottom: 0.75rem; color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.25rem; }
            .article-preview h3 { font-size: 1.2rem; font-weight: 700; margin-top: 1.5rem; margin-bottom: 0.5rem; color: #1e293b; }
            .article-preview h4 { font-size: 1.05rem; font-weight: 700; margin-top: 1rem; margin-bottom: 0.5rem; color: #334155; }
            .article-preview p { margin: 0.75rem 0; line-height: 1.85; color: #1e293b; }
            .article-preview ul, .article-preview ol { padding-left: 1.5rem; margin: 0.5rem 0; }
            .article-preview li { margin: 0.25rem 0; line-height: 1.7; }
            .article-preview strong { color: #4f46e5; font-weight: 700; }
            .article-preview table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
            .article-preview th, .article-preview td { border: 1px solid #cbd5e1; padding: 0.5rem; text-align: left; }
            .article-preview th { background-color: #f1f5f9; font-weight: 600; }
          `}</style>
        </div>
      )}

      {tab === 'html' && (
        <textarea
          className="input font-mono text-xs leading-relaxed min-h-[500px]"
          value={html}
          onChange={(e) => setHtml(e.target.value)}
        />
      )}

      {tab === 'meta' && (
        <div className="card p-6">
          <label className="label">メタディスクリプション（120字以内推奨）</label>
          <textarea
            className="input min-h-[120px]"
            value={meta}
            onChange={(e) => setMeta(e.target.value)}
            maxLength={200}
          />
          <div className="mt-1 text-xs text-slate-500 text-right">{meta.length}/120</div>
        </div>
      )}

      {tab === 'advice' && (
        <div className="card p-6 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-bold">SEOアドバイス（要件定義書 5.6.3）</h2>
              <p className="text-xs text-slate-500 mt-1">
                AIが生成した本文に対し、より上位表示するために人間が追加すべき独自性のあるコンテンツを5つ提案します。
              </p>
            </div>
            <button onClick={generateAdvice} disabled={adviceLoading} className="btn-primary text-sm">
              {adviceLoading ? '生成中…' : advice.length > 0 ? '再生成' : 'アドバイス生成'}
            </button>
          </div>

          {advice.length === 0 && !adviceLoading && (
            <p className="text-sm text-slate-500 text-center py-8">
              「アドバイス生成」ボタンを押すと、E-E-A-T観点で5つの改善提案が表示されます。
            </p>
          )}

          {advice.length > 0 && (
            <ul className="space-y-2">
              {advice.map((a, i) => (
                <li key={i} className="border border-slate-200 rounded p-3 bg-slate-50">
                  <div className="text-xs font-medium text-brand-700 mb-1">
                    {CATEGORY_LABELS[a.category] || a.category}
                  </div>
                  <div className="text-sm text-slate-800">{a.suggestion}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded text-sm font-medium transition-colors whitespace-nowrap ${
        active ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  );
}
