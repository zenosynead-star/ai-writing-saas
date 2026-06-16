import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { sanitizeUserInput } from '@/lib/llm';
import { findExistingWpPostByKeywords, type WpCredentials } from '@/lib/wordpress';
import { internalPost } from '@/lib/internalFetch';
import { z } from 'zod';

/**
 * 一括記事作成 + サーバー側ジョブ起動。
 * キーワード(行)ごとに draft 記事を作成し BulkJob にぶら下げ、サーバー側プロセッサを起動して返す。
 * 実生成(本文→画像→公開)はサーバーが駆動するので、画面を更新/離脱しても継続し、
 * 止まっても watchdog timer が再開する。クライアントは jobId で進捗をポーリングするだけ。
 *
 * skipPublished=true (既定) のとき、同一キーワードで WordPress に「公開中(status=publish)」の
 * 記事が存在する行は作成せずスキップし、skipped で返す（ゴミ箱/下書きは対象外＝再生成する）。
 */
const Schema = z.object({
  keywords: z.array(z.string().min(1).max(200)).min(1).max(50),
  skipPublished: z.boolean().optional().default(true),
  model: z.enum(['low_cost', 'balanced', 'high_quality']).optional().default('balanced'),
  useCompetitor: z.boolean().optional().default(true),
  useWebSearch: z.boolean().optional().default(false),
  imageMode: z.enum(['none', 'eyecatch', 'full']).optional().default('none'),
  wpPublish: z.enum(['none', 'draft', 'publish']).optional().default('none'),
  targetChars: z.number().int().min(0).max(50000).optional().default(0),
  // 生成フェーズの並列数(1〜4)。公開フェーズは常に上から順1件ずつ（並列にしない）。
  parallelism: z.number().int().min(1).max(4).optional().default(2),
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

    const { keywords, skipPublished, model, useCompetitor, useWebSearch, imageMode, wpPublish, targetChars, parallelism } =
      parsed.data;
    // 公開時は画像が必須なので、画像「なし」選択でも最低アイキャッチを生成する
    const effImageMode = wpPublish !== 'none' && imageMode === 'none' ? 'eyecatch' : imageMode;

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

    const toCreate: string[][] = [];
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

      toCreate.push(kwList);
    }

    if (toCreate.length === 0) {
      // 生成対象なし（全部公開中スキップ等）。ジョブは作らず skipped だけ返す。
      return NextResponse.json({ jobId: null, created: 0, skipped });
    }

    // サーバー側ジョブを作成（設定を保存）→ 記事を pending で一括作成 → プロセッサ起動。
    // 以降の本文→画像→公開はサーバーが駆動するので、画面更新/離脱しても継続する。
    const params = JSON.stringify({ model, useCompetitor, useWebSearch, effImageMode, wpPublish, targetChars, parallelism });
    const job = await prisma.bulkJob.create({
      data: { userId: user.id, status: 'running', params, total: toCreate.length, skipped: JSON.stringify(skipped) },
    });
    // createMany は全件 createdAt=now() で同一になり、createdAt 昇順の並びが不定になる。
    // すると生成順(claim)・公開順(上から1件ずつ)・表示順がバラバラになり、公開ワーカーが
    // 「自分基準の先頭(未生成の記事)」を待ち続けて公開待ちが滞留する。
    // 入力(上から)の順を確定させるため createdAt を 1ms ずつずらして付与する。
    const baseTime = Date.now();
    await prisma.article.createMany({
      data: toCreate.map((kwList, i) => ({
        userId: user.id,
        title: '',
        keywords: JSON.stringify(kwList),
        status: 'draft',
        step: 1,
        bulkJobId: job.id,
        bulkState: 'pending',
        bulkAttempts: 0,
        createdAt: new Date(baseTime + i),
      })),
    });

    // サーバー側プロセッサを起動（/process は即応答し、処理はバックグラウンドで継続）。
    // 失敗しても watchdog timer が pending を拾うので握り潰してよい。
    await internalPost('/api/articles/bulk/process', { jobId: job.id }).catch(() => {});

    return NextResponse.json({ jobId: job.id, created: toCreate.length, skipped });
  } catch (err) {
    console.error('[articles/bulk]', err);
    return NextResponse.json({ error: 'サーバー内部エラー' }, { status: 500 });
  }
}
