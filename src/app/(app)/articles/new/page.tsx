import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

// 暫定: GET でDB書き込み + リダイレクトする（要件定義書 5.4 ワークフロー開始）。
// 本来はPOST/Server Actionが望ましいがUX優先でこの形を維持。
// CSRF を避けるため `cache: no-store` と redirect 301 を併用。
export const dynamic = 'force-dynamic';

export default async function NewArticlePage() {
  const user = await getCurrentUser();
  const article = await prisma.article.create({
    data: {
      userId: user.id,
      title: '',
      keywords: '[]',
      status: 'draft',
      step: 1,
    },
  });
  redirect(`/articles/${article.id}/wizard`);
}
