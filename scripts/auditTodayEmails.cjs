"use strict";
/**
 * auditTodayEmails.cjs
 * Audits all EmailDraft records created today.
 * Checks for:
 *  1. Hallucinations — candidate proposed for a role they don't fit (low ATS score),
 *     or email body claims skills/certs not present in the candidate profile.
 *  2. Prompt non-compliance — missing mandatory section headers, wrong subject pattern,
 *     banned openers, missing candidate name, American spellings, etc.
 */

const { PrismaClient } = require("@prisma/client");

const p = new PrismaClient({ log: [] });

// ─── Constants ──────────────────────────────────────────────────────────────

const TODAY_START = new Date("2026-04-20T00:00:00.000Z");
const TODAY_END = new Date("2026-04-20T23:59:59.999Z");

const MANDATORY_SECTION_HEADERS = [
  "Proposed delivery resource",
  "Why this matters",
  "Relevant capability",
  "Operating model",
  "A transparent note",
  "Next step",
];

const BANNED_OPENERS = [
  "i hope you're well",
  "i hope you are well",
  "i wanted to reach out",
  "please find attached",
  "i'd like to introduce",
  "further to our conversation",
  "hi there",
  "to whom it may concern",
];

const AMERICAN_SPELLINGS = [
  ["organization", "organisation"],
  ["organization", "organisation"],
  ["prioritize", "prioritise"],
  ["color", "colour"],
  ["modeling", "modelling"],
  ["meter", "metre"],
  ["skeptical", "sceptical"],
  ["program", "programme"],
  ["favor", "favour"],
  ["labor", "labour"],
  ["analyze", "analyse"],
  ["recognize", "recognise"],
  ["realize", "realise"],
  ["formalize", "formalise"],
];

const ATS_CONCERN_THRESHOLD = 70; // below this → possible hallucination/mismatch

// ─── Helpers ────────────────────────────────────────────────────────────────

function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function checkMandatorySections(html) {
  const missing = [];
  for (const header of MANDATORY_SECTION_HEADERS) {
    // Must appear wrapped in <strong>
    const re = new RegExp(`<strong>\\s*${escapeRegex(header)}`, "i");
    if (!re.test(html)) missing.push(header);
  }
  return missing;
}

function checkSubjectPattern(subject) {
  // Pattern: "[Domain/Role] Services Support – [Sender] ([Candidate])"
  const hasServicesSupport = /services support/i.test(subject);
  const hasParentheses = /\(.+\)/.test(subject);
  const hasDash = /[–—-]/.test(subject);
  const issues = [];
  if (!hasServicesSupport) issues.push('Missing "Services Support" in subject');
  if (!hasDash) issues.push("Missing dash separator in subject");
  if (!hasParentheses)
    issues.push("Missing parenthetical candidate name in subject");
  return issues;
}

function checkBannedOpeners(html) {
  const plain = stripHtml(html);
  // Check first 300 chars of plain text (the greeting/opener area)
  const opening = plain.substring(0, 300);
  const found = [];
  for (const opener of BANNED_OPENERS) {
    if (opening.includes(opener)) found.push(opener);
  }
  return found;
}

function checkAmericanSpellings(html) {
  const plain = stripHtml(html);
  const found = [];
  for (const [american] of AMERICAN_SPELLINGS) {
    const re = new RegExp(`\\b${american}\\b`, "i");
    if (re.test(plain)) found.push(american);
  }
  return found;
}

function checkCandidateNameInBody(html, fullName) {
  if (!fullName) return false;
  // The full name or at least first+last should appear
  const plain = html.toLowerCase();
  const name = fullName.toLowerCase();
  return plain.includes(name);
}

function parseCsvField(csv) {
  if (!csv) return [];
  return csv
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Checks if the email claims skills/certs not present in the candidate profile.
 * We look for explicit "certification" mentions (e.g. AWS, Azure, CISSP, PMP, etc.)
 * and flag if found in email but not in candidate certs.
 */
function checkInventedCertifications(
  htmlBody,
  candidateCerts,
  candidateSkills,
) {
  const allProfileTerms = new Set([...candidateCerts, ...candidateSkills]);
  const plain = stripHtml(htmlBody);

  // Common cert patterns to detect
  const certPatterns = [
    /\b(aws|azure|gcp|google cloud|cissp|cism|cisa|pmp|prince2|itil|togaf|cka|ckad|rhce|mcse|mcsa|ccna|ccnp|ccie|az-\d{3}|sc-\d{3}|ms-\d{3}|dp-\d{3}|ai-\d{3}|pl-\d{3}|architect associate|solutions architect|developer associate|sysops|devops professional|data engineer|security specialty)\b/gi,
  ];

  const claimedCerts = new Set();
  for (const pattern of certPatterns) {
    const matches = plain.matchAll(pattern);
    for (const m of matches) {
      claimedCerts.add(m[1].toLowerCase());
    }
  }

  const notInProfile = [];
  for (const cert of claimedCerts) {
    const inProfile =
      [...allProfileTerms].some((t) => t.includes(cert) || cert.includes(t)) ||
      candidateCerts.some((c) => c.includes(cert) || cert.includes(c));
    if (!inProfile) {
      notInProfile.push(cert);
    }
  }

  return notInProfile;
}

/**
 * Role fit check: does the candidate's suggested/preferred roles overlap with the job title?
 * Also uses ATS score from JobCandidateMatch.
 */
function assessRoleFit(job, candidate, matchRecord) {
  const issues = [];

  // ATS score check
  if (matchRecord) {
    if (matchRecord.aiScore < ATS_CONCERN_THRESHOLD) {
      issues.push(
        `Low ATS match score: ${matchRecord.aiScore}/100 (threshold ${ATS_CONCERN_THRESHOLD})`,
      );
    }
  } else {
    issues.push("No ATS match record found — fit not verified");
  }

  // Role overlap check
  const jobTitleLower = (job.title || "").toLowerCase();
  const suggestedRoles = parseCsvField(candidate.suggestedRolesCsv);
  const preferredRoles = parseCsvField(candidate.preferredRolesCsv);
  const candidateSkills = parseCsvField(candidate.skillsCsv);

  const allCandidateTerms = [
    ...suggestedRoles,
    ...preferredRoles,
    ...candidateSkills,
  ];

  // Extract keywords from job title
  const jobKeywords = jobTitleLower
    .split(/[\s,\/\-]+/)
    .filter((w) => w.length > 3)
    .filter((w) => !["and", "the", "for", "with"].includes(w));

  const hasRoleOverlap = jobKeywords.some((kw) =>
    allCandidateTerms.some((term) => term.includes(kw) || kw.includes(term)),
  );

  if (!hasRoleOverlap && allCandidateTerms.length > 0) {
    issues.push(
      `No keyword overlap between job title ("${job.title}") and candidate profile terms (${allCandidateTerms.slice(0, 8).join(", ")}${allCandidateTerms.length > 8 ? "..." : ""})`,
    );
  }

  return issues;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log(" Email Hallucination & Prompt Compliance Audit");
  console.log(` Date: ${TODAY_START.toISOString().slice(0, 10)}`);
  console.log("═══════════════════════════════════════════════════════════\n");

  // Fetch all email drafts created today with related data
  const drafts = await p.emailDraft.findMany({
    where: {
      tenantId: "dotcloudconsulting",
      createdAt: { gte: TODAY_START, lte: TODAY_END },
    },
    include: {
      application: {
        include: {
          job: true,
          candidate: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Found ${drafts.length} email draft(s) created today.\n`);

  if (drafts.length === 0) {
    console.log("No emails to audit.");
    await p.$disconnect();
    return;
  }

  // Fetch ATS match records for all job/candidate pairs in one query
  const jobCandidatePairs = drafts.map((d) => ({
    jobId: d.application.jobId,
    candidateId: d.application.candidateId,
  }));

  const matchRecords = await p.jobCandidateMatch.findMany({
    where: {
      tenantId: "dotcloudconsulting",
      OR: jobCandidatePairs,
    },
  });

  const matchMap = new Map();
  for (const m of matchRecords) {
    matchMap.set(`${m.jobId}::${m.candidateId}`, m);
  }

  // ─── Audit each draft ────────────────────────────────────────────────────

  const results = [];

  for (const draft of drafts) {
    const { application } = draft;
    const { job, candidate } = application;
    const matchRecord = matchMap.get(`${job.id}::${candidate.id}`) || null;

    const audit = {
      draftId: draft.id,
      createdAt: draft.createdAt.toISOString(),
      candidateName: candidate.fullName,
      jobTitle: job.title,
      subject: draft.subject,
      atsScore: matchRecord?.aiScore ?? null,
      atsRationale: matchRecord?.rationale ?? null,
      hallucinations: [],
      promptIssues: [],
    };

    // ── 1. Role fit / hallucination checks ──────────────────────────────
    const roleFitIssues = assessRoleFit(job, candidate, matchRecord);
    audit.hallucinations.push(...roleFitIssues);

    // Invented certifications
    const candidateCerts = parseCsvField(candidate.certificationsCsv);
    const candidateSkills = parseCsvField(candidate.skillsCsv);
    const inventedCerts = checkInventedCertifications(
      draft.htmlBody,
      candidateCerts,
      candidateSkills,
    );
    if (inventedCerts.length > 0) {
      audit.hallucinations.push(
        `Potentially invented cert/tech in email not found in profile: ${inventedCerts.join(", ")}`,
      );
    }

    // Candidate name check
    const nameInBody = checkCandidateNameInBody(
      draft.htmlBody,
      candidate.fullName,
    );
    if (!nameInBody) {
      audit.hallucinations.push(
        `Candidate full name "${candidate.fullName}" NOT found in email body`,
      );
    }

    // ── 2. Prompt compliance checks ──────────────────────────────────────
    const missingSections = checkMandatorySections(draft.htmlBody);
    if (missingSections.length > 0) {
      audit.promptIssues.push(
        `Missing mandatory section headers: ${missingSections.join(", ")}`,
      );
    }

    const subjectIssues = checkSubjectPattern(draft.subject);
    audit.promptIssues.push(...subjectIssues);

    const bannedOpeners = checkBannedOpeners(draft.htmlBody);
    if (bannedOpeners.length > 0) {
      audit.promptIssues.push(
        `Banned opener(s) detected: "${bannedOpeners.join('", "')}"`,
      );
    }

    const americanSpellings = checkAmericanSpellings(draft.htmlBody);
    if (americanSpellings.length > 0) {
      audit.promptIssues.push(
        `American spelling(s): ${americanSpellings.join(", ")}`,
      );
    }

    results.push(audit);
  }

  // ─── Summary ─────────────────────────────────────────────────────────────

  let totalHallucinations = 0;
  let totalPromptIssues = 0;
  let cleanCount = 0;

  console.log(
    "─── Per-Email Results ──────────────────────────────────────────\n",
  );

  for (const r of results) {
    const hasHallucinations = r.hallucinations.length > 0;
    const hasPromptIssues = r.promptIssues.length > 0;
    const isClean = !hasHallucinations && !hasPromptIssues;

    if (isClean) cleanCount++;
    if (hasHallucinations) totalHallucinations++;
    if (hasPromptIssues) totalPromptIssues++;

    const flag = isClean
      ? "✅"
      : hasHallucinations && hasPromptIssues
        ? "🔴"
        : hasHallucinations
          ? "🟠"
          : "🟡";
    console.log(
      `${flag} [${r.createdAt.slice(11, 19)}] ${r.candidateName} → "${r.jobTitle}"`,
    );
    console.log(`   Subject : ${r.subject}`);
    console.log(
      `   ATS     : ${r.atsScore !== null ? `${r.atsScore}/100` : "no record"}`,
    );

    if (r.atsRationale) {
      // Print first 200 chars of rationale
      const short = r.atsRationale.slice(0, 200).replace(/\n/g, " ");
      console.log(
        `   Rationale: ${short}${r.atsRationale.length > 200 ? "..." : ""}`,
      );
    }

    if (r.hallucinations.length > 0) {
      console.log("   🚨 HALLUCINATION / FIT ISSUES:");
      for (const h of r.hallucinations) {
        console.log(`      • ${h}`);
      }
    }

    if (r.promptIssues.length > 0) {
      console.log("   ⚠️  PROMPT COMPLIANCE ISSUES:");
      for (const i of r.promptIssues) {
        console.log(`      • ${i}`);
      }
    }

    console.log();
  }

  console.log(
    "─── Summary ────────────────────────────────────────────────────\n",
  );
  console.log(`Total emails today        : ${results.length}`);
  console.log(`✅ Fully clean            : ${cleanCount}`);
  console.log(
    `🟠 Hallucination issues   : ${totalHallucinations} email(s) affected`,
  );
  console.log(
    `🟡 Prompt non-compliance  : ${totalPromptIssues} email(s) affected`,
  );
  console.log();

  // Severity breakdown
  const hallucinationTypes = {};
  const promptIssueTypes = {};

  for (const r of results) {
    for (const h of r.hallucinations) {
      const key = h.startsWith("Low ATS")
        ? "Low ATS score"
        : h.startsWith("No ATS")
          ? "No ATS record"
          : h.startsWith("No keyword overlap")
            ? "Role keyword mismatch"
            : h.startsWith("Potentially invented")
              ? "Invented cert/tech"
              : h.startsWith("Candidate full name")
                ? "Missing candidate name"
                : "Other";
      hallucinationTypes[key] = (hallucinationTypes[key] || 0) + 1;
    }
    for (const i of r.promptIssues) {
      const key = i.startsWith("Missing mandatory")
        ? "Missing section headers"
        : i.startsWith('Missing "Services Support"')
          ? "Bad subject pattern"
          : i.startsWith("Banned opener")
            ? "Banned opener"
            : i.startsWith("American spelling")
              ? "American spellings"
              : "Other";
      promptIssueTypes[key] = (promptIssueTypes[key] || 0) + 1;
    }
  }

  if (Object.keys(hallucinationTypes).length > 0) {
    console.log("Hallucination breakdown:");
    for (const [k, v] of Object.entries(hallucinationTypes)) {
      console.log(`  ${k}: ${v}`);
    }
    console.log();
  }

  if (Object.keys(promptIssueTypes).length > 0) {
    console.log("Prompt compliance breakdown:");
    for (const [k, v] of Object.entries(promptIssueTypes)) {
      console.log(`  ${k}: ${v}`);
    }
    console.log();
  }

  await p.$disconnect();
}

main().catch((err) => {
  console.error(err);
  p.$disconnect();
  process.exit(1);
});
