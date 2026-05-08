// Probe deepseek-v4-flash:cloud with a realistic structured JSON prompt
const OLLAMA_BASE = "http://localhost:11434/v1";
const model = "deepseek-v4-flash:cloud";

const sysPrompt = `You are an expert CV formatter. Convert the raw CV sections into a well-structured ATS-optimised CV.
Return strict JSON only with the following keys: summary, experience (array), education (array), skills (array), certifications (array).`;

const userPrompt = `RAW CV:
John Smith
Senior Software Engineer

EXPERIENCE:
- Acme Corp (2020-2024): Led backend team, Node.js, TypeScript, AWS
- Startup XYZ (2018-2020): Full-stack developer React, Python

EDUCATION:
- BSc Computer Science, University of Cape Town, 2018

SKILLS:
TypeScript, Node.js, React, AWS, Docker, PostgreSQL

Return JSON: { "summary": "...", "experience": [...], "education": [...], "skills": [...], "certifications": [] }`;

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
      max_tokens: 2048,
      messages: [
        { role: "system", content: sysPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  const d = await res.json();
  const content = d.choices?.[0]?.message?.content ?? "(empty)";
  const reasoning = d.choices?.[0]?.message?.reasoning ?? "";
  const finishReason = d.choices?.[0]?.finish_reason;
  console.log(`finish_reason: ${finishReason}`);
  console.log(
    `content length: ${content.length}, first 200: ${String(content).slice(0, 200)}`,
  );
  console.log(`reasoning length: ${String(reasoning).length}`);
} catch (e) {
  console.error("FAIL:", e.message);
}
