// Read actual env vars
const apiBase = process.env.LLMLITE_API_BASE || "http://host.docker.internal:4001/v1";
const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || "email-generation";

// Use same system prompt structure as production
const systemPrompt = `SYSTEM ROLE
You are a senior professional services consultant drafting a concise, direct B2B candidate-submission email in British English. You propose a named delivery resource for a client contract.

HARD CONSTRAINTS:
1. Return JSON with exactly: { "subject": "...", "html": "..." }
2. Do not return any other text outside the JSON.
3. The html value must contain only Outlook-safe HTML using <p>, <br>, <strong>, <em>.`;

const userPrompt = `JOB DESCRIPTION:
Cloud Engineer role at Stott and May. Outside IR35. 12-month contract. Azure, Terraform, Kubernetes required.

CANDIDATE CV SUMMARY:
Kgomotso Sello Dungeni. 8+ years cloud infrastructure. Azure Expert, Terraform, Docker, Kubernetes. Active Azure certifications (AZ-104, AZ-305).

JD-TO-CV ALIGNMENT AND GAPS:
Strong Azure match. Gap: no direct Kubernetes production ops experience documented.

CONTEXT:
- Hiring company: Stott and May
- Role title: Cloud Engineer
- Candidate full name: Kgomotso Sello Dungeni
- Sender company: DotCloud Consulting
- Preferred email length: 200-280 words

DRAFT THE EMAIL:

1. SUBJECT: Cloud Engineer – B2B / Outside IR35 – Kgomotso Sello Dungeni
2. GREETING: Hi,
...draft the full email...

Return JSON with exactly: { "subject": "...", "html": "..." }`;

async function run() {
  console.log("Sending to:", apiBase + "/chat/completions");
  const response = await fetch(`${apiBase}/chat/completions`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: 1200,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
    }),
  });
  console.log("Status:", response.status);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";
  console.log("=== RAW CONTENT (first 500 chars) ===");
  console.log(content.substring(0, 500));
  console.log("=== STARTS WITH ===");
  console.log(JSON.stringify(content.substring(0, 20)));
}
run().catch(e => console.error("ERR:", e.message));
