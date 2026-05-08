const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  // Find the specific draft for Kgomotso + Lead SRE
  const drafts = await p.emailDraft.findMany({
    where: {
      tenantId: "dotcloudconsulting",
      subject: { contains: "Kgomotso" },
    },
    select: {
      id: true,
      subject: true,
      htmlBody: true,
      createdAt: true,
      application: {
        select: {
          id: true,
          currentStage: true,
          jobId: true,
          candidateId: true,
          job: {
            select: {
              id: true,
              title: true,
              isRemote: true,
              requiresUsWorkAuth: true,
              rawText: true,
              opportunityEmail: true,
              company: { select: { name: true } },
            },
          },
          candidate: {
            select: {
              id: true,
              fullName: true,
              suggestedRolesCsv: true,
              preferredRolesCsv: true,
              skillsCsv: true,
              rawCV: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  for (const d of drafts) {
    const job = d.application.job;
    const cand = d.application.candidate;
    console.log("\n=== DRAFT ===");
    console.log("Subject:", d.subject);
    console.log("Job title:", job.title);
    console.log("Job isRemote:", job.isRemote);
    console.log("Job requiresUsWorkAuth:", job.requiresUsWorkAuth);
    console.log("Job opportunityEmail:", job.opportunityEmail);
    console.log("Candidate:", cand.fullName);
    console.log("Candidate suggestedRoles:", cand.suggestedRolesCsv);
    console.log("Candidate preferredRoles:", cand.preferredRolesCsv);
    // Search the JD for location requirements
    const rawText = job.rawText || "";
    const locationPatterns = [
      "pune",
      "bengaluru",
      "bangalore",
      "chennai",
      "india",
      "location",
      "based in",
      "reside",
      "must be based",
    ];
    const lines = rawText.split("\n").filter((l) => l.trim());
    const locationLines = lines.filter((l) =>
      locationPatterns.some((p) => l.toLowerCase().includes(p)),
    );
    console.log("\nJD location-related lines:");
    locationLines.forEach((l) => console.log("  >", l.trim()));
    console.log("\nJD first 500 chars:", rawText.slice(0, 500));
    console.log("\nHTML body (first 800 chars):", d.htmlBody.slice(0, 800));
  }

  await p.$disconnect();
}
main().catch((e) => console.error(e));
