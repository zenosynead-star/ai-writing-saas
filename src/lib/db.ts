import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof createPrismaClient> };

/**
 * Neon Postgres の scale-to-zero (アイドル時のDB一時停止) で発生する
 * E57P01 / "terminating connection due to administrator command" エラーに対し、
 * 最大2回までexponential backoff(100ms, 200ms)でリトライするミドルウェア付きクライアント。
 */
function createPrismaClient() {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

  return base.$extends({
    query: {
      async $allOperations({ args, query }) {
        const MAX_RETRIES = 2;
        let lastErr: unknown;
        for (let i = 0; i <= MAX_RETRIES; i++) {
          try {
            return await query(args);
          } catch (e) {
            lastErr = e;
            const msg = (e as Error)?.message ?? '';
            const retryable =
              /E57P01/.test(msg) ||
              /terminating connection/i.test(msg) ||
              /administrator command/i.test(msg) ||
              /Connection reset/i.test(msg) ||
              /Connection refused/i.test(msg) ||
              /ECONNRESET/i.test(msg) ||
              /Can't reach database server/i.test(msg) ||
              /Closed connection/i.test(msg);
            if (i < MAX_RETRIES && retryable) {
              await new Promise((r) => setTimeout(r, 100 * Math.pow(2, i)));
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
