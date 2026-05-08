import { PrismaClient } from "@prisma/client";

type PrismaGlobal = typeof globalThis & { prisma?: PrismaClient };

const globalForPrisma = globalThis as PrismaGlobal;

function createClient(): PrismaClient {
  const client = new PrismaClient({
    log: ["error", "warn"],
    transactionOptions: {
      maxWait: 10_000,
      timeout: 15_000,
    },
  });

  // Tune SQLite for performance on first connect.
  // WAL mode persists on the DB file; the other PRAGMAs are per-connection.
  // All PRAGMA SET statements may return result rows, so use $queryRawUnsafe.
  client
    .$queryRawUnsafe("PRAGMA journal_mode = WAL")
    .then(() => client.$queryRawUnsafe("PRAGMA synchronous = NORMAL"))
    .then(() => client.$queryRawUnsafe("PRAGMA cache_size = -20000"))
    .then(() => client.$queryRawUnsafe("PRAGMA busy_timeout = 15000"))
    .then(() => client.$queryRawUnsafe("PRAGMA mmap_size = 268435456"))
    .catch((err: unknown) =>
      console.warn("[PRISMA] SQLite PRAGMA tuning failed:", err),
    );

  return client;
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
