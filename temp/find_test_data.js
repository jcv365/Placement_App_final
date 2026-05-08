/**
 * Direct test of all AI/LLM functions in the codebase.
 * Runs inside the Docker container.
 */
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

// ── Import AI libs ──────────────────────────────────────────────────────────
const { generateStructuredJson } = require("../src/lib/aiJson");
const { generateEmail } = require("../src/lib/azureOpenAi");
const { generateEmailViaGithubModels } = require("../src/lib/githubModels");
const { generateEmailViaCopilotStudio } = require("../src/lib/copilotStudio");
const { inferMetadataFromUploadedText } = require("../src/lib/aiMetadata");
const { checkEmailFactuality } = require("../src/lib/emailFactualityGuard");
const {
  validateCandidateJobMatch,
} = require("../src/lib/matchValidationAgent");
const {
  isAiGatewayConfigured,
  resolveAiGatewayConfig,
} = require("../src/lib/liteLlm");

const results = {};

function record(name, outcome) {
  results[name] = outcome;
  const icon = outcome.ok ? "✅" : "❌";
  console.log(
    `${icon} ${name}: ${outcome.ok ? "PASS" : "FAIL"}${outcome.detail ? " — " + outcome.detail : ""}`,
  );
}

async function main() {
  console.log("\n═══ AI / LLM Function Test Suite ═══\n");

  // ── 1. Gateway configuration ───────────────────────────────────────────────
  console.log("── 1. LiteLLM Gateway Configuration ──");
  try {
    const configured = isAiGatewayConfigured();
    const config = resolveAiGatewayConfig();
    record("LiteLLM Gateway Configured", {
      ok: configured,
      detail: configured ? `apiBase=${config.apiBase}` : "Not configured",
    });
  } catch (e) {
    record("LiteLLM Gateway Configured", { ok: false, detail: e.message });
  }

  // ── 2. generateStructuredJson (core AI function) ──────────────────────────
  console.log("\n── 2. generateStructuredJson ──");
  try {
    const result = await generateStructuredJson({
      systemPrompt: "You are a test assistant. Return strict JSON only.",
      userPrompt: 'Return JSON: {"status":"ok","message":"AI is working"}',
      maxTokens: 100,
      temperature: 0,
    });
    const ok = result && result.status === "ok";
    record("generateStructuredJson", {
      ok,
      detail: ok
        ? `status=${result.status}`
        : `unexpected: ${JSON.stringify(result).slice(0, 120)}`,
    });
  } catch (e) {
    record("generateStructuredJson", {
      ok: false,
      detail: e.message.slice(0, 200),
    });
  }

  // ── 3. generateEmail (azureOpenAi) ────────────────────────────────────────
  console.log("\n── 3. generateEmail (azureOpenAi) ──");
  try {
    const result = await generateEmail({
      systemPrompt:
        "You are an email drafting assistant. Return JSON with subject and html keys.",
      userPrompt:
        'Draft a short test email for candidate "John Doe" applying for "Software Engineer" at "Acme Corp". Return JSON: {"subject":"...","html":"..."}',
      maxOutputTokens: 500,
    });
    const ok = result && result.subject && result.html;
    record("generateEmail (azureOpenAi)", {
      ok,
      detail: ok
        ? `subject="${result.subject.slice(0, 60)}"`
        : "missing subject or html",
    });
  } catch (e) {
    record("generateEmail (azureOpenAi)", {
      ok: false,
      detail: e.message.slice(0, 200),
    });
  }

  // ── 4. generateEmailViaGithubModels ──────────────────────────────────────
  console.log("\n── 4. generateEmailViaGithubModels ──");
  try {
    const result = await generateEmailViaGithubModels({
      systemPrompt:
        "You are an email drafting assistant. Return JSON with subject and html keys.",
      userPrompt:
        'Draft a short test email for candidate "Jane Smith" applying for "Data Analyst" at "Beta Ltd". Return JSON: {"subject":"...","html":"..."}',
      maxOutputTokens: 500,
    });
    const ok = result && result.subject && result.html;
    record("generateEmailViaGithubModels", {
      ok,
      detail: ok
        ? `subject="${result.subject.slice(0, 60)}"`
        : "missing subject or html",
    });
  } catch (e) {
    record("generateEmailViaGithubModels", {
      ok: false,
      detail: e.message.slice(0, 200),
    });
  }

  // ── 5. generateEmailViaCopilotStudio ──────────────────────────────────────
  console.log("\n── 5. generateEmailViaCopilotStudio ──");
  try {
    const result = await generateEmailViaCopilotStudio({
      systemPrompt:
        "You are an email drafting assistant. Return JSON with subject and html keys.",
      userPrompt:
        'Draft a short test email for candidate "Bob Lee" applying for "Project Manager" at "Gamma Inc". Return JSON: {"subject":"...","html":"..."}',
    });
    const ok = result && result.subject && result.html;
    record("generateEmailViaCopilotStudio", {
      ok,
      detail: ok
        ? `subject="${result.subject.slice(0, 60)}"`
        : "missing subject or html",
    });
  } catch (e) {
    const notConfigured = /Missing Copilot Studio configuration/i.test(
      e.message,
    );
    record("generateEmailViaCopilotStudio", {
      ok: notConfigured,
      detail: notConfigured
        ? "Not configured (optional provider)"
        : e.message.slice(0, 200),
    });
  }

  // ── 6. inferMetadataFromUploadedText ──────────────────────────────────────
  console.log("\n── 6. inferMetadataFromUploadedText ──");
  try {
    const result = await inferMetadataFromUploadedText({
      jobText:
        "Senior Azure Cloud Engineer – Must have experience with Azure DevOps, Terraform, and Kubernetes. Based in London.",
      candidateText:
        "Thabo Mokoena\nAzure Certified Engineer\n5 years experience with Terraform and AKS\nthabo@example.com",
    });
    const ok = result && (result.roleTitle || result.candidateName);
    record("inferMetadataFromUploadedText", {
      ok: !!ok,
      detail: ok
        ? `roleTitle="${result.roleTitle}", candidateName="${result.candidateName}"`
        : "no metadata returned",
    });
  } catch (e) {
    record("inferMetadataFromUploadedText", {
      ok: false,
      detail: e.message.slice(0, 200),
    });
  }

  // ── 7. checkEmailFactuality ───────────────────────────────────────────────
  console.log("\n── 7. checkEmailFactuality ──");
  try {
    const result = await checkEmailFactuality({
      emailHtml:
        "<p>Thabo Mokoena is an Azure Certified Engineer with 5 years of Terraform and AKS experience.</p>",
      jdText:
        "Senior Azure Cloud Engineer – Must have experience with Azure DevOps, Terraform, and Kubernetes. Based in London.",
      cvText:
        "Thabo Mokoena\nAzure Certified Engineer\n5 years experience with Terraform and AKS\nthabo@example.com",
      roleTitle: "Senior Azure Cloud Engineer",
      candidateName: "Thabo Mokoena",
      companyName: "Acme Corp",
    });
    const ok =
      typeof result.pass === "boolean" && typeof result.score === "number";
    record("checkEmailFactuality", {
      ok,
      detail: ok
        ? `pass=${result.pass}, score=${result.score}, hallucinated=${result.hallucinatedClaims.length}`
        : "unexpected result shape",
    });
  } catch (e) {
    record("checkEmailFactuality", {
      ok: false,
      detail: e.message.slice(0, 200),
    });
  }

  // ── 8. validateCandidateJobMatch ──────────────────────────────────────────
  console.log("\n── 8. validateCandidateJobMatch ──");
  try {
    const result = await validateCandidateJobMatch({
      jobTitle: "Senior Azure Cloud Engineer",
      jobText:
        "Senior Azure Cloud Engineer – Must have experience with Azure DevOps, Terraform, and Kubernetes. Based in London. Must have 5+ years experience.",
      candidateSuggestedRoles: "Azure Cloud Engineer, DevOps Engineer",
      candidateSkills: "Azure, Terraform, Kubernetes, AKS, Azure DevOps",
      candidateCertifications: "Azure Certified Engineer",
      candidateCvText:
        "Thabo Mokoena\nAzure Certified Engineer\n5 years experience with Terraform and AKS\nBuilt CI/CD pipelines with Azure DevOps\nthabo@example.com",
    });
    const ok =
      typeof result.matched === "boolean" &&
      typeof result.confidence === "number";
    record("validateCandidateJobMatch", {
      ok,
      detail: ok
        ? `matched=${result.matched}, confidence=${result.confidence}, matchType=${result.matchType}`
        : "unexpected result shape",
    });
  } catch (e) {
    record("validateCandidateJobMatch", {
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

  await p.$disconnect();
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
