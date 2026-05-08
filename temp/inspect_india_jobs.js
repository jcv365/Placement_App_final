const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  // Get India-specific jobs
  const indiaJobs = await p.job.findMany({
    where: {
      tenantId: "dotcloudconsulting",
      OR: [
        { rawText: { contains: "pune" } },
        { rawText: { contains: "bengaluru" } },
        { rawText: { contains: "bangalore" } },
        { rawText: { contains: "chennai" } },
      ],
    },
    select: {
      id: true,
      title: true,
      rawText: true,
      isRemote: true,
      requiresUkWorkAuth: true,
    },
    take: 5,
  });

  for (const j of indiaJobs) {
    console.log(
      `\n=== ${j.title} (isRemote=${j.isRemote}, requiresUkWorkAuth=${j.requiresUkWorkAuth}) ===`,
    );
    const lines = j.rawText.split("\n");
    for (const line of lines) {
      const lower = line.toLowerCase();
      if (
        lower.includes("pune") ||
        lower.includes("bengaluru") ||
        lower.includes("bangalore") ||
        lower.includes("chennai") ||
        lower.includes("india") ||
        lower.includes("based in") ||
        lower.includes("location") ||
        lower.includes("remote")
      ) {
        console.log(`  >> ${line.trim()}`);
      }
    }
  }

  await p.$disconnect();
}
main().catch((e) => console.error(e));
