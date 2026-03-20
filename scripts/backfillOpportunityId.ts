import { computeOpportunityId } from "../src/lib/opportunity";
import { prisma } from "../src/lib/prisma";

async function main() {
  const applications = await prisma.application.findMany({
    include: {
      job: {
        include: {
          company: true,
        },
      },
      candidate: true,
    },
  });

  for (const application of applications) {
    const opportunityId = computeOpportunityId({
      candidateName: application.candidate.fullName,
      roleTitle: application.job.title,
      companyName: application.job.company?.name,
    });

    await prisma.application.update({
      where: { id: application.id },
      data: { opportunityId },
    });
  }

  console.log(`Backfilled ${applications.length} applications.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
