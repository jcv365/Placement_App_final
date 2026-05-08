const url = process.argv[2] || "http://litellm-gateway:4001/v1/chat/completions";
const key = process.argv[3] || "sk-WYyjZwVwjE9PoP3W8C_YGrAsV-DrFanjS5LDPSvVWy4";
async function main() {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({ model: "auto", messages: [{ role: "user", content: "Say hello in one word" }], max_tokens: 10 })
  });
  console.log("Status:", res.status);
  const text = await res.text();
  console.log("Body:", text.slice(0, 500));
}
main().catch(e => console.error(e));
