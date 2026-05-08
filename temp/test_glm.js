const model = process.argv[2] || "glm-5.1:cloud";
const url = "http://ollama-ollama-1:11434/v1/chat/completions";

const body = {
  model,
  temperature: 0.3,
  max_tokens: 4096,
  messages: [
    {
      role: "system",
      content:
        "You are an email drafting assistant for DotCloud Consulting, a recruitment agency. You write professional, concise candidate introduction emails in British English. Return ONLY a JSON object with two fields: subject (string) and html (string with HTML markup).",
    },
    {
      role: "user",
      content:
        "Write a professional email introducing Tanyaradzwa Tanatswa Mushonga for a Senior Backend Engineer role. The role is remote. Sender is DotCloud Consulting. Return JSON with subject and html fields.",
    },
  ],
};

console.log(`Testing model: ${model}`);
const start = Date.now();
fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer ollama",
  },
  body: JSON.stringify(body),
})
  .then((r) => r.json())
  .then((d) => {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const c = d.choices?.[0]?.message?.content || "";
    const reasoning = d.choices?.[0]?.message?.reasoning || "";
    console.log("Time:", elapsed + "s");
    console.log("Finish reason:", d.choices?.[0]?.finish_reason);
    console.log("Content length:", c.length);
    console.log("Reasoning length:", reasoning.length);
    if (c) {
      console.log("Content:");
      console.log(c.slice(0, 500));
      console.log("Has subject:", c.includes('"subject"'));
      console.log("Has html:", c.includes('"html"'));
    } else if (reasoning) {
      console.log("Reasoning (first 300):", reasoning.slice(0, 300));
    }
  })
  .catch((e) => console.error("Fetch error:", e.message));
