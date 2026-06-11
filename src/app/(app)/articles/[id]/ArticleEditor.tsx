'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { sanitizeHtml } from '@/lib/sanitize';
import { ProgressBar } from '@/components/ProgressBar';

interface Advice {
  category: string;
  suggestion: string;
}

interface ArticleImageMeta {
  id: string;
  kind: string;
  h2Index: number | null;
  mimeType: string;
  prompt: string;
}

interface WpConnSummary {
  id: string;
  siteUrl: string;
  username: string;
  defaultStatus: string;
  isDefault: boolean;
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
  const [tab, setTab] = useState<'preview' | 'html' | 'meta' | 'advice' | 'pharma' | 'images' | 'publish'>('preview');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [advice, setAdvice] = useState<Advice[]>(initialAdvice || []);
  const [adviceLoading, setAdviceLoading] = useState(false);

  // 薬機法チェック
  interface PharmaFinding { phrase: string; reason: string; suggestion: string; severity: string }
  const [pharma, setPharma] = useState<{ summary: string; risk_level: string; findings: PharmaFinding[] } | null>(null);
  const [pharmaLoading, setPharmaLoading] = useState(false);

  // 画像
  const [images, setImages] = useState<ArticleImageMeta[]>([]);
  const [featuredId, setFeaturedId] = useState<string | null>(null);
  const [imageGenLoading, setImageGenLoading] = useState(false);
  const [imageProgress, setImageProgress] = useState<{ step: number; total: number; label: string }>({ step: 0, total: 0, label: '' });

  // WordPress
  const [wpConns, setWpConns] = useState<WpConnSummary[]>([]);
  const [wpPublishLoading, setWpPublishLoading] = useState(false);
  const [wpStatus, setWpStatus] = useState<'draft' | 'publish' | 'future'>('draft');

  // h2 count (for bulk image generation)
  const [h2Count, setH2Count] = useState(0);

  const wordCount = html.replace(/<[^>]+>/g, '').length;
  const safeHtml = useMemo(() => sanitizeHtml(html), [html]);

  // 初回ロードで画像・WP接続・h2数を取得
  useEffect(() => {
    fetch(`/api/generate/images?articleId=${articleId}`)
      .then((r) => r.json())
      .then((d) => {
        setImages(d.images || []);
        setFeaturedId(d.featuredImageId || null);
      })
      .catch(() => {});
    fetch('/api/wordpress')
      .then((r) => r.json())
      .then((d) => setWpConns(d.connections || []))
      .catch(() => {});
    // count h2 from bodyHtml
    const m = (initialHtml.match(/<h2\b/gi) || []).length;
    setH2Count(m);
  }, [articleId, initialHtml]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/articles/${articleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bodyHtml: html, metaDescription: meta }),
      });
      if (res.ok) setSavedAt(new Date());
      else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '保存に失敗しました');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  /**
   * 画像生成: 1枚ずつ API を呼んで進捗を細かく可視化する
   */
  const generateImages = async (scope: 'all' | 'eyecatch' | 'h2') => {
    setImageGenLoading(true);
    setError(null);
    setInfo(null);

    // 生成タスクのリストを構築
    const tasks: Array<{ label: string; body: Record<string, unknown> }> = [];
    if (scope === 'all' || scope === 'eyecatch') {
      tasks.push({ label: 'アイキャッチ', body: { articleId, scope: 'eyecatch' } });
    }
    if (scope === 'all' || scope === 'h2') {
      for (let i = 0; i < h2Count; i++) {
        tasks.push({ label: `h2見出し #${i + 1}`, body: { articleId, scope: 'h2', h2Index: i } });
      }
    }

    if (tasks.length === 0) {
      setError('生成対象がありません(h2見出しを生成してから再度お試しください)');
      setImageGenLoading(false);
      return;
    }

    setImageProgress({ step: 0, total: tasks.length, label: tasks[0].label });

    let successCount = 0;
    const errorMsgs: string[] = [];
    for (let i = 0; i < tasks.length; i++) {
      setImageProgress({ step: i + 1, total: tasks.length, label: tasks[i].label });
      try {
        const res = await fetch('/api/generate/images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tasks[i].body),
        });
        const data = await res.json();
        if (!res.ok) {
          errorMsgs.push(`${tasks[i].label}: ${data.error || `HTTP ${res.status}`}`);
        } else if (data.errors && data.errors.length > 0) {
          errorMsgs.push(`${tasks[i].label}: ${data.errors[0].error?.slice(0, 80)}`);
        } else {
          successCount++;
        }
      } catch (err) {
        errorMsgs.push(`${tasks[i].label}: ${(err as Error).message}`);
      }
      // 各リクエスト後に画像一覧をリフレッシュ
      try {
        const r = await fetch(`/api/generate/images?articleId=${articleId}`);
        const d = await r.json();
        setImages(d.images || []);
        setFeaturedId(d.featuredImageId || null);
      } catch {}
    }

    setImageGenLoading(false);
    setImageProgress({ step: 0, total: 0, label: '' });

    if (errorMsgs.length > 0) {
      setError(`${errorMsgs.length} 件失敗: ${errorMsgs.slice(0, 2).join(' / ')}`);
    }
    if (successCount > 0) {
      setInfo(`✅ ${successCount} 枚生成完了`);
    }
    setTab('images');
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
      if (!res.ok) { setError(data.error || 'アドバイス生成に失敗しました'); return; }
      setAdvice(data.advices);
      setTab('advice');
    } catch (err) { setError((err as Error).message); }
    finally { setAdviceLoading(false); }
  };

  const runPharmaCheck = async () => {
    setPharmaLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/generate/pharma-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleId }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || '薬機法チェックに失敗しました'); return; }
      setPharma({ summary: data.summary, risk_level: data.risk_level, findings: data.findings });
      setTab('pharma');
    } catch (err) { setError((err as Error).message); }
    finally { setPharmaLoading(false); }
  };

  const publishToWp = async () => {
    if (wpConns.length === 0) {
      setError('WordPress 接続が未設定です。設定 → WordPress 連携で接続してください。');
      return;
    }
    if (!confirm(`WordPress (${wpConns.find((c) => c.isDefault)?.siteUrl ?? wpConns[0].siteUrl}) に「${wpStatus === 'draft' ? '下書き' : wpStatus === 'publish' ? '公開' : '予約'}」で投稿しますか?`)) return;
    setWpPublishLoading(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch('/api/wordpress/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleId, status: wpStatus, uploadImages: true }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'WP投稿に失敗しました'); return; }
      setInfo(`WordPress に投稿成功: ${data.link} (status=${data.status})`);
    } catch (err) { setError((err as Error).message); }
    finally { setWpPublishLoading(false); }
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
    a.href = url; a.download = `article-${articleId}.md`; a.click();
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(html);
    setInfo('HTMLをクリップボードにコピーしました');
  };

  const deleteArticle = async () => {
    if (!confirm('この記事を削除しますか?この操作は取り消せません。')) return;
    const res = await fetch(`/api/articles/${articleId}`, { method: 'DELETE' });
    if (res.ok) { router.push('/articles'); router.refresh(); }
  };

  const eyecatchImg = images.find((i) => i.kind === 'eyecatch');
  const h2Imgs = images.filter((i) => i.kind === 'h2').sort((a, b) => (a.h2Index ?? 0) - (b.h2Index ?? 0));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1 bg-white border border-line rounded-[8px] p-1 overflow-x-auto max-w-full">
          {(['preview', 'html', 'meta', 'advice', 'pharma', 'images', 'publish'] as const).map((t) => (
            <TabButton key={t} active={tab === t} onClick={() => setTab(t)}>
              {t === 'preview' ? 'プレビュー' :
               t === 'html' ? 'HTML' :
               t === 'meta' ? 'メタ' :
               t === 'advice' ? `アドバイス${advice.length > 0 ? ` (${advice.length})` : ''}` :
               t === 'pharma' ? '薬機法チェック' :
               t === 'images' ? `画像${images.length > 0 ? ` (${images.length})` : ''}` :
               'WordPress'}
            </TabButton>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm flex-wrap">
          <span className="text-sub">{wordCount}文字</span>
          {savedAt && <span className="text-xs text-teal-mid">保存済 {savedAt.toLocaleTimeString('ja-JP')}</span>}
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
      {info && (
        <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded p-3 flex items-center justify-between">
          <span>{info}</span>
          <button onClick={() => setInfo(null)} className="text-green-700 hover:text-green-900 text-xs ml-2">×</button>
        </div>
      )}

      {tab === 'preview' && (
        <div className="card p-8 prose prose-slate max-w-none">
          {eyecatchImg && (
            <img src={`/api/images/${eyecatchImg.id}`} alt="アイキャッチ" className="w-full mb-6 rounded-lg" />
          )}
          <div className="article-preview" dangerouslySetInnerHTML={{ __html: safeHtml }} />
          <style>{`
            .article-preview h2 { font-size: 1.5rem; font-weight: 700; margin-top: 2rem; margin-bottom: 0.75rem; color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.25rem; }
            .article-preview h3 { font-size: 1.2rem; font-weight: 700; margin-top: 1.5rem; margin-bottom: 0.5rem; color: #1e293b; }
            .article-preview h4 { font-size: 1.05rem; font-weight: 700; margin-top: 1rem; margin-bottom: 0.5rem; color: #334155; }
            .article-preview p { margin: 0.75rem 0; line-height: 1.85; color: #1e293b; }
            .article-preview ul, .article-preview ol { padding-left: 1.5rem; margin: 0.5rem 0; }
            .article-preview li { margin: 0.25rem 0; line-height: 1.7; }
            .article-preview strong { color: #177f72; font-weight: 700; }
            .article-preview table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
            .article-preview th, .article-preview td { border: 1px solid #cbd5e1; padding: 0.5rem; text-align: left; }
            .article-preview th { background-color: #f1f5f9; font-weight: 600; }
          `}</style>
        </div>
      )}

      {tab === 'html' && (
        <textarea className="input font-mono text-xs leading-relaxed min-h-[500px]" value={html} onChange={(e) => setHtml(e.target.value)} />
      )}

      {tab === 'meta' && (
        <div className="card p-6">
          <label className="label">メタディスクリプション(120字以内推奨)</label>
          <textarea className="input min-h-[120px]" value={meta} onChange={(e) => setMeta(e.target.value)} maxLength={200} />
          <div className="mt-1 text-xs text-slate-500 text-right">{meta.length}/120</div>
        </div>
      )}

      {tab === 'advice' && (
        <div className="card p-6 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-bold">SEOアドバイス</h2>
              <p className="text-xs text-slate-500 mt-1">E-E-A-T観点で人間が追加すべき独自性を5つ提案</p>
            </div>
            <button onClick={generateAdvice} disabled={adviceLoading} className="btn-primary text-sm">
              {adviceLoading ? '生成中…' : advice.length > 0 ? '再生成' : 'アドバイス生成'}
            </button>
          </div>
          {adviceLoading && <ProgressBar active={true} estimateSec={10} label="アドバイス生成中" />}
          {advice.length > 0 ? (
            <ul className="space-y-2">
              {advice.map((a, i) => (
                <li key={i} className="border border-slate-200 rounded p-3 bg-slate-50">
                  <div className="text-xs font-medium text-brand-700 mb-1">{CATEGORY_LABELS[a.category] || a.category}</div>
                  <div className="text-sm text-slate-800">{a.suggestion}</div>
                </li>
              ))}
            </ul>
          ) : !adviceLoading && (
            <p className="text-sm text-slate-500 text-center py-8">ボタンを押して提案を生成</p>
          )}
        </div>
      )}

      {tab === 'pharma' && (
        <div className="card p-6 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="section-title">薬機法・景表法チェック</h2>
              <p className="text-xs text-sub mt-1">医薬品的効能・誇大表現・優良誤認の恐れがある表現を抽出し、言い換え案を提示します。</p>
            </div>
            <button onClick={runPharmaCheck} disabled={pharmaLoading} className="btn-primary text-sm">
              {pharmaLoading ? 'チェック中…' : pharma ? '再チェック' : 'チェック実行'}
            </button>
          </div>
          {pharmaLoading && <ProgressBar active={true} estimateSec={12} label="薬機法チェック中" />}
          {pharma && !pharmaLoading && (
            <>
              <div className={`flex items-center gap-3 p-3 rounded-[8px] border ${
                pharma.risk_level === 'high' ? 'bg-red-50 border-red-200' :
                pharma.risk_level === 'medium' ? 'bg-amber-50 border-amber-200' :
                'bg-teal/5 border-teal/20'
              }`}>
                <span className={`badge ${
                  pharma.risk_level === 'high' ? 'bg-red-100 text-red-700' :
                  pharma.risk_level === 'medium' ? 'bg-amber-100 text-amber-700' :
                  'bg-teal/10 text-teal-dark'
                }`}>
                  リスク: {pharma.risk_level === 'high' ? '高' : pharma.risk_level === 'medium' ? '中' : '低'}
                </span>
                <span className="text-sm text-ink">{pharma.summary}</span>
              </div>
              {pharma.findings.length > 0 ? (
                <ul className="space-y-2">
                  {pharma.findings.map((f, i) => (
                    <li key={i} className="border border-line rounded-[8px] p-3">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className={`badge ${
                          f.severity === 'high' ? 'bg-red-100 text-red-700' :
                          f.severity === 'medium' ? 'bg-amber-100 text-amber-700' :
                          'bg-line text-sub'
                        }`}>{f.severity === 'high' ? '高' : f.severity === 'medium' ? '中' : '低'}</span>
                        <span className="font-bold text-navy text-sm">「{f.phrase}」</span>
                      </div>
                      <div className="text-xs text-sub mb-1">⚠ {f.reason}</div>
                      <div className="text-sm text-teal-dark">→ 言い換え案: {f.suggestion}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-teal-dark text-center py-6">✅ 問題のある表現は検出されませんでした。</p>
              )}
            </>
          )}
          {!pharma && !pharmaLoading && (
            <p className="text-sm text-sub text-center py-8">ボタンを押して薬機法・景表法チェックを実行</p>
          )}
        </div>
      )}

      {tab === 'images' && (
        <div className="card p-6 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-bold">画像生成（Pollinations.ai / Flux）</h2>
              <p className="text-xs text-slate-500 mt-1">
                アイキャッチ + h2見出し画像を自動生成。1枚あたり 20〜60秒、混雑時は最大2分。
                {h2Count > 0 && ` h2見出し数: ${h2Count}`}
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => generateImages('all')} disabled={imageGenLoading} className="btn-primary text-sm">
                {imageGenLoading ? '生成中…' : '全部生成'}
              </button>
              <button onClick={() => generateImages('eyecatch')} disabled={imageGenLoading} className="btn-secondary text-sm">
                アイキャッチのみ
              </button>
              <button onClick={() => generateImages('h2')} disabled={imageGenLoading || h2Count === 0} className="btn-secondary text-sm">
                h2のみ
              </button>
            </div>
          </div>

          {imageGenLoading && imageProgress.total > 0 && (
            <div className="bg-brand-50 border border-brand-200 rounded-lg p-4">
              <ProgressBar
                active={true}
                estimateSec={45}
                label={`画像生成中: ${imageProgress.label}`}
                step={imageProgress.step}
                total={imageProgress.total}
              />
              <div className="mt-2 text-xs text-slate-600">
                残り {imageProgress.total - imageProgress.step + 1} 枚 / 推定残り時間 約 {Math.max(0, (imageProgress.total - imageProgress.step + 1) * 45)}秒
              </div>
            </div>
          )}

          {eyecatchImg && (
            <div>
              <div className="text-xs font-medium text-slate-700 mb-2">アイキャッチ</div>
              <img src={`/api/images/${eyecatchImg.id}`} alt="アイキャッチ" className="w-full max-w-2xl rounded-lg border border-slate-200" />
            </div>
          )}

          {h2Imgs.length > 0 && (
            <div>
              <div className="text-xs font-medium text-slate-700 mb-2 mt-4">h2 見出し画像 ({h2Imgs.length}枚)</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {h2Imgs.map((img) => (
                  <div key={img.id} className="border border-slate-200 rounded p-2">
                    <img src={`/api/images/${img.id}`} alt={`h2-${img.h2Index}`} className="w-full rounded" />
                    <div className="text-xs text-slate-500 mt-1">h2 #{(img.h2Index ?? 0) + 1}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {images.length === 0 && !imageGenLoading && (
            <p className="text-sm text-slate-500 text-center py-8">画像はまだありません。「全部生成」を押してください。</p>
          )}
        </div>
      )}

      {tab === 'publish' && (
        <div className="card p-6 space-y-4">
          <div>
            <h2 className="font-bold">WordPress に投稿</h2>
            <p className="text-xs text-slate-500 mt-1">
              アイキャッチと h2 画像は自動でWordPressのメディアライブラリにアップロードされ、本文の対応位置に挿入されます。
            </p>
          </div>

          {wpConns.length === 0 ? (
            <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-3">
              WordPress 接続がまだありません。<a href="/settings/wordpress" className="underline">設定画面で接続</a>してください。
            </div>
          ) : (
            <>
              <div className="text-sm text-slate-700">
                投稿先: <strong>{wpConns.find((c) => c.isDefault)?.siteUrl ?? wpConns[0].siteUrl}</strong>
              </div>
              <div>
                <label className="label">投稿ステータス</label>
                <div className="flex gap-2">
                  {(['draft', 'publish', 'future'] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setWpStatus(s)}
                      className={`px-4 py-2 rounded-[5px] text-sm font-bold border ${
                        wpStatus === s ? 'bg-teal text-white border-teal' : 'bg-white text-navy border-line hover:bg-bluepaper'
                      }`}
                    >
                      {s === 'draft' ? '下書き' : s === 'publish' ? '公開' : '予約投稿'}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={publishToWp} disabled={wpPublishLoading} className="btn-primary">
                {wpPublishLoading ? '投稿中…' : 'WordPress に投稿'}
              </button>
              {wpPublishLoading && (
                <ProgressBar
                  active={true}
                  estimateSec={images.length * 5 + 10}
                  label={`WordPress に投稿中(画像${images.length}枚アップロード+本文投稿)`}
                />
              )}
            </>
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
      className={`px-3 py-1.5 rounded-[5px] text-sm font-bold transition-colors whitespace-nowrap ${
        active ? 'bg-teal text-white' : 'text-sub hover:bg-bluepaper'
      }`}
    >
      {children}
    </button>
  );
}
