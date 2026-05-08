/**
 * Delete Outlook drafts from the shared mailbox that correspond to
 * location-restricted jobs (India-only, UK-only, Europe-only).
 *
 * This script:
 * 1. Gets a Graph access token
 * 2. Lists all drafts in the shared mailbox
 * 3. Matches them against known job titles from location-restricted jobs
 * 4. Deletes the matching drafts
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
    const message = await response.text();
    throw new Error(`Graph token error: ${response.status} ${message}`);
  }

  const payload = await response.json();
  return payload.access_token;
}

// Location restriction patterns (same as jobClassification.ts)
function requiresNonSaLocationRestriction(title, rawText) {
  const haystack = `${title} ${rawText}`.toLowerCase();
  const indiaPatterns =
    /\bbased\s+in\s+(?:pune|bengaluru|bangalore|chennai|hyderabad|mumbai|delhi|noida|gurgaon|kolkata)\b|\bmust\s+be\s+based\s+in\s+(?:pune|bengaluru|bangalore|chennai|hyderabad|mumbai|delhi|noida|gurgaon|kolkata|india)\b|\blocation[\s:]*\s*(?:pune|bengaluru|bangalore|chennai|hyderabad|mumbai|delhi|noida|gurgaon|kolkata)\b|\bpan\s+india\b|\bwork\s+from\s+office\b.*(?:pune|bengaluru|bangalore|chennai|hyderabad|mumbai|delhi)/;
  const europePatterns =
    /\bmust\s+be\s+based\s+in\s+europe\b|\bbased\s+in\s+(?:the\s+)?uk\s+only\b|\buk[\s-]based\s+only\b|\bbased\s+in\s+(?:the\s+)?eu\b/;
  const ukOnlyPatterns =
    /\bbased\s+in\s+uk\s+only\b|\buk\s*\/\s*eu\s+only\b|\buk\s+only\b|\bmust\s+be\s+(?:based\s+in|resident\s+in)\s+(?:the\s+)?uk\b/;
  return (
    indiaPatterns.test(haystack) ||
    europePatterns.test(haystack) ||
    ukOnlyPatterns.test(haystack)
  );
}

// SA-compatible patterns (should NOT be deleted)
function isSaCompatibleJob(title, rawText) {
  const haystack = `${title} ${rawText}`.toLowerCase();
  return /\bmust\s+be\s+currently\s+based\s+in\s+south\s+africa\b|\bfully\s+remote\s*[\(]\s*sa\s*[\)]\b|\bremote\s+from\s+south\s+africa\b|\bwork\s+from\s+south\s+africa\b|\bsouth\s+african\s+professionals\b/i.test(
    haystack,
  );
}

async function main() {
  console.log("Step 1: Getting Graph access token...");
  const accessToken = await getAccessToken();
  console.log("  Token obtained.");

  // Step 2: Get all location-restricted job titles
  console.log("\nStep 2: Finding location-restricted jobs...");
  const allJobs = await p.job.findMany({
    where: { tenantId: "dotcloudconsulting" },
    select: { id: true, title: true, rawText: true },
  });

  const incompatibleJobs = allJobs.filter((j) => {
    if (isSaCompatibleJob(j.title, j.rawText)) return false;
    return requiresNonSaLocationRestriction(j.title, j.rawText);
  });

  console.log(`  Found ${incompatibleJobs.length} location-restricted jobs`);

  // Extract key words from job titles for matching
  const jobKeywords = incompatibleJobs.map((j) => {
    const title = j.title.toLowerCase();
    // Extract meaningful keywords (skip common words)
    const words = title
      .split(/[\s\-–—|,]+/)
      .filter(
        (w) =>
          w.length > 2 &&
          !/^(the|and|for|with|senior|lead|junior|mid|level|role|contract|position|hire|looking|seeking|required|wanted|urgent|needed|remote|fully|based|only|must|years|exp|experience)$/i.test(
            w,
          ),
      );
    return { id: j.id, title: j.title, keywords: words };
  });

  console.log("\nStep 3: Listing Outlook drafts...");
  let allDrafts = [];
  let url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MAILBOX)}/mailFolders/drafts/messages?$select=id,subject,toRecipients,createdDateTime&$top=200`;

  while (url) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Graph list drafts error: ${response.status} ${text}`);
    }
    const data = await response.json();
    allDrafts = allDrafts.concat(data.value || []);
    url = data["@odata.nextLink"] || null;
  }

  console.log(`  Found ${allDrafts.length} total drafts in mailbox`);

  // Step 4: Match drafts against location-restricted job titles
  console.log("\nStep 4: Matching drafts to location-restricted jobs...");
  const draftsToDelete = [];

  for (const draft of allDrafts) {
    const subject = (draft.subject || "").toLowerCase();
    const toEmails = (draft.toRecipients || []).map((r) =>
      (r.emailAddress?.address || "").toLowerCase(),
    );

    // Check if the subject contains keywords from any incompatible job
    for (const job of jobKeywords) {
      const jobTitleLower = job.title.toLowerCase();
      // Match if the subject contains at least 2 significant words from the job title
      const matchCount = job.keywords.filter((kw) =>
        subject.includes(kw),
      ).length;
      if (matchCount >= 2 || (job.keywords.length <= 2 && matchCount >= 1)) {
        // Additional check: make sure this isn't a SA-compatible job
        const fullJob = incompatibleJobs.find((j) => j.id === job.id);
        if (fullJob && !isSaCompatibleJob(fullJob.title, fullJob.rawText)) {
          draftsToDelete.push({
            id: draft.id,
            subject: draft.subject,
            createdDateTime: draft.createdDateTime,
            toEmails: toEmails.join(", "),
            matchedJob: job.title,
          });
          break; // Don't match the same draft to multiple jobs
        }
      }
    }
  }

  console.log(`  Matched ${draftsToDelete.length} drafts for deletion`);

  if (draftsToDelete.length === 0) {
    console.log("\nNo drafts to delete. Done.");
    await p.$disconnect();
    return;
  }

  // Show what we're about to delete
  console.log("\nDrafts to delete:");
  for (const d of draftsToDelete.slice(0, 20)) {
    console.log(
      `  - "${d.subject}" → matched: ${d.matchedJob} (to: ${d.toEmails})`,
    );
  }
  if (draftsToDelete.length > 20) {
    console.log(`  ... and ${draftsToDelete.length - 20} more`);
  }

  // Step 5: Delete the drafts
  console.log(`\nStep 5: Deleting ${draftsToDelete.length} drafts...`);
  let deleted = 0;
  let failed = 0;

  for (const draft of draftsToDelete) {
    try {
      const response = await fetch(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MAILBOX)}/messages/${draft.id}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      if (response.ok || response.status === 204) {
        deleted++;
      } else {
        const text = await response.text();
        console.log(
          `  Failed to delete "${draft.subject}": ${response.status} ${text.slice(0, 100)}`,
        );
        failed++;
      }
    } catch (e) {
      console.log(`  Error deleting "${draft.subject}": ${e.message}`);
      failed++;
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`  Deleted: ${deleted}`);
  console.log(`  Failed: ${failed}`);

  await p.$disconnect();
}

main().catch((e) => console.error("Fatal:", e));
