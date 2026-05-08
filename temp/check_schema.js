const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
p.$queryRawUnsafe("PRAGMA table_info(Candidate)").then(cols => {
  cols.forEach(c => console.log(c.name));
  return p.$disconnect();
}).catch(e => { console.error(e.message); process.exit(1); });
