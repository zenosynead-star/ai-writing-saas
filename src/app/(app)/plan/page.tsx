import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import PlanChooser from './PlanChooser';

export default async function PlanPage() {
  const user = (await getCurrentUser())!;
  const plans = await prisma.plan.findMany({
    where: { isActive: true },
    orderBy: { priceJpy: 'asc' },
  });
  const recentTx = await prisma.creditTransaction.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">プラン・課金</h1>
        <p className="text-sm text-slate-600 mt-1">
          現プラン: <strong>{user.plan.name}</strong>　月次クレジット {user.plan.monthlyCredits} CR　現残高 {user.currentCredits.toLocaleString()} CR
        </p>
      </div>

      <PlanChooser plans={plans} currentPlanName={user.plan.name} />

      <div>
        <div className="text-sm font-medium text-slate-700 mb-2">紹介コード</div>
        <div className="card p-4 flex items-center justify-between">
          <code className="bg-slate-100 px-3 py-1.5 rounded text-base font-mono">{user.referralCode}</code>
          <span className="text-xs text-slate-500">有料プラン移行時から1年間10%OFFの紹介特典付き</span>
        </div>
      </div>

      <div>
        <div className="text-sm font-medium text-slate-700 mb-2">クレジット履歴（直近20件）</div>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-2 text-slate-600">日時</th>
                <th className="text-left px-4 py-2 text-slate-600">理由</th>
                <th className="text-right px-4 py-2 text-slate-600">増減</th>
                <th className="text-right px-4 py-2 text-slate-600">残高</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recentTx.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-500">履歴はまだありません</td></tr>
              )}
              {recentTx.map((tx) => {
                const meta = tx.meta ? (JSON.parse(tx.meta) as { description?: string }) : {};
                return (
                  <tr key={tx.id}>
                    <td className="px-4 py-2 text-slate-500">{new Date(tx.createdAt).toLocaleString('ja-JP')}</td>
                    <td className="px-4 py-2 text-slate-700">{meta.description ?? tx.reason}</td>
                    <td className={`px-4 py-2 text-right font-medium ${tx.amount >= 0 ? 'text-green-600' : 'text-slate-700'}`}>
                      {tx.amount >= 0 ? '+' : ''}{tx.amount}
                    </td>
                    <td className="px-4 py-2 text-right text-slate-600">{tx.balanceAfter}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
