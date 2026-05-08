const { PrismaClient } = require("../node_modules/.prisma/client");
const path = require("path");
const dbPath = path.resolve(
  __dirname,
  "..",
  ".next-run-prod",
  "standalone",
  "prisma",
  "prod.db",
);
const p = new PrismaClient({
  datasourceUrl: `file:${dbPath}`,
});

(async () => {
  const jobs = await p.job.findMany({
    select: {
      id: true,
      title: true,
      company: { select: { name: true } },
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  console.log("Total jobs:", jobs.length);
  for (const j of jobs) {
    console.log(
      j.id.slice(0, 8),
      "|",
      j.title,
      "|",
      j.company?.name ?? "(none)",
      "|",
      j.createdAt.toISOString().slice(0, 16),
    );
  }

  const apps = await p.application.count();
  console.log("\nTotal applications:", apps);

  const candidates = await p.candidate.count();
  console.log("Total candidates:", candidates);

  const companies = await p.company.count();
  console.log("Total companies:", companies);

  const tenantUsers = await p.tenantUser.count();
  console.log("Total tenant users:", tenantUsers);

  const clientAccounts = await p.clientAccount.count();
  console.log("Total client accounts:", clientAccounts);

  await p.$disconnect();
})();
