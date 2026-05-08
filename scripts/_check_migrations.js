const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
async function main() {
  const rows = await p.$queryRawUnsafe('SELECT migration_name, finished_at, applied_steps_done, rolled_back_at FROM _prisma_migrations ORDER BY started_at');
  console.log(JSON.stringify(rows, (k,v) => typeof v === 'bigint' ? Number(v) : v, 2));
  await p.$disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });
