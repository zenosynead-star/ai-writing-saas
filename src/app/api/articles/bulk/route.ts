import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { sanitizeUserInput } from '@/lib/llm';
import { findExistingWpPostByKeywords, type WpCredentials } from '@/lib/wordpress';
import { z } from 'zod';

/**
 * 一括記事作成: キーワード(行)ごとに draft 記事を作成して返す。
 * 実生成はクライアントが /api/generate/auto を記事ごとに順次呼ぶ。
 *
 * skipPublished=true (既定) のとき、同一キーワードで既に WordPress へ投稿済み
 * (wpPostId あり) の記事が存在する行は draft を作らずスキップし、skipped で返す。
 */
const Schema = z.object({
  keywords: z.array(z.string().min(1).max(200)).min(1).max(50),
  skipPublished: z.boolean().optional().default(true),
});

/**
 * キーワード集合を順序・区切り非依存の比較キーに正規化する。
 * 大文字小文字を畳み、トークン境界を保持して区切り違いによる誤マッチを防ぐ
 * (例: ["ab","c"] と ["a","bc"] を別物として扱う)。
 */
function kwSignature(tokens: string[]): string {
  return tokens
    .join(' ')
    .split(/[,、\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join('\n');
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    const parsed = Schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'キーワードを1〜50件で入力してください' }, { status: 400 });

    const { keywords, skipPublished } = parsed.data;

    // 公開済み(WordPress 投稿済み = wpPostId あり)記事の KW シグネチャを集める
    const publishedSigs = new Map<string, { id: string; title: string }>();
    if (skipPublished) {
      const existing = await prisma.article.findMany({
        where: { userId: user.id, wpPostId: { not: null } },
        select: { id: true, title: true, keywords: true },
      });
      for (const a of existing) {
        let kws: string[] = [];
        try {
          const parsedKw = JSON.parse(a.keywords || '[]');
          if (Array.isArray(parsedKw)) kws = parsedKw.map(String);
        } catch {
          kws = [];
        }
        if (kws.length === 0) continue;
        const sig = kwSignature(kws);
        // 既存記事が複数ヒットする場合は最初の1件を代表として保持
        if (sig && !publishedSigs.has(sig)) publishedSigs.set(sig, { id: a.id, title: a.title });
      }
    }

    // WP サイト本体の既存投稿もチェックするための接続情報（他ツール/手動公開の重複も防ぐ）
    let wpCreds: WpCredentials | null = null;
    if (skipPublished) {
      const conn = await prisma.wpConnection.findFirst({ where: { userId: user.id, isDefault: true } });
      if (conn) wpCreds = { siteUrl: conn.siteUrl, username: conn.username, appPassword: conn.appPassword };
    }

    const created: Array<{ id: string; keyword: string }> = [];
    const skipped: Array<{ keyword: string; existingId: string; existingTitle: string; wpLink?: string }> = [];
    for (const raw of keywords) {
      const kw = sanitizeUserInput(raw).trim();
      if (!kw) continue;
      // 1行に複数KW(スペース/カンマ区切り)が来てもまとめて1記事のターゲットKWにする
      const kwList = kw.split(/[,、\s]+/).filter(Boolean).slice(0, 5);
      if (kwList.length === 0) continue;
      const sig = kwSignature(kwList);

      // アプリDBに同KWの投稿済み記事(wpPostId あり)があっても、それが「今も WP で公開中か」は
      // 下の WP 本体チェック(status=publish のみ)で判定する。WP接続が無い時だけ DB の記録で
      // スキップする（フォールバック）。こうすることで、WP でゴミ箱/下書きに移した KW は
      // 「実際に公開中ではない」ので再生成できる（ユーザー要望: 公開中のものだけスキップ）。
      const hit = publishedSigs.get(sig);
      if (hit && !wpCreds) {
        skipped.push({ keyword: kwList.join(' '), existingId: hit.id, existingTitle: hit.title || kwList.join(' ') });
        continue;
      }

      // WP 本体に同KWの「公開中」投稿があればスキップ（他ツール/手動公開の重複も防ぐ。これが実体判定）
      if (wpCreds) {
        const wpHit = await findExistingWpPostByKeywords(wpCreds, kwList);
        if (wpHit) {
          skipped.push({
            keyword: kwList.join(' '),
            existingId: '',
            existingTitle: wpHit.title || kwList.join(' '),
            wpLink: wpHit.link || undefined,
          });
          continue;
        }
      }

      const article = await prisma.article.create({
        data: {
          userId: user.id,
          title: '',
          keywords: JSON.stringify(kwList),
          status: 'draft',
          step: 1,
        },
      });
      created.push({ id: article.id, keyword: kwList.join(' ') });
    }

    return NextResponse.json({ created, skipped });
  } catch (err) {
    console.error('[articles/bulk]', err);
    return NextResponse.json({ error: 'サーバー内部エラー' }, { status: 500 });
  }
}
