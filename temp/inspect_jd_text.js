const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  // Get a sample of flagged jobs and show their JD text snippets
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
    select: {
      id: true,
      title: true,
      rawText: true,
      requiresUkWorkAuth: true,
      isRemote: true,
    },
    take: 10,
  });

  for (const j of flaggedJobs) {
    console.log(
      `\n=== ${j.title} (isRemote=${j.isRemote}, requiresUkWorkAuth=${j.requiresUkWorkAuth}) ===`,
    );
    // Extract relevant lines
    const lines = j.rawText.split("\n");
    for (const line of lines) {
      const lower = line.toLowerCase();
      if (
        lower.includes("pune") ||
        lower.includes("bengaluru") ||
        lower.includes("bangalore") ||
        lower.includes("chennai") ||
        lower.includes("uk-based") ||
        lower.includes("uk based") ||
        lower.includes("must be based") ||
        lower.includes("sc clearance") ||
        lower.includes("security clearance") ||
        lower.includes("uk national") ||
        lower.includes("location") ||
        lower.includes("remote") ||
        lower.includes("based in")
      ) {
        console.log(`  >> ${line.trim()}`);
      }
    }
  }

  await p.$disconnect();
}
main().catch((e) => console.error(e));
