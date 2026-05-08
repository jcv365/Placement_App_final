// Find real test data for all 11 journeys
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient({
  datasources: { db: { url: "file:../prisma/prod.db?connection_limit=1" } },
});

try {
  // Find application with highest ATS score for email generation
  const highAts = await prisma.application.findFirst({
    where: { tenantId: "dotcloudconsulting", atsScore: { gte: 80 } },
    include: {
      job: { select: { title: true, opportunityEmail: true } },
      candidate: { select: { fullName: true, rawCV: true } },
    },
    orderBy: { atsScore: "desc" },
  });
  console.log(
    "HIGH ATS APP:",
    JSON.stringify({
      appId: highAts?.id,
      jobId: highAts?.jobId,
      candidateId: highAts?.candidateId,
      atsScore: highAts?.atsScore,
      jobTitle: highAts?.job?.title,
      candidateName: highAts?.candidate?.fullName,
    }),
  );

  // Find application with existing email draft
  const withDraft = await prisma.application.findFirst({
    where: { tenantId: "dotcloudconsulting", emailDrafts: { some: {} } },
    include: {
      job: { select: { title: true } },
      candidate: { select: { fullName: true } },
      emailDrafts: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  console.log(
    "WITH DRAFT:",
    JSON.stringify({
      appId: withDraft?.id,
      jobId: withDraft?.jobId,
      candidateId: withDraft?.candidateId,
      draftId: withDraft?.emailDrafts?.[0]?.id,
    }),
  );

  // Find any candidate with rawCV
  const candidateWithCv = await prisma.candidate.findFirst({
    where: { tenantId: "dotcloudconsulting", rawCV: { not: "" } },
    select: { id: true, fullName: true, skillsCsv: true },
  });
  console.log("CANDIDATE WITH CV:", JSON.stringify(candidateWithCv));

  // Find any job
  const job = await prisma.job.findFirst({
    where: { tenantId: "dotcloudconsulting" },
    select: { id: true, title: true },
    orderBy: { createdAt: "desc" },
  });
  console.log("JOB:", JSON.stringify(job));

  // Count all applications and their ATS scores distribution
  const counts = await prisma.application.groupBy({
    by: ["currentStage"],
    where: { tenantId: "dotcloudconsulting" },
    _count: true,
  });
  console.log("APP STAGES:", JSON.stringify(counts));

  // Find any application with ATS score > 85 for email
  const apps = await prisma.application.findMany({
    where: { tenantId: "dotcloudconsulting" },
    orderBy: { atsScore: "desc" },
    take: 5,
    select: {
      id: true,
      jobId: true,
      candidateId: true,
      atsScore: true,
      currentStage: true,
    },
  });
  console.log("TOP ATS APPS:", JSON.stringify(apps));
} finally {
  await prisma.$disconnect();
}
