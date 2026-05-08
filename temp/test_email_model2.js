const url = "http://litellm-gateway:4001/v1/chat/completions";
const key = "sk-WYyjZwVwjE9PoP3W8C_YGrAsV-DrFanjS5LDPSvVWy4";
async function main() {
  console.log("Testing email-generation model with JSON output...");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({
      model: "email-generation",
      messages: [
        { role: "system", content: "You write professional outreach emails. Always respond with a JSON object containing 'subject' and 'html' keys." },
        { role: "user", content: "Write a short email introducing a Senior .NET Developer named Jonathan Wagener to a client for a remote role. Output JSON with subject and html fields." }
      ],
      max_tokens: 800,
      temperature: 0.3
    })
  });
  console.log("Status:", res.status);
  const text = await res.text();
  console.log("Body:", text.slice(0, 2000));
}
main().catch(e => console.error(e));
