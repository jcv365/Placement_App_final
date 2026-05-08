const apiBase = process.env.LLMLITE_API_BASE || "http://host.docker.internal:4001/v1";
const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || "email-generation";

async function run() {
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
        { role: "system", content: "You are a professional services consultant drafting a B2B candidate-submission email. Return JSON with exactly: { \"subject\": \"...\", \"html\": \"...\" }. No other text." },
        { role: "user", content: "Draft an email proposing John Smith (Cloud Engineer, 8 years Azure experience) for a Cloud Infrastructure role at Acme Corp. UK contract outside IR35. Return JSON only." }
      ],
    }),
  });
  console.log("Status:", response.status);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  console.log("=== CONTENT START ===");
  console.log(content?.substring(0, 1000));
  console.log("=== CONTENT END ===");
}
run().catch(e => { console.error("ERR:", e.message); });
