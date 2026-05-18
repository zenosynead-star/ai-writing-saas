import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';

const PatchSchema = z.object({
  title: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  status: z.enum(['draft', 'generating', 'completed', 'failed']).optional(),
  step: z.number().optional(),
  persona: z.string().optional(),
  searchIntent: z.string().optional(),
  latentNeeds: z.array(z.string()).optional(),
  toneSample: z.string().optional(),
  volumeSpec: z.string().optional(),
  customInstruction: z.string().optional(),
  bodyHtml: z.string().optional(),
  metaDescription: z.string().optional(),
  headings: z
    .array(
      z.object({
        level: z.number(),
        text: z.string(),
        parentIdx: z.number().nullable(),
        order: z.number(),
      }),
    )
    .optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();

  const article = await prisma.article.findFirst({ where: { id, userId: user.id } });
  if (!article) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.format() }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  for (const k of ['title', 'status', 'step', 'persona', 'searchIntent', 'toneSample', 'volumeSpec', 'customInstruction', 'bodyHtml', 'metaDescription']) {
    if ((parsed.data as Record<string, unknown>)[k] !== undefined) data[k] = (parsed.data as Record<string, unknown>)[k];
  }
  if (parsed.data.keywords) data.keywords = JSON.stringify(parsed.data.keywords);
  if (parsed.data.latentNeeds) data.latentNeeds = JSON.stringify(parsed.data.latentNeeds);

  await prisma.article.update({ where: { id }, data });

  // Replace headings if provided
  if (parsed.data.headings) {
    await prisma.articleHeading.deleteMany({ where: { articleId: id } });
    const idMap: Record<number, string> = {};
    for (let i = 0; i < parsed.data.headings.length; i++) {
      const h = parsed.data.headings[i];
      const created = await prisma.articleHeading.create({
        data: {
          articleId: id,
          level: h.level,
          text: h.text,
          parentId: h.parentIdx !== null ? idMap[h.parentIdx] : null,
          order: h.order,
        },
      });
      idMap[i] = created.id;
    }
  }

  const result = await prisma.article.findUnique({
    where: { id },
    include: { headings: { orderBy: { order: 'asc' } } },
  });

  return NextResponse.json({ article: result });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const article = await prisma.article.findFirst({ where: { id, userId: user.id } });
  if (!article) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await prisma.article.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
