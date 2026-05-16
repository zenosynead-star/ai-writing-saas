import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

async function createArticleAndRedirect() {
  'use server';
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');

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

export default async function NewArticlePage() {
  await createArticleAndRedirect();
  return null;
}
