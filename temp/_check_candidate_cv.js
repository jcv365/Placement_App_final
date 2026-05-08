const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

p.candidate
  .findFirst({
    where: { id: "cmnegz3m90005v6a4rur1ey87" },
    select: {
      id: true,
      fullName: true,
      rawCV: true,
      cvFileName: true,
      skillsCsv: true,
      certificationsCsv: true,
      suggestedRolesCsv: true,
      cvFileData: true,
    },
  })
  .then((r) => {
    console.log("fullName:", r.fullName);
    console.log("cvFileName:", r.cvFileName);
    console.log("rawCV length:", r.rawCV ? r.rawCV.length : "NULL");
    console.log("skillsCsv:", r.skillsCsv);
    console.log("certificationsCsv:", r.certificationsCsv);
    console.log("suggestedRolesCsv:", r.suggestedRolesCsv);
    console.log(
      "cvFileData bytes:",
      r.cvFileData ? r.cvFileData.length : "NULL",
    );
    return p.$disconnect();
  })
  .catch((e) => {
    console.error(e.message);
    p.$disconnect();
    process.exit(1);
  });
