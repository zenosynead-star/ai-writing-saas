import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * 内部リンクグラフ: 全記事を node、記事Aの本文が記事Bへリンクしている関係を edge として返す。
 * 3D 可視化(/articles/links)用。
 *
 * リンク判定: A.bodyHtml の <a href> を抽出し、各 href が他記事 B を指すか以下で照合:
 *  - /articles/<B.id>
 *  - B.sourceUrl と一致/包含
 *  - WordPress permalink (?p=<B.wpPostId>)
 *  - アンカーテキスト or href に B のタイトルが含まれる(フォールバック)
 */
export const dynamic = 'force-dynamic';

interface GraphNode {
  id: string;
  title: string;
  keyword: string; // 記事のターゲットKW（keywords を半角スペース連結）。可視化の主ラベル
  status: string;
  outDegree: number;
  inDegree: number;
}
interface GraphLink {
  source: string;
  target: string;
}

/** keywords(JSON配列) を半角スペース連結の表示用KWにする。空なら空文字。 */
function parseKeyword(json: string | null): string {
  try {
    const k = JSON.parse(json || '[]');
    if (Array.isArray(k) && k.length > 0) return k.map(String).join(' ');
  } catch {
    /* ignore */
  }
  return '';
}

export async function GET() {
  const user = await getCurrentUser();
  // 「リンクマップ＝公開中の記事の内部リンク構造」。下書き/生成中/失敗/未公開は数にもグラフにも含めない
  // （記事数を“実際に公開されている記事数”に一致させる。ユーザー要望）。
  const articles = await prisma.article.findMany({
    where: { userId: user.id, wpPostId: { not: null }, wpPostStatus: 'publish' },
    select: { id: true, title: true, keywords: true, status: true, bodyHtml: true, sourceUrl: true, wpPostId: true },
    orderBy: { createdAt: 'desc' },
  });

  const nodes: GraphNode[] = articles.map((a) => ({
    id: a.id,
    title: a.title || '（無題）',
    keyword: parseKeyword(a.keywords) || a.title || '（無題）',
    status: a.status,
    outDegree: 0,
    inDegree: 0,
  }));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  // 照合用インデックス
  const byTitle = articles
    .filter((a) => a.title && a.title.length >= 4)
    .map((a) => ({ id: a.id, title: a.title as string }));

  const linkSet = new Set<string>();
  const links: GraphLink[] = [];

  const addLink = (source: string, target: string) => {
    if (source === target) return;
    const key = `${source}->${target}`;
    if (linkSet.has(key)) return;
    linkSet.add(key);
    links.push({ source, target });
    const s = nodeById.get(source);
    const t = nodeById.get(target);
    if (s) s.outDegree++;
    if (t) t.inDegree++;
  };

  for (const a of articles) {
    if (!a.bodyHtml) continue;
    // <a href="..."> 抽出
    const hrefs = [...a.bodyHtml.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
    for (const m of hrefs) {
      const href = m[1];
      const anchorText = (m[2] || '').replace(/<[^>]+>/g, '').trim();

      // (1) /articles/<id>
      const idMatch = href.match(/\/articles\/([a-z0-9]{20,})/i);
      if (idMatch && nodeById.has(idMatch[1])) {
        addLink(a.id, idMatch[1]);
        continue;
      }
      // (2) sourceUrl / wpPostId 一致
      let matched = false;
      for (const b of articles) {
        if (b.id === a.id) continue;
        if (b.sourceUrl && href.includes(b.sourceUrl)) { addLink(a.id, b.id); matched = true; break; }
        if (b.wpPostId && new RegExp(`[?&]p=${b.wpPostId}\\b`).test(href)) { addLink(a.id, b.id); matched = true; break; }
      }
      if (matched) continue;
      // (3) アンカーテキストが他記事タイトルを含む(フォールバック)
      if (anchorText.length >= 4) {
        for (const b of byTitle) {
          if (b.id === a.id) continue;
          if (anchorText.includes(b.title) || b.title.includes(anchorText)) { addLink(a.id, b.id); break; }
        }
      }
    }
  }

  return NextResponse.json({
    nodes,
    links,
    stats: {
      articles: nodes.length,
      links: links.length,
      orphans: nodes.filter((n) => n.inDegree === 0 && n.outDegree === 0).length,
    },
  });
}
