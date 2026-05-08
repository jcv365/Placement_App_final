const { PrismaClient } = require("@prisma/client");

(async () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: "file:./prod.db" } },
  });
  try {
    const tenantId = process.env.TARGET_TENANT_ID || "default";
    const [jobs, candidates, applications, companies, rulesets] =
      await Promise.all([
        prisma.job.count({ where: { tenantId } }),
        prisma.candidate.count({ where: { tenantId } }),
        prisma.application.count({ where: { tenantId } }),
        prisma.company.findMany({
          where: { tenantId },
          select: { id: true, name: true },
        }),
        prisma.ruleSet.findMany({
          where: { tenantId },
          select: { id: true, name: true, isDefault: true, updatedAt: true },
        }),
      ]);

    console.log(
      JSON.stringify(
        { tenantId, jobs, candidates, applications, companies, rulesets },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
})();
