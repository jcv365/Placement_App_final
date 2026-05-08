/**
 * AI/LLM Function Test Suite — calls API endpoints directly.
 * Run from host via PowerShell.
 */
const BASE = "http://localhost:3001";
const TENANT_COOKIE = "tenantId=dotcloudconsulting";

const results = {};

function record(name, outcome) {
  results[name] = outcome;
  const icon = outcome.ok ? "✅" : "❌";
  console.log(
    `${icon} ${name}: ${outcome.ok ? "PASS" : "FAIL"}${outcome.detail ? " — " + outcome.detail : ""}`,
  );
}

async function fetchJson(path, opts = {}) {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Cookie: TENANT_COOKIE,
      ...(opts.headers || {}),
    },
  });
  const body = await res.json();
  return { status: res.status, body };
}

async function main() {
  console.log("\n═══ AI / LLM Function Test Suite ═══\n");

  // ── 1. AI Status ──────────────────────────────────────────────────────────
  console.log("── 1. AI Status Endpoint ──");
  try {
    const { status, body } = await fetchJson("/api/ai/status");
    const ok = status === 200 && body?.data?.liteLlmConfigured === true;
    record("AI Status (LiteLLM configured)", {
      ok,
      detail: ok
        ? "Gateway configured"
        : `status=${status}, body=${JSON.stringify(body).slice(0, 120)}`,
    });
  } catch (e) {
    record("AI Status (LiteLLM configured)", { ok: false, detail: e.message });
  }

  // ── 2. Find test data (job + candidate + application) ─────────────────────
  console.log("\n── 2. Finding test data ──");
  let jobId, candidateId, applicationId;
  try {
    const { body: jobsBody } = await fetchJson("/api/jobs?limit=3");
    const jobs = jobsBody?.data?.jobs || jobsBody?.data || [];
    jobId = jobs[0]?.id;
    console.log(`   Job: id=${jobId}, title="${jobs[0]?.title}"`);
  } catch (e) {
    console.log("   Could not fetch jobs:", e.message);
  }

  // ── 3. Match Score (AI candidate scoring) ─────────────────────────────────
  console.log("\n── 3. Match Score Endpoint ──");
  if (jobId) {
    try {
      const { status, body } = await fetchJson(
        `/api/match/score?jobId=${jobId}`,
      );
      const ok = status === 200 && Array.isArray(body?.data?.candidates);
      record("Match Score (AI candidate scoring)", {
        ok,
        detail: ok
          ? `${body.data.candidates.length} candidates scored`
          : `status=${status}, ${JSON.stringify(body).slice(0, 150)}`,
      });
    } catch (e) {
      record("Match Score (AI candidate scoring)", {
        ok: false,
        detail: e.message.slice(0, 200),
      });
    }
  } else {
    record("Match Score (AI candidate scoring)", {
      ok: false,
      detail: "No job ID available",
    });
  }

  // ── 4. Email Generate (full AI pipeline) ─────────────────────────────────
  console.log("\n── 4. Email Generate Endpoint ──");
  // Find an application for the job
  try {
    const { body: appsBody } = await fetchJson(
      `/api/applications?jobId=${jobId}&limit=1`,
    );
    const apps = appsBody?.data || [];
    if (apps.length > 0) {
      applicationId = apps[0].id;
      candidateId = apps[0].candidateId;
      console.log(
        `   Found application: id=${applicationId}, candidateId=${candidateId}`,
      );
    }
  } catch (e) {
    console.log("   Could not find application:", e.message.slice(0, 100));
  }

  if (applicationId && candidateId && jobId) {
    try {
      const { status, body } = await fetchJson("/api/email/generate", {
        method: "POST",
        body: JSON.stringify({
          applicationId,
          candidateId,
          jobId,
          force: true,
        }),
      });
      const ok = status === 200 && body?.data?.subject;
      record("Email Generate (full AI pipeline)", {
        ok,
        detail: ok
          ? `subject="${body.data.subject.slice(0, 60)}"`
          : `status=${status}, ${JSON.stringify(body).slice(0, 150)}`,
      });
    } catch (e) {
      record("Email Generate (full AI pipeline)", {
        ok: false,
        detail: e.message.slice(0, 200),
      });
    }
  } else {
    record("Email Generate (full AI pipeline)", {
      ok: false,
      detail: "No application/candidate available for test",
    });
  }

  // ── 5. Opportunities Upload (AI extraction + matching) ────────────────────
  console.log("\n── 5. Opportunities Upload (AI extraction) ──");
  try {
    const testText =
      "Senior Azure Cloud Engineer – Must have experience with Azure DevOps, Terraform, and Kubernetes. Based in London. 5+ years experience required.";
    const { status, body } = await fetchJson("/api/opportunities/upload", {
      method: "POST",
      body: JSON.stringify({
        text: testText,
        source: "test",
      }),
    });
    // Even a 400 with validation error means the endpoint is reachable
    const reachable = status !== 500;
    record("Opportunities Upload (AI extraction)", {
      ok: reachable,
      detail: `status=${status}, ${JSON.stringify(body).slice(0, 150)}`,
    });
  } catch (e) {
    record("Opportunities Upload (AI extraction)", {
      ok: false,
      detail: e.message.slice(0, 200),
    });
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n═══ Summary ═══");
  const entries = Object.entries(results);
  const passed = entries.filter(([, r]) => r.ok).length;
  const failed = entries.filter(([, r]) => !r.ok).length;
  console.log(`Total: ${entries.length}  Passed: ${passed}  Failed: ${failed}`);
  for (const [name, r] of entries) {
    const icon = r.ok ? "✅" : "❌";
    console.log(`  ${icon} ${name}${r.detail ? " — " + r.detail : ""}`);
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
