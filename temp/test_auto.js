const url = "http://litellm-gateway:4001/v1/chat/completions";
const key = "sk-WYyjZwVwjE9PoP3W8C_YGrAsV-DrFanjS5LDPSvVWy4";
async function main() {
  console.log("Testing model=auto (what the app uses)...");
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({
        model: "auto",
        messages: [
          { role: "system", content: "You write professional outreach emails in British English. Return JSON with { subject, html }." },
          { role: "user", content: "Write a short 2-sentence email introducing a Senior .NET Developer named Jonathan Wagener for a remote contract role. Sender: DotCloud Consulting. Output JSON." }
        ],
        max_tokens: 1200,
        temperature: 0.3
      })
    });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log("Status:", res.status, "Time:", elapsed + "s");
    const text = await res.text();
    try {
      const data = JSON.parse(text);
      console.log("Model routed to:", data.auto_router?.classified_as || "unknown");
      const content = data.choices?.[0]?.message?.content || "";
      console.log("Content length:", content.length);
      console.log("Content preview:", content.slice(0, 500));
    } catch(e) {
      console.log("Raw body:", text.slice(0, 500));
    }
  } catch(e) {
    console.error("Error:", e.message);
  }
}
main();
