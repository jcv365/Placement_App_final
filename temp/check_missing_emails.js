// Check the 59 missing drafts - do they have opportunity emails?
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

async function main() {
  const dbDrafts = await p.emailDraft.findMany({
    where: { tenantId: "dotcloudconsulting" },
    select: {
      subject: true,
      application: {
        select: {
          jobId: true,
          candidateId: true,
          job: { select: { title: true, opportunityEmail: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Deduplicate
  const pairMap = new Map();
  for (const d of dbDrafts) {
    const key = `${d.application.jobId}::${d.application.candidateId}`;
    if (!pairMap.has(key)) pairMap.set(key, d);
  }
  const dbPairs = [...pairMap.values()];

  // Check which have no valid email
  const noEmail = dbPairs.filter((d) => {
    const raw = d.application.job.opportunityEmail;
    if (!raw) return true;
    const emails = raw
      .split(/[,;]+/)
      .map((s) => s.trim())
      .filter((s) => s.includes("@") && s.includes("."));
    return emails.length === 0;
  });

  console.log(`Total DB pairs: ${dbPairs.length}`);
  console.log(`Pairs without valid opportunity email: ${noEmail.length}`);

  if (noEmail.length > 0) {
    console.log("\nSample missing emails:");
    noEmail.slice(0, 10).forEach((d) => {
      console.log(
        `  - "${d.subject}" → job: "${d.application.job.title}" → email: "${d.application.job.opportunityEmail || "NONE"}"`,
      );
    });
  }

  await p.$disconnect();
}

main().catch((e) => console.error(e));
