const apiBase = "http://host.docker.internal:4001/v1";
const apiKey = "sk-WYyjZwVwjE9PoP3W8C_YGrAsV-DrFanjS5LDPSvVWy4";
const model = "email-generation";

async function run() {
  console.log("Testing fetch to:", apiBase + "/chat/completions");
  try {
    const response = await fetch(`${apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: 100,
        messages: [
          { role: "system", content: "Reply with JSON: {\"subject\":\"test\",\"html\":\"<p>test</p>\"}" },
          { role: "user", content: "Generate test email." }
        ],
      }),
    });
    console.log("Status:", response.status);
    const text = await response.text();
    console.log("Body (first 300):", text.substring(0, 300));
  } catch(e) {
    console.log("FETCH ERROR:", e.message);
    console.log("Stack:", e.stack);
  }
}

run();
