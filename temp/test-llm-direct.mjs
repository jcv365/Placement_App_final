/**
 * Direct LLM Model Test Suite
 * Tests deepseek-v4-flash:cloud directly via the Ollama gateway
 * for each type of structured/unstructured request the app makes
 */
const API_BASE = "http://localhost:11434/v1";
const MODEL = "deepseek-v4-flash:cloud";
const API_KEY = "ollama";

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

async function callLlm(systemPrompt, userPrompt, maxTokens = 4096) {
  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0,
      max_tokens: maxTokens,
    }),
  });
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  const finishReason = data.choices?.[0]?.finish_reason;
  if (!content || content.trim().length === 0) {
    throw new Error(
      `Empty content | finish_reason: ${finishReason} | usage: ${JSON.stringify(data.usage)}`,
    );
  }
  return { content, finishReason, usage: data.usage };
}

function extractJson(raw) {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  if (!trimmed.includes("{")) return trimmed;
  return trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1);
}

async function main() {
  console.log(
    "=== Direct LLM Model Test Suite (deepseek-v4-flash:cloud) ===\n",
  );

  // T1: Simple JSON extraction (like inferMetadataFromUploadedText)
  await test("T1: Metadata extraction (JSON)", async () => {
    const r = await callLlm(
      "You are a metadata extraction assistant. Return only valid JSON.",
      "Extract the role title and candidate name from this job description: 'Senior DevOps Engineer – We are looking for John Smith to join our team. Must have AWS and CI/CD experience.' Return JSON with keys: role, candidateName.",
    );
    const json = JSON.parse(extractJson(r.content));
    return `Role: ${json.role} | Name: ${json.candidateName} | Tokens: ${r.usage?.completion_tokens}`;
  });

  // T2: Email generation (unstructured, long-form)
  await test("T2: Email generation (unstructured)", async () => {
    const r = await callLlm(
      "You are a professional email writer for a recruitment agency. Write a placement email introducing a candidate to a client. Use British English. Return the email as plain text.",
      "Write a professional placement email for: Candidate: Jeanre Swanepoel, Senior DevOps Engineer with 20 years experience in AWS, CI/CD, Kubernetes. Client: Dot Cloud Consulting. Role: Senior DevOps Engineer. The candidate has excellent CI/CD and infrastructure-as-code skills.",
      8192,
    );
    return `Length: ${r.content.length} | Preview: ${r.content.slice(0, 100)} | Tokens: ${r.usage?.completion_tokens}`;
  });

  // T3: Match validation (structured JSON with scoring)
  await test("T3: Match validation (JSON scoring)", async () => {
    const r = await callLlm(
      "You are a candidate-job matching assistant. Evaluate the match between a candidate and a job. Return only valid JSON with keys: score (0-100), rationale (string), decision (PASS/FAIL).",
      "Candidate: Senior DevOps Engineer with 20 years AWS, CI/CD, Kubernetes, Terraform experience. Job: Senior DevOps Engineer requiring AWS, CI/CD, infrastructure-as-code, 10+ years experience. Evaluate the match.",
    );
    const json = JSON.parse(extractJson(r.content));
    return `Score: ${json.score} | Decision: ${json.decision} | Tokens: ${r.usage?.completion_tokens}`;
  });

  // T4: CV formatting (structured JSON with sections)
  await test("T4: CV formatting (JSON sections)", async () => {
    const r = await callLlm(
      "You are a CV formatting assistant for ATS systems. Parse the raw CV text and return structured JSON with keys: sections (array of {title: string, items: string[]}), skills (string[]), certifications (string[]). Return only valid JSON.",
      "Format this CV:\n\nJEANRE SWANEPoEL\nSenior DevOps Engineer\n\nEXPERIENCE\n- 20 years in AWS, CI/CD, Kubernetes, Terraform\n- Led infrastructure teams at multiple enterprises\n- Built multi-region deployment pipelines\n\nSKILLS\nAWS, CI/CD, Kubernetes, Terraform, Docker, Ansible, Jenkins, Git\n\nCERTIFICATIONS\nAWS Solutions Architect Professional, Certified Kubernetes Administrator\n\nEDUCATION\nBSc Computer Science, University of Pretoria",
      16384,
    );
    const json = JSON.parse(extractJson(r.content));
    return `Sections: ${json.sections?.length || 0} | Skills: ${json.skills?.length || 0} | Certs: ${json.certifications?.length || 0} | Tokens: ${r.usage?.completion_tokens}`;
  });

  // T5: British English correction
  await test("T5: British English correction (JSON)", async () => {
    const r = await callLlm(
      "You are a British English spelling and grammar corrector. Return only valid JSON with key: corrected (string).",
      "Correct this text to British English: 'The candidate has organized the program and analyzed the behavior patterns. They specialize in color theory and have optimized their modeling approach.'",
    );
    const json = JSON.parse(extractJson(r.content));
    return `Corrected: ${json.corrected?.slice(0, 150) || "N/A"} | Tokens: ${r.usage?.completion_tokens}`;
  });

  // T6: Company name resolution (JSON)
  await test("T6: Company resolution (JSON)", async () => {
    const r = await callLlm(
      "You are a company name resolution assistant. Given an informal or partial company name, return the official company name. Return only valid JSON with key: resolvedName (string).",
      "Resolve this company name: 'MSFT' or 'Microsoft Corp'",
    );
    const json = JSON.parse(extractJson(r.content));
    return `Resolved: ${json.resolvedName} | Tokens: ${r.usage?.completion_tokens}`;
  });

  // T7: Email factuality check (JSON)
  await test("T7: Factuality check (JSON)", async () => {
    const r = await callLlm(
      "You are an email factuality checker. Verify that claims in an email are supported by the provided context. Return only valid JSON with keys: factual (boolean), score (0-100), issues (string[]).",
      "Context: Candidate Jeanre Swanepoel is a Senior DevOps Engineer with 20 years experience in AWS and CI/CD. Email claims: 'Jeanre has 15 years of Python development experience and is a certified Java developer.' Check factuality.",
    );
    const json = JSON.parse(extractJson(r.content));
    return `Factual: ${json.factual} | Score: ${json.score} | Issues: ${json.issues?.length || 0} | Tokens: ${r.usage?.completion_tokens}`;
  });

  // T8: Candidate profile inference (JSON with skills/roles)
  await test("T8: Candidate profile inference (JSON)", async () => {
    const r = await callLlm(
      "You are a candidate profile extraction assistant. Extract skills, certifications, and suggested roles from a CV. Return only valid JSON with keys: skills (string[]), certifications (string[]), suggestedRoles (string[]).",
      "Extract profile from this CV:\n\nJEANRE SWANEPoEL\nSenior DevOps Engineer\n\nSKILLS: AWS, CI/CD, Kubernetes, Terraform, Docker, Ansible, Jenkins, Git, Python, Bash\nCERTIFICATIONS: AWS Solutions Architect Professional, CKA\nEXPERIENCE: 20 years in cloud infrastructure and DevOps",
      8192,
    );
    const json = JSON.parse(extractJson(r.content));
    return `Skills: ${json.skills?.length || 0} | Certs: ${json.certifications?.length || 0} | Roles: ${json.suggestedRoles?.length || 0} | Tokens: ${r.usage?.completion_tokens}`;
  });

  // T9: Large CV formatting (stress test)
  await test("T9: Large CV formatting (stress test)", async () => {
    const longCv =
      "HEINRICH MULLER\nNetwork Security Architect\n\nEXPERIENCE\n" +
      Array.from(
        { length: 20 },
        (_, i) =>
          `- ${2010 + i}: Led security architecture at Enterprise ${i + 1}. Implemented zero-trust networks, SIEM systems, and compliance frameworks.`,
      ).join("\n") +
      "\n\nSKILLS\nNetwork Security, Zero Trust, SIEM, Firewalls, IDS/IPS, VPN, PKI, Compliance, Risk Assessment, Incident Response, Cloud Security, AWS Security, Azure Security\n\nCERTIFICATIONS\nCISSP, CISM, CEH, CCSP, AWS Security Specialty\n\nEDUCATION\nMSc Information Security, University of Cape Town";
    const r = await callLlm(
      "You are a CV formatting assistant for ATS systems. Parse the raw CV text and return structured JSON with keys: sections (array of {title: string, items: string[]}), skills (string[]), certifications (string[]). Return only valid JSON.",
      `Format this CV:\n\n${longCv}`,
      16384,
    );
    const json = JSON.parse(extractJson(r.content));
    return `Sections: ${json.sections?.length || 0} | Skills: ${json.skills?.length || 0} | Tokens: ${r.usage?.completion_tokens}`;
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
