const { PrismaClient } = require("@prisma/client");

(async () => {
  const p = new PrismaClient();
  const [c, j, a] = await Promise.all([
    p.candidate.count(),
    p.job.count(),
    p.application.count(),
  ]);
  console.log("Candidates:", c, "Jobs:", j, "Applications:", a);

  if (c > 0) {
    const candidates = await p.candidate.findMany({
      take: 10,
      select: {
        id: true,
        fullName: true,
        isActive: true,
        skillsCsv: true,
        suggestedRolesCsv: true,
        companyId: true,
      },
    });
    console.log("\nCandidates:", JSON.stringify(candidates, null, 2));
  }

  if (j > 0) {
    const jobs = await p.job.findMany({
      take: 10,
      select: {
        id: true,
        title: true,
        companyId: true,
        rawText: true,
      },
    });
    console.log(
      "\nJobs:",
      JSON.stringify(
        jobs.map((job) => ({
          ...job,
          rawText: job.rawText.substring(0, 100) + "...",
        })),
        null,
        2,
      ),
    );
  }

  const companies = await p.company.findMany({
    select: { id: true, name: true, slug: true },
  });
  console.log("\nCompanies:", JSON.stringify(companies, null, 2));

  const tenants = await p.tenant.findMany({
    select: { id: true, name: true, slug: true },
  });
  console.log("Tenants:", JSON.stringify(tenants, null, 2));

  await p.$disconnect();
})().catch(async (e) => {
  console.error(String(e));
  process.exit(1);
});
