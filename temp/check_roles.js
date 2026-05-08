process.chdir("/app");
const { PrismaClient } = require("/app/node_modules/@prisma/client");
const p = new PrismaClient();
p.candidate.findMany({
  where: { fullName: { in: ["Jonathan Wagener","Kudzai Murimi","Liliyosa Mbakureya","Riaan Snyders","Jeanre Swanepoel"] } },
  select: { fullName: true, suggestedRolesCsv: true, preferredRolesCsv: true }
}).then(r => {
  r.forEach(c => console.log(c.fullName, "|", c.suggestedRolesCsv, "|", c.preferredRolesCsv));
  p.$disconnect();
}).catch(e => { console.error(e.message); p.$disconnect(); });
