import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';

// 画像配信エンドポイント (認証不要、IDが分かれば誰でも見られる cuid 形式なので推測困難)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const img = await prisma.articleImage.findUnique({ where: { id } });
  if (!img) return new Response('Not found', { status: 404 });
  const buf = Buffer.from(img.dataBase64, 'base64');
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': img.mimeType,
      'Content-Length': String(buf.byteLength),
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
