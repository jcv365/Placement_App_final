const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  // The 4 Enterprise Architect drafts that are missing from Outlook
  const ids = [
    "cmnrtug6o007yqt01je0fvq2b", // 26+ Years, Azure & Integration
    "cmnrts5yj007bqt013pk8u3xj", // Dual CCIE, CISM, MBA
    "cmnrttbhq007nqt01wnec5d0c", // 30+ yrs consulting depth
    "cmnrtvh580088qt01anhi5tde", // multi-cloud governance depth
  ];

  for (const id of ids) {
    const d = await p.emailDraft.delete({
      where: { id },
      select: { subject: true },
    });
    console.log("Deleted:", d.subject);
  }

  const count = await p.emailDraft.count({
    where: { tenantId: "dotcloudconsulting" },
  });
  console.log("\nRemaining DB drafts:", count);
  await p.$disconnect();
})();
