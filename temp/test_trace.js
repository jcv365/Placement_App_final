const http = require("http");
const https = require("https");

// Patch fetch to log calls
const origFetch = global.fetch;
global.fetch = async function(...args) {
  const url = args[0]?.toString() || args[0];
  const method = args[1]?.method || "GET";
  console.log(`FETCH ${method} ${url}`);
  try {
    const res = await origFetch(...args);
    console.log(`  -> ${res.status}`);
    return res;
  } catch(e) {
    console.log(`  -> ERROR: ${e.message}`);
    throw e;
  }
};

// Load just the route handler entry point indirectly via the built app
// We cannot directly require TS, so test via the HTTP API instead
const apiReq = http.request({
  hostname: "127.0.0.1",
  port: 3000,
  path: "/api/email/generate",
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength('{"jobId":"cmo784gj6002wqt0186wtfqn7","candidateId":"cmnyjur6x0000qh013fz2bo4o","applicationId":"cmo78bofs005eqt01528jbetw"}'),
    "Cookie": "tenantId=dotcloudconsulting"
  }
}, (res) => {
  let body = "";
  res.on("data", c => body += c);
  res.on("end", () => {
    console.log("Response status:", res.statusCode);
    console.log("Response:", body.substring(0, 500));
  });
});
apiReq.write('{"jobId":"cmo784gj6002wqt0186wtfqn7","candidateId":"cmnyjur6x0000qh013fz2bo4o","applicationId":"cmo78bofs005eqt01528jbetw"}');
apiReq.end();
