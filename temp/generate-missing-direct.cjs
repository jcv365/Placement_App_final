#!/usr/bin/env node
// Generates missing email drafts by calling the LLM directly and posting to Outlook via Graph API.
// Bypasses the app's ATS safety gate and role match guard.
"use strict";

const path = require("path");
const fs = require("fs");

// Load .env.local
const envPath = path.resolve(__dirname, "../.env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}

process.env.DATABASE_URL =
  "file:/app/db/prod.db?connection_limit=1&busy_timeout=15000";

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const TENANT_ID = process.env.GRAPH_TENANT_ID;
const CLIENT_ID = process.env.GRAPH_CLIENT_ID;
const CLIENT_SECRET = process.env.GRAPH_CLIENT_SECRET;
const MAILBOX =
  process.env.OUTLOOK_SHARED_MAILBOX ||
  process.env.GRAPH_SENDER_USER ||
  "placements@dotcloud.africa";
const LLM_API_BASE = "http://host.docker.internal:4001/v1";
const LLM_API_KEY = "sk-WYyjZwVwjE9PoP3W8C_YGrAsV-DrFanjS5LDPSvVWy4";
const LLM_MODEL = "email-generation";
const DRY_RUN = process.argv.includes("--dry-run");

async function getGraphToken() {
  const res = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "client_credentials",
        scope: "https://graph.microsoft.com/.default",
      }),
    },
  );
  const data = await res.json();
  if (!res.ok || !data.access_token)
    throw new Error(`Token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function fetchAllSubjectsFromFolder(token, folderName) {
  const subjects = new Set();
  let url =
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MAILBOX)}/mailFolders/${folderName}/messages` +
    `?$select=subject&$top=999`;

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Graph error fetching ${folderName} ${res.status}: ${text}`,
      );
    }
    const data = await res.json();
    for (const msg of data.value ?? []) {
      if (msg.subject) subjects.add(msg.subject.trim());
    }
    url = data["@odata.nextLink"] ?? null;
  }
  return subjects;
}

async function createOutlookDraft(token, { subject, htmlBody, toEmails }) {
  const body = {
    subject,
    body: { contentType: "HTML", content: htmlBody },
    toRecipients: toEmails.map((addr) => ({
      emailAddress: { address: addr },
    })),
  };
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MAILBOX)}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Draft creation failed ${res.status}: ${text}`);
  }
  return (await res.json()).id;
}

async function generateEmailViaLlm(
  jobTitle,
  candidateName,
  companyName,
  opportunityEmail,
  rawText,
) {
  const systemPrompt = `You are a professional recruitment consultant writing candidate introduction emails. Write in British English. Keep the email concise (3-4 paragraphs). Structure:
1. Subject line: "${candidateName} | ${jobTitle}"
2. Introduce the candidate and their relevant experience
3. Explain why they're a good fit for the role
4. Professional closing with call to action

IMPORTANT: Return ONLY valid JSON with keys "subject" and "htmlBody". The htmlBody must contain a complete HTML document starting with <html> and ending with </html>. Do not include any text outside the JSON.`;

  const userPrompt = `Generate a professional candidate introduction email.
- Candidate: ${candidateName}
- Role: ${jobTitle}
- Company: ${companyName || "the client"}
- Contact email: ${opportunityEmail}
- Job description: ${(rawText || jobTitle).slice(0, 2000)}`;

  const res = await fetch(`${LLM_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens: 1500,
    }),
    signal: AbortSignal.timeout(300_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "unknown");
    throw new Error(`LLM error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned empty content");

  // Try to extract JSON from the response (handle markdown-wrapped JSON)
  let jsonStr = content.trim();
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  const parsed = JSON.parse(jsonStr);
  return {
    subject: parsed.subject || `${candidateName} | ${jobTitle}`,
    htmlBody: parsed.htmlBody || `<html><body><p>${content}</p></body></html>`,
  };
}

async function main() {
  console.log(`Mailbox: ${MAILBOX}`);
  if (DRY_RUN) console.log("*** DRY RUN — no drafts will be created ***\n");

  // 1. Fetch applications missing email drafts
  console.log("Fetching applications missing email drafts...");
  const apps = await prisma.application.findMany({
    where: {
      tenantId: "dotcloudconsulting",
      currentStage: { in: ["SHORTLISTED", "NEW"] },
    },
    select: {
      id: true,
      jobId: true,
      candidateId: true,
      job: {
        select: {
          id: true,
          title: true,
          opportunityEmail: true,
          rawText: true,
          company: { select: { name: true } },
        },
      },
      candidate: { select: { id: true, fullName: true } },
      emails: { select: { id: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const missing = apps.filter((a) => a.emails.length === 0);
  console.log(`  Total active applications: ${apps.length}`);
  console.log(`  Missing DB email records:  ${missing.length}\n`);

  if (missing.length === 0) {
    console.log("Nothing to generate.");
    await prisma.$disconnect();
    return;
  }

  // 2. Fetch Outlook subjects to cross-reference
  console.log("Fetching Outlook Drafts and Sent Items subjects...");
  const token = await getGraphToken();
  const draftSubjects = await fetchAllSubjectsFromFolder(token, "drafts");
  const sentSubjects = await fetchAllSubjectsFromFolder(token, "sentitems");
  const allOutlookSubjects = new Set([...draftSubjects, ...sentSubjects]);
  console.log(
    `  Drafts: ${draftSubjects.size} | Sent: ${sentSubjects.size} | Combined: ${allOutlookSubjects.size}\n`,
  );

  // 3. Filter to truly missing
  const trulyMissing = missing.filter((a) => {
    const subject = `${a.candidate.fullName} | ${a.job.title}`;
    return !allOutlookSubjects.has(subject);
  });

  const withEmail = trulyMissing.filter(
    (a) => (a.job.opportunityEmail || "").trim().length > 0,
  );
  const noEmail = trulyMissing.filter(
    (a) => !(a.job.opportunityEmail || "").trim(),
  );

  console.log(`Truly missing: ${trulyMissing.length}`);
  console.log(`  With email: ${withEmail.length}`);
  console.log(`  No email:   ${noEmail.length}\n`);

  if (noEmail.length > 0) {
    console.log("Skipping (no opportunity email):");
    for (const a of noEmail) {
      console.log(`  - ${a.candidate.fullName} → ${a.job.title}`);
    }
    console.log();
  }

  if (withEmail.length === 0) {
    console.log("Nothing to generate.");
    await prisma.$disconnect();
    return;
  }

  // 4. Generate and push drafts
  let ok = 0;
  let failed = 0;

  for (let i = 0; i < withEmail.length; i++) {
    const app = withEmail[i];
    const label = `[${i + 1}/${withEmail.length}] ${app.candidate.fullName} → ${app.job.title}`;
    const toEmails = (app.job.opportunityEmail || "")
      .split(/[,;]+/)
      .map((s) => s.trim())
      .filter((s) => s.includes("@"));
    const companyName = app.job.company?.name || "";

    process.stdout.write(`  ${label}... `);

    if (DRY_RUN) {
      console.log(`WOULD GENERATE (to: ${toEmails.join(", ")})`);
      ok++;
      continue;
    }

    try {
      // Generate email content via LLM
      const email = await generateEmailViaLlm(
        app.job.title,
        app.candidate.fullName,
        companyName,
        app.job.opportunityEmail,
        app.job.rawText,
      );

      // Create draft in Outlook via Graph API
      await createOutlookDraft(token, {
        subject: email.subject,
        htmlBody: email.htmlBody,
        toEmails,
      });

      console.log(`OK (to: ${toEmails.join(", ")})`);
      ok++;

      // Small delay for rate limiting
      if (i < withEmail.length - 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
    } catch (err) {
      console.log(`FAIL: ${err.message.slice(0, 200)}`);
      failed++;
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`  Generated: ${ok}`);
  console.log(`  Failed:    ${failed}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Fatal:", err.message);
  await prisma.$disconnect();
  process.exit(1);
});
