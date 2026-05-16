import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import SiteManager from './SiteManager';

export default async function SitesPage() {
  const user = (await getCurrentUser())!;
  const sites = await prisma.site.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    include: { keywords: { take: 5 } },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">サイト管理</h1>
        <p className="text-sm text-slate-600 mt-1">
          自社サイト・競合サイトを登録します（{sites.length} / {user.plan.maxSites}）
        </p>
      </div>

      <SiteManager
        initialSites={sites.map((s) => ({
          id: s.id,
          domain: s.domain,
          type: s.type,
          businessArea: s.businessArea,
          searchConsoleConnected: s.searchConsoleConnected,
          keywordCount: s.keywords.length,
        }))}
        maxSites={user.plan.maxSites}
      />
    </div>
  );
}
