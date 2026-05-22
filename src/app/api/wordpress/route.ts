import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { testConnection, WpError } from '@/lib/wordpress';
import { z } from 'zod';

const PostSchema = z.object({
  siteUrl: z.string().url(),
  username: z.string().min(1),
  appPassword: z.string().min(1),
  defaultStatus: z.enum(['draft', 'publish', 'future']).default('draft'),
});

export async function GET() {
  const user = await getCurrentUser();
  const conns = await prisma.wpConnection.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, siteUrl: true, username: true, defaultStatus: true, isDefault: true, createdAt: true },
  });
  return NextResponse.json({ connections: conns });
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    const parsed = PostSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
    const { siteUrl, username, appPassword, defaultStatus } = parsed.data;

    // 接続テスト
    const info = await testConnection({ siteUrl, username, appPassword });

    // 既存を default=false に
    await prisma.wpConnection.updateMany({
      where: { userId: user.id },
      data: { isDefault: false },
    });

    // 同じ siteUrl の既存があれば削除して再作成
    await prisma.wpConnection.deleteMany({ where: { userId: user.id, siteUrl } });
    const conn = await prisma.wpConnection.create({
      data: { userId: user.id, siteUrl, username, appPassword, defaultStatus, isDefault: true },
    });

    return NextResponse.json({
      ok: true,
      connectedAs: info.name,
      connection: { id: conn.id, siteUrl: conn.siteUrl, username: conn.username, defaultStatus: conn.defaultStatus },
    });
  } catch (err) {
    if (err instanceof WpError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    console.error('[wordpress]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await prisma.wpConnection.deleteMany({ where: { id, userId: user.id } });
  return NextResponse.json({ ok: true });
}
