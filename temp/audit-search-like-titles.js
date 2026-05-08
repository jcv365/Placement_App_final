const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

(async () => {
  const start = new Date("2026-04-07T00:00:00.000Z");
  const end = new Date("2026-04-08T00:00:00.000Z");
  const rows = await p.job.findMany({
    where: { createdAt: { gte: start, lt: end } },
    select: { tenantId: true, title: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const bad = rows.filter((r) =>
    /(^|\s)(contract|remote|outside|ir35|uk|europe|eu)(\s|$)/i.test(
      String(r.title || ""),
    ),
  );

  console.log("rowsToday", rows.length);
  console.log("searchLikeTitles", bad.length);
  for (const b of bad.slice(0, 25)) {
    console.log(
      JSON.stringify({
        tenantId: b.tenantId,
        title: b.title,
        createdAt: b.createdAt.toISOString(),
      }),
    );
  }

  await p.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await p.$disconnect();
  process.exit(1);
});
