const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
p.$executeRawUnsafe(
  'ALTER TABLE "Candidate" ADD COLUMN "selfReportedHourlyRate" TEXT',
)
  .then(() => {
    console.log("Migration applied successfully");
    return p.$disconnect();
  })
  .catch((e) => {
    const msg = e.message || "";
    if (msg.includes("duplicate column") || msg.includes("already exists")) {
      console.log("Column already exists — skipping");
      return p.$disconnect();
    }
    console.error("MIGRATION FAILED:", msg);
    process.exit(1);
  });
