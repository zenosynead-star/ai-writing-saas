import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { generate, extractJson, BASE_SYSTEM, llmErrorToResponse } from '@/lib/llm';
import { ADVICE_PROMPT } from '@/lib/prompts';
import { z } from 'zod';

const Schema = z.object({ articleId: z.string() });

interface AdviceResult {
  category: string;
  suggestion: string;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();

    const parsed = Schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
    const { articleId } = parsed.data;

    const article = await prisma.article.findFirst({ where: { id: articleId, userId: user.id } });
    if (!article) return NextResponse.json({ error: 'Article not found' }, { status: 404 });
    if (!article.bodyHtml) {
      return NextResponse.json({ error: '本文がまだ生成されていません' }, { status: 400 });
    }

    const result = await generate({
      logicalModel: 'balanced',
      taskType: 'advice',
      system: BASE_SYSTEM,
      user: ADVICE_PROMPT({ articleHtml: article.bodyHtml }),
      maxTokens: 2000,
      jsonMode: true,
    });

    const json = extractJson<{ advices: AdviceResult[] }>(result.content);
    if (!Array.isArray(json.advices)) {
      return NextResponse.json({ error: 'AI出力の形式が想定外でした' }, { status: 502 });
    }

    await prisma.article.update({
      where: { id: articleId },
      data: { adviceJson: JSON.stringify(json.advices) },
    });

    return NextResponse.json({ advices: json.advices });
  } catch (err) {
    console.error('[advice]', err);
    const { status, body } = llmErrorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
