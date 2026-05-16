import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';

const Schema = z.object({
  domain: z.string().min(3).max(253).regex(/^[a-zA-Z0-9.\-]+$/, 'ドメイン形式が不正です'),
  type: z.enum(['own', 'competitor']),
  businessArea: z.string().max(100).nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const parsed = Schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.errors.map((e) => e.message).join(', ') }, { status: 400 });

    const count = await prisma.site.count({ where: { userId: user.id } });
    if (count >= user.plan.maxSites) {
      return NextResponse.json({ error: `プラン上限（${user.plan.maxSites}）に達しています` }, { status: 403 });
    }

    const existing = await prisma.site.findFirst({
      where: { userId: user.id, domain: parsed.data.domain },
    });
    if (existing) return NextResponse.json({ error: '同じドメインは既に登録されています' }, { status: 400 });

    const site = await prisma.site.create({
      data: {
        userId: user.id,
        domain: parsed.data.domain,
        type: parsed.data.type,
        businessArea: parsed.data.businessArea ?? null,
      },
    });

    return NextResponse.json({ site });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
