import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';

// 画像配信エンドポイント (認証不要、IDが分かれば誰でも見られる cuid 形式なので推測困難)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const img = await prisma.articleImage.findUnique({ where: { id } });
  if (!img) return new Response('Not found', { status: 404 });
  const buf = Buffer.from(img.dataBase64, 'base64');
  // バックフィルが同一 id の中身（プレースホルダー→本物）を差し替えるため immutable は使わない。
  // ETag + must-revalidate で、差し替え後はキャッシュが確実に更新される。
  const etag = `"${img.id}-${img.modelUsed || 'na'}-${buf.byteLength}"`;
  if (req.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': 'public, max-age=60, must-revalidate' } });
  }
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': img.mimeType,
      'Content-Length': String(buf.byteLength),
      'Cache-Control': 'public, max-age=60, must-revalidate',
      ETag: etag,
    },
  });
}
