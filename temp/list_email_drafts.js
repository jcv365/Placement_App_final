const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
async function main() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const drafts = await p.emailDraft.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { application: { select: { id: true, job: { select: { title: true } }, candidate: { select: { fullName: true, email: true } } } } }
  });
  console.log(`Found ${drafts.length} drafts created in the last 24h`);
  drafts.forEach(d => {
    const app = d.application;
    const jobTitle = app?.job?.title ?? '(no job)';
    const cand = app?.candidate?.fullName ?? '(no candidate)';
    const snippet = d.htmlBody.replace(/<[^>]+>/g, '').slice(0, 400).replace(/\n+/g,' ');
    console.log('---');
    console.log(`id: ${d.id}`);
    console.log(`createdAt: ${d.createdAt.toISOString()}`);
    console.log(`subject: ${d.subject}`);
    console.log(`appId: ${d.applicationId} job: ${jobTitle} candidate: ${cand}`);
    console.log(`bodySnippet: ${snippet}`);
  });
  await p.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
