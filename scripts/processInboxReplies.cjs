"use strict";
/**
 * processInboxReplies.cjs
 *
 * Inbox reply agent: reads received emails in the shared Outlook mailbox,
 * matches senders to candidates in the database, parses their responses
 * (confirmed roles + hourly rate), and updates the candidate record.
 *
 * Handles two email reply categories:
 *   1. Role confirmation replies — responses to the role confirmation email sent 13 Apr 2026
 *   2. Opportunity replies — replies to any outbound opportunity/application email
 *
 * Usage:
 *   node scripts/processInboxReplies.cjs                          # dry run (today)
 *   node scripts/processInboxReplies.cjs --apply                  # write updates + mark as read
 *   node scripts/processInboxReplies.cjs --since 2026-04-13       # custom date (default: today)
 *   node scripts/processInboxReplies.cjs --apply --filter "riaan" # single sender
 *
 * Required env (in .env.local or shell):
 *   GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET
 *   APP_SESSION_SECRET
 *   Optionally: OUTLOOK_SHARED_MAILBOX, API_BASE
 */

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { execSync } = require("child_process");
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

// ── CLI flags ────────────────────────────────────────────────────────────────

const APPLY = process.argv.includes("--apply");

const sinceIdx = process.argv.indexOf("--since");
const SINCE_DATE =
  sinceIdx !== -1 && process.argv[sinceIdx + 1]
    ? process.argv[sinceIdx + 1].trim()
    : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10); // default: last 7 days

const filterIdx = process.argv.indexOf("--filter");
const SENDER_FILTER =
  filterIdx !== -1 && process.argv[filterIdx + 1]
    ? process.argv[filterIdx + 1].trim().toLowerCase()
    : null;

const CONTAINER = resolveAppContainer();
const API_BASE = process.env.API_BASE ?? "http://127.0.0.1:3001";
const SESSION_SECRET =
  process.env.APP_SESSION_SECRET ?? "local-app-session-secret";
const TENANT_ID = process.env.TARGET_TENANT_ID ?? "dotcloudconsulting";

// ── Session minting ──────────────────────────────────────────────────────────

function signValue(value) {
  return crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(value)
    .digest("base64url");
}

function mintSession(userId, tenantId) {
  const payload = {
    uid: userId,
    tid: tenantId,
    role: "ADMIN",
    exp: Date.now() + 3600 * 1000,
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = signValue(b64);
  return `${b64}.${sig}`;
}

// ── Docker exec helper (script-file pattern) ─────────────────────────────────
// Avoids inline `node -e "..."` quoting issues and cmd.exe spawn overhead.
// Writes the script to a local temp file, docker-cp's it in, runs it with
// `-w /app` so node_modules resolve correctly, then cleans up both sides.

function dockerExecScript(scriptContent, timeoutMs = 30000) {
  const stamp = Date.now();
  const localTmp = path.join(__dirname, `../temp/_dexec_${stamp}.js`);
  const containerPath = `/app/_inbox_agent_${stamp}.js`;
  fs.mkdirSync(path.dirname(localTmp), { recursive: true });
  fs.writeFileSync(localTmp, scriptContent, "utf8");
  try {
    execSync(`docker cp "${localTmp}" ${CONTAINER}:${containerPath}`, {
      encoding: "utf8",
      timeout: 10000,
    });
    return execSync(`docker exec -w /app ${CONTAINER} node ${containerPath}`, {
      encoding: "utf8",
      timeout: timeoutMs,
    }).trim();
  } finally {
    try {
      fs.unlinkSync(localTmp);
    } catch (_) {}
    try {
      execSync(`docker exec ${CONTAINER} rm -f ${containerPath}`, {
        encoding: "utf8",
        timeout: 5000,
      });
    } catch (_) {}
  }
}

// ── Admin user lookup via docker exec ────────────────────────────────────────

function getAdminUserViaDocker() {
  const script = [
    '"use strict";',
    "const { PrismaClient } = require('@prisma/client');",
    "const p = new PrismaClient();",
    `p.tenantUser.findFirst({ where: { tenantId: ${JSON.stringify(TENANT_ID)}, role: 'ADMIN', isActive: true }, select: { id: true, email: true } })`,
    "  .then(u => { console.log(JSON.stringify(u)); process.exit(0); })",
    "  .catch(e => { console.error(e.message); process.exit(1); });",
  ].join("\n");
  return JSON.parse(dockerExecScript(script));
}

// ── Update candidate via docker exec ────────────────────────────────────────

function updateCandidateViaDocker(candidateId, updates) {
  const keys = Object.keys(updates);
  const values = Object.values(updates);
  const setClauses = keys.map((col, i) => `"${col}" = $${i + 1}`).join(", ");
  const idParamIdx = keys.length + 1;
  const sql = `UPDATE "Candidate" SET ${setClauses} WHERE "id" = $${idParamIdx}`;
  const allValues = [...values, candidateId];

  const script = [
    '"use strict";',
    "const { PrismaClient } = require('@prisma/client');",
    "const p = new PrismaClient();",
    `const sql = ${JSON.stringify(sql)};`,
    `const args = ${JSON.stringify(allValues)};`,
    "p.$executeRawUnsafe(sql, ...args)",
    "  .then(() => { console.log('updated'); process.exit(0); })",
    "  .catch(e => { console.error('ERROR:' + e.message); process.exit(1); });",
  ].join("\n");

  const result = dockerExecScript(script);
  if (result.includes("ERROR:")) {
    throw new Error(result.replace("ERROR:", "").trim());
  }
}

// ── Fetch all candidates via app API ─────────────────────────────────────────

async function fetchAllCandidates(cookieHeader) {
  const PAGE_SIZE = 200;
  let page = 1;
  const all = [];

  while (true) {
    const url = `${API_BASE}/api/candidates?slim=true&page=${page}&pageSize=${PAGE_SIZE}`;
    const res = await fetch(url, { headers: { Cookie: cookieHeader } });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `GET /api/candidates failed: ${res.status} ${body.slice(0, 200)}`,
      );
    }
    const envelope = await res.json();
    const payload = envelope?.data ?? envelope;
    if (Array.isArray(payload)) {
      all.push(...payload);
      break;
    }
    const items = Array.isArray(payload?.items) ? payload.items : [];
    all.push(...items);
    const total =
      typeof payload?.total === "number" ? payload.total : items.length;
    if (all.length >= total) break;
    page++;
  }
  return all;
}

// ── Graph helpers ────────────────────────────────────────────────────────────

function getSharedMailbox() {
  return (
    process.env.OUTLOOK_SHARED_MAILBOX?.trim() ||
    process.env.GRAPH_SENDER_USER?.trim() ||
    ""
  );
}

async function getGraphAppAccessToken() {
  const tenantId = process.env.GRAPH_TENANT_ID?.trim();
  const clientId = process.env.GRAPH_CLIENT_ID?.trim();
  const clientSecret = process.env.GRAPH_CLIENT_SECRET?.trim();
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      "Graph credentials not configured. Set GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET.",
    );
  }
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!response.ok) {
    const msg = await response.text();
    throw new Error(`Graph token error: ${response.status} ${msg}`);
  }
  const data = await response.json();
  if (!data.access_token)
    throw new Error("No access_token in Graph token response");
  return data.access_token;
}

// Fetches inbox messages received on or after sinceDate (ISO date string "YYYY-MM-DD").
async function fetchInboxMessages(mailbox, accessToken, sinceDate) {
  const messages = [];
  // Only fetch unread messages — the agent marks processed emails as read, preventing re-processing on hourly runs
  const filterClause = `receivedDateTime ge ${sinceDate}T00:00:00Z and isRead eq false`;
  let url =
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/mailFolders/Inbox/messages` +
    `?$filter=${encodeURIComponent(filterClause)}` +
    `&$select=id,subject,from,receivedDateTime,isRead,body` +
    `&$top=50` +
    `&$orderby=receivedDateTime desc`;

  while (url) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        // Request plain text body to make parsing easier
        Prefer: 'outlook.body-content-type="text"',
      },
    });
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(`Graph inbox fetch error: ${res.status} ${msg}`);
    }
    const data = await res.json();
    messages.push(...(data.value ?? []));
    url = data["@odata.nextLink"] ?? null;
  }
  return messages;
}

async function markAsRead(mailbox, messageId, accessToken) {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages/${messageId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isRead: true }),
    },
  );
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Graph markAsRead error: ${res.status} ${msg}`);
  }
}

// ── Email parsing ────────────────────────────────────────────────────────────

// Strip HTML tags and decode common HTML entities from a body string.
function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ── Exchange rates to ZAR (fetched live) ────────────────────────────────────
// Fallback rates used when the Frankfurter API is unreachable.
const ZAR_RATES_FALLBACK = { ZAR: 1, R: 1, GBP: 23.5, EUR: 20.0, USD: 18.5 };

// Module-level ref updated at startup from a live FX feed.
let ZAR_RATES = { ...ZAR_RATES_FALLBACK };

/**
 * Fetches current ZAR conversion rates from api.frankfurter.app.
 * Returns fallback rates if the API is unreachable or returns bad data.
 * Rates are expressed as "1 foreign unit → N ZAR".
 */
async function fetchZarRates() {
  try {
    const res = await fetch(
      "https://api.frankfurter.app/latest?base=ZAR&symbols=GBP,EUR,USD",
      { signal: AbortSignal.timeout(6_000) },
    );
    if (!res.ok) return ZAR_RATES_FALLBACK;
    const data = await res.json();
    const r = data?.rates ?? {};
    // data.rates.GBP = how many GBP per 1 ZAR → invert to get ZAR per GBP
    return {
      ZAR: 1,
      R: 1,
      GBP: r.GBP ? Math.round((1 / r.GBP) * 100) / 100 : ZAR_RATES_FALLBACK.GBP,
      EUR: r.EUR ? Math.round((1 / r.EUR) * 100) / 100 : ZAR_RATES_FALLBACK.EUR,
      USD: r.USD ? Math.round((1 / r.USD) * 100) / 100 : ZAR_RATES_FALLBACK.USD,
    };
  } catch {
    return ZAR_RATES_FALLBACK;
  }
}

function symbolToCurrencyCode(sym) {
  if (sym === "£") return "GBP";
  if (sym === "€") return "EUR";
  if (sym === "$") return "USD";
  return sym.toUpperCase();
}

/**
 * Attempts to extract a rate from the plain-text email body and convert to ZAR.
 * Returns { original, zarAmount } or null if nothing found.
 * zarAmount is a number rounded to 2 decimal places.
 */
function parseRate(bodyText) {
  // [regex, currencyGroupIndex | null, amountGroupIndex]
  // null currencyGroupIndex means assume ZAR
  const patterns = [
    // £45.50, €50, $60 — symbol before number
    [
      /([£€$])\s*(\d+(?:[.,]\d+)?)\s*(?:(?:per|\/)\s*h(?:ou?r?)?|ph|p\/h)?/i,
      1,
      2,
    ],
    // 45 GBP, 50 EUR, 900 ZAR — number then code
    [
      /(\d+(?:[.,]\d+)?)\s*(GBP|EUR|USD|ZAR)\s*(?:(?:per|\/)\s*h(?:ou?r?)?|ph|p\/h)?/i,
      2,
      1,
    ],
    // GBP 45, EUR 50 — code then number
    [
      /(GBP|EUR|USD|ZAR)\s*(\d+(?:[.,]\d+)?)\s*(?:(?:per|\/)\s*h(?:ou?r?)?|ph|p\/h)?/i,
      1,
      2,
    ],
    // R 900 — South African Rand shorthand
    [
      /\b(R)\s*(\d+(?:[.,]\d+)?)\s*(?:(?:per|\/)\s*h(?:ou?r?)?|ph|p\/h)?/i,
      1,
      2,
    ],
    // 45 per hour / 45 per hr — no currency symbol, assume ZAR
    [/(\d+(?:[.,]\d+)?)\s*(?:per\s+h(?:ou?r?)?|\/\s*h(?:ou?r?)?)/i, null, 1],
  ];

  for (const [pattern, currencyGroup, amountGroup] of patterns) {
    const m = bodyText.match(pattern);
    if (!m) continue;
    const amount = parseFloat(m[amountGroup].replace(",", "."));
    if (isNaN(amount)) continue;
    const currencyCode =
      currencyGroup !== null ? symbolToCurrencyCode(m[currencyGroup]) : "ZAR";
    const multiplier = ZAR_RATES[currencyCode] ?? 1;
    const zarAmount = Math.round(amount * multiplier * 100) / 100;
    return { original: m[0].trim(), zarAmount };
  }
  return null;
}

/**
 * Returns which of the candidate's suggestedRoles are mentioned in the body text.
 * If the body contains "all" role language, returns all suggested roles.
 * Returns an empty array if nothing can be matched.
 */
function extractConfirmedRoles(bodyText, suggestedRolesCsv) {
  const suggested = suggestedRolesCsv
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);

  if (suggested.length === 0) return [];

  const bodyLower = bodyText.toLowerCase();

  // "happy with all", "confirm all", "all of the above", "all roles", etc.
  if (
    /\ball\b.*\broles?\b|\ball\s+of\s+the\s+(above|listed)|\bconfirm\s+all\b|\bhappy\s+with\s+all\b/i.test(
      bodyText,
    )
  ) {
    return [...suggested];
  }

  // Match each suggested role name in the body
  return suggested.filter((role) => bodyLower.includes(role.toLowerCase()));
}

/**
 * Returns true if this message looks like a reply to the role-confirmation
 * email or an opportunity-related email from this service.
 */
function isRelevantReply(subject) {
  const s = (subject ?? "").toLowerCase();
  return (
    // Replies to our role confirmation email
    s.includes("role confirmation") ||
    s.includes("contracting opportunities") ||
    // Replies to opportunity/job application emails
    s.includes("opportunity") ||
    s.includes("application") ||
    s.includes("placement") ||
    // Generic "Re:" replies to anything from the mailbox: capture everything
    s.startsWith("re:")
  );
}

// ── Additional signal detectors ───────────────────────────────────────────────

/**
 * Classifies email intent using AI. Returns { intent, confirmedRoles, rationale }
 * or null if no AI credentials are configured.
 * Falls back to keyword detection if AI is unavailable.
 */
async function classifyEmailIntentWithAi(bodyText, suggestedRolesCsv) {
  const apiBase = process.env.LLMLITE_API_BASE || process.env.OPENAI_API_BASE;
  const apiKey = process.env.LLMLITE_API_KEY || process.env.OPENAI_API_KEY;
  const model =
    process.env.LLMLITE_MODEL ||
    process.env.OPENAI_MODEL ||
    process.env.AZURE_OPENAI_DEPLOYMENT ||
    "auto";

  if (!apiBase || !apiKey) return null;

  const systemPrompt = `You are an email intent classifier for a contract recruitment platform. Analyse the candidate's email reply and return a JSON object with exactly these fields:
- "intent": one of "INTERESTED", "DECLINED", or null (null only if completely ambiguous)
- "confirmedRoles": array of role strings from suggestedRoles that the candidate confirmed (empty array if none mentioned)
- "rationale": one sentence explaining your classification

Suggested roles for this candidate: ${suggestedRolesCsv || "(none)"}

Respond ONLY with valid JSON. No markdown, no explanation outside the JSON.`;

  const userPrompt = `Email body:\n${bodyText.slice(0, 2000)}`;

  try {
    const response = await fetch(`${apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 200,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content ?? "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    if (typeof parsed !== "object" || parsed === null) return null;

    return {
      intent: parsed.intent ?? null,
      confirmedRoles: Array.isArray(parsed.confirmedRoles)
        ? parsed.confirmedRoles
        : [],
      rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
    };
  } catch {
    return null;
  }
}

/**
 * Detects whether the email body indicates the sender has signed an agreement.
 * Checks subject + body for agreement type keywords combined with signing language.
 * Returns 'NDA', 'TEAMING_AGREEMENT', or null.
 */
function detectAgreementSigned(subject, bodyText) {
  const s = (subject ?? "").toLowerCase();
  const b = (bodyText ?? "").toLowerCase();
  const hasSigned = /\b(?:signed|i have signed|completed|executed)\b/.test(b);
  if (!hasSigned) return null;
  if (s.includes("teaming") || b.includes("teaming agreement"))
    return "TEAMING_AGREEMENT";
  if (s.includes("nda") || b.includes("nda") || b.includes("non-disclosure"))
    return "NDA";
  return null;
}

/**
 * Detects whether the sender is expressing interest in or declining an opportunity.
 * Returns 'DECLINED', 'INTERESTED', or null. Decline takes priority.
 */
function detectOpportunityIntent(bodyText) {
  const b = (bodyText ?? "").toLowerCase();
  const declineKeywords = [
    "not interested",
    "no longer interested",
    "i withdraw",
    "i decline",
    "i am declining",
    "no thank",
    "unfortunately cannot",
    "unfortunately i cannot",
    "prefer not to proceed",
    "withdraw my application",
  ];
  const interestKeywords = [
    "i am interested",
    "i'm interested",
    "very interested",
    "please proceed",
    "please share my cv",
    "i confirm my interest",
    "i would like to proceed",
    "happy to proceed",
    "yes please",
    "count me in",
    "i would love to",
    "forward my cv",
    "send my cv",
  ];
  if (declineKeywords.some((kw) => b.includes(kw))) return "DECLINED";
  if (interestKeywords.some((kw) => b.includes(kw))) return "INTERESTED";
  return null;
}

/**
 * Detects a phone number update accompanied by contextual language.
 * Returns a cleaned phone string or null.
 */
function detectPhoneUpdate(bodyText) {
  const m = bodyText.match(
    /(?:my (?:new |updated )?(?:cell|mobile|phone|contact)(?: number)?(?: is)?:?\s*)(\+?[\d\s\-().]{7,15})/i,
  );
  if (!m) return null;
  const phone = m[1].replace(/\s+/g, " ").trim();
  if ((phone.match(/\d/g) ?? []).length < 7) return null;
  return phone;
}

// ── Additional docker exec helpers ────────────────────────────────────────────

/**
 * Marks a CandidateAgreement as COMPLETED (signed) via docker exec raw SQL.
 * Returns the number of rows updated (0 = no matching agreement record found — send via platform first).
 */
function markAgreementCompletedViaDocker(candidateId, agreementType) {
  const sql =
    'UPDATE "CandidateAgreement" SET "status" = $1, "signedAt" = datetime(\'now\'), "updatedAt" = datetime(\'now\') WHERE "candidateId" = $2 AND "type" = $3';
  const script = [
    '"use strict";',
    "const { PrismaClient } = require('@prisma/client');",
    "const p = new PrismaClient();",
    `p.$executeRawUnsafe(${JSON.stringify(sql)}, 'COMPLETED', ${JSON.stringify(candidateId)}, ${JSON.stringify(agreementType)})`,
    "  .then(n => { console.log('rows:' + n); process.exit(0); })",
    "  .catch(e => { console.error('ERROR:' + e.message); process.exit(1); });",
  ].join("\n");
  const result = dockerExecScript(script);
  if (result.includes("ERROR:"))
    throw new Error(result.replace("ERROR:", "").trim());
  return parseInt(result.replace("rows:", ""), 10);
}

/**
 * Fetches active (non-terminal) applications for a candidate via docker exec.
 * Returns array of { id, currentStage, opportunityId }.
 */
function fetchActiveApplicationsViaDocker(candidateId) {
  const sql =
    'SELECT id, "currentStage", "opportunityId" FROM "Application" WHERE "candidateId" = $1 AND "currentStage" NOT IN (\'REJECTED\', \'PLACED\') ORDER BY "updatedAt" DESC';
  const script = [
    '"use strict";',
    "const { PrismaClient } = require('@prisma/client');",
    "const p = new PrismaClient();",
    `p.$queryRawUnsafe(${JSON.stringify(sql)}, ${JSON.stringify(candidateId)})`,
    "  .then(rows => { console.log(JSON.stringify(rows)); process.exit(0); })",
    "  .catch(e => { console.error('ERROR:' + e.message); process.exit(1); });",
  ].join("\n");
  const result = dockerExecScript(script);
  if (result.includes("ERROR:"))
    throw new Error(result.replace("ERROR:", "").trim());
  return JSON.parse(result);
}

/**
 * Updates an Application's currentStage and inserts an ApplicationStageHistory record.
 */
function updateApplicationStageViaDocker(appId, fromStage, toStage) {
  const updateSql =
    'UPDATE "Application" SET "currentStage" = $1, "updatedAt" = datetime(\'now\') WHERE "id" = $2';
  // Subquery retrieves tenantId from the application row itself
  const historySql =
    'INSERT INTO "ApplicationStageHistory" ("id", "tenantId", "applicationId", "fromStage", "toStage", "changedBy", "changedAt") SELECT lower(hex(randomblob(4))||\'-\'||hex(randomblob(2))||\'-\'||hex(randomblob(2))||\'-\'||hex(randomblob(2))||\'-\'||hex(randomblob(6))), "tenantId", $1, $2, $3, $4, datetime(\'now\') FROM "Application" WHERE "id" = $1';
  const fromArg = fromStage !== null ? JSON.stringify(fromStage) : "null";
  const script = [
    '"use strict";',
    "const { PrismaClient } = require('@prisma/client');",
    "const p = new PrismaClient();",
    "p.$transaction([",
    `  p.$executeRawUnsafe(${JSON.stringify(updateSql)}, ${JSON.stringify(toStage)}, ${JSON.stringify(appId)}),`,
    `  p.$executeRawUnsafe(${JSON.stringify(historySql)}, ${JSON.stringify(appId)}, ${fromArg}, ${JSON.stringify(toStage)}, 'inbox-agent'),`,
    "])",
    "  .then(() => { console.log('updated'); process.exit(0); })",
    "  .catch(e => { console.error('ERROR:' + e.message); process.exit(1); });",
  ].join("\n");
  const result = dockerExecScript(script);
  if (result.includes("ERROR:"))
    throw new Error(result.replace("ERROR:", "").trim());
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const mailbox = getSharedMailbox();

  console.log("=".repeat(60));
  console.log("Inbox Reply Agent — Candidate Updater");
  console.log("=".repeat(60));
  console.log(
    `Mode      : ${APPLY ? "APPLY (will update candidates)" : "DRY RUN"}`,
  );
  console.log(`Mailbox   : ${mailbox}`);
  console.log(`Since     : ${SINCE_DATE}`);
  if (SENDER_FILTER) console.log(`Filter    : "${SENDER_FILTER}"`);
  console.log();

  // ── Live FX rates ─────────────────────────────────────────────────────────
  ZAR_RATES = await fetchZarRates();
  console.log(
    `FX rates  : GBP=${ZAR_RATES.GBP}, EUR=${ZAR_RATES.EUR}, USD=${ZAR_RATES.USD} (live)`,
  );
  console.log();

  // ── Session ──────────────────────────────────────────────────────────────
  console.log("Looking up admin user via docker exec...");
  const adminUser = getAdminUserViaDocker();
  if (!adminUser?.id) {
    throw new Error(`No active admin user found for tenant ${TENANT_ID}`);
  }
  const sessionToken = mintSession(adminUser.id, TENANT_ID);
  const cookieHeader = `tenantId=${TENANT_ID}; appSession=${sessionToken}`;
  console.log(`Session   : minted for ${adminUser.email}\n`);

  // ── Candidates ────────────────────────────────────────────────────────────
  console.log("Fetching candidates from app API...");
  const candidates = await fetchAllCandidates(cookieHeader);
  console.log(`Found     : ${candidates.length} candidates\n`);

  // Build lookup map: normalised email → candidate
  const byEmail = new Map();
  for (const c of candidates) {
    if (c.email) {
      byEmail.set(c.email.trim().toLowerCase(), c);
    }
  }

  // ── Graph ─────────────────────────────────────────────────────────────────
  console.log("Acquiring Graph access token...");
  const accessToken = await getGraphAppAccessToken();
  console.log("Token acquired.\n");

  console.log(`Fetching inbox messages since ${SINCE_DATE}...`);
  const allMessages = await fetchInboxMessages(
    mailbox,
    accessToken,
    SINCE_DATE,
  );
  console.log(`Inbox messages found : ${allMessages.length}`);

  // Filter: relevant replies only
  let relevant = allMessages.filter((m) => isRelevantReply(m.subject));
  console.log(`Relevant replies     : ${relevant.length}`);

  // Optional sender filter
  if (SENDER_FILTER) {
    relevant = relevant.filter((m) => {
      const addr = (m.from?.emailAddress?.address ?? "").toLowerCase();
      const name = (m.from?.emailAddress?.name ?? "").toLowerCase();
      return addr.includes(SENDER_FILTER) || name.includes(SENDER_FILTER);
    });
    console.log(`After filter         : ${relevant.length}`);
  }

  if (relevant.length === 0) {
    console.log("\nNo relevant replies to process.");
    return;
  }

  console.log();
  console.log("-".repeat(60));

  let updated = 0;
  let noMatch = 0;
  let failed = 0;

  const noMatchList = [];
  const results = [];

  for (const message of relevant) {
    const senderEmail = (message.from?.emailAddress?.address ?? "").trim();
    const senderName = message.from?.emailAddress?.name ?? senderEmail;
    const subject = message.subject ?? "(no subject)";
    const receivedAt = message.receivedDateTime ?? "";

    console.log(`From    : ${senderName} <${senderEmail}>`);
    console.log(`Subject : ${subject}`);
    console.log(`Date    : ${receivedAt}`);

    // Match to candidate
    const candidate = byEmail.get(senderEmail.toLowerCase());
    if (!candidate) {
      console.log(`Match   : ⚠  No candidate found with this email`);
      noMatchList.push({ senderEmail, senderName, subject });
      noMatch++;
      console.log();
      continue;
    }

    console.log(`Match   : ${candidate.fullName} (id: ${candidate.id})`);

    // Parse body
    const rawBody = message.body?.content ?? "";
    const bodyText =
      message.body?.contentType === "html" ? stripHtml(rawBody) : rawBody;

    // ── Detect all signals ────────────────────────────────────────────────
    const parsedRate = parseRate(bodyText);
    const agreementSigned = detectAgreementSigned(subject, bodyText);
    const phoneUpdate = detectPhoneUpdate(bodyText);

    // AI-powered intent + role classification (falls back to keyword heuristics)
    const aiClassification = await classifyEmailIntentWithAi(
      bodyText,
      candidate.suggestedRolesCsv ?? "",
    );

    let confirmedRoles;
    let opportunityIntent;

    if (aiClassification) {
      confirmedRoles =
        aiClassification.confirmedRoles.length > 0
          ? aiClassification.confirmedRoles
          : extractConfirmedRoles(bodyText, candidate.suggestedRolesCsv ?? "");
      opportunityIntent = aiClassification.intent;
      if (aiClassification.rationale) {
        console.log(`AI      : ${aiClassification.rationale}`);
      }
    } else {
      confirmedRoles = extractConfirmedRoles(
        bodyText,
        candidate.suggestedRolesCsv ?? "",
      );
      opportunityIntent = detectOpportunityIntent(bodyText);
    }

    // ── Log detected signals ──────────────────────────────────────────────
    console.log(
      `Rate    : ${parsedRate ? `R${parsedRate.zarAmount} (from ${parsedRate.original})` : "(not found)"}`,
    );
    console.log(
      `Roles   : ${confirmedRoles.length > 0 ? confirmedRoles.join(", ") : "(none matched)"}`,
    );
    if (agreementSigned)
      console.log(`Agreement: ${agreementSigned} — signed detected`);
    if (opportunityIntent) console.log(`Intent   : ${opportunityIntent}`);
    if (phoneUpdate) console.log(`Phone    : ${phoneUpdate}`);

    if (APPLY) {
      try {
        // ── 1. Candidate profile updates (rate, roles, phone) ─────────────
        const candidateUpdates = {};
        if (parsedRate) {
          candidateUpdates.selfReportedHourlyRate = `R${parsedRate.zarAmount}`;
        }
        if (confirmedRoles.length > 0) {
          const existing = (candidate.preferredRolesCsv ?? "")
            .split(",")
            .map((r) => r.trim())
            .filter(Boolean);
          const merged = [...new Set([...existing, ...confirmedRoles])];
          candidateUpdates.preferredRolesCsv = merged.join(", ");
        }
        if (phoneUpdate) {
          candidateUpdates.phone = phoneUpdate;
        }
        if (Object.keys(candidateUpdates).length > 0) {
          updateCandidateViaDocker(candidate.id, candidateUpdates);
          console.log(`Profile : ✓ Candidate record updated`);
        }

        // ── 2. Agreement signing ──────────────────────────────────────────
        if (agreementSigned) {
          const rows = markAgreementCompletedViaDocker(
            candidate.id,
            agreementSigned,
          );
          if (rows > 0) {
            console.log(`Agreemnt: ✓ ${agreementSigned} marked COMPLETED`);
          } else {
            console.log(
              `Agreemnt: ⚠  ${agreementSigned} — no agreement record found (send via platform first)`,
            );
          }
        }

        // ── 3. Opportunity interest / decline ─────────────────────────────
        if (opportunityIntent === "DECLINED") {
          const apps = fetchActiveApplicationsViaDocker(candidate.id);
          if (apps.length === 0) {
            console.log(`Intent  : DECLINED — no active applications found`);
          } else {
            for (const app of apps) {
              updateApplicationStageViaDocker(
                app.id,
                app.currentStage,
                "REJECTED",
              );
              console.log(
                `Intent  : ✓ Application ${app.opportunityId} → REJECTED`,
              );
            }
          }
        } else if (opportunityIntent === "INTERESTED") {
          const apps = fetchActiveApplicationsViaDocker(candidate.id);
          console.log(
            `Intent  : INTERESTED — ${apps.length} active application(s) noted`,
          );
        }

        const anythingDetected =
          Object.keys(candidateUpdates).length > 0 ||
          agreementSigned !== null ||
          opportunityIntent !== null;

        if (!anythingDetected) {
          console.log(`Update  : — Nothing parseable detected`);
        }

        await markAsRead(mailbox, message.id, accessToken);
        console.log(`Email   : Marked as read`);
        updated++;

        results.push({
          name: candidate.fullName,
          email: senderEmail,
          rate: parsedRate ? `R${parsedRate.zarAmount}` : null,
          roles: confirmedRoles,
          agreementSigned,
          opportunityIntent,
          status: "updated",
        });
      } catch (err) {
        console.error(`Update  : ✗ FAILED — ${err.message}`);
        failed++;
        results.push({
          name: candidate.fullName,
          email: senderEmail,
          rate: parsedRate ? `R${parsedRate.zarAmount}` : null,
          roles: confirmedRoles,
          agreementSigned,
          opportunityIntent,
          status: "failed",
          error: err.message,
        });
      }
    } else {
      const actions = [];
      if (parsedRate) actions.push(`rate: R${parsedRate.zarAmount}`);
      if (confirmedRoles.length > 0)
        actions.push(`${confirmedRoles.length} role(s)`);
      if (agreementSigned) actions.push(`${agreementSigned} signed`);
      if (opportunityIntent) actions.push(`intent: ${opportunityIntent}`);
      if (phoneUpdate) actions.push(`phone update`);
      console.log(
        `Actions : ${actions.length > 0 ? actions.join(", ") : "— nothing detected"}`,
      );
      results.push({
        name: candidate.fullName,
        email: senderEmail,
        rate: parsedRate ? `R${parsedRate.zarAmount}` : null,
        roles: confirmedRoles,
        agreementSigned,
        opportunityIntent,
        status: "dry-run",
      });
    }

    console.log();
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("=".repeat(60));
  if (APPLY) {
    console.log(
      `Done. Updated: ${updated}, Failed: ${failed}, Unmatched: ${noMatch}`,
    );
  } else {
    const parsedRateCount = results.filter((r) => r.rate).length;
    const parsedRolesCount = results.filter((r) => r.roles?.length > 0).length;
    const agreementCount = results.filter((r) => r.agreementSigned).length;
    const intentCount = results.filter((r) => r.opportunityIntent).length;
    console.log(
      `Dry run — ${relevant.length} reply/replies found, ` +
        `${results.filter((r) => r.status === "dry-run" && byEmail.has(r.email?.toLowerCase())).length} matched to candidates`,
    );
    console.log(`  Rate parsed    : ${parsedRateCount}`);
    console.log(`  Roles matched  : ${parsedRolesCount}`);
    console.log(`  Agreements     : ${agreementCount}`);
    console.log(`  Opp intent     : ${intentCount}`);
    console.log(`  Unmatched      : ${noMatch}`);
  }

  if (noMatchList.length > 0) {
    console.log(`\nUnmatched senders (no candidate with that email):`);
    for (const nm of noMatchList) {
      console.log(`  - ${nm.senderName} <${nm.senderEmail}>`);
    }
  }

  if (!APPLY) {
    console.log("\nRun with --apply to write updates to the database.");
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
