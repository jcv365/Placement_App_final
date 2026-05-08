const apiBase = process.env.LLMLITE_API_BASE || "http://host.docker.internal:4001/v1";
const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || "email-generation";

// Force the system prompt to be very minimal to see fallback model behaviour
const systemPrompt = `You are drafting a B2B email. The user message tells you everything you need.

IMPORTANT: Return JSON only: {"subject":"...","html":"..."}
No other text before or after the JSON.`;

const userPrompt = `Draft a B2B candidate-submission email:
- Candidate: Kgomotso Sello Dungeni, Cloud Engineer, 8+ years Azure
- Role: Cloud Engineer at Stott and May, Outside IR35
- Sender: DotCloud Consulting
- Recipient: Hiring Manager (no name known)

Return JSON only: {"subject": "...", "html": "..."}`;

async function run() {
  for (let i = 0; i < 3; i++) {
    console.log(`\n=== Request ${i+1} ===`);
    const response = await fetch(`${apiBase}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ model, temperature: 0.3, max_tokens: 800, messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]}),
    });
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    console.log("First 100 chars:", JSON.stringify(content.substring(0, 100)));
    const isJson = content.trim().startsWith("{") || content.trim().startsWith("```");
    console.log("JSON format:", isJson);
  }
}
run().catch(e => console.error("ERR:", e.message));
