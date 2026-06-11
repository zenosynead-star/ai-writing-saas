import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { generate, extractJson, BASE_SYSTEM, llmErrorToResponse } from '@/lib/llm';
import { PHARMA_CHECK_PROMPT } from '@/lib/prompts';
import { z } from 'zod';

const Schema = z.object({ articleId: z.string() });

interface PharmaFinding {
  phrase: string;
  reason: string;
  suggestion: string;
  severity: string;
}
interface PharmaResult {
  summary: string;
  risk_level: string;
  findings: PharmaFinding[];
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
      logicalModel: 'low_cost',
      taskType: 'advice',
      system: BASE_SYSTEM,
      user: PHARMA_CHECK_PROMPT({ articleHtml: article.bodyHtml }),
      maxTokens: 3000,
      jsonMode: true,
    });

    const json = extractJson<PharmaResult>(result.content);
    if (!Array.isArray(json.findings)) {
      return NextResponse.json({ error: 'AI出力の形式が想定外でした' }, { status: 502 });
    }

    await prisma.article.update({
      where: { id: articleId },
      data: { pharmaCheckJson: JSON.stringify(json) },
    });

    return NextResponse.json({
      summary: json.summary || '',
      risk_level: json.risk_level || 'low',
      findings: json.findings,
    });
  } catch (err) {
    console.error('[pharma-check]', err);
    const { status, body } = llmErrorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
