const apiBase = "http://host.docker.internal:4001/v1";
const apiKey = process.env.OPENAI_API_KEY;
const model = "email-generation";

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
      max_tokens: 200,
      messages: [
        { role: "system", content: "Return JSON only: {\"subject\":\"test\",\"html\":\"<p>ok</p>\"}. No other text." },
        { role: "user", content: "Email for John Smith, Cloud Engineer, Stott & May client." }
      ],
    }),
  });
  console.log("Status:", response.status);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";
  console.log("First 200:", JSON.stringify(content.substring(0, 200)));
}
run().catch(e => console.error("ERR:", e.message));
