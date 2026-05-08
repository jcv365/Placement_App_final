const http = require("http");

const payload = JSON.stringify({
  jobId: "cmo784gj6002wqt0186wtfqn7",
  candidateId: "cmnyjur6x0000qh013fz2bo4o",
  applicationId: "cmo78bofs005eqt01528jbetw"
});

const req = http.request({
  hostname: "127.0.0.1",
  port: 3000,
  path: "/api/email/generate",
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload)
  }
}, (res) => {
  let body = "";
  res.on("data", chunk => body += chunk);
  res.on("end", () => {
    console.log("STATUS:", res.statusCode);
    try {
      const data = JSON.parse(body);
      console.log("=== SUBJECT ===\n" + (data.subject || "(none)"));
      console.log("\n=== BODY ===\n" + (data.body || "(none)"));
      if (data.error) console.log("ERROR:", JSON.stringify(data.error));
    } catch(e) {
      console.log("RAW:", body.substring(0, 2000));
    }
  });
});
req.on("error", e => { console.error("Request error:", e.message); process.exit(1); });
req.write(payload);
req.end();
