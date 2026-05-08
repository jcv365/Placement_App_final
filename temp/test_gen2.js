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
    "Content-Length": Buffer.byteLength(payload),
    "Cookie": "tenantId=dotcloudconsulting"
  }
}, (res) => {
  let body = "";
  res.on("data", chunk => body += chunk);
  res.on("end", () => {
    console.log("STATUS:", res.statusCode);
    try {
      const data = JSON.parse(body);
      if (data.error) { console.log("ERROR:", JSON.stringify(data.error)); return; }
      console.log("=== SUBJECT ===");
      console.log(data.subject || "(none)");
      console.log("\n=== BODY ===");
      // Strip HTML tags for readability
      const text = (data.body || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\n\n+/g, "\n\n").trim();
      console.log(text);
      console.log("\n=== RAW HTML (first 500 chars) ===");
      console.log((data.body || "").substring(0, 500));
    } catch(e) {
      console.log("RAW:", body.substring(0, 3000));
    }
  });
});
req.on("error", e => { console.error("Request error:", e.message); process.exit(1); });
req.write(payload);
req.end();
