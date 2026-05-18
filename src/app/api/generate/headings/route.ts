import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { generate, extractJson, BASE_SYSTEM, sanitizeUserInput } from '@/lib/llm';
import { HEADING_GENERATION_PROMPT } from '@/lib/prompts';
import { validateHeadingTree } from '@/lib/headings';
import { z } from 'zod';

const Schema = z.object({
  articleId: z.string(),
  customInstruction: z.string().max(2000).optional(),
});

interface HeadingResult {
  estimated_persona: string;
  search_intent: string;
  latent_needs: string[];
  headings: Array<{ level: number; text: string; children: HeadingResult['headings'] }>;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();

    const parsed = Schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'Invalid' }, { status: 400 });
    const { articleId, customInstruction } = parsed.data;

    const article = await prisma.article.findFirst({ where: { id: articleId, userId: user.id } });
    if (!article) return NextResponse.json({ error: 'Article not found' }, { status: 404 });

    const keywords = JSON.parse(article.keywords || '[]') as string[];
    if (keywords.length === 0) {
      return NextResponse.json({ error: 'まずキーワードを設定してください' }, { status: 400 });
    }

    const result = await generate({
      logicalModel: 'balanced',
      taskType: 'heading',
      system: BASE_SYSTEM,
      user: HEADING_GENERATION_PROMPT({
        keywords,
        userCustomInstruction: customInstruction ? sanitizeUserInput(customInstruction) : undefined,
      }),
      maxTokens: 4000,
      jsonMode: true,
    });

    const json = extractJson<HeadingResult>(result.content);
    if (!validateHeadingTree(json.headings)) {
      throw new Error('Invalid heading tree shape');
    }

    return NextResponse.json({
      estimated_persona: json.estimated_persona,
      search_intent: json.search_intent,
      latent_needs: json.latent_needs,
      headings: json.headings,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
