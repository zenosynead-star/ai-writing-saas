import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyPassword, createSession } from '@/lib/auth';
import { z } from 'zod';

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = LoginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: '入力が不正です' }, { status: 400 });
    }
    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return NextResponse.json({ error: 'メールアドレスまたはパスワードが間違っています' }, { status: 401 });
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: 'メールアドレスまたはパスワードが間違っています' }, { status: 401 });
    }

    // 同時セッション5上限。古いものから削除
    const sessions = await prisma.session.findMany({
      where: { userId: user.id },
      orderBy: { lastUsedAt: 'asc' },
    });
    if (sessions.length >= 5) {
      const removeCount = sessions.length - 4;
      const toRemove = sessions.slice(0, removeCount).map((s) => s.id);
      await prisma.session.deleteMany({ where: { id: { in: toRemove } } });
    }

    await createSession(user.id);

    return NextResponse.json({ user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
