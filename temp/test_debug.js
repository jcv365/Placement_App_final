const http = require("http");
const payload = JSON.stringify({
  jobId: "cmo784gj6002wqt0186wtfqn7",
  candidateId: "cmnyjur6x0000qh013fz2bo4o",
  applicationId: "cmo78bofs005eqt01528jbetw",
});
const req = http.request(
  {
    hostname: "127.0.0.1",
    port: 3000,
    path: "/api/email/generate",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
      Cookie: "tenantId=dotcloudconsulting",
    },
  },
  (res) => {
    let body = "";
    res.on("data", (chunk) => (body += chunk));
    res.on("end", () => {
      console.log("STATUS:", res.statusCode);
      console.log("BODY:", body.substring(0, 2000));
    });
  },
);
req.on("error", (e) => console.error("ERROR:", e.message));
req.write(payload);
req.end();
