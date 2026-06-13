import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { sanitizeUserInput } from '@/lib/llm';
import { z } from 'zod';

/**
 * 一括記事作成: キーワード(行)ごとに draft 記事を作成して返す。
 * 実生成はクライアントが /api/generate/auto を記事ごとに順次呼ぶ。
 */
const Schema = z.object({
  keywords: z.array(z.string().min(1).max(200)).min(1).max(50),
});

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    const parsed = Schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'キーワードを1〜50件で入力してください' }, { status: 400 });

    const created: Array<{ id: string; keyword: string }> = [];
    for (const raw of parsed.data.keywords) {
      const kw = sanitizeUserInput(raw).trim();
      if (!kw) continue;
      // 1行に複数KW(スペース/カンマ区切り)が来てもまとめて1記事のターゲットKWにする
      const kwList = kw.split(/[,、\s]+/).filter(Boolean).slice(0, 5);
      const article = await prisma.article.create({
        data: {
          userId: user.id,
          title: '',
          keywords: JSON.stringify(kwList),
          status: 'draft',
          step: 1,
        },
      });
      created.push({ id: article.id, keyword: kwList.join(' ') });
    }

    return NextResponse.json({ created });
  } catch (err) {
    console.error('[articles/bulk]', err);
    return NextResponse.json({ error: 'サーバー内部エラー' }, { status: 500 });
  }
}
