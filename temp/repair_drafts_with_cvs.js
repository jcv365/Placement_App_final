// Repair Outlook drafts WITH CV attachments
// Runs inside the container, bypassing HTTP auth
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

// Import the compiled graph and pdfRedaction modules
const {
  createOutlookDraftForMailbox,
  getGraphAppAccessToken,
} = require("/app/node_modules/.prisma/client/../dist/lib/graph");
const {
  buildRedactedCvPdfFromText,
  redactContactDetailsInPdf,
} = require("/app/node_modules/.prisma/client/../dist/lib/pdfRedaction");

const DEFAULT_OUTLOOK_MAILBOX = "placements@dotcloud.africa";

function parseEmails(raw) {
  if (!raw) return [];
  return raw
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes("@") && s.includes("."));
}

function safeAttachmentName(value) {
  const base = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "candidate";
}

async function fetchAllSubjectsFromFolder(token, mailbox, folderName) {
  const subjects = new Set();
  let url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/mailFolders/${folderName}/messages?$select=subject&$top=999`;
  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok)
      throw new Error(
        `Graph error fetching ${folderName}: ${res.status} ${await res.text()}`,
      );
    const data = await res.json();
    for (const msg of data.value || []) {
      if (msg.subject) subjects.add(msg.subject.trim());
    }
    url = data["@odata.nextLink"] || null;
  }
  return subjects;
}

async function main() {
  const mailbox =
    process.env.OUTLOOK_SHARED_MAILBOX?.trim() ||
    process.env.GRAPH_SENDER_USER?.trim() ||
    DEFAULT_OUTLOOK_MAILBOX;
  console.log("Mailbox:", mailbox);

  // Fetch all DB email drafts, latest per job+candidate pair
  const dbDrafts = await p.emailDraft.findMany({
    where: { tenantId: "dotcloudconsulting" },
    select: {
      id: true,
      subject: true,
      htmlBody: true,
      application: {
        select: {
          jobId: true,
          candidateId: true,
          job: { select: { title: true, opportunityEmail: true } },
          candidate: {
            select: {
              fullName: true,
              email: true,
              phone: true,
              rawCV: true,
              cvFileName: true,
              cvMimeType: true,
              cvFileData: true,
              formattedCvPdfData: true,
              formattedCvFileName: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Deduplicate per job+candidate
  const pairMap = new Map();
  for (const d of dbDrafts) {
    const key = `${d.application.jobId}::${d.application.candidateId}`;
    if (!pairMap.has(key)) pairMap.set(key, d);
  }
  const dbPairs = [...pairMap.values()];
  console.log(`DB draft pairs: ${dbPairs.length}`);

  // Fetch subjects from Drafts + Sent Items
  const token = await getGraphAppAccessToken();
  console.log("Graph token obtained.");

  const [draftSubjects, sentSubjects] = await Promise.all([
    fetchAllSubjectsFromFolder(token, mailbox, "drafts"),
    fetchAllSubjectsFromFolder(token, mailbox, "sentitems"),
  ]);
  const allOutlookSubjects = new Set([...draftSubjects, ...sentSubjects]);
  console.log(`Outlook subjects (drafts + sent): ${allOutlookSubjects.size}`);

  // Find missing drafts
  const missing = dbPairs.filter(
    (d) => !allOutlookSubjects.has(d.subject?.trim() ?? ""),
  );
  const actionable = missing.filter(
    (d) => parseEmails(d.application.job.opportunityEmail).length > 0,
  );
  const skippedNoEmail = missing.length - actionable.length;
  console.log(
    `Missing from Outlook: ${missing.length}, actionable (have email): ${actionable.length}, skipped (no email): ${skippedNoEmail}`,
  );

  let repaired = 0;
  let failed = 0;
  let withCv = 0;
  let withoutCv = 0;

  for (const d of actionable) {
    const toEmails = parseEmails(d.application.job.opportunityEmail);
    try {
      const candidate = d.application.candidate;
      const hasFormattedPdf =
        Boolean(candidate.formattedCvPdfData) &&
        (candidate.formattedCvPdfData?.byteLength ?? 0) > 0;

      let redactedPdfBase64;

      if (hasFormattedPdf && candidate.formattedCvPdfData) {
        redactedPdfBase64 = Buffer.from(candidate.formattedCvPdfData).toString(
          "base64",
        );
      } else {
        const hasBinaryCv =
          Boolean(candidate.cvFileData) &&
          (candidate.cvFileData?.byteLength ?? 0) > 0;
        const looksLikePdfCv =
          hasBinaryCv &&
          ((candidate.cvMimeType?.trim().toLowerCase() || "") ===
            "application/pdf" ||
            (candidate.cvFileName?.trim().toLowerCase().endsWith(".pdf") ??
              false));

        if (looksLikePdfCv && candidate.cvFileData) {
          try {
            const redactedPdf = await redactContactDetailsInPdf({
              pdfBytes: Buffer.from(candidate.cvFileData),
              email: candidate.email,
              phone: candidate.phone,
            });
            redactedPdfBase64 = redactedPdf.toString("base64");
          } catch (error) {
            console.warn("[REPAIR_DRAFT_REDACTION_FALLBACK]", {
              reason: error?.message ?? "unknown",
            });
            redactedPdfBase64 = undefined;
          }
        }

        if (!redactedPdfBase64 && (candidate.rawCV ?? "").trim()) {
          const fallbackRedactedPdf = await buildRedactedCvPdfFromText({
            cvText: candidate.rawCV ?? "",
            candidateName: candidate.fullName,
            email: candidate.email,
            phone: candidate.phone,
          });
          redactedPdfBase64 = fallbackRedactedPdf.toString("base64");
        }
      }

      const safeName = safeAttachmentName(candidate.fullName ?? "candidate");
      const attachments = redactedPdfBase64
        ? [
            {
              filename:
                (hasFormattedPdf
                  ? candidate.formattedCvFileName?.trim()
                  : candidate.cvFileName?.trim()) || `${safeName}-cv.pdf`,
              contentBase64: redactedPdfBase64,
              contentType: "application/pdf",
            },
          ]
        : [];

      if (attachments.length > 0) withCv++;
      else withoutCv++;

      await createOutlookDraftForMailbox({
        mailbox,
        subject: d.subject ?? "",
        htmlBody: d.htmlBody ?? "",
        to: toEmails,
        attachments,
      });
      repaired++;
      if (repaired % 50 === 0)
        console.log(`Progress: ${repaired}/${actionable.length} repaired`);
    } catch (e) {
      failed++;
      console.error(`Failed: "${d.subject}" - ${e.message}`);
    }
    // Rate limit: ~3 requests per second
    await new Promise((r) => setTimeout(r, 350));
  }

  console.log(`\n=== DONE ===`);
  console.log(`Repaired: ${repaired}, Failed: ${failed}`);
  console.log(`With CV: ${withCv}, Without CV: ${withoutCv}`);
  console.log(`Already in mailbox: ${dbPairs.length - missing.length}`);
  console.log(`Skipped (no email): ${skippedNoEmail}`);

  await p.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
