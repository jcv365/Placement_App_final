import { PrismaClient } from "@prisma/client";

type PrismaGlobal = typeof globalThis & { prisma?: PrismaClient };

const globalForPrisma = globalThis as PrismaGlobal;

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["error", "warn"],
  });

// TODO: Add encryption-at-rest middleware for raw JD/CV fields in production.
// prisma.$use(async (params, next) => {
//   return next(params);
// });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
