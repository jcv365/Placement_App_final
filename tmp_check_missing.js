process.chdir("/app");
const { PrismaClient } = require("/app/node_modules/@prisma/client");
const prisma = new PrismaClient();
async function main() {
  // Apps that are in EMAIL_DRAFTED or SHORTLISTED stage but have no email drafts
  const apps = await prisma.application.findMany({
    where: {
      currentStage: { in: ["EMAIL_DRAFTED", "SHORTLISTED", "NEW"] },
      emails: { none: {} }
    },
    select: {
      id: true,
      currentStage: true,
      tenantId: true,
      job: { select: { id: true, title: true, opportunityEmail: true } },
      candidate: { select: { fullName: true } }
    },
    orderBy: { createdAt: "desc" },
    take: 50
  });
  console.log("Apps without drafts:", apps.length);
  apps.slice(0,10).forEach(a => console.log(a.currentStage, a.candidate.fullName, "|", a.job.title));
  
  // Also check how many have drafts but not sent
  const withDrafts = await prisma.application.count({ where: { emails: { some: {} }, currentStage: { notIn: ["SENT_TO_CLIENT","PLACED","REJECTED"] } } });
  console.log("Apps with drafts (not yet sent):", withDrafts);
  
  // Total apps
  const total = await prisma.application.count();
  console.log("Total apps:", total);
}
main().then(() => prisma.$disconnect()).catch(e => { console.error(e.message); prisma.$disconnect(); });
