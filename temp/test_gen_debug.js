const apiBase = process.env.LLMLITE_API_BASE || "http://host.docker.internal:4001/v1";
const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || "email-generation";

console.log("apiBase:", apiBase);
console.log("apiKey present:", !!apiKey);
console.log("model:", model);

async function run() {
  try {
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
          { role: "system", content: 'Return JSON: {"subject":"Test","html":"<p>ok</p>"}' },
          { role: "user", content: "Generate test." }
        ],
      }),
    });
    console.log("Status:", response.status);
    if (!response.ok) {
      console.log("ERROR BODY:", await response.text());
      return;
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    console.log("Content:", content?.substring(0, 300));
  } catch(e) {
    console.log("EXCEPTION TYPE:", e.constructor.name);
    console.log("EXCEPTION MSG:", e.message);
    console.log("EXCEPTION STACK:", e.stack);
  }
}
run();
