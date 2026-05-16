'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ArticleEditor({
  articleId,
  initialHtml,
  initialMeta,
}: {
  articleId: string;
  initialHtml: string;
  initialMeta: string;
}) {
  const router = useRouter();
  const [html, setHtml] = useState(initialHtml);
  const [meta, setMeta] = useState(initialMeta);
  const [tab, setTab] = useState<'preview' | 'html' | 'meta'>('preview');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const wordCount = html.replace(/<[^>]+>/g, '').length;

  const save = async () => {
    setSaving(true);
    const res = await fetch(`/api/articles/${articleId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bodyHtml: html, metaDescription: meta }),
    });
    if (res.ok) setSavedAt(new Date());
    setSaving(false);
  };

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(html);
    alert('HTMLをクリップボードにコピーしました');
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
    const res = await fetch(`/api/articles/${articleId}`, { method: 'DELETE' });
    if (res.ok) {
      router.push('/articles');
      router.refresh();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded p-1">
          <TabButton active={tab === 'preview'} onClick={() => setTab('preview')}>プレビュー</TabButton>
          <TabButton active={tab === 'html'} onClick={() => setTab('html')}>HTML</TabButton>
          <TabButton active={tab === 'meta'} onClick={() => setTab('meta')}>メタディスクリプション</TabButton>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-500">{wordCount}文字</span>
          {savedAt && <span className="text-xs text-green-600">保存済 {savedAt.toLocaleTimeString('ja-JP')}</span>}
          <button onClick={save} disabled={saving} className="btn-primary text-sm">{saving ? '保存中…' : '保存'}</button>
          <button onClick={copyToClipboard} className="btn-secondary text-sm">HTMLコピー</button>
          <button onClick={exportMarkdown} className="btn-secondary text-sm">Markdownダウンロード</button>
          <button onClick={deleteArticle} className="btn-danger text-sm">削除</button>
        </div>
      </div>

      {tab === 'preview' && (
        <div className="card p-8 prose prose-slate max-w-none">
          <div
            className="article-preview"
            dangerouslySetInnerHTML={{ __html: html }}
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
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
        active ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  );
}
