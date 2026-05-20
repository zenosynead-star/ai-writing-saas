import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import Wizard from './Wizard';

export default async function WizardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const article = await prisma.article.findFirst({
    where: { id, userId: user.id },
    include: { headings: { orderBy: { order: 'asc' } } },
  });
  if (!article) notFound();
  if (article.status === 'completed' && article.bodyHtml) {
    redirect(`/articles/${article.id}`);
  }

  return (
    <Wizard
      articleId={article.id}
      initialState={{
        step: article.step,
        keywords: JSON.parse(article.keywords || '[]'),
        title: article.title || '',
        persona: article.persona || '',
        searchIntent: article.searchIntent || '',
        latentNeeds: article.latentNeeds ? JSON.parse(article.latentNeeds) : [],
        toneSample: article.toneSample || '',
        volumeSpec: article.volumeSpec || '',
        customInstruction: article.customInstruction || '',
        modelChoice: (article.modelChoice as 'low_cost' | 'balanced' | 'high_quality' | null) || 'balanced',
        headings: article.headings,
        bodyHtml: article.bodyHtml || '',
        metaDescription: article.metaDescription || '',
      }}
    />
  );
}
