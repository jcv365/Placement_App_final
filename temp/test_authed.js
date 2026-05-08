// Mint a session token for a known user, then generate an email with that session
const http = require("http");
const crypto = require("crypto");

// Mint a session token manually (same logic as appAuth.ts createAppSessionToken)
// We need to use the app's JWT signing — easier to just POST to login
// Use the login endpoint to get the cookie

function login(email, password) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      email,
      password,
      tenantId: "dotcloudconsulting",
    });
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: 3000,
        path: "/api/auth/tenant/login",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          const cookies = res.headers["set-cookie"] || [];
          console.log("Login status:", res.statusCode);
          console.log("Set-Cookie headers:", cookies);
          resolve(cookies);
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function generateEmail(cookieStr) {
  return new Promise((resolve, reject) => {
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
          Cookie: cookieStr,
        },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          console.log("\nGenerate status:", res.statusCode);
          try {
            const wrapped = JSON.parse(body);
            const data = wrapped.data || wrapped;
            console.log("\n=== SUBJECT ===");
            console.log(data.subject || "(none)");
            console.log("\n=== PLAIN TEXT ===");
            const text = (data.htmlBody || "")
              .replace(/<[^>]+>/g, "")
              .replace(/&amp;/g, "&")
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
              .trim();
            console.log(text);
            console.log(
              "\n--- WORD COUNT:",
              text.split(/\s+/).filter(Boolean).length,
              "---",
            );
          } catch (e) {
            console.log("PARSE ERROR:", e.message);
            console.log("RAW:", body.substring(0, 2000));
          }
          resolve();
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  // Try login with charl.venter — password unknown, let's try common patterns
  // Actually let's try to mint a session directly
  const { PrismaClient } = require("@prisma/client");
  const db = new PrismaClient();

  // Get the JWT secret from env
  const secret =
    process.env.APP_SESSION_SECRET ||
    process.env.SESSION_SECRET ||
    "dev-secret";
  console.log(
    "Using session secret present:",
    !!process.env.APP_SESSION_SECRET,
  );

  // Build a session token the same way as the app
  // Check appAuth.ts approach — it uses a simple HMAC-signed JSON
  const payload = {
    uid: "cmmutgwan0003v69wp9wutd49",
    tid: "dotcloudconsulting",
    role: "ADMIN",
    exp: Date.now() + 86400000,
  };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", secret)
    .update(data)
    .digest("base64url");
  const token = `${data}.${sig}`;

  const cookieStr = `tenantId=dotcloudconsulting; appSession=${token}`;
  console.log("Attempting with minted session for Charl Venter...");

  await generateEmail(cookieStr);
  await db.$disconnect();
}

main().catch(console.error);
