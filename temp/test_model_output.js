const url = "http://ollama-ollama-1:11434/v1/chat/completions";
async function main() {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "qwen:latest",
      temperature: 0.3,
      max_tokens: 1200,
      messages: [
        { role: "system", content: "You are a senior professional services consultant drafting a concise B2B candidate-submission email in British English. Return JSON with exactly { subject, html }." },
        { role: "user", content: "Write a short email introducing Jonathan Wagener as a Senior .NET Developer for a remote role. Sender: DotCloud Consulting. Output JSON with subject and html fields." }
      ],
    }),
  });
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || "";
  console.log("Content length:", content.length);
  console.log("Content:");
  console.log(content);
  // Try to parse as JSON
  try {
    const jsonStr = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const start = jsonStr.indexOf("{");
    const end = jsonStr.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(jsonStr.slice(start, end + 1));
      console.log("\nParsed OK! subject:", parsed.subject ? "YES" : "NO", "html:", parsed.html ? "YES" : "NO");
    } else {
      console.log("\nNo JSON object found in content");
    }
  } catch(e) {
    console.log("\nJSON parse failed:", e.message);
  }
}
main();
