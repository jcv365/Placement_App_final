const url = "http://litellm-gateway:4001/v1/chat/completions";
const key = "sk-WYyjZwVwjE9PoP3W8C_YGrAsV-DrFanjS5LDPSvVWy4";
async function main() {
  console.log("Testing email-generation with long prompt...");
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({
        model: "email-generation",
        messages: [
          { role: "system", content: "You write professional outreach emails in British English. Return JSON with { subject, html }." },
          { role: "user", content: "Write a professional B2B email introducing Tanyaradzwa Tanatswa Mushonga as a Senior Backend Engineer for a remote contract role. The sender is DotCloud Consulting. The candidate has 8+ years of experience in .NET, Azure, and microservices. Output JSON with subject and html fields. 200-280 words." }
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
      console.log("Model:", data.auto_router?.classified_as || data.model || "?");
      const content = data.choices?.[0]?.message?.content || "";
      console.log("Content length:", content.length);
      console.log("Content preview:", content.slice(0, 300));
    } catch(e) {
      console.log("Raw:", text.slice(0, 500));
    }
  } catch(e) {
    console.error("Error:", e.message);
  }
}
main();
