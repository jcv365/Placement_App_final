const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  const apps = await p.application.findMany({
    where: {
      tenantId: "dotcloudconsulting",
      currentStage: { in: ["SHORTLISTED", "NEW"] },
    },
    select: {
      id: true,
      currentStage: true,
      createdAt: true,
      job: { select: { id: true, title: true, opportunityEmail: true } },
      candidate: { select: { id: true, fullName: true } },
      emails: { select: { id: true, subject: true, createdAt: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  console.log("Total active applications:", apps.length);
  const missing = apps.filter((a) => a.emails.length === 0);
  console.log("Missing email drafts:", missing.length);
  for (const a of missing) {
    console.log(
      "  MISSING:",
      a.id,
      "|",
      a.candidate.fullName,
      "|",
      a.job.title,
      "| email:",
      a.job.opportunityEmail || "NONE",
    );
  }
  console.log("");
  const hasEmails = apps.filter((a) => a.emails.length > 0);
  console.log("With email drafts:", hasEmails.length);
  for (const a of hasEmails.slice(0, 10)) {
    console.log(
      "  HAS:",
      a.id,
      "|",
      a.candidate.fullName,
      "|",
      a.job.title,
      "|",
      a.emails[0]?.subject?.slice(0, 60) || "no subject",
    );
  }
  await p.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
