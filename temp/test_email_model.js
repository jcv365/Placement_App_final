const url = "http://litellm-gateway:4001/v1/chat/completions";
const key = "sk-WYyjZwVwjE9PoP3W8C_YGrAsV-DrFanjS5LDPSvVWy4";
async function main() {
  console.log("Testing email-generation model...");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({
      model: "email-generation",
      messages: [
        { role: "system", content: "You write professional outreach emails in British English." },
        { role: "user", content: "Write a short 2-sentence email introducing a Senior .NET Developer candidate to a client." }
      ],
      max_tokens: 200,
      temperature: 0.3
    })
  });
  console.log("Status:", res.status);
  const text = await res.text();
  console.log("Body:", text.slice(0, 1500));
}
main().catch(e => console.error(e));
