"use strict";
/**
 * _agentUtils.cjs
 *
 * Shared utilities used by the agent scripts (cvMatchDraftAgent, jdCandidateMatchAgent,
 * docusignLifecycleAgent, sendDraftsAgent, etc.).
 *
 * Prefix with _ so that it sorts first and is clearly not an entry-point script.
 */

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { execSync } = require("child_process");

// ── Env loading ──────────────────────────────────────────────────────────────

/**
 * Loads key=value pairs from a .env file into process.env.
 * Skips keys that are already set. Handles quoted values.
 */
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

/**
 * Loads .env.local then .env from the project root (parent of scripts/).
 * Call this once at the top of each agent script before reading env vars.
 */
function loadProjectEnv() {
  const root = path.resolve(__dirname, "..");
  loadEnvFile(path.join(root, ".env.local"));
  loadEnvFile(path.join(root, ".env"));
}

// ── Session minting ──────────────────────────────────────────────────────────

function signValue(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

/**
 * Mints a short-lived (1-hour) HMAC-signed session token for the given user
 * and tenant. The token format matches the app's session middleware.
 */
function mintSession(userId, tenantId, sessionSecret) {
  const payload = {
    uid: userId,
    tid: tenantId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = signValue(b64, sessionSecret);
  return `${b64}.${sig}`;
}

/**
 * Returns a Cookie header string ready for use in API calls.
 */
function buildCookieHeader(userId, tenantId, sessionSecret) {
  const token = mintSession(userId, tenantId, sessionSecret);
  return `tenantId=${tenantId}; appSession=${token}`;
}

// ── Container resolution ────────────────────────────────────────────────────

/**
 * Returns the name of the running app container.
 * Precedence: DOCKER_CONTAINER env → docker ps auto-discovery → hardcoded fallback.
 */
function resolveAppContainer() {
  if (process.env.DOCKER_CONTAINER) return process.env.DOCKER_CONTAINER;
  try {
    const names = execSync(
      'docker ps --filter "status=running" --format "{{.Names}}"',
      { encoding: "utf8", timeout: 5000 },
    )
      .split("\n")
      .filter((n) => n && n.includes("placements") && n.includes("-app-"));
    const prod = names.find((n) => n.includes("_prod"));
    if (prod) return prod;
    if (names.length > 0) return names[0];
  } catch (_) {}
  return "contract_placements_prod-app-1";
}

// ── Docker exec helper (script-file pattern) ─────────────────────────────────
// Avoids inline `node -e "..."` quoting issues and cmd.exe spawn overhead.
// Writes the script to a local temp file, docker-cp's it in, runs it with
// `-w /app` so node_modules resolve correctly, then cleans up both sides.

function dockerExecScript(container, scriptContent, timeoutMs = 30000) {
  const stamp = Date.now();
  const localTmp = path.join(__dirname, `../temp/_dexec_${stamp}.js`);
  const containerPath = `/app/_agent_${stamp}.js`;
  fs.mkdirSync(path.dirname(localTmp), { recursive: true });
  fs.writeFileSync(localTmp, scriptContent, "utf8");
  try {
    execSync(`docker cp "${localTmp}" ${container}:${containerPath}`, {
      encoding: "utf8",
      timeout: 10000,
    });
    return execSync(`docker exec -w /app ${container} node ${containerPath}`, {
      encoding: "utf8",
      timeout: timeoutMs,
    }).trim();
  } finally {
    try {
      fs.unlinkSync(localTmp);
    } catch (_) {}
    try {
      execSync(`docker exec ${container} rm -f ${containerPath}`, {
        encoding: "utf8",
        timeout: 5000,
      });
    } catch (_) {}
  }
}

// ── Admin user lookup ────────────────────────────────────────────────────────

/**
 * Fetches the first active ADMIN user for the given tenant by running a
 * Prisma query inside the running Docker container. Returns { id, email }.
 */
function getAdminUserViaDocker(tenantId, container) {
  const resolvedContainer = container ?? resolveAppContainer();
  const script = [
    "const { PrismaClient } = require('@prisma/client');",
    "const p = new PrismaClient();",
    `p.tenantUser.findFirst({ where: { tenantId: '${tenantId}', role: 'ADMIN', isActive: true }, select: { id: true, email: true } })`,
    ".then(u => { console.log(JSON.stringify(u)); process.exit(0); })",
    ".catch(e => { console.error(e.message); process.exit(1); });",
  ].join("\n");

  return JSON.parse(dockerExecScript(resolvedContainer, script));
}

module.exports = {
  loadEnvFile,
  loadProjectEnv,
  mintSession,
  buildCookieHeader,
  resolveAppContainer,
  dockerExecScript,
  getAdminUserViaDocker,
};
