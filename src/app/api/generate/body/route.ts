import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { generate, BASE_SYSTEM, type LogicalModel, llmErrorToResponse } from '@/lib/llm';
import { BODY_GENERATION_PROMPT } from '@/lib/prompts';
import { z } from 'zod';

const Schema = z.object({
  articleId: z.string(),
  model: z.enum(['low_cost', 'balanced', 'high_quality']).optional(),
});

function buildHeadingTreeText(
  headings: Array<{ id: string; level: number; text: string; parentId: string | null; order: number }>,
): string {
  const sorted = [...headings].sort((a, b) => a.order - b.order);
  return sorted.map((h) => `${'#'.repeat(h.level)} ${h.text}`).join('\n');
}

function extractMetaDescription(html: string): { html: string; meta: string } {
  const m = html.match(/<!--\s*META:\s*([\s\S]*?)\s*-->/i);
  if (!m) return { html, meta: '' };
  return {
    html: html.replace(m[0], '').trim(),
    meta: m[1].trim(),
  };
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();

    const parsed = Schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
    const { articleId, model } = parsed.data;
    const logicalModel: LogicalModel = model ?? 'balanced';

    const article = await prisma.article.findFirst({
      where: { id: articleId, userId: user.id },
      include: { headings: true },
    });
    if (!article) return NextResponse.json({ error: 'Article not found' }, { status: 404 });

    const keywords = JSON.parse(article.keywords || '[]') as string[];
    if (keywords.length === 0 || !article.title || article.headings.length === 0) {
      return NextResponse.json({ error: 'キーワード/タイトル/見出しが揃っていません' }, { status: 400 });
    }

    await prisma.article.update({ where: { id: articleId }, data: { status: 'generating' } });

    try {
      const result = await generate({
        logicalModel,
        taskType: 'body',
        system: BASE_SYSTEM,
        user: BODY_GENERATION_PROMPT({
          keywords,
          title: article.title,
          persona: article.persona || '自動推定',
          searchIntent: article.searchIntent || 'informational',
          latentNeeds: article.latentNeeds ? JSON.parse(article.latentNeeds) : [],
          headingTree: buildHeadingTreeText(article.headings),
          toneSample: article.toneSample || undefined,
          volumeSpec: article.volumeSpec || undefined,
        }),
        maxTokens: 16000,
        temperature: 0.65,
      });

      const { html, meta } = extractMetaDescription(result.content);

      await prisma.article.update({
        where: { id: articleId },
        data: {
          bodyHtml: html,
          metaDescription: meta,
          modelUsed: result.actualModel,
          status: 'completed',
        },
      });

      return NextResponse.json({ bodyHtml: html, metaDescription: meta, model: result.actualModel });
    } catch (err) {
      await prisma.article.update({ where: { id: articleId }, data: { status: 'failed' } });
      throw err;
    }
  } catch (err) {
    console.error('[body]', err);
    const { status, body } = llmErrorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
