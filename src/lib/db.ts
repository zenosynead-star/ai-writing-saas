import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof createPrismaClient> };

/** 接続断系（Neonのアイドル切断・プール枯渇・ソケット断）はリトライ対象。 */
function isRetryableDbError(msg: string): boolean {
  return (
    /57P01/.test(msg) || // terminating connection due to administrator command
    /terminating connection/i.test(msg) ||
    /administrator command/i.test(msg) ||
    /\bClosed\b|connection closed|closed the connection|Server has closed/i.test(msg) || // \b で disclosed/enclosed の誤検出を防ぐ（kind: Closed は拾う）
    /Connection reset|ECONNRESET|EPIPE|ETIMEDOUT|socket hang up/i.test(msg) ||
    /Connection refused|Can't reach database server/i.test(msg) ||
    /Timed out fetching a new connection|pool timeout|connection pool/i.test(msg) ||
    /P1001|P1017|P2024/.test(msg) // Prisma: 到達不可/接続切断/プール取得タイムアウト
  );
}

/**
 * Neon Postgres は、長時間のLLM生成中などでクエリが流れずアイドルになった接続を
 * 強制切断する（E57P01 "terminating connection due to administrator command"）。
 * その後 Prisma のプールが死んだ接続を破棄して新規接続を張り直すまでに数秒かかるため、
 * 短いバックオフ(100/200ms)では再接続前に撃ち尽くして 500 になっていた。
 * → 最大5回・250ms〜4s のバックオフ＋接続断系パターンを広めに拾ってリトライする。
 * バックオフ中に Prisma プールが健全な接続を用意し直すので、次の試行で成功する。
 */
/** 試行間の待機(ms)。要素数 = 最大リトライ回数。初回試行を含め最大 length+1 回試行する。 */
const BACKOFF_MS = [250, 600, 1200, 2500, 4000];

function createPrismaClient() {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

  return base.$extends({
    query: {
      async $allOperations({ args, query }) {
        let lastErr: unknown;
        for (let i = 0; i <= BACKOFF_MS.length; i++) {
          try {
            return await query(args);
          } catch (e) {
            lastErr = e;
            // Prisma の接続断は message が空で code/全文側にだけ出ることがある
            // (例: `Error { kind: Closed }` / P1017)。message・code・name・String(e) を全部見て判定する。
            const err = e as { message?: string; code?: string; name?: string };
            const msg = `${err?.message ?? ''} ${err?.code ?? ''} ${err?.name ?? ''} ${String(e)}`;
            if (i < BACKOFF_MS.length && isRetryableDbError(msg)) {
              await new Promise((r) => setTimeout(r, BACKOFF_MS[i]));
              continue;
            }
            throw e;
          }
        }
        throw lastErr;
      },
    },
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
