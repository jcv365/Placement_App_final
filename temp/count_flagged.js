const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  // Count jobs with India/UK location requirements
  const flaggedJobs = await p.job.findMany({
    where: {
      tenantId: "dotcloudconsulting",
      OR: [
        { rawText: { contains: "pune" } },
        { rawText: { contains: "bengaluru" } },
        { rawText: { contains: "bangalore" } },
        { rawText: { contains: "chennai" } },
        { rawText: { contains: "UK-based" } },
        { rawText: { contains: "UK based" } },
        { rawText: { contains: "must be based in" } },
        { rawText: { contains: "SC Clearance" } },
        { rawText: { contains: "security clearance" } },
        { rawText: { contains: "UK national" } },
      ],
    },
    select: { id: true, title: true },
  });
  console.log("Jobs with India/UK location requirements:", flaggedJobs.length);

  // Count email drafts for these jobs
  const flaggedJobIds = flaggedJobs.map((j) => j.id);
  const draftsForFlagged = await p.emailDraft.findMany({
    where: {
      tenantId: "dotcloudconsulting",
      application: { jobId: { in: flaggedJobIds } },
    },
    select: {
      id: true,
      subject: true,
      application: {
        select: {
          job: { select: { title: true } },
          candidate: { select: { fullName: true } },
        },
      },
    },
  });
  console.log(
    "Email drafts created for flagged jobs:",
    draftsForFlagged.length,
  );
  for (const d of draftsForFlagged) {
    console.log(`  - ${d.subject} (${d.application.candidate.fullName})`);
  }

  // Also count total drafts
  const totalDrafts = await p.emailDraft.count({
    where: { tenantId: "dotcloudconsulting" },
  });
  console.log("\nTotal email drafts:", totalDrafts);
  console.log(
    "Percentage flagged:",
    ((draftsForFlagged.length / totalDrafts) * 100).toFixed(1) + "%",
  );

  await p.$disconnect();
}
main().catch((e) => console.error(e));
