const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  const cols = await p.$queryRaw`PRAGMA table_info(Job)`;
  const requires = cols.filter((c) => c.name.includes("requires"));
  console.log(
    "Columns with 'requires':",
    requires.map((c) => c.name),
  );

  // Try the actual query the app makes
  try {
    const job = await p.job.findFirst({
      where: { id: "test" },
      select: {
        id: true,
        requiresNonSaLocation: true,
        requiresUsWorkAuth: true,
      },
    });
    console.log("Query with requiresNonSaLocation works");
  } catch (e) {
    console.log("Query error:", e.message);
  }
  await p.$disconnect();
}
main();
