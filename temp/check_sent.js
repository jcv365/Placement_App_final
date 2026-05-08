const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient({ log: [] });
async function main() {
  const sent = await p.application.count({
    where: {
      tenantId: "dotcloudconsulting",
      currentStage: "SENT_TO_CLIENT",
      updatedAt: { gte: new Date("2026-04-20T00:00:00.000Z") }
    }
  });
  const drafted = await p.application.count({
    where: {
      tenantId: "dotcloudconsulting",
      currentStage: "EMAIL_DRAFTED",
      updatedAt: { gte: new Date("2026-04-20T00:00:00.000Z") }
    }
  });
  console.log("SENT_TO_CLIENT today:", sent);
  console.log("EMAIL_DRAFTED today:", drafted);
  await p.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
