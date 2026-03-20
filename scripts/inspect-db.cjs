const { PrismaClient } = require("@prisma/client");
(async () => {
  const prisma = new PrismaClient();
  const rows = await prisma.candidate.findMany({
    select: { fullName: true, email: true, vettingStatus: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  console.log(JSON.stringify(rows));
  await prisma.$disconnect();
})().catch(async (error) => {
  console.error(String(error));
  process.exit(1);
});
