import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { prisma } from './db';
import { randomBytes } from 'crypto';

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET ?? 'dev-secret-change-me-please-this-is-long-enough');
const COOKIE_NAME = 'awsaas_session';
const ACTIVE_DAYS = 30;

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

export function generateReferralCode(): string {
  return randomBytes(4).toString('hex').toUpperCase();
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + ACTIVE_DAYS * 24 * 60 * 60 * 1000);

  await prisma.session.create({
    data: { userId, token, expiresAt },
  });

  const jwt = await new SignJWT({ sub: userId, sid: token })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ACTIVE_DAYS}d`)
    .sign(SECRET);

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, jwt, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });

  return token;
}

export async function destroySession() {
  const cookieStore = await cookies();
  const jwt = cookieStore.get(COOKIE_NAME)?.value;
  if (jwt) {
    try {
      const { payload } = await jwtVerify(jwt, SECRET);
      if (payload.sid) {
        await prisma.session.deleteMany({ where: { token: payload.sid as string } });
      }
    } catch {}
  }
  cookieStore.delete(COOKIE_NAME);
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const jwt = cookieStore.get(COOKIE_NAME)?.value;
  if (!jwt) return null;

  try {
    const { payload } = await jwtVerify(jwt, SECRET);
    const sid = payload.sid as string;
    const session = await prisma.session.findUnique({
      where: { token: sid },
      include: { user: { include: { plan: true } } },
    });
    if (!session) return null;
    if (session.expiresAt < new Date()) {
      await prisma.session.delete({ where: { id: session.id } });
      return null;
    }
    // 非アクティブ7日チェック
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    if (session.lastUsedAt < sevenDaysAgo) {
      await prisma.session.delete({ where: { id: session.id } });
      return null;
    }
    await prisma.session.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date() },
    });
    return session.user;
  } catch {
    return null;
  }
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Response('Unauthorized', { status: 401 });
  }
  return user;
}
