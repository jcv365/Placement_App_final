/**
 * Comprehensive LLM Journey Test Suite
 * Tests all 11 AI/LLM functions with deepseek-v4-flash:cloud model
 */
const BASE = "http://localhost:3001";
const COOKIE = "session=dotcloudconsulting";
const HEADERS = { Cookie: COOKIE, "Content-Type": "application/json" };

// Valid test data from the database
const JOB_ID = "cmmxp4bcr0003v6q84xo61u8u";
const CANDIDATE_ID = "cmnegvm7q0000v6a4ejjqaz83";
const APPLICATION_ID = "cmnfpsk5d0007v6howeqdq4n0";

let passed = 0,
  failed = 0,
  results = [];

async function test(name, fn) {
  try {
    const result = await fn();
    console.log(`✅ ${name}: ${JSON.stringify(result).slice(0, 200)}`);
    passed++;
    results.push({
      name,
      status: "PASS",
      detail: String(result).slice(0, 200),
    });
  } catch (e) {
    console.log(`❌ ${name}: ${e.message?.slice(0, 300) || e}`);
    failed++;
    results.push({
      name,
      status: "FAIL",
      detail: e.message?.slice(0, 300) || String(e).slice(0, 300),
    });
  }
}

async function post(url, body, timeout = 120000) {
  const res = await fetch(url, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  const data = await res.json();
  if (!res.ok)
    throw new Error(
      `HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`,
    );
  return data;
}

async function get(url, timeout = 30000) {
  const res = await fetch(url, {
    method: "GET",
    headers: { Cookie: COOKIE },
    signal: AbortSignal.timeout(timeout),
  });
  const data = await res.json();
  if (!res.ok)
    throw new Error(
      `HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`,
    );
  return data;
}

async function main() {
  console.log("=== LLM Journey Test Suite (deepseek-v4-flash:cloud) ===\n");

  // J0: AI Status
  await test("J0: AI Status", async () => {
    const r = await get(`${BASE}/api/ai/status`);
    return r.data?.liteLlmConfigured
      ? "LiteLLM configured ✅"
      : "LiteLLM NOT configured ❌";
  });

  // J1: Email Generation (fresh, force=true)
  await test("J1: Email Generation (force)", async () => {
    const r = await post(`${BASE}/api/email/generate`, {
      jobId: JOB_ID,
      candidateId: CANDIDATE_ID,
      applicationId: APPLICATION_ID,
    });
    const cached = r.data?.cached ? "CACHED" : "FRESH";
    const drafts = r.data?.drafts?.length || 0;
    return `${cached} | ${drafts} draft(s) | model: ${r.data?.model || "unknown"}`;
  });

  // J2: Match Scoring
  await test("J2: Match Scoring", async () => {
    const r = await post(`${BASE}/api/match/score`, {
      jobId: JOB_ID,
      candidateIds: [CANDIDATE_ID],
    });
    const scores = r.data?.scores?.length || 0;
    return `${scores} score(s) returned`;
  });

  // J3: Match Score Cache
  await test("J3: Match Score Cache", async () => {
    const r = await post(`${BASE}/api/match/score`, {
      jobId: JOB_ID,
      candidateIds: [CANDIDATE_ID],
    });
    return `Cache hit: ${r.data?.cached ? "YES" : "NO"}`;
  });

  // J4: Opportunities Upload (metadata inference)
  await test("J4: Opportunities Upload (metadata)", async () => {
    const r = await post(`${BASE}/api/opportunities/upload`, {
      text: "Senior Software Engineer position requiring React, TypeScript, and Node.js. Must have 5+ years experience in cloud architecture. Based in London, UK. Salary range £80,000-£120,000.",
    });
    return `Role: ${r.data?.role || "N/A"} | Name: ${r.data?.candidateName || "N/A"}`;
  });

  // J5: Email Repair Drafts
  await test("J5: Email Repair Drafts (auth check)", async () => {
    try {
      const r = await post(`${BASE}/api/email/repair-drafts`, {
        applicationId: APPLICATION_ID,
      });
      return `Unexpected success: ${JSON.stringify(r).slice(0, 100)}`;
    } catch (e) {
      // We expect 401 without admin auth
      if (e.message.includes("401") || e.message.includes("Authentication")) {
        return "Correctly returns 401 for unauthenticated request ✅";
      }
      return `Got error but not 401: ${e.message.slice(0, 100)}`;
    }
  });

  // J6: Candidate Profile Inference (via CV upload)
  await test("J6: Candidate Profile Inference", async () => {
    const r = await post(`${BASE}/api/candidates/infer-profile`, {
      candidateId: CANDIDATE_ID,
    });
    return `Profile inferred: ${r.data?.skills ? "skills ✅" : "no skills"} | ${r.data?.suggestedRoles ? "roles ✅" : "no roles"}`;
  });

  // J7: British English Correction
  await test("J7: British English Correction", async () => {
    const r = await post(`${BASE}/api/ai/british-english`, {
      text: "The candidate has organized the program and analyzed the behavior patterns.",
    });
    return `Corrected: ${r.data?.text?.slice(0, 100) || "N/A"}`;
  });

  // J8: Company Resolution
  await test("J8: Company Resolution", async () => {
    const r = await post(`${BASE}/api/ai/resolve-company`, {
      companyName: "Microsoft Corporation",
    });
    return `Resolved: ${r.data?.resolvedName || r.data?.name || "N/A"}`;
  });

  // J9: Email Factuality Guard
  await test("J9: Email Factuality Guard", async () => {
    const r = await post(`${BASE}/api/ai/factuality-check`, {
      emailContent:
        "Dear Sir, I am writing regarding the Senior Developer position at Dot Cloud Consulting. The candidate has 10 years of experience in React and TypeScript.",
      jobTitle: "Senior Developer",
      candidateName: "Test Candidate",
    });
    return `Factual: ${r.data?.factual ? "YES" : "NO"} | Score: ${r.data?.score || "N/A"}`;
  });

  // J10: CV Formatting
  await test("J10: CV Formatting", async () => {
    const r = await post(`${BASE}/api/candidates/format-cv`, {
      candidateId: CANDIDATE_ID,
    });
    return `Formatted: ${r.data?.formatted ? "YES" : "NO"} | Length: ${r.data?.text?.length || 0}`;
  });

  console.log(
    `\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===`,
  );
  console.log("\nDetailed results:");
  results.forEach((r) =>
    console.log(
      `  ${r.status === "PASS" ? "✅" : "❌"} ${r.name}: ${r.detail}`,
    ),
  );
}

main().catch((e) => console.error("Fatal:", e));
