const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  const app = await p.application.findFirst({
    where: { id: "cmok170v000saok71bbexjds0" },
    select: {
      id: true,
      job: { select: { title: true, rawText: true } },
      candidate: { select: { fullName: true, rawCV: true } },
    },
  });
  console.log("Job title:", app.job.title);
  console.log("Job rawText (first 500):", app.job.rawText?.slice(0, 500));
  console.log("---");
  console.log("Candidate name:", app.candidate.fullName);
  console.log(
    "Candidate rawCV (first 500):",
    app.candidate.rawCV?.slice(0, 500),
  );
  await p.$disconnect();
}
main().catch((e) => console.error(e));
