import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';

export default async function HomePage() {
  const user = await getCurrentUser();
  if (user) redirect('/dashboard');

  return (
    <main className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="font-bold text-xl text-brand-700">AI Writing SaaS</div>
          <nav className="flex items-center gap-3">
            <Link href="/login" className="btn-secondary">ログイン</Link>
            <Link href="/signup" className="btn-primary">無料で始める</Link>
          </nav>
        </div>
      </header>

      <section className="max-w-5xl mx-auto px-6 pt-20 pb-12 text-center">
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-slate-900">
          キーワードを入力するだけで、<br />
          <span className="text-brand-600">SEO最適化記事</span>を10倍速で生成
        </h1>
        <p className="mt-6 text-lg text-slate-600 max-w-2xl mx-auto">
          SEOプロフェッショナルのノウハウを内蔵したAIが、タイトル・見出し・本文をワンクリックで生成。
          検索順位とAI検索における自社ブランド言及までを一気通貫で支援します。
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link href="/signup" className="btn-primary text-base px-6 py-3">無料プランで試す</Link>
          <Link href="/login" className="btn-secondary text-base px-6 py-3">ログイン</Link>
        </div>
        <p className="mt-3 text-xs text-slate-500">クレジットカード不要 / 50クレジット付与</p>
      </section>

      <section className="max-w-6xl mx-auto px-6 pb-20 grid md:grid-cols-3 gap-6">
        {[
          { t: 'キーワード探索', d: 'テーマやURLから狙うべき検索キーワードを20件提案。検索意図・競合度・推奨理由も同時に取得。' },
          { t: '見出し構成生成', d: 'E-E-A-T・Needs Met基準を満たすh2-h6見出しを自動構成。ペルソナと検索意図も同時推定。' },
          { t: '本文生成', d: 'PREP法に従い3000字以上のHTML本文を生成。キーワード密度・文体・SEO最適化を一括処理。' },
          { t: 'LLMOコンパス', d: 'ChatGPT・Gemini・Claudeで自社ブランドが言及される頻度と順位を計測（実装予定）。' },
          { t: '画像生成', d: '14スタイル×12テンプレートで168種類のプリセット画像を生成可能（実装予定）。' },
          { t: '順位計測', d: 'Google・Yahoo・Bingの検索順位とAI Overviewsの表示を計測（実装予定）。' },
        ].map((f) => (
          <div key={f.t} className="card p-6">
            <div className="font-bold text-slate-900">{f.t}</div>
            <div className="mt-2 text-sm text-slate-600">{f.d}</div>
          </div>
        ))}
      </section>

      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-6 text-center text-sm text-slate-500">
          © 2026 AI Writing SaaS
        </div>
      </footer>
    </main>
  );
}
