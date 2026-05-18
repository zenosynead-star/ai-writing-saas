import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();

  const site = await prisma.site.findFirst({ where: { id, userId: user.id } });
  if (!site) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await prisma.site.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
