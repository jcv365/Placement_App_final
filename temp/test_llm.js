const http = require("http");
const https = require("https");

// Test connectivity to LiteLLM gateway
const gatewayUrl =
  process.env.LLMLITE_API_BASE || "http://host.docker.internal:4001/v1";
const apiKey =
  process.env.OPENAI_API_KEY ||
  process.env.LLMLITE_API_KEY ||
  "sk-WYyjZwVwjE9PoP3W8C_YGrAsV-DrFanjS5LDPSvVWy4";

console.log("Gateway URL:", gatewayUrl);
console.log(
  "API Key set:",
  !!apiKey,
  apiKey ? apiKey.substring(0, 10) + "..." : "MISSING",
);

const payload = JSON.stringify({
  model: process.env.OPENAI_MODEL || "auto",
  max_tokens: 50,
  messages: [{ role: "user", content: "Say: test OK" }],
});

const url = new URL(gatewayUrl.replace(/\/$/, "") + "/chat/completions");
const mod = url.protocol === "https:" ? https : http;

const req = mod.request(
  {
    hostname: url.hostname,
    port: url.port || (url.protocol === "https:" ? 443 : 80),
    path: url.pathname,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
      Authorization: `Bearer ${apiKey}`,
    },
  },
  (res) => {
    let body = "";
    res.on("data", (c) => (body += c));
    res.on("end", () => {
      console.log("HTTP Status:", res.statusCode);
      console.log("Response:", body.substring(0, 500));
    });
  },
);
req.on("error", (e) => console.error("Connection error:", e.message));
req.write(payload);
req.end();
