// Probe available Ollama models for structured JSON capability
const OLLAMA_BASE = "http://localhost:11434/v1";
const models = [
  "deepseek-v4-flash:cloud",
  "glm-5.1:cloud",
  "qwen2.5:7b",
  "qwen2.5:3b",
  "gemma3:latest",
];

for (const model of models) {
  try {
    const res = await fetch(`${OLLAMA_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer ollama",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 200,
        messages: [
          { role: "system", content: "Return valid JSON only. No extra text." },
          {
            role: "user",
            content: 'Respond with exactly: {"ok":true,"name":"test"}',
          },
        ],
      }),
    });
    const d = await res.json();
    const content = d.choices?.[0]?.message?.content?.trim() ?? "(empty)";
    const reasoning = d.choices?.[0]?.message?.reasoning?.trim() ?? "";
    console.log(
      `${model} => HTTP ${res.status} | content: ${content.slice(0, 120)} | reasoning_len: ${reasoning.length}`,
    );
  } catch (e) {
    console.log(`${model} FAIL: ${e.message.slice(0, 80)}`);
  }
}
