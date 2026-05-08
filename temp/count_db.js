const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const c = await p.emailDraft.count({
    where: { tenantId: "dotcloudconsulting" },
  });
  console.log("DB draft count:", c);
  await p.$disconnect();
})();
