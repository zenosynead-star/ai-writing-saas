import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 要件定義書 3.2.1 プラン構成 + 3.3.2 追加クレジット単価
const PLAN_SEED = [
  { name: 'Free',       monthlyCredits: 50,   maxArticles: 1,   maxSites: 1,    maxRankKeywords: 1,     maxImages: 0,    priceJpy: 0,     extraUnitJpy: 10 },
  { name: 'Lite',       monthlyCredits: 100,  maxArticles: 2,   maxSites: 5,    maxRankKeywords: 1000,  maxImages: 100,  priceJpy: 500,   extraUnitJpy: 8  },
  { name: 'Standard',   monthlyCredits: 620,  maxArticles: 15,  maxSites: 50,   maxRankKeywords: 6200,  maxImages: 620,  priceJpy: 3000,  extraUnitJpy: 7  },
  { name: 'Pro',        monthlyCredits: 2000, maxArticles: 50,  maxSites: 200,  maxRankKeywords: 20000, maxImages: 2000, priceJpy: 9000,  extraUnitJpy: 6  },
  { name: 'Enterprise', monthlyCredits: 7000, maxArticles: 175, maxSites: 1000, maxRankKeywords: 70000, maxImages: 7000, priceJpy: 30000, extraUnitJpy: 5  },
];

async function main() {
  console.log('Seeding plans...');
  for (const p of PLAN_SEED) {
    await prisma.plan.upsert({
      where: { name: p.name },
      update: p,
      create: p,
    });
  }
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
