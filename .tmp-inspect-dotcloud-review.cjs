const { PrismaClient } = require("@prisma/client");

async function inspect(dbUrl, label) {
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  try {
    const jobsNoCompany = await prisma.job.findMany({
      where: { companyId: null },
      select: { id: true, title: true, companyId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    const dotcloudCompanies = await prisma.company.findMany({
      where: { name: { contains: "dotcloud" } },
      select: { id: true, name: true, tenantId: true },
    });

    const dotcloudJobs = await prisma.job.findMany({
      where: { company: { is: { name: { contains: "dotcloud" } } } },
      select: {
        id: true,
        title: true,
        companyId: true,
        createdAt: true,
        company: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    console.log(
      JSON.stringify(
        {
          label,
          jobsWithoutCompanyCount: jobsNoCompany.length,
          jobsWithoutCompanySample: jobsNoCompany,
          dotcloudCompanies,
          dotcloudJobsCount: dotcloudJobs.length,
          dotcloudJobs,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

(async () => {
  await inspect("file:./prod.db", "prod");
})();
