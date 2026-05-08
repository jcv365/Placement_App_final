const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  // Check how many candidates have CV data
  const totalCandidates = await p.candidate.count({
    where: { tenantId: "dotcloudconsulting" },
  });
  const withFormattedCv = await p.candidate.count({
    where: {
      tenantId: "dotcloudconsulting",
      formattedCvPdfData: { not: null },
    },
  });
  const withCvFileData = await p.candidate.count({
    where: { tenantId: "dotcloudconsulting", cvFileData: { not: null } },
  });
  const withRawCv = await p.candidate.count({
    where: { tenantId: "dotcloudconsulting", rawCV: { not: "" } },
  });

  console.log("Candidate CV data:");
  console.log(`  Total candidates: ${totalCandidates}`);
  console.log(`  With formattedCvPdfData: ${withFormattedCv}`);
  console.log(`  With cvFileData: ${withCvFileData}`);
  console.log(`  With rawCV text: ${withRawCv}`);

  // Check a sample candidate
  const sample = await p.candidate.findFirst({
    where: {
      tenantId: "dotcloudconsulting",
      formattedCvPdfData: { not: null },
    },
    select: {
      fullName: true,
      formattedCvFileName: true,
      formattedCvPdfData: true,
      cvFileName: true,
      cvFileData: true,
      cvMimeType: true,
    },
  });
  if (sample) {
    console.log(
      `\nSample candidate with formattedCvPdfData: ${sample.fullName}`,
    );
    console.log(`  formattedCvFileName: ${sample.formattedCvFileName}`);
    console.log(
      `  formattedCvPdfData length: ${sample.formattedCvPdfData?.byteLength ?? 0}`,
    );
    console.log(`  cvFileName: ${sample.cvFileName}`);
    console.log(`  cvFileData length: ${sample.cvFileData?.byteLength ?? 0}`);
    console.log(`  cvMimeType: ${sample.cvMimeType}`);
  } else {
    console.log("\nNo candidates with formattedCvPdfData found!");
  }

  // Check a sample with cvFileData
  const sample2 = await p.candidate.findFirst({
    where: { tenantId: "dotcloudconsulting", cvFileData: { not: null } },
    select: {
      fullName: true,
      cvFileName: true,
      cvFileData: true,
      cvMimeType: true,
    },
  });
  if (sample2) {
    console.log(`\nSample candidate with cvFileData: ${sample2.fullName}`);
    console.log(`  cvFileName: ${sample2.cvFileName}`);
    console.log(`  cvFileData length: ${sample2.cvFileData?.byteLength ?? 0}`);
    console.log(`  cvMimeType: ${sample2.cvMimeType}`);
  } else {
    console.log("\nNo candidates with cvFileData found!");
  }

  await p.$disconnect();
}
main().catch((e) => console.error(e));
