const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  const ids = [
    "cmog9cwip017uqf01bz10lssv",
    "cmog95il2017oqf011jmc5wsn",
    "cmog94t5s017iqf01a0lhz5h6",
  ];
  for (const id of ids) {
    const d = await p.emailDraft.findUnique({ where: { id } });
    console.log("---");
    console.log("id:", id);
    if (!d) {
      console.log("not found");
      continue;
    }
    console.log("subject:", d.subject);
    console.log("createdAt:", d.createdAt.toISOString());
    console.log("appId:", d.applicationId);
    let app = null;
    if (d.applicationId) {
      app = await p.application.findUnique({
        where: { id: d.applicationId },
        include: { job: true, candidate: true },
      });
    }
    console.log("jobTitle:", app?.job?.title);
    console.log("candidate:", app?.candidate?.fullName, app?.candidate?.email);
    console.log("htmlBody:");
    console.log(d.htmlBody);
  }
  await p.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
