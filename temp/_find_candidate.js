const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

p.candidate
  .findMany({
    where: { fullName: { contains: "Venter" } },
    select: {
      id: true,
      fullName: true,
      formattedCvFileName: true,
      formattedCvGeneratedAt: true,
      tenantId: true,
    },
  })
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
    return p.$disconnect();
  })
  .catch((e) => {
    console.error(e.message);
    p.$disconnect();
    process.exit(1);
  });
