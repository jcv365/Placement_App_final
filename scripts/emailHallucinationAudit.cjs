"use strict";
/**
 * emailHallucinationAudit.cjs
 *
 * Audits every EMAIL_DRAFTED application in the database for hallucinated or
 * invented claims in the generated email body. Uses the same factuality-check
 * prompt that the generate API applies at creation time.
 *
 * This script is the safety net: it can be run any time to sweep already-
 * generated drafts and flag (or delete) ones that contain claims not supported
 * by the candidate CV or the job description.
 *
 * Usage (run inside Docker container):
 *   docker cp scripts/emailHallucinationAudit.cjs <container>:/app/emailHallucinationAudit.cjs
 *   docker exec -w /app <container> node /app/emailHallucinationAudit.cjs
 *   docker exec -w /app <container> node /app/emailHallucinationAudit.cjs --delete-flagged
 *   docker exec -w /app <container> node /app/emailHallucinationAudit.cjs --tenant-id nildata
 *
 * Flags:
 *   --delete-flagged   Delete EmailDraft records that fail the audit and revert
 *                      the application stage from EMAIL_DRAFTED back to SHORTLISTED.
 *   --tenant-id <id>   Scope to a single tenant (default: all tenants).
 *   --threshold <n>    Factuality score below which a draft is flagged (default: 80).
 */

const { PrismaClient } = require("@prisma/client");

// ── CLI flags ────────────────────────────────────────────────────────────────

const DELETE_FLAGGED = process.argv.includes("--delete-flagged");

const tenantIdx = process.argv.indexOf("--tenant-id");
const TENANT_FILTER =
  tenantIdx !== -1 && process.argv[tenantIdx + 1]
    ? process.argv[tenantIdx + 1].trim()
    : null;

const thresholdIdx = process.argv.indexOf("--threshold");
const FACTUALITY_THRESHOLD =
  thresholdIdx !== -1 && process.argv[thresholdIdx + 1]
    ? Number(process.argv[thresholdIdx + 1])
    : 80;

// ── AI gateway ───────────────────────────────────────────────────────────────

const AI_BASE = (
  process.env.LLMLITE_API_BASE ??
  process.env.OPENAI_API_BASE ??
  ""
).replace(/\/$/, "");

const AI_KEY = process.env.LLMLITE_API_KEY ?? process.env.OPENAI_API_KEY ?? "";

const AI_MODEL =
  process.env.LLMLITE_MODEL ??
  process.env.OPENAI_MODEL ??
  process.env.AZURE_OPENAI_DEPLOYMENT ??
  "auto";

if (!AI_BASE || !AI_KEY) {
  console.error(
    "[AUDIT] ERROR: LLMLITE_API_BASE and LLMLITE_API_KEY must be set in the environment.",
  );
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function htmlToPlainText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text, maxChars = 4000) {
  if (!text) return "";
  return text.length <= maxChars
    ? text
    : text.slice(0, maxChars) + "\n…[truncated]";
}

function extractJson(raw) {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1)
    throw new Error("No JSON object found in AI response");
  return JSON.parse(trimmed.slice(start, end + 1));
}

async function callAi(systemPrompt, userPrompt) {
  const res = await fetch(`${AI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_KEY}`,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0,
      max_tokens: 1000,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AI call failed: ${res.status} ${body.slice(0, 200)}`);
  }

  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content ?? "";
  return extractJson(content);
}

async function checkFactuality({
  emailHtml,
  jdText,
  cvText,
  roleTitle,
  candidateName,
  companyName,
}) {
  const emailText = htmlToPlainText(emailHtml);

  const systemPrompt = `You are a strict factual accuracy auditor for candidate-submission emails.
Your only job is to verify whether each specific factual claim in the email is directly supported by the supplied source documents (JD and CV).

DEFINITION OF A SPECIFIC FACTUAL CLAIM:
- Quantified statements: years of experience ("12 years"), team sizes ("led a team of 8"), uptime/scale figures.
- Named technologies, platforms, or products attributed to the candidate ("skilled in SAP S/4HANA", "AWS certified").
- Named certifications or qualifications the email attributes to the candidate.
- Named companies or clients where the candidate is said to have worked.
- Specific project names or outcomes attributed to the candidate.
- Any superlative or distinctive claim ("the only candidate who...", "uniquely qualified...").

DO NOT flag:
- General role-relevant language ("strong architecture background").
- Paraphrases that clearly reflect CV content even if not word-for-word.
- The candidate's name, the company name, or the role title.

Return strict JSON: { "score": 0-100, "hallucinatedClaims": [], "verifiedClaims": [], "guidance": "" }
- score: 100 if all specific claims are verified; lower proportionally for each unverified claim.
- hallucinatedClaims: list each unsupported specific claim verbatim.
- verifiedClaims: list each verified specific claim verbatim.
- guidance: if score < ${FACTUALITY_THRESHOLD}, write 1-3 actionable sentences telling the email generator exactly which claims to remove or replace with source-verified content. Empty string if score >= ${FACTUALITY_THRESHOLD}.`;

  const userPrompt =
    `CANDIDATE: ${candidateName}\n` +
    `ROLE: ${roleTitle}\n` +
    `COMPANY: ${companyName ?? ""}\n\n` +
    `SOURCE — JOB DESCRIPTION:\n${truncate(jdText)}\n\n` +
    `SOURCE — CANDIDATE CV:\n${truncate(cvText)}\n\n` +
    `EMAIL DRAFT TO AUDIT:\n${truncate(emailText, 2500)}\n\n` +
    `Audit every specific factual claim in the email draft against the two source documents above. Return JSON only.`;

  const raw = await callAi(systemPrompt, userPrompt);

  const score =
    typeof raw.score === "number" ? Math.max(0, Math.min(100, raw.score)) : 100;
  const hallucinatedClaims = Array.isArray(raw.hallucinatedClaims)
    ? raw.hallucinatedClaims.filter((c) => typeof c === "string" && c.trim())
    : [];
  const verifiedClaims = Array.isArray(raw.verifiedClaims)
    ? raw.verifiedClaims.filter((c) => typeof c === "string" && c.trim())
    : [];
  const guidance = typeof raw.guidance === "string" ? raw.guidance.trim() : "";

  const pass = score >= FACTUALITY_THRESHOLD && hallucinatedClaims.length === 0;
  return { pass, score, hallucinatedClaims, verifiedClaims, guidance };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const p = new PrismaClient();

  console.log("=".repeat(70));
  console.log("EMAIL HALLUCINATION AUDIT");
  console.log(`  Date     : ${new Date().toISOString()}`);
  console.log(`  Tenant   : ${TENANT_FILTER ?? "ALL"}`);
  console.log(`  Threshold: ${FACTUALITY_THRESHOLD}`);
  console.log(
    `  Deleting : ${DELETE_FLAGGED ? "YES — flagged drafts will be removed" : "no (dry run)"}`,
  );
  console.log("=".repeat(70));

  // Fetch all EMAIL_DRAFTED applications that have at least one EmailDraft.
  const where = {
    currentStage: "EMAIL_DRAFTED",
    emails: { some: {} },
    ...(TENANT_FILTER ? { tenantId: TENANT_FILTER } : {}),
  };

  const applications = await p.application.findMany({
    where,
    select: {
      id: true,
      tenantId: true,
      currentStage: true,
      candidate: {
        select: {
          id: true,
          fullName: true,
          rawCV: true,
        },
      },
      job: {
        select: {
          id: true,
          title: true,
          rawText: true,
          company: { select: { name: true } },
        },
      },
      emails: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          subject: true,
          htmlBody: true,
          createdAt: true,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  console.log(
    `\nFound ${applications.length} EMAIL_DRAFTED applications to audit.\n`,
  );

  const results = { pass: [], fail: [], error: [] };

  for (let i = 0; i < applications.length; i++) {
    const app = applications[i];
    const draft = app.emails[0];
    const candidateName = app.candidate?.fullName ?? "Unknown";
    const roleTitle = app.job?.title ?? "Unknown";
    const companyName = app.job?.company?.name ?? "";

    process.stdout.write(
      `[${String(i + 1).padStart(3, " ")}/${applications.length}] ` +
        `${candidateName.padEnd(30)} → ${roleTitle.slice(0, 30).padEnd(30)} ... `,
    );

    if (!draft) {
      process.stdout.write("SKIP (no draft)\n");
      continue;
    }

    if (!app.candidate?.rawCV?.trim()) {
      process.stdout.write("SKIP (no CV)\n");
      results.error.push({
        applicationId: app.id,
        candidateName,
        roleTitle,
        reason: "No CV text",
      });
      continue;
    }

    if (!app.job?.rawText?.trim()) {
      process.stdout.write("SKIP (no JD)\n");
      results.error.push({
        applicationId: app.id,
        candidateName,
        roleTitle,
        reason: "No JD text",
      });
      continue;
    }

    try {
      const report = await checkFactuality({
        emailHtml: draft.htmlBody,
        jdText: app.job.rawText,
        cvText: app.candidate.rawCV,
        roleTitle,
        candidateName,
        companyName,
      });

      if (report.pass) {
        process.stdout.write(`PASS  (score: ${report.score})\n`);
        results.pass.push({
          applicationId: app.id,
          candidateName,
          roleTitle,
          score: report.score,
        });
      } else {
        process.stdout.write(
          `FAIL  (score: ${report.score}, ${report.hallucinatedClaims.length} hallucination(s))\n`,
        );
        for (const claim of report.hallucinatedClaims) {
          console.log(`       ✗ ${claim}`);
        }
        if (report.guidance) {
          console.log(`       → ${report.guidance}`);
        }
        results.fail.push({
          applicationId: app.id,
          draftId: draft.id,
          tenantId: app.tenantId,
          candidateName,
          roleTitle,
          score: report.score,
          hallucinatedClaims: report.hallucinatedClaims,
          guidance: report.guidance,
        });
      }
    } catch (err) {
      process.stdout.write(`ERROR (${err.message.slice(0, 60)})\n`);
      results.error.push({
        applicationId: app.id,
        candidateName,
        roleTitle,
        reason: err.message,
      });
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────

  console.log("\n" + "=".repeat(70));
  console.log("SUMMARY");
  console.log(`  Total audited : ${applications.length}`);
  console.log(`  PASS          : ${results.pass.length}`);
  console.log(`  FAIL          : ${results.fail.length}`);
  console.log(`  Error/skipped : ${results.error.length}`);
  console.log("=".repeat(70));

  if (results.fail.length > 0) {
    console.log("\nFAILED DRAFTS:");
    for (const f of results.fail) {
      console.log(`\n  Application : ${f.applicationId}`);
      console.log(`  Candidate   : ${f.candidateName}`);
      console.log(`  Role        : ${f.roleTitle}`);
      console.log(`  Score       : ${f.score}`);
      console.log(`  Hallucinated:`);
      for (const claim of f.hallucinatedClaims) {
        console.log(`    - ${claim}`);
      }
    }
  }

  // ── Delete flagged drafts ─────────────────────────────────────────────────

  if (DELETE_FLAGGED && results.fail.length > 0) {
    console.log(`\n${"=".repeat(70)}`);
    console.log(
      `DELETING ${results.fail.length} flagged draft(s) and reverting stage to SHORTLISTED...`,
    );

    let deleted = 0;
    let reverted = 0;

    for (const f of results.fail) {
      try {
        // Delete the email draft.
        await p.emailDraft.delete({ where: { id: f.draftId } });
        deleted++;

        // Revert application stage to SHORTLISTED and record the history event.
        await p.application.update({
          where: { id: f.applicationId },
          data: {
            currentStage: "SHORTLISTED",
            history: {
              create: {
                tenantId: f.tenantId,
                fromStage: "EMAIL_DRAFTED",
                toStage: "SHORTLISTED",
                changedBy: "emailHallucinationAudit",
              },
            },
          },
        });
        reverted++;

        console.log(
          `  ✓ Deleted draft + reverted: ${f.candidateName} → ${f.roleTitle}`,
        );
      } catch (err) {
        console.error(`  ✗ Failed for ${f.applicationId}: ${err.message}`);
      }
    }

    console.log(`\nDone. Deleted: ${deleted}, Reverted: ${reverted}`);
  } else if (!DELETE_FLAGGED && results.fail.length > 0) {
    console.log(
      `\nRe-run with --delete-flagged to remove the ${results.fail.length} flagged draft(s) and revert those applications to SHORTLISTED.`,
    );
  }

  await p.$disconnect();
}

main().catch((err) => {
  console.error("[AUDIT] Fatal error:", err);
  process.exit(1);
});
