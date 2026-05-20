import RewritePanel from './RewritePanel';

export default function RewritePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">リライト</h1>
        <p className="text-sm text-slate-600 mt-1">
          既存記事のURLを入力すると、AIが本文を解析し、SEO観点で改善した新しい記事を生成します（要件定義書 5.7）。
        </p>
      </div>
      <RewritePanel />
    </div>
  );
}
