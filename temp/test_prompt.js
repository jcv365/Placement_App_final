const http = require("http");
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient({ datasources: { db: { url: "file:/app/db/prod.db?connection_limit=1" } } });

const GATEWAY_URL = process.env.LLMLITE_API_BASE || "http://host.docker.internal:4001/v1";
const API_KEY = process.env.OPENAI_API_KEY || process.env.LLMLITE_API_KEY || "";
const MODEL = process.env.OPENAI_MODEL || "auto";

async function callLLM(systemPrompt, userPrompt) {
  const payload = JSON.stringify({
    model: MODEL,
    max_tokens: 1200,
    temperature: 0.3,
    messages: [
      { role: "system", content: systemPrompt.substring(0, 200) + "...[truncated]" },
      { role: "user", content: userPrompt.substring(0, 200) + "...[truncated]" }
    ]
  });
  console.log("Prompt system length:", systemPrompt.length, "chars");
  console.log("Prompt user length:", userPrompt.length, "chars");
  console.log("Model:", MODEL);
  
  return new Promise((resolve, reject) => {
    const url = new URL(GATEWAY_URL.replace(/\/$/, "") + "/chat/completions");
    const req = http.request({
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "Authorization": `Bearer ${API_KEY}`
      }
    }, (res) => {
      let body = "";
      res.on("data", c => body += c);
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  const job = await p.job.findUnique({
    where: { id: "cmo784gj6002wqt0186wtfqn7" },
    select: { id: true, title: true, rawText: true }
  });
  const cand = await p.candidate.findUnique({
    where: { id: "cmnyjur6x0000qh013fz2bo4o" },
    select: { id: true, fullName: true, rawCV: true }
  });
  
  console.log("Job:", job?.title, "| CV length:", cand?.rawCV?.length);
  
  const systemPrompt = `You are a B2B email writer. Return JSON with { "subject": "test", "html": "<p>test</p>" }.`;
  const userPrompt = `JOB: ${(job?.rawText || "").substring(0, 500)}\nCANDIDATE: ${(cand?.rawCV || "").substring(0, 500)}\nWrite a test email.`;
  
  const result = await callLLM(systemPrompt, userPrompt);
  console.log("Status:", result.status);
  console.log("Response:", result.body.substring(0, 800));
  
  await p.$disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });
