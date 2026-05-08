import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const jobs = await p.job.findMany({
  take: 3,
  select: { id: true, title: true },
});
console.log("Jobs:", JSON.stringify(jobs));
const candidates = await p.candidate.findMany({
  take: 3,
  select: { id: true, firstName: true, lastName: true },
});
console.log("Candidates:", JSON.stringify(candidates));
const apps = await p.application.findMany({
  take: 3,
  select: { id: true, jobId: true, candidateId: true },
});
console.log("Applications:", JSON.stringify(apps));
await p.$disconnect();
