const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  try {
    const r = await p.job.findFirst({
      select: { id: true, requiresNonSaLocation: true },
    });
    console.log("Job query works:", !!r);
    console.log("requiresNonSaLocation value:", r?.requiresNonSaLocation);
  } catch (e) {
    console.log("Error:", e.message);
  }
  await p.$disconnect();
}
main();
