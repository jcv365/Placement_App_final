const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  // Find all jobs with India-specific location requirements
  const jobs = await p.job.findMany({
    where: { tenantId: "dotcloudconsulting" },
    select: {
      id: true,
      title: true,
      isRemote: true,
      requiresUsWorkAuth: true,
      rawText: true,
      opportunityEmail: true,
      _count: { select: { applications: true } },
    },
  });

  const indiaLocationPatterns = [
    /pune/i,
    /bengaluru/i,
    /bangalore/i,
    /chennai/i,
    /india/i,
    /must be based in/i,
    /based in (?:pune|bengaluru|bangalore|chennai|india)/i,
    /location.*(?:pune|bengaluru|bangalore|chennai|india)/i,
    /uk-based only/i,
    /uk based only/i,
    /must be.*uk/i,
    /uk national/i,
    /sc clearance/i,
    /security clearance/i,
    /dv clearance/i,
  ];

  const flagged = [];
  for (const job of jobs) {
    const raw = job.rawText || "";
    const matches = [];
    for (const pattern of indiaLocationPatterns) {
      if (pattern.test(raw)) {
        // Get the matching line for context
        const lines = raw.split("\n").filter((l) => pattern.test(l));
        matches.push({
          pattern: pattern.source,
          lines: lines.map((l) => l.trim().slice(0, 120)),
        });
      }
    }
    if (matches.length > 0) {
      flagged.push({
        id: job.id.slice(0, 8),
        title: job.title,
        isRemote: job.isRemote,
        requiresUsWorkAuth: job.requiresUsWorkAuth,
        hasOpportunityEmail: !!job.opportunityEmail,
        applicationCount: job._count.applications,
        matches,
      });
    }
  }

  console.log("=== Jobs with India/UK location requirements ===");
  console.log("Total flagged:", flagged.length);
  for (const j of flagged) {
    console.log(`\n${j.id} | ${j.title}`);
    console.log(
      `  isRemote: ${j.isRemote}, requiresUsWorkAuth: ${j.requiresUsWorkAuth}, hasEmail: ${j.hasOpportunityEmail}, apps: ${j.applicationCount}`,
    );
    for (const m of j.matches) {
      console.log(`  Pattern: ${m.pattern}`);
      for (const line of m.lines) {
        console.log(`    > ${line}`);
      }
    }
  }

  // Count how many email drafts were created for these flagged jobs
  const flaggedJobIds = new Set(flagged.map((j) => j.id));
  const draftsForFlagged = await p.emailDraft.findMany({
    where: {
      tenantId: "dotcloudconsulting",
      application: {
        job: {
          id: { in: [...flaggedJobIds] },
        },
      },
    },
    select: {
      id: true,
      subject: true,
      application: {
        select: {
          job: { select: { title: true, id: true } },
          candidate: { select: { fullName: true } },
        },
      },
    },
  });

  console.log(
    `\n=== Email drafts created for flagged jobs: ${draftsForFlagged.length} ===`,
  );
  for (const d of draftsForFlagged.slice(0, 20)) {
    console.log(`  ${d.subject} (${d.application.candidate.fullName})`);
  }

  await p.$disconnect();
}
main().catch((e) => console.error(e));
