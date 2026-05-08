const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
p.tenantUser
  .findMany({
    where: { tenantId: "dotcloudconsulting" },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      isActive: true,
    },
  })
  .then((users) => {
    console.log(JSON.stringify(users, null, 2));
    p.$disconnect();
  });
