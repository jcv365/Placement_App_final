const http = require("http");

// Capture what the API returns after parsing
const apiReq = http.request({
  hostname: "127.0.0.1",
  port: 3000,
  path: "/api/email/generate",
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Cookie": "tenantId=dotcloudconsulting"
  }
}, (res) => {
  let body = "";
  res.on("data", c => body += c);
  res.on("end", () => {
    console.log("Status:", res.statusCode);
    try {
      const parsed = JSON.parse(body);
      console.log("Parsed:", JSON.stringify(parsed, null, 2).substring(0, 1000));
    } catch(e) {
      console.log("Raw:", body.substring(0, 1000));
    }
  });
});
const payload = JSON.stringify({
  "jobId": "cmo784gj6002wqt0186wtfqn7",
  "candidateId": "cmnyjur6x0000qh013fz2bo4o",
  "applicationId": "cmo78bofs005eqt01528jbetw"
});
apiReq.setHeader("Content-Length", Buffer.byteLength(payload));
apiReq.write(payload);
apiReq.end();
