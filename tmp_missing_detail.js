process.chdir("/app");
const { PrismaClient } = require("/app/node_modules/@prisma/client");
const prisma = new PrismaClient();
async function main() {
  const apps = await prisma.application.findMany({
    where: {
      currentStage: { in: ["EMAIL_DRAFTED", "SHORTLISTED", "NEW"] },
      emails: { none: {} }
    },
    select: {
      id: true,
      currentStage: true,
      tenantId: true,
      jobId: true,
      candidateId: true,
      job: { select: { id: true, title: true, opportunityEmail: true } },
      candidate: { select: { fullName: true } }
    },
    orderBy: { createdAt: "desc" }
  });
  console.log(JSON.stringify(apps, null, 2));
}
main().then(() => prisma.$disconnect()).catch(e => { console.error(e.message); prisma.$disconnect(); });
