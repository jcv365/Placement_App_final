const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  // Test the raw Ollama call that the app would make
  const apiBase = process.env.OPENAI_API_BASE || process.env.LLMLITE_API_BASE;
  const apiKey = process.env.OPENAI_API_KEY || process.env.LLMLITE_API_KEY;
  const model = process.env.OPENAI_MODEL || process.env.LITELLM_MODEL || "auto";
  console.log("Config:", { apiBase, apiKey: apiKey?.slice(0,10) + "...", model });
  
  const start = Date.now();
  try {
    const res = await fetch(`${apiBase}/chat/completions`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: 200,
        messages: [
          { role: "system", content: "You write professional emails. Return JSON with { subject, html }." },
          { role: "user", content: "Write a 1-sentence email introducing a developer. Output JSON." },
        ],
      }),
    });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log("Status:", res.status, "Time:", elapsed + "s");
    const text = await res.text();
    console.log("Response:", text.slice(0, 500));
  } catch(e) {
    console.error("Fetch error:", e.message);
  }
  await p.$disconnect();
}
main();
