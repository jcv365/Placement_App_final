const { PrismaClient } = require("@prisma/client");

async function main() {
  const dbUrl = process.argv[2] || "file:./demo.db";
  const prisma = new PrismaClient({ datasourceUrl: dbUrl });

  const cols = await prisma.$queryRawUnsafe(
    "SELECT name FROM pragma_table_info('Timesheet')",
  );
  const names = cols.map((c) => c.name);
  console.log("Current Timesheet columns:", names.join(", "));

  if (names.includes("weekStartDate") && !names.includes("periodStartDate")) {
    console.log(
      "Renaming weekStartDate -> periodStartDate, weekEndDate -> periodEndDate...",
    );
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "Timesheet" RENAME COLUMN "weekStartDate" TO "periodStartDate"',
    );
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "Timesheet" RENAME COLUMN "weekEndDate" TO "periodEndDate"',
    );
    console.log("Done.");
  } else if (names.includes("periodStartDate")) {
    console.log("Columns already renamed, nothing to do.");
  } else {
    console.log("Timesheet table layout unexpected, skipping.");
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
