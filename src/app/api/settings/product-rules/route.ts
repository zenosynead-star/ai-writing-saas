import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { listProductChoices } from '@/lib/productRules';
import { z } from 'zod';

/**
 * おすすめ商品ルール設定 API。
 * GET: サイト(WpConnection)ごとの defaultProductId + ルール一覧 + 選択肢商品を返す。
 * PUT: 指定サイトの defaultProductId とルールを丸ごと置換保存する。
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    const connections = await prisma.wpConnection.findMany({
      where: { userId: user.id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      include: { productRules: { orderBy: { order: 'asc' } } },
    });
    return NextResponse.json({
      products: listProductChoices(),
      connections: connections.map((c) => ({
        id: c.id,
        siteUrl: c.siteUrl,
        isDefault: c.isDefault,
        defaultProductId: c.defaultProductId,
        rules: c.productRules.map((r) => ({
          keyword: r.keyword,
          productId: r.productId,
          enabled: r.enabled,
        })),
      })),
    });
  } catch (e) {
    console.error('[settings/product-rules GET]', e);
    return NextResponse.json({ error: 'サーバー内部エラー' }, { status: 500 });
  }
}

const PutSchema = z.object({
  connectionId: z.string().min(1),
  defaultProductId: z.string().min(1).max(50).nullable().optional(),
  rules: z
    .array(
      z.object({
        keyword: z.string().min(1).max(100),
        productId: z.string().min(1).max(50),
        enabled: z.boolean().optional().default(true),
      }),
    )
    .max(100),
});

export async function PUT(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    const parsed = PutSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: '入力が不正です' }, { status: 400 });
    const { connectionId, defaultProductId, rules } = parsed.data;

    // 接続がこのユーザーのものか検証（他人の接続を編集させない）
    const conn = await prisma.wpConnection.findFirst({ where: { id: connectionId, userId: user.id } });
    if (!conn) return NextResponse.json({ error: '接続が見つかりません' }, { status: 404 });

    // 既存ルールを置換（削除→作成）＋ デフォルト商品を更新。
    // バッチ形式 $transaction なので PgBouncer(pooler) 経由でも安全。
    await prisma.$transaction([
      prisma.productRule.deleteMany({ where: { wpConnectionId: conn.id } }),
      ...rules
        .filter((r) => r.keyword.trim() && r.productId)
        .map((r, i) =>
          prisma.productRule.create({
            data: {
              wpConnectionId: conn.id,
              order: i,
              keyword: r.keyword.trim(),
              productId: r.productId,
              enabled: r.enabled ?? true,
            },
          }),
        ),
      prisma.wpConnection.update({
        where: { id: conn.id },
        data: { defaultProductId: defaultProductId ?? null },
      }),
    ]);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[settings/product-rules PUT]', e);
    return NextResponse.json({ error: 'サーバー内部エラー' }, { status: 500 });
  }
}
