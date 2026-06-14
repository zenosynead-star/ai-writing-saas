import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { listProductChoices } from '@/lib/productRules';
import ProductRulesForm from './ProductRulesForm';

export const dynamic = 'force-dynamic';

export default async function ProductRulesPage() {
  const user = await getCurrentUser();
  const connections = await prisma.wpConnection.findMany({
    where: { userId: user.id },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    include: { productRules: { orderBy: { order: 'asc' } } },
  });
  const products = listProductChoices();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">おすすめ商品ルール</h1>
        <p className="text-sm text-slate-600 mt-1">
          記事のキーワードに応じて、商品カードと本文で推奨する商品を出し分けます。
          上のルールから順に判定し、最初に一致したものを採用。どれにも一致しなければ「デフォルト商品」を推奨します。
          サイト（WordPress 接続）ごとに設定できます。
        </p>
      </div>

      {connections.length === 0 ? (
        <div className="card p-6 text-sm text-slate-600">
          まず{' '}
          <a className="text-teal-mid underline font-bold" href="/settings/wordpress">
            WordPress 連携
          </a>{' '}
          でサイトを登録すると、ここで商品の出し分けを設定できます。
        </div>
      ) : (
        <ProductRulesForm
          products={products}
          connections={connections.map((c) => ({
            id: c.id,
            siteUrl: c.siteUrl,
            isDefault: c.isDefault,
            defaultProductId: c.defaultProductId,
            rules: c.productRules.map((r) => ({ keyword: r.keyword, productId: r.productId, enabled: r.enabled })),
          }))}
        />
      )}

      <div className="card p-6 text-sm text-slate-700 space-y-2">
        <h2 className="font-bold">仕組み</h2>
        <ul className="list-disc list-inside space-y-1 text-xs text-slate-600">
          <li>記事生成・公開時に、その記事のキーワード（とタイトル）をルールの「含む文言」と照合します。</li>
          <li>一致したルールの商品を、本文の「イチオシ」として書き、商品カード（要約／詳細／最下部）もその商品で挿入します。</li>
          <li>どのルールにも一致しない場合は「デフォルト商品」を推奨します。デフォルト未設定なら本文中で言及された自社商品を自動選定します。</li>
          <li>商品の追加・スペック編集はソース（<code>src/data/products.json</code>）で管理します。</li>
        </ul>
      </div>
    </div>
  );
}
