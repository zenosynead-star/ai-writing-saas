import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { hashPassword, createSession, generateReferralCode } from '@/lib/auth';
import { grantCredits } from '@/lib/credits';
import { z } from 'zod';

const SignupSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).regex(/[A-Z]/, '大文字必須').regex(/[a-z]/, '小文字必須').regex(/[0-9]/, '数字必須'),
  referralCode: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = SignupSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors.map((e) => e.message).join(', ') },
        { status: 400 },
      );
    }
    const { name, email, password, referralCode } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: 'このメールアドレスは既に登録されています' }, { status: 400 });
    }

    const freePlan = await prisma.plan.findUnique({ where: { name: 'Free' } });
    if (!freePlan) {
      return NextResponse.json({ error: 'プランデータ未初期化です。npm run db:seed を実行してください' }, { status: 500 });
    }

    let referralValid = false;
    if (referralCode) {
      const referrer = await prisma.user.findUnique({ where: { referralCode } });
      referralValid = !!referrer;
    }

    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash: await hashPassword(password),
        planId: freePlan.id,
        referralCode: generateReferralCode(),
        referredByCode: referralValid ? referralCode : null,
        currentCredits: 0,
      },
    });

    // Free プラン分の月次クレジットを付与
    await grantCredits({
      userId: user.id,
      amount: freePlan.monthlyCredits,
      reason: 'signup_bonus',
      description: `${freePlan.name}プラン初回クレジット付与`,
    });

    await createSession(user.id);

    return NextResponse.json({
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
