import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 個人ツール化に伴い、認証なしの "default user" を初期作成する
async function main() {
  console.log('Seeding default plan + default user...');
  const plan = await prisma.plan.upsert({
    where: { name: 'Unlimited' },
    update: {},
    create: {
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

  await prisma.user.upsert({
    where: { id: 'default-user' },
    update: {},
    create: {
      id: 'default-user',
      email: 'default@local',
      passwordHash: 'unused',
      name: 'Default User',
      language: 'ja',
      planId: plan.id,
      currentCredits: 999999,
      referralCode: 'DEFAULT',
    },
  });

  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
