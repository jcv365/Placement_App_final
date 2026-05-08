const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  // Find all applications that are SHORTLISTED or NEW and have no email drafts
  const apps = await p.application.findMany({
    where: {
      tenantId: "dotcloudconsulting",
      currentStage: { in: ["SHORTLISTED", "NEW"] },
    },
    select: {
      id: true,
      currentStage: true,
      job: { select: { id: true, title: true, opportunityEmail: true } },
      candidate: { select: { id: true, fullName: true } },
      emails: { select: { id: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const missing = apps.filter((a) => a.emails.length === 0);
  console.log(
    JSON.stringify(
      missing.map((a) => ({
        applicationId: a.id,
        jobId: a.job.id,
        candidateId: a.candidate.id,
        candidateName: a.candidate.fullName,
        jobTitle: a.job.title,
        opportunityEmail: a.job.opportunityEmail || "",
      })),
    ),
  );
  await p.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
