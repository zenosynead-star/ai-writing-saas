// 認証機能は無効化（個人ツールとしての利用）
// すべての操作は固定の "default user" として実行される
import { prisma } from './db';

const DEFAULT_USER_ID = 'default-user';

export type DefaultUser = {
  id: string;
  email: string;
  name: string;
  language: string;
  currentCredits: number;
  plan: { name: string };
};

/**
 * 認証なし版の getCurrentUser
 * 固定のデフォルトユーザーを返す（無ければ自動作成）
 */
export async function getCurrentUser(): Promise<DefaultUser> {
  let user = await prisma.user.findUnique({
    where: { id: DEFAULT_USER_ID },
    include: { plan: true },
  });
  if (!user) {
    // 初回アクセス時に自動作成
    user = await ensureDefaultUser();
  }
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    language: user.language,
    currentCredits: user.currentCredits,
    plan: { name: user.plan.name },
  };
}

async function ensureDefaultUser() {
  // 何かしらのプランが必要なので、最初のプランを取得（無ければ作成）
  let plan = await prisma.plan.findFirst();
  if (!plan) {
    plan = await prisma.plan.create({
      data: {
        name: 'Unlimited',
        monthlyCredits: 999999,
        maxArticles: 999999,
        maxSites: 999999,
        maxRankKeywords: 999999,
        maxImages: 999999,
        priceJpy: 0,
        extraUnitJpy: 0,
      },
    });
  }
  return prisma.user.upsert({
    where: { id: DEFAULT_USER_ID },
    update: {},
    create: {
      id: DEFAULT_USER_ID,
      email: 'default@local',
      passwordHash: 'unused',
      name: 'Default User',
      language: 'ja',
      planId: plan.id,
      currentCredits: 999999,
      referralCode: 'DEFAULT',
    },
    include: { plan: true },
  });
}
