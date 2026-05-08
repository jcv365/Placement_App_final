const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const missing = await p.application.findMany({
    where: { currentStage: "SHORTLISTED", emails: { none: {} } },
    select: { id: true, job: { select: { title: true } }, candidate: { select: { fullName: true } } }
  });
  console.log("SHORTLISTED apps without email drafts:", missing.length);
  if (missing.length > 0) {
    missing.slice(0, 10).forEach(a => console.log("  -", a.job.title, "/", a.candidate.fullName));
  }
  await p.$disconnect();
})();
