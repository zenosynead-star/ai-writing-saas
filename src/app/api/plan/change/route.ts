import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { grantCredits } from '@/lib/credits';
import { z } from 'zod';

// MVP: 実決済処理はモック。本実装ではStripe等のPSP連携が必要。
const Schema = z.object({ planName: z.string() });

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const parsed = Schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'Invalid' }, { status: 400 });
    const { planName } = parsed.data;

    const newPlan = await prisma.plan.findUnique({ where: { name: planName } });
    if (!newPlan) return NextResponse.json({ error: 'プランが存在しません' }, { status: 404 });
    if (newPlan.id === user.planId) return NextResponse.json({ error: '同じプランです' }, { status: 400 });

    const oldPlan = await prisma.plan.findUnique({ where: { id: user.planId } });
    const isUpgrade = !!oldPlan && newPlan.priceJpy > oldPlan.priceJpy;

    // 要件定義書 3.2.2 プラン変更ロジック
    // アップグレード: 即時反映 + 新プランの月次クレジット上限値が残高に加算
    // ダウングレード: 次回更新日に反映（MVPでは即時実装）

    const oneMonthLater = new Date();
    oneMonthLater.setMonth(oneMonthLater.getMonth() + 1);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { planId: newPlan.id },
      });
      await tx.subscription.create({
        data: {
          userId: user.id,
          planId: newPlan.id,
          startedAt: new Date(),
          nextRenewalAt: oneMonthLater,
          status: 'active',
          paymentMethod: 'mock',
        },
      });
    });

    if (isUpgrade) {
      await grantCredits({
        userId: user.id,
        amount: newPlan.monthlyCredits,
        reason: 'monthly_grant',
        description: `${newPlan.name}プランへアップグレード（CR付与）`,
      });
    }

    return NextResponse.json({ ok: true, planName: newPlan.name });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
