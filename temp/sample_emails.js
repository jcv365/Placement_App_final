const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  const drafts = await p.emailDraft.findMany({
    where: { tenantId: "dotcloudconsulting" },
    select: {
      id: true,
      subject: true,
      htmlBody: true,
      createdAt: true,
      application: {
        select: {
          currentStage: true,
          job: { select: { title: true, isRemote: true } },
          candidate: { select: { fullName: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  for (const d of drafts) {
    console.log("\n=== DRAFT ===");
    console.log("Subject:", d.subject);
    console.log("Candidate:", d.application.candidate.fullName);
    console.log("Job:", d.application.job.title);
    console.log("Remote:", d.application.job.isRemote);
    console.log("Stage:", d.application.currentStage);
    console.log("Created:", d.createdAt.toISOString());
    console.log("HTML length:", d.htmlBody.length);
    // Check for key prompt rules
    const html = d.htmlBody.toLowerCase();
    const checks = {
      "British English (optimised/optimised)":
        html.includes("optimis") ||
        html.includes("organis") ||
        html.includes("behaviour") ||
        !html.includes("optimized"),
      "No 'I hope this finds you well'":
        !html.includes("i hope this finds you well") &&
        !html.includes("hope you're well"),
      "No 'I'm reaching out'":
        !html.includes("i'm reaching out") &&
        !html.includes("i am reaching out"),
      "Has 'Relevant strengths'": html.includes("relevant strength"),
      "Has transparency paragraph":
        html.includes("one point to flag") ||
        html.includes("to be transparent"),
      "Has commercial paragraph": html.includes("commercially"),
      "Has CTA":
        html.includes("what would") ||
        html.includes("how would") ||
        html.includes("next step"),
      "Mentions DotCloud Consulting": html.includes("dotcloud consulting"),
      "Subject format check": /^.+\s*[–\-]\s*.+\s*[–\-]\s*.+$/.test(d.subject),
    };
    console.log("Quality checks:", JSON.stringify(checks, null, 2));
    // Print first 500 chars of body
    console.log("Body preview:", d.htmlBody.slice(0, 500));
  }

  await p.$disconnect();
}
main().catch((e) => console.error(e));
