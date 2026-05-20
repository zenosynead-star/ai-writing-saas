import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { fetchPage, FetchError } from '@/lib/fetcher';
import { parseArticle, headingsToMarkdown } from '@/lib/htmlParser';
import { generate, BASE_SYSTEM, sanitizeUserInput, llmErrorToResponse, type LogicalModel } from '@/lib/llm';
import { REWRITE_GENERATION_PROMPT } from '@/lib/prompts';
import { z } from 'zod';

const Schema = z.object({
  url: z.string().url(),
  mode: z.enum(['structure_preserve', 'restructure', 'partial']),
  additionalInstruction: z.string().max(1000).optional(),
  model: z.enum(['low_cost', 'balanced', 'high_quality']).optional(),
});

function extractMeta(html: string): { html: string; meta: string } {
  const m = html.match(/<!--\s*META:\s*([\s\S]*?)\s*-->/i);
  if (!m) return { html, meta: '' };
  return { html: html.replace(m[0], '').trim(), meta: m[1].trim() };
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    const parsed = Schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
    }
    const { url, mode, additionalInstruction, model } = parsed.data;
    const logicalModel: LogicalModel = model ?? 'balanced';

    // 1. URL を再取得・再解析（analyze の結果を信用せず確実性優先）
    const fetched = await fetchPage(url);
    const parsedArticle = parseArticle(fetched.html);
    if (!parsedArticle.title && parsedArticle.wordCount < 200) {
      return NextResponse.json(
        { error: 'リライト対象の記事を取得できませんでした' },
        { status: 422 },
      );
    }

    // 2. LLM でリライト生成
    const result = await generate({
      logicalModel,
      taskType: 'rewrite',
      system: BASE_SYSTEM,
      user: REWRITE_GENERATION_PROMPT({
        sourceUrl: fetched.finalUrl,
        originalTitle: parsedArticle.title || parsedArticle.ogTitle || '',
        originalMeta: parsedArticle.metaDescription || parsedArticle.ogDescription || '',
        originalHeadingsMarkdown: headingsToMarkdown(parsedArticle.headings),
        originalBodySummary: parsedArticle.paragraphs.join('\n\n'),
        mode,
        additionalInstruction: additionalInstruction ? sanitizeUserInput(additionalInstruction) : undefined,
      }),
      maxTokens: 16000,
      temperature: 0.65,
    });

    const { html, meta } = extractMeta(result.content);

    // 3. Article として新規作成（リライト結果を保存）
    const newArticle = await prisma.article.create({
      data: {
        userId: user.id,
        title: parsedArticle.title || '(リライト記事)',
        keywords: JSON.stringify([]),
        status: 'completed',
        step: 5,
        bodyHtml: html,
        metaDescription: meta,
        modelUsed: result.actualModel,
        modelChoice: logicalModel,
        sourceUrl: fetched.finalUrl,
        originalBodyHtml: parsedArticle.bodyHtml.slice(0, 100000),
        rewriteMode: mode,
      },
    });

    return NextResponse.json({
      articleId: newArticle.id,
      title: newArticle.title,
      bodyHtml: html,
      metaDescription: meta,
      model: result.actualModel,
    });
  } catch (err) {
    if (err instanceof FetchError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    console.error('[rewrite/generate]', err);
    const { status, body } = llmErrorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
