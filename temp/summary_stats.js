const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  const total = await p.application.count();
  const shortlisted = await p.application.count({
    where: { currentStage: "SHORTLISTED" },
  });
  const emailDrafted = await p.application.count({
    where: { currentStage: "EMAIL_DRAFTED" },
  });
  const sentToClient = await p.application.count({
    where: { currentStage: "SENT_TO_CLIENT" },
  });
  const totalDrafts = await p.emailDraft.count();
  const noDrafts = await p.application.count({
    where: { currentStage: "SHORTLISTED", emails: { none: {} } },
  });
  console.log("=== Application Summary ===");
  console.log("Total applications:", total);
  console.log("SHORTLISTED:", shortlisted);
  console.log("EMAIL_DRAFTED:", emailDrafted);
  console.log("SENT_TO_CLIENT:", sentToClient);
  console.log("Total email drafts:", totalDrafts);
  console.log("SHORTLISTED without drafts:", noDrafts);
  await p.$disconnect();
}
main().catch((e) => console.error(e));
