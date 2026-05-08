/**
 * Regenerate Outlook drafts for DB EmailDraft records that no longer have
 * corresponding Outlook drafts in the shared mailbox.
 *
 * Includes CV PDF attachments (formatted CV preferred, falls back to raw CV PDF).
 * Processes in batches to avoid memory issues with binary data.
 */
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

const GRAPH_TENANT_ID = process.env.GRAPH_TENANT_ID;
const GRAPH_CLIENT_ID = process.env.GRAPH_CLIENT_ID;
const GRAPH_CLIENT_SECRET = process.env.GRAPH_CLIENT_SECRET;
const MAILBOX = (
  process.env.OUTLOOK_SHARED_MAILBOX || "placements@dotcloud.africa"
)
  .trim()
  .toLowerCase();

function safeAttachmentName(value) {
  const base = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "candidate";
}

async function getAccessToken() {
  const tokenUrl = `https://login.microsoftonline.com/${GRAPH_TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: GRAPH_CLIENT_ID,
    client_secret: GRAPH_CLIENT_SECRET,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token error: ${response.status} ${text}`);
  }
  const payload = await response.json();
  return payload.access_token;
}

async function listOutlookDraftSubjects(accessToken) {
  let allDrafts = [];
  let url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MAILBOX)}/mailFolders/drafts/messages?$select=subject&$top=200`;
  while (url) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new Error(`List error: ${response.status}`);
    const data = await response.json();
    allDrafts = allDrafts.concat(data.value || []);
    url = data["@odata.nextLink"] || null;
  }
  return new Set(allDrafts.map((d) => (d.subject || "").trim().toLowerCase()));
}

async function createOutlookDraft(
  accessToken,
  subject,
  htmlBody,
  toRecipients,
  attachments,
) {
  const messageBody = {
    subject,
    body: { contentType: "HTML", content: htmlBody },
    toRecipients: toRecipients.map((addr) => ({
      emailAddress: { address: addr },
    })),
  };

  if (attachments && attachments.length > 0) {
    messageBody.attachments = attachments.map((att) => ({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: att.filename,
      contentType: att.contentType,
      contentBytes: att.contentBase64,
    }));
  }

  const response = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MAILBOX)}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(messageBody),
    },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Create draft error: ${response.status} ${text.slice(0, 300)}`,
    );
  }
  return response.json();
}

async function main() {
  console.log("Step 1: Getting Graph access token...");
  const accessToken = await getAccessToken();

  console.log("\nStep 2: Listing existing Outlook drafts...");
  const existingSubjects = await listOutlookDraftSubjects(accessToken);
  console.log(`  Found ${existingSubjects.size} existing Outlook drafts`);

  console.log("\nStep 3: Finding DB drafts without Outlook drafts...");
  // Light query first — no binary data
  const dbDraftsLight = await p.emailDraft.findMany({
    where: { tenantId: "dotcloudconsulting" },
    select: {
      id: true,
      subject: true,
      application: {
        select: {
          job: { select: { opportunityEmail: true } },
          candidate: { select: { fullName: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`  Total DB drafts: ${dbDraftsLight.length}`);

  // Find DB drafts that don't have a matching Outlook draft
  const missingIds = dbDraftsLight
    .filter((d) => {
      const subjectLower = (d.subject || "").trim().toLowerCase();
      return !existingSubjects.has(subjectLower);
    })
    .map((d) => d.id);

  console.log(`  Missing Outlook drafts: ${missingIds.length}`);

  if (missingIds.length === 0) {
    console.log("\nNo drafts to recreate. Done.");
    await p.$disconnect();
    return;
  }

  // Show sample
  const sampleMissing = dbDraftsLight
    .filter((d) => missingIds.includes(d.id))
    .slice(0, 5);
  console.log("\nSample drafts to recreate:");
  for (const d of sampleMissing) {
    const email = d.application?.job?.opportunityEmail || "no email";
    console.log(`  - "${d.subject}" → to: ${email}`);
  }

  // Step 4: Recreate Outlook drafts with CV attachments in batches
  const BATCH_SIZE = 10;
  let created = 0;
  let skipped = 0;
  let failed = 0;
  let withAttachment = 0;
  let withoutAttachment = 0;

  console.log(
    `\nStep 4: Recreating ${missingIds.length} Outlook drafts with CV attachments (batch size: ${BATCH_SIZE})...`,
  );

  for (let i = 0; i < missingIds.length; i += BATCH_SIZE) {
    const batchIds = missingIds.slice(i, i + BATCH_SIZE);

    // Load full draft data including binary CV data for this batch only
    const batchDrafts = await p.emailDraft.findMany({
      where: { id: { in: batchIds } },
      select: {
        id: true,
        subject: true,
        htmlBody: true,
        application: {
          select: {
            job: { select: { opportunityEmail: true } },
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
    });

    for (const draft of batchDrafts) {
      // Parse recipients from opportunity email
      const rawEmail = draft.application?.job?.opportunityEmail || "";
      const recipients = rawEmail
        .split(/[;,]/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

      if (recipients.length === 0) {
        skipped++;
        continue;
      }

      // Build CV attachment
      const cand = draft.application?.candidate;
      let attachments = [];

      try {
        // Prefer formatted ATS PDF
        if (
          cand?.formattedCvPdfData &&
          Buffer.isBuffer(cand.formattedCvPdfData) &&
          cand.formattedCvPdfData.byteLength > 0
        ) {
          const filename =
            cand.formattedCvFileName?.trim() ||
            `${safeAttachmentName(cand.fullName)}-cv.pdf`;
          attachments.push({
            filename,
            contentBase64: cand.formattedCvPdfData.toString("base64"),
            contentType: "application/pdf",
          });
          withAttachment++;
        }
        // Fall back to raw uploaded PDF
        else if (
          cand?.cvFileData &&
          Buffer.isBuffer(cand.cvFileData) &&
          cand.cvFileData.byteLength > 0 &&
          cand.cvMimeType === "application/pdf"
        ) {
          const filename =
            cand.cvFileName?.trim() ||
            `${safeAttachmentName(cand.fullName)}-cv.pdf`;
          attachments.push({
            filename,
            contentBase64: cand.cvFileData.toString("base64"),
            contentType: "application/pdf",
          });
          withAttachment++;
        } else {
          withoutAttachment++;
        }
      } catch (e) {
        console.log(`  Attachment error for "${draft.subject}": ${e.message}`);
        withoutAttachment++;
      }

      try {
        await createOutlookDraft(
          accessToken,
          draft.subject,
          draft.htmlBody,
          recipients,
          attachments,
        );
        created++;
      } catch (e) {
        console.log(`  Failed: "${draft.subject}" - ${e.message}`);
        failed++;
      }
    }

    console.log(
      `  Progress: ${Math.min(i + BATCH_SIZE, missingIds.length)}/${missingIds.length} processed | ${created} created, ${skipped} skipped, ${failed} failed | ${withAttachment} with CV, ${withoutAttachment} without CV`,
    );
  }

  console.log(`\n=== DONE ===`);
  console.log(`  Created: ${created}`);
  console.log(`  Skipped (no recipients): ${skipped}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  With CV attachment: ${withAttachment}`);
  console.log(`  Without CV attachment: ${withoutAttachment}`);

  await p.$disconnect();
}

main().catch((e) => console.error("Fatal:", e));
