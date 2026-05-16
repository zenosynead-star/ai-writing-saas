import { prisma } from './db';

// 要件定義書 3.3.1 クレジット消費表
export const CREDIT_COST = {
  keyword_theme: 1,
  keyword_url: 2,
  title_generation: 1,
  heading_generation: 2,
  body_standard: 10,
  body_high: 15,
  body_max: 20,
  image_standard: 1,
  image_high: 2,
  rewrite: 8,
  rank_measurement: 0.02,
  llmo_measurement: 0.4,
  yakkihou_check: 1,
} as const;

export type CreditReason =
  | 'consumption'
  | 'monthly_grant'
  | 'purchase'
  | 'refund'
  | 'signup_bonus';

export async function consumeCredits(opts: {
  userId: string;
  amount: number;
  description: string;
  relatedResourceId?: string;
}) {
  if (opts.amount <= 0) return;
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: opts.userId } });
    if (!user) throw new Error('User not found');
    if (user.currentCredits < opts.amount) {
      throw new Error('INSUFFICIENT_CREDITS');
    }
    const newBalance = user.currentCredits - opts.amount;
    await tx.user.update({
      where: { id: user.id },
      data: { currentCredits: newBalance },
    });
    await tx.creditTransaction.create({
      data: {
        userId: user.id,
        amount: -opts.amount,
        balanceAfter: newBalance,
        reason: 'consumption',
        relatedResourceId: opts.relatedResourceId,
        meta: JSON.stringify({ description: opts.description }),
      },
    });
    return newBalance;
  });
}

export async function grantCredits(opts: {
  userId: string;
  amount: number;
  reason: CreditReason;
  description: string;
}) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: opts.userId } });
    if (!user) throw new Error('User not found');
    const newBalance = user.currentCredits + opts.amount;
    await tx.user.update({
      where: { id: user.id },
      data: { currentCredits: newBalance },
    });
    await tx.creditTransaction.create({
      data: {
        userId: user.id,
        amount: opts.amount,
        balanceAfter: newBalance,
        reason: opts.reason,
        meta: JSON.stringify({ description: opts.description }),
      },
    });
    return newBalance;
  });
}
