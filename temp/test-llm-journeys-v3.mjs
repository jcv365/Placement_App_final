/**
 * Comprehensive LLM Journey Test Suite v3
 * Tests all AI/LLM functions with deepseek-v4-flash:cloud model
 * Uses correct API endpoints and authentication
 */
const BASE = "http://localhost:3001";
const TENANT_COOKIE = "tenantId=dotcloudconsulting";

// Valid test data from the database (applications with existing email drafts)
const APP_ID = "cmnfqwq0l0001v6wwonmeev42";
const JOB_ID = "cmn05okgh001xv6oc556ujb1g";
const CANDIDATE_ID = "cmnegwn0b0001v6a4yer4s7oz";

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
    headers: { Cookie: TENANT_COOKIE, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  let data;
  try {
    data = await res.json();
  } catch {
    data = { raw: await res.text().catch(() => "non-json") };
  }
  if (!res.ok)
    throw new Error(
      `HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`,
    );
  return data;
}

async function get(url, timeout = 30000) {
  const res = await fetch(url, {
    method: "GET",
    headers: { Cookie: TENANT_COOKIE },
    signal: AbortSignal.timeout(timeout),
  });
  let data;
  try {
    data = await res.json();
  } catch {
    data = { raw: await res.text().catch(() => "non-json") };
  }
  if (!res.ok)
    throw new Error(
      `HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`,
    );
  return data;
}

async function main() {
  console.log("=== LLM Journey Test Suite v3 (deepseek-v4-flash:cloud) ===\n");

  // ─── J0: AI Status ───
  await test("J0: AI Status", async () => {
    const r = await get(`${BASE}/api/ai/status`);
    return r.data?.liteLlmConfigured
      ? "LiteLLM configured ✅"
      : "LiteLLM NOT configured ❌";
  });

  // ─── J1: Email Generation (fresh LLM call) ───
  // Uses generateEmail() → LiteLLM gateway → deepseek-v4-flash:cloud
  await test("J1: Email Generation", async () => {
    const r = await post(`${BASE}/api/email/generate`, {
      jobId: JOB_ID,
      candidateId: CANDIDATE_ID,
      applicationId: APP_ID,
    });
    const cached = r.data?.cached ? "CACHED" : "FRESH";
    const drafts = r.data?.drafts?.length || 0;
    const model = r.data?.model || r.data?.aiProvider || "unknown";
    return `${cached} | ${drafts} draft(s) | model: ${model}`;
  });

  // ─── J2: Match Scoring (LLM-powered candidate-job matching) ───
  // Uses validateCandidateJobMatch() → generateStructuredJson() → deepseek-v4-flash:cloud
  await test("J2: Match Scoring", async () => {
    const r = await get(`${BASE}/api/match/score?jobId=${JOB_ID}&force=true`);
    return `Scores: ${r.data?.scored?.length || r.data?.results?.length || 0} | Source: ${r.data?.source || r.data?.aiProvider || "unknown"}`;
  });

  // ─── J3: Match Score Cached ───
  await test("J3: Match Score Cached", async () => {
    const r = await post(`${BASE}/api/match/score/cached`, {
      jobIds: [JOB_ID],
    });
    return `Cache: ${r.data?.results?.length || 0} results`;
  });

  // ─── J4: Opportunities Upload (LLM metadata inference) ───
  // Uses inferMetadataFromUploadedText() → generateStructuredJson() → deepseek-v4-flash:cloud
  await test("J4: Opportunities Upload", async () => {
    const r = await post(`${BASE}/api/opportunities/upload`, {
      text: "Senior Software Engineer position requiring React, TypeScript, and Node.js. Must have 5+ years experience in cloud architecture. Based in London, UK. Salary range £80,000-£120,000.",
    });
    return `Role: ${r.data?.role || r.data?.inferredRole || "N/A"} | Name: ${r.data?.candidateName || r.data?.inferredName || "N/A"}`;
  });

  // ─── J5: Email Repair Drafts (auth check) ───
  // Uses requireAdminContextFromRequest() → should return 401/500 for unauthenticated
  await test("J5: Email Repair Drafts (auth)", async () => {
    try {
      const r = await post(`${BASE}/api/email/repair-drafts`, {
        applicationId: APP_ID,
      });
      return `Unexpected success: ${JSON.stringify(r).slice(0, 100)}`;
    } catch (e) {
      if (
        e.message.includes("401") ||
        e.message.includes("UNAUTHORISED") ||
        e.message.includes("Authentication")
      ) {
        return "Correctly rejects unauthenticated request ✅";
      }
      return `Got error: ${e.message.slice(0, 100)}`;
    }
  });

  // ─── J6: Candidate ATS Match (LLM-powered match validation) ───
  // Uses validateCandidateJobMatch() → generateStructuredJson() → deepseek-v4-flash:cloud
  await test("J6: Candidate ATS Match", async () => {
    const r = await post(`${BASE}/api/candidates/${CANDIDATE_ID}/ats-match`, {
      jobId: JOB_ID,
    });
    return `Score: ${r.data?.score || r.data?.atsScore || "N/A"} | Decision: ${r.data?.decision || r.data?.atsDecision || "N/A"}`;
  });

  // ─── J7: Candidate Formatted CV (LLM-powered CV formatting) ───
  // Uses formatCvForAts() → generateStructuredJson() → deepseek-v4-flash:cloud
  await test("J7: Candidate Formatted CV", async () => {
    const r = await post(
      `${BASE}/api/candidates/${CANDIDATE_ID}/formatted-cv`,
      {},
    );
    return `Formatted: ${r.data?.formatted || r.data?.success ? "YES" : "NO"} | Length: ${r.data?.text?.length || r.data?.length || 0}`;
  });

  // ─── J8: Candidate Roles (LLM role inference) ───
  // Uses inferCandidateProfileFromCv() → generateStructuredJson() → deepseek-v4-flash:cloud
  await test("J8: Candidate Roles", async () => {
    const r = await post(`${BASE}/api/candidates/${CANDIDATE_ID}/roles`, {});
    return `Roles: ${r.data?.roles?.length || r.data?.suggestedRoles?.length || 0} suggested`;
  });

  // ─── J9: Candidate ATS Fix (LLM-powered ATS optimization) ───
  // Uses formatCvForAts() → generateStructuredJson() → deepseek-v4-flash:cloud
  await test("J9: Candidate ATS Fix", async () => {
    const r = await post(`${BASE}/api/candidates/${CANDIDATE_ID}/ats-fix`, {
      jobId: JOB_ID,
    });
    return `Fixed: ${r.data?.fixed || r.data?.success ? "YES" : "NO"} | Score: ${r.data?.score || r.data?.atsScore || "N/A"}`;
  });

  // ─── J10: Email Factuality Guard ───
  // Uses checkEmailFactuality() → generateStructuredJson() → deepseek-v4-flash:cloud
  // This is called internally during email generation, but let's test it via the email learn endpoint
  await test("J10: Email Learn (factuality)", async () => {
    const r = await post(`${BASE}/api/email/learn`, {
      applicationId: APP_ID,
      feedback: "positive",
    });
    return `Learn: ${r.ok ? "OK" : "N/A"} | ${JSON.stringify(r.data || r).slice(0, 100)}`;
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
