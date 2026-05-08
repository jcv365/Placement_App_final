"use strict";
/**
 * resendCandidateEmails.cjs
 *
 * Resends the Role Confirmation and NDA/Teaming emails for a single candidate
 * by calling the Graph API directly (same logic as the app's fire-and-forget).
 *
 * Usage:
 *   node scripts/resendCandidateEmails.cjs --candidate-id <id>      # dry run
 *   node scripts/resendCandidateEmails.cjs --candidate-id <id> --apply
 */

const path = require("path");
const fs = require("fs");
const { resolveAppContainer } = require("./_agentUtils");

// ── Env loading ──────────────────────────────────────────────────────────────

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.resolve(__dirname, "../.env.local"));
loadEnvFile(path.resolve(__dirname, "../.env"));

// ── Config ───────────────────────────────────────────────────────────────────

const APPLY = process.argv.includes("--apply");
const cidIdx = process.argv.indexOf("--candidate-id");
const CANDIDATE_ID = cidIdx !== -1 ? process.argv[cidIdx + 1] : null;

if (!CANDIDATE_ID) {
  console.error(
    "Usage: node scripts/resendCandidateEmails.cjs --candidate-id <id> [--apply]",
  );
  process.exit(1);
}

const GRAPH_TENANT_ID = process.env.GRAPH_TENANT_ID?.trim();
const GRAPH_CLIENT_ID = process.env.GRAPH_CLIENT_ID?.trim();
const GRAPH_CLIENT_SECRET = process.env.GRAPH_CLIENT_SECRET?.trim();
const MAILBOX =
  process.env.OUTLOOK_SHARED_MAILBOX?.trim() ||
  process.env.GRAPH_SENDER_USER?.trim();
const SENDER_NAME =
  process.env.SENDER_DISPLAY_NAME?.trim() ||
  process.env.PLATFORM_PARTNER_NAME?.trim() ||
  "DotCloud Consulting";
const BRAND_NAME = process.env.PLATFORM_PARTNER_NAME?.trim() || SENDER_NAME;

const DATA_ROOT = process.env.DATA_MOUNT_ROOT ?? process.cwd();
const DOCS_DIR = path.join(DATA_ROOT, "data", "Documents");
const NDA_FILENAME = process.env.NDA_DOCUMENT_FILENAME?.trim() || "";
const TEAMING_FILENAME = process.env.TEAMING_DOCUMENT_FILENAME?.trim() || "";

const CONTAINER = resolveAppContainer();

// ── Graph helpers ────────────────────────────────────────────────────────────

async function getGraphToken() {
  const body = new URLSearchParams({
    client_id: GRAPH_CLIENT_ID,
    client_secret: GRAPH_CLIENT_SECRET,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${GRAPH_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
  );
  if (!res.ok)
    throw new Error(`Token error: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.access_token;
}

async function createDraft(token, { subject, htmlBody, to, attachments }) {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MAILBOX)}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        subject,
        body: { contentType: "HTML", content: htmlBody },
        toRecipients: to.map((a) => ({ emailAddress: { address: a } })),
        attachments: (attachments || []).map((att) => ({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: att.filename,
          contentType: att.contentType || "application/pdf",
          contentBytes: att.contentBase64,
        })),
      }),
    },
  );
  if (!res.ok)
    throw new Error(`Draft error: ${res.status} ${await res.text()}`);
  return res.json();
}

async function sendDraft(token, messageId) {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MAILBOX)}/messages/${messageId}/send`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Length": "0" },
    },
  );
  if (!res.ok) throw new Error(`Send error: ${res.status} ${await res.text()}`);
}

// ── Document loader ──────────────────────────────────────────────────────────

function loadDocAttachments() {
  return [NDA_FILENAME, TEAMING_FILENAME]
    .filter(Boolean)
    .map((filename) => {
      const filePath = path.join(DOCS_DIR, filename);
      if (!fs.existsSync(filePath)) {
        console.warn(`  ⚠ Document not found: ${filePath}`);
        return null;
      }
      return {
        filename,
        contentBase64: fs.readFileSync(filePath).toString("base64"),
        contentType: "application/pdf",
      };
    })
    .filter(Boolean);
}

// ── HTML builders ────────────────────────────────────────────────────────────

function esc(t) {
  return t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildRoleConfirmationHtml(name, roles) {
  const first = name.trim().split(/\s+/)[0] || name;
  const rolesHtml = roles
    .map((r) => `<li style="margin:4px 0;">${esc(r)}</li>`)
    .join("\n");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#222;line-height:1.6;max-width:640px;margin:0 auto;padding:20px;">
<p>Good day ${esc(first)},</p>
<p>Thank you for joining ${esc(BRAND_NAME)}'s active bench of specialist engineers. We are a professional services company that deploys our engineers directly to clients across Europe and the United Kingdom for contracting engagements, and we take direct accountability for the quality and fit of every engineer we represent.</p>
<p>In order for us to put you forward effectively, we would kindly ask that you take a moment to confirm the following:</p>
<p><strong>1. Roles you are comfortable being considered for</strong></p>
<p>Based on your profile and experience, we have identified the following roles as potential fits for you. Please could you review this list and let us know which ones you are happy for us to actively pursue on your behalf — and feel free to suggest any additional roles you feel we may have missed:</p>
<ul style="padding-left:20px;margin:12px 0;">${rolesHtml}</ul>
<p><strong>2. Your hourly rate</strong></p>
<p>Could you please confirm your expected hourly rate for contract engagements in Europe and the UK? Please note that all engagements we facilitate are fully remote. If your rate varies depending on the role or region, please do let us know — that level of detail is very helpful when we are negotiating on your behalf.</p>
<p><strong>3. Required documentation</strong></p>
<p>We have attached two documents that we require all contractors to complete before we can formally represent them:</p>
<ul style="padding-left:20px;margin:12px 0;">
<li style="margin:4px 0;"><strong>Non-Disclosure Agreement (NDA)</strong> — protects both parties' confidential information throughout our engagement.</li>
<li style="margin:4px 0;"><strong>Teaming Agreement</strong> — formalises your engagement with ${esc(BRAND_NAME)} as a professional services partner, setting out the terms under which we will deploy you to our clients as part of our engineering bench.</li>
</ul>
<p>Please print, sign, and scan (or photograph clearly) both documents, then reply to this email with the signed copies attached. Alternatively, if you have a digital signature tool, you are welcome to use that.</p>
<p>Please reply to this email at your earliest convenience with your confirmation and all signed documents. Should you wish to discuss anything further, or if your circumstances have changed since we last spoke, please do not hesitate to reach out — we are always happy to assist.</p>
<p>We look forward to hearing from you.</p>
<p>Kind regards,<br/><strong>${esc(SENDER_NAME)}</strong><br/><a href="mailto:${esc(MAILBOX)}">${esc(MAILBOX)}</a></p>
</body></html>`;
}

function buildNdaTeamingHtml(name) {
  const first = name.trim().split(/\s+/)[0] || name;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#222;line-height:1.6;max-width:640px;margin:0 auto;padding:20px;">
<p>Good day ${esc(first)},</p>
<p>Thank you for joining ${esc(BRAND_NAME)}'s specialist engineering bench. We are a professional services company that deploys vetted engineers to clients across Europe and the United Kingdom for contracting engagements, and we are pleased to have you as part of our team.</p>
<p>To formalise your engagement with us and enable us to present you to our clients as part of our engineering bench, we require you to review, sign, and return the following two documents:</p>
<ol style="padding-left:20px;margin:12px 0;">
<li style="margin:8px 0;"><strong>Non-Disclosure Agreement (NDA)</strong> — Protects both parties and ensures that any confidential information shared during the engagement process remains strictly private.</li>
<li style="margin:8px 0;"><strong>Teaming Agreement</strong> — Formalises your engagement with ${esc(BRAND_NAME)} as a professional services partner, setting out the terms under which we will deploy you to our clients as part of our engineering bench.</li>
</ol>
<p>Please print, sign, and scan each document, then <strong>reply to this email</strong> with the signed copies attached. Alternatively, you are welcome to use a digital signature tool such as DocuSign or Adobe Sign.</p>
<p>Should you have any questions about the contents of either document, please do not hesitate to reach out — we are happy to clarify anything before you sign.</p>
<p>We look forward to receiving your completed documents.</p>
<p>Kind regards,<br/><strong>${esc(SENDER_NAME)}</strong><br/><a href="mailto:${esc(MAILBOX)}">${esc(MAILBOX)}</a></p>
</body></html>`;
}

// ── DB lookup via docker exec ────────────────────────────────────────────────

const { execSync } = require("child_process");

function getCandidate(id) {
  const script = `const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.candidate.findFirst({where:{id:'${id}'},select:{id:true,fullName:true,email:true,suggestedRolesCsv:true}}).then(c=>{console.log(JSON.stringify(c));return p.$disconnect()});`;
  const raw = execSync(
    `docker exec ${CONTAINER} node -e "${script.replace(/"/g, '\\"')}"`,
    { encoding: "utf8", timeout: 15000 },
  ).trim();
  return JSON.parse(raw);
}

// ── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  if (
    !GRAPH_TENANT_ID ||
    !GRAPH_CLIENT_ID ||
    !GRAPH_CLIENT_SECRET ||
    !MAILBOX
  ) {
    console.error("Graph credentials not configured.");
    process.exit(1);
  }

  console.log(`Mailbox: ${MAILBOX}`);
  console.log(`Brand: ${BRAND_NAME}`);
  console.log(`Docs dir: ${DOCS_DIR}`);

  const candidate = getCandidate(CANDIDATE_ID);
  if (!candidate) {
    console.error("Candidate not found:", CANDIDATE_ID);
    process.exit(1);
  }

  console.log(`\nCandidate: ${candidate.fullName} <${candidate.email}>`);
  const roles = (candidate.suggestedRolesCsv || "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  console.log(`Roles: ${roles.join(", ")}`);

  const attachments = loadDocAttachments();
  console.log(`Attachments: ${attachments.length} document(s) loaded`);
  attachments.forEach((a) => console.log(`  ✓ ${a.filename}`));

  if (!APPLY) {
    console.log("\n[DRY RUN] Add --apply to create and send drafts.");
    return;
  }

  const token = await getGraphToken();
  console.log("Graph token acquired.");

  // 1) Role Confirmation
  if (roles.length > 0) {
    const htmlBody = buildRoleConfirmationHtml(candidate.fullName, roles);
    const subject =
      "Contracting Opportunities in Europe & UK — Role Confirmation and Rate";
    console.log("\n--- Role Confirmation ---");
    const draft = await createDraft(token, {
      subject,
      htmlBody,
      to: [candidate.email],
      attachments,
    });
    console.log("Draft created:", draft.id);
    await sendDraft(token, draft.id);
    console.log("✓ Role Confirmation email SENT to", candidate.email);
  }

  // 2) NDA & Teaming
  {
    const htmlBody = buildNdaTeamingHtml(candidate.fullName);
    const subject = `${BRAND_NAME} — NDA & Teaming Agreement: Action Required`;
    console.log("\n--- NDA & Teaming Agreement ---");
    const draft = await createDraft(token, {
      subject,
      htmlBody,
      to: [candidate.email],
      attachments,
    });
    console.log("Draft created:", draft.id);
    await sendDraft(token, draft.id);
    console.log("✓ NDA & Teaming email SENT to", candidate.email);
  }

  console.log("\nDone.");
})();
