// Call the repair-drafts API from inside the container with a valid admin session
const crypto = require("node:crypto");

function base64UrlEncode(input) {
  return Buffer.from(input, "utf8").toString("base64url");
}

function signValue(value) {
  const secret =
    process.env.APP_SESSION_SECRET?.trim() ||
    process.env.ADMIN_SESSION_SECRET?.trim() ||
    "local-admin-session-secret";
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function createAdminSessionTokenForTenant(username, tenantId) {
  const payload = {
    u: username.trim(),
    t: tenantId.trim().toLowerCase(),
    exp: Date.now() + 24 * 60 * 60 * 1000,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signValue(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

async function main() {
  const token = createAdminSessionTokenForTenant("admin", "dotcloudconsulting");
  console.log("Admin session token created.");

  const start = Date.now();
  const res = await fetch("http://localhost:3000/api/email/repair-drafts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `adminSession=${token}`,
    },
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Status: ${res.status} Time: ${elapsed}s`);

  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
