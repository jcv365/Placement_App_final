/**
 * Fix Outlook drafts missing CV PDF attachments.
 *
 * Strategy:
 * 1. List all Outlook drafts (with hasAttachments flag)
 * 2. List all Sent Items (to identify already-sent drafts)
 * 3. For drafts missing attachments that HAVEN'T been sent yet:
 *    - Delete the old draft
 *    - Recreate with CV attachment
 * 4. For drafts missing attachments that HAVE been sent:
 *    - Delete the leftover draft (the sent copy already has attachments)
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
  if (!response.ok) throw new Error(`Token error: ${response.status}`);
  return (await response.json()).access_token;
}

async function listMessages(accessToken, folder, select) {
  let all = [];
  let url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MAILBOX)}/mailFolders/${folder}/messages?$select=${select}&$top=200`;
  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`List ${folder} error: ${res.status}`);
    const data = await res.json();
    all = all.concat(data.value || []);
    url = data["@odata.nextLink"] || null;
  }
  return all;
}

async function deleteOutlookDraft(accessToken, messageId) {
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MAILBOX)}/messages/${messageId}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok && response.status !== 404) {
    const text = await response.text();
    throw new Error(`Delete error: ${response.status} ${text.slice(0, 200)}`);
  }
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

  console.log("\nStep 2: Listing Outlook drafts and Sent Items...");
  const outlookDrafts = await listMessages(
    accessToken,
    "drafts",
    "subject,hasAttachments",
  );
  const sentItems = await listMessages(
    accessToken,
    "sentitems",
    "subject,hasAttachments",
  );

  const sentSubjects = new Set(
    sentItems.map((s) => (s.subject || "").trim().toLowerCase()),
  );
  console.log(
    `  Drafts: ${outlookDrafts.length} (${outlookDrafts.filter((d) => d.hasAttachments).length} with attachments)`,
  );
  console.log(
    `  Sent Items: ${sentItems.length} (${sentItems.filter((s) => s.hasAttachments).length} with attachments)`,
  );

  // Categorise drafts without attachments
  const draftsWithoutAttach = outlookDrafts.filter((d) => !d.hasAttachments);
  const alreadySent = draftsWithoutAttach.filter((d) =>
    sentSubjects.has((d.subject || "").trim().toLowerCase()),
  );
  const notYetSent = draftsWithoutAttach.filter(
    (d) => !sentSubjects.has((d.subject || "").trim().toLowerCase()),
  );

  console.log(`\n  Drafts without attachments: ${draftsWithoutAttach.length}`);
  console.log(
    `    Already sent (just delete leftover draft): ${alreadySent.length}`,
  );
  console.log(
    `    Not yet sent (delete + recreate with CV): ${notYetSent.length}`,
  );

  // Step 3: Delete leftover drafts that were already sent
  if (alreadySent.length > 0) {
    console.log(
      `\nStep 3: Deleting ${alreadySent.length} leftover drafts (already sent with attachments)...`,
    );
    let deleted = 0;
    for (const d of alreadySent) {
      try {
        await deleteOutlookDraft(accessToken, d.id);
        deleted++;
      } catch (e) {
        // Non-fatal
      }
    }
    console.log(`  Deleted: ${deleted}`);
  }

  if (notYetSent.length === 0) {
    console.log("\nNo drafts need recreation. Done.");
    await p.$disconnect();
    return;
  }

  // Step 4: Match unsent drafts against DB to get candidate CV data
  console.log(
    `\nStep 4: Matching ${notYetSent.length} unsent drafts against DB...`,
  );
  const noAttachBySubject = new Map();
  for (const d of notYetSent) {
    const key = (d.subject || "").trim().toLowerCase();
    noAttachBySubject.set(key, d.id);
  }

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

  const needsRecreation = dbDraftsLight.filter((d) => {
    const key = (d.subject || "").trim().toLowerCase();
    return noAttachBySubject.has(key);
  });

  console.log(`  DB drafts needing recreation: ${needsRecreation.length}`);

  if (needsRecreation.length === 0) {
    console.log("\nNo drafts need recreation. Done.");
    await p.$disconnect();
    return;
  }

  // Step 5: Delete old drafts and recreate with attachments
  const BATCH_SIZE = 10;
  let created = 0;
  let skipped = 0;
  let failed = 0;
  let withCv = 0;
  let withoutCv = 0;

  console.log(
    `\nStep 5: Recreating ${needsRecreation.length} drafts with CV attachments...`,
  );

  for (let i = 0; i < needsRecreation.length; i += BATCH_SIZE) {
    const batch = needsRecreation.slice(i, i + BATCH_SIZE);

    // Delete old drafts without attachments
    for (const d of batch) {
      const key = (d.subject || "").trim().toLowerCase();
      const outlookId = noAttachBySubject.get(key);
      if (outlookId) {
        try {
          await deleteOutlookDraft(accessToken, outlookId);
        } catch (e) {
          // Non-fatal
        }
      }
    }

    // Load full draft data including binary CV data for this batch
    const batchDrafts = await p.emailDraft.findMany({
      where: { id: { in: batch.map((d) => d.id) } },
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
      const rawEmail = draft.application?.job?.opportunityEmail || "";
      const recipients = rawEmail
        .split(/[;,]/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

      if (recipients.length === 0) {
        skipped++;
        continue;
      }

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
          withCv++;
        } else if (
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
          withCv++;
        } else {
          withoutCv++;
        }
      } catch (e) {
        console.log(`  Attachment error for "${draft.subject}": ${e.message}`);
        withoutCv++;
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
      `  Progress: ${Math.min(i + BATCH_SIZE, needsRecreation.length)}/${needsRecreation.length} | ${created} created, ${skipped} skipped, ${failed} failed | ${withCv} with CV, ${withoutCv} without CV`,
    );
  }

  console.log(`\n=== DONE ===`);
  console.log(`  Created: ${created}`);
  console.log(`  Skipped (no recipients): ${skipped}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  With CV attachment: ${withCv}`);
  console.log(`  Without CV attachment: ${withoutCv}`);

  await p.$disconnect();
}

main().catch((e) => console.error("Fatal:", e));
