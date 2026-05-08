const BASE = "http://localhost:3001";
const COOKIE = "tenantId=dotcloudconsulting";
const results = {};

function record(name, ok, detail) {
  results[name] = { ok, detail };
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`);
}

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Cookie: COOKIE,
      ...(opts.headers || {}),
    },
  });
  return { status: res.status, body: await res.json() };
}

async function main() {
  console.log("\n═══ AI / LLM Function Test Suite ═══\n");

  // 1. AI Status
  try {
    const { status, body } = await api("/api/ai/status");
    record(
      "AI Status (LiteLLM configured)",
      status === 200 && body?.data?.liteLlmConfigured === true,
      status === 200 ? "Gateway configured" : `status=${status}`,
    );
  } catch (e) {
    record("AI Status", false, e.message);
  }

  // 2. Email Generate (full AI pipeline: evidence context + email + factuality guard)
  try {
    const { status, body } = await api("/api/email/generate", {
      method: "POST",
      body: JSON.stringify({
        applicationId: "cmok171hd019aok71wnesvuml",
        candidateId: "cmnsq28ce0004rx011vd4kxgo",
        jobId: "cmoj74crq00zapf01hn1dv7fa",
        force: true,
      }),
    });
    const ok = status === 200 && body?.data?.subject;
    record(
      "Email Generate (evidence + email + factuality)",
      ok,
      ok ? `subject="${body.data.subject.slice(0, 60)}"` : `status=${status}`,
    );
  } catch (e) {
    record("Email Generate", false, e.message.slice(0, 150));
  }

  // 3. Match Score (AI candidate scoring)
  try {
    const { status, body } = await api(
      "/api/match/score?jobId=cmoj74crq00zapf01hn1dv7fa",
    );
    record(
      "Match Score (AI candidate scoring)",
      status === 200 && Array.isArray(body?.data?.candidates),
      status === 200
        ? `${body.data.candidates.length} candidates`
        : `status=${status}`,
    );
  } catch (e) {
    record("Match Score", false, e.message.slice(0, 150));
  }

  // 4. Match Score Cached
  try {
    const { status } = await api(
      "/api/match/score/cached?jobId=cmoj74crq00zapf01hn1dv7fa",
    );
    record("Match Score Cached", status === 200, `status=${status}`);
  } catch (e) {
    record("Match Score Cached", false, e.message.slice(0, 150));
  }

  // 5. Opportunities Upload (AI extraction + matching)
  try {
    const fd = new FormData();
    fd.append("source", "linkedin");
    fd.append(
      "file",
      new Blob(
        [
          "Senior Azure Cloud Engineer – Must have experience with Azure DevOps, Terraform, and Kubernetes. Based in London. 5+ years experience required.",
        ],
        { type: "text/plain" },
      ),
      "test.txt",
    );
    const res = await fetch(`${BASE}/api/opportunities/upload`, {
      method: "POST",
      headers: { Cookie: COOKIE },
      body: fd,
    });
    const body = await res.json();
    record(
      "Opportunities Upload (AI extraction)",
      res.status === 200 || res.status === 201,
      `status=${res.status}`,
    );
  } catch (e) {
    record("Opportunities Upload", false, e.message.slice(0, 150));
  }

  // 6. Email Repair Drafts (endpoint reachable)
  try {
    const { status } = await api("/api/email/repair-drafts", {
      method: "POST",
      body: JSON.stringify({ dryRun: true }),
    });
    record(
      "Email Repair Drafts (reachable)",
      status !== 500,
      `status=${status}`,
    );
  } catch (e) {
    record("Email Repair Drafts", false, e.message.slice(0, 150));
  }

  // Summary
  console.log("\n═══ Summary ═══");
  const entries = Object.entries(results);
  const passed = entries.filter(([, r]) => r.ok).length;
  const failed = entries.filter(([, r]) => !r.ok).length;
  console.log(`Total: ${entries.length}  Passed: ${passed}  Failed: ${failed}`);
  for (const [name, r] of entries) {
    console.log(
      `  ${r.ok ? "✅" : "❌"} ${name}${r.detail ? " — " + r.detail : ""}`,
    );
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
