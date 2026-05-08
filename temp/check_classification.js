const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  // Check how many jobs have requiresUkWorkAuth set
  const ukAuthSet = await p.job.count({
    where: { tenantId: "dotcloudconsulting", requiresUkWorkAuth: true },
  });
  const ukAuthNull = await p.job.count({
    where: { tenantId: "dotcloudconsulting", requiresUkWorkAuth: null },
  });
  const ukAuthFalse = await p.job.count({
    where: { tenantId: "dotcloudconsulting", requiresUkWorkAuth: false },
  });
  console.log("requiresUkWorkAuth distribution:");
  console.log(`  true:  ${ukAuthSet}`);
  console.log(`  false: ${ukAuthFalse}`);
  console.log(`  null:  ${ukAuthNull}`);

  // Check how many jobs have requiresUsWorkAuth set
  const usAuthSet = await p.job.count({
    where: { tenantId: "dotcloudconsulting", requiresUsWorkAuth: true },
  });
  const usAuthNull = await p.job.count({
    where: { tenantId: "dotcloudconsulting", requiresUsWorkAuth: null },
  });
  const usAuthFalse = await p.job.count({
    where: { tenantId: "dotcloudconsulting", requiresUsWorkAuth: false },
  });
  console.log("\nrequiresUsWorkAuth distribution:");
  console.log(`  true:  ${usAuthSet}`);
  console.log(`  false: ${usAuthFalse}`);
  console.log(`  null:  ${usAuthNull}`);

  // Check how many flagged India/UK jobs have requiresUkWorkAuth set
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
      requiresUkWorkAuth: true,
      requiresUsWorkAuth: true,
      isRemote: true,
    },
  });

  console.log("\nFlagged jobs classification status:");
  let ukTrue = 0,
    ukNull = 0,
    ukFalse = 0;
  let remoteTrue = 0,
    remoteNull = 0;
  for (const j of flaggedJobs) {
    if (j.requiresUkWorkAuth === true) ukTrue++;
    else if (j.requiresUkWorkAuth === null) ukNull++;
    else ukFalse++;
    if (j.isRemote === true) remoteTrue++;
    else if (j.isRemote === null) remoteNull++;
  }
  console.log(
    `  requiresUkWorkAuth: true=${ukTrue}, false=${ukFalse}, null=${ukNull}`,
  );
  console.log(`  isRemote: true=${remoteTrue}, null=${remoteNull}`);

  // Show a few examples of UK-flagged jobs that have requiresUkWorkAuth=null
  const missedUk = flaggedJobs
    .filter((j) => j.requiresUkWorkAuth !== true)
    .slice(0, 5);
  console.log("\nSample UK-flagged jobs with requiresUkWorkAuth NOT true:");
  for (const j of missedUk) {
    console.log(
      `  ${j.title} (isRemote=${j.isRemote}, requiresUkWorkAuth=${j.requiresUkWorkAuth})`,
    );
  }

  await p.$disconnect();
}
main().catch((e) => console.error(e));
