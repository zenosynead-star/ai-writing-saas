import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import WordPressForm from './WordPressForm';

export default async function WordPressSettingsPage() {
  const user = await getCurrentUser();
  const conns = await prisma.wpConnection.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">WordPress 連携</h1>
        <p className="text-sm text-slate-600 mt-1">
          記事を WordPress サイトに直接投稿できます。Application Password を発行して接続してください。
        </p>
      </div>

      <WordPressForm
        initialConnections={conns.map((c) => ({
          id: c.id,
          siteUrl: c.siteUrl,
          username: c.username,
          defaultStatus: c.defaultStatus,
          isDefault: c.isDefault,
        }))}
      />

      <div className="card p-6 text-sm text-slate-700 space-y-2">
        <h2 className="font-bold">Application Password の発行方法</h2>
        <ol className="list-decimal list-inside space-y-1 text-xs text-slate-600">
          <li>WordPress 管理画面 → 左メニュー「ユーザー」→「プロフィール」</li>
          <li>ページ下部の「アプリケーションパスワード」セクション</li>
          <li>名前(例: ai-writing-tool) を入力 → 「新しいアプリケーションパスワードを追加」</li>
          <li>表示されたパスワード(スペース込み)をコピーしてフォームに貼り付け</li>
        </ol>
        <p className="text-xs text-slate-500 mt-3">
          ※ WordPress 5.6 以上が必要 / SSL(https) 必須 / 「アプリケーションパスワード」が無効化されていない環境
        </p>
      </div>
    </div>
  );
}
