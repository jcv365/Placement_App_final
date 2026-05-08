#!/usr/bin/env node
const http = require("node:http");

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) return fallback;
  return args[index + 1];
};

const listenHost = getArg("--listen-host", "192.168.1.161");
const listenPort = Number.parseInt(getArg("--listen-port", "8081"), 10);
const targetHost = getArg("--target-host", "127.0.0.1");
const targetPort = Number.parseInt(getArg("--target-port", "3000"), 10);
const maxBodyBytes = Number.parseInt(getArg("--max-body-bytes", "2097152"), 10);
const maxUrlLength = Number.parseInt(getArg("--max-url-length", "2048"), 10);
const maxHeaderBytes = Number.parseInt(
  getArg("--max-header-bytes", "8192"),
  10,
);
const rateLimitWindowMs = Number.parseInt(
  getArg("--rate-window-ms", "60000"),
  10,
);
const rateLimitMax = Number.parseInt(getArg("--rate-max", "120"), 10);
const upstreamTimeoutMs = Number.parseInt(
  getArg("--upstream-timeout-ms", "60000"),
  10,
);

const ALLOWED_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

const BLOCKED_PATH_PATTERNS = [
  /\.\./i,
  /%2e%2e/i,
  /\/\.env/i,
  /\/\.git/i,
  /\/\.svn/i,
  /\/wp-admin/i,
  /\/wp-login\.php/i,
  /\/phpmyadmin/i,
  /\/cgi-bin\//i,
  /\0/i,
];

const ATTACK_PATTERNS = [
  {
    id: "owasp-sqli-basic",
    pattern:
      /(?:\bunion\b\s+\bselect\b|\bor\b\s+['\"]?1['\"]?=['\"]?1|information_schema|sleep\s*\()/i,
  },
  {
    id: "owasp-xss-basic",
    pattern:
      /(?:<script\b|javascript:|onerror\s*=|onload\s*=|<img\b[^>]*\bonerror\b)/i,
  },
  {
    id: "owasp-lfi-rfi",
    pattern:
      /(?:\.\.\/|%2e%2e%2f|\/etc\/passwd|boot\.ini|https?:\/\/(?:127\.0\.0\.1|localhost|169\.254\.169\.254))/i,
  },
  {
    id: "owasp-command-injection",
    pattern:
      /(?:;|\|\||&&|\|)\s*(?:bash|sh|cmd(?:\.exe)?|powershell(?:\.exe)?|curl|wget)\b/i,
  },
  {
    id: "owasp-template-injection",
    pattern: /(?:\{\{\s*.*\s*\}\}|<%\s*.*\s*%>)/i,
  },
];

const requestBuckets = new Map();

const METHODS_WITH_BODY = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const ALLOWED_CONTENT_TYPES = [
  "application/json",
  "application/x-www-form-urlencoded",
  "multipart/form-data",
  "text/plain",
];

function setSecurityHeaders(response) {
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader(
    "Permissions-Policy",
    "geolocation=(), microphone=(), camera=()",
  );
  response.setHeader("X-WAF-Proxy", "contract-placements-local");
}

function appendSecurityHeaders(headers) {
  return {
    ...headers,
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cross-origin-resource-policy": "same-origin",
    "permissions-policy": "geolocation=(), microphone=(), camera=()",
    "x-waf-proxy": "contract-placements-local",
  };
}

function reject(response, statusCode, message) {
  setSecurityHeaders(response);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.end(message);
}

function estimateHeadersSize(headers) {
  return Object.entries(headers).reduce((size, [key, value]) => {
    if (Array.isArray(value)) {
      return size + key.length + value.join(",").length;
    }

    return size + key.length + String(value ?? "").length;
  }, 0);
}

function getClientIp(req) {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }

  return req.socket.remoteAddress || "unknown";
}

function isRateLimited(req) {
  const now = Date.now();
  const ip = getClientIp(req);
  const existing = requestBuckets.get(ip) || [];
  const recent = existing.filter((stamp) => now - stamp <= rateLimitWindowMs);

  if (recent.length >= rateLimitMax) {
    requestBuckets.set(ip, recent);
    return true;
  }

  recent.push(now);
  requestBuckets.set(ip, recent);
  return false;
}

function hasAllowedContentType(req) {
  if (!METHODS_WITH_BODY.has(req.method || "")) {
    return true;
  }

  const rawContentType = req.headers["content-type"];
  if (typeof rawContentType !== "string" || !rawContentType.trim()) {
    return true;
  }

  const lower = rawContentType.toLowerCase();
  return ALLOWED_CONTENT_TYPES.some((allowed) => lower.startsWith(allowed));
}

function detectAttackSurface(text) {
  for (const { id, pattern } of ATTACK_PATTERNS) {
    if (pattern.test(text)) {
      return id;
    }
  }

  return null;
}

function decodeSafely(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isBlockedRequest(req, parsedPath, requestBodyText) {
  if (isRateLimited(req)) {
    return {
      blocked: true,
      status: 429,
      reason: "Too many requests (OWASP rate limit)",
    };
  }

  if (!ALLOWED_METHODS.has(req.method || "")) {
    return { blocked: true, status: 405, reason: "Method not allowed by WAF" };
  }

  const path = parsedPath || req.url || "/";
  const decodedPath = decodeSafely(path);
  if (path.length > maxUrlLength) {
    return { blocked: true, status: 414, reason: "URI too long" };
  }

  const headerBytes = estimateHeadersSize(req.headers);
  if (headerBytes > maxHeaderBytes) {
    return { blocked: true, status: 431, reason: "Request headers too large" };
  }

  if (!hasAllowedContentType(req)) {
    return {
      blocked: true,
      status: 415,
      reason: "Unsupported media type by WAF policy",
    };
  }

  for (const pattern of BLOCKED_PATH_PATTERNS) {
    if (pattern.test(path) || pattern.test(decodedPath)) {
      return { blocked: true, status: 403, reason: "Blocked by WAF path rule" };
    }
  }

  const attack = detectAttackSurface(`${path}\n${decodedPath}`);
  if (attack) {
    return {
      blocked: true,
      status: 403,
      reason: `Blocked by OWASP signature (${attack})`,
    };
  }

  if (requestBodyText) {
    const bodyAttack = detectAttackSurface(requestBodyText);
    if (bodyAttack) {
      return {
        blocked: true,
        status: 403,
        reason: `Blocked by OWASP signature (${bodyAttack})`,
      };
    }
  }

  const contentLengthRaw = req.headers["content-length"];
  if (typeof contentLengthRaw === "string") {
    const contentLength = Number.parseInt(contentLengthRaw, 10);
    if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
      return { blocked: true, status: 413, reason: "Payload too large" };
    }
  }

  return { blocked: false };
}

async function readBody(req) {
  return new Promise((resolve, rejectPromise) => {
    const chunks = [];
    let total = 0;

    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBodyBytes) {
        rejectPromise({
          status: 413,
          reason: "Payload too large",
        });
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

    req.on("error", () => {
      rejectPromise({ status: 400, reason: "Malformed request body" });
    });
  });
}

async function handleRequest(req, res) {
  const bodyBuffer = await readBody(req);
  const bodyText = bodyBuffer.toString("utf8");
  const requestPath = req.url || "/";

  const blocked = isBlockedRequest(req, requestPath, bodyText);
  if (blocked.blocked) {
    reject(res, blocked.status, blocked.reason);
    return;
  }

  const headers = { ...req.headers };
  headers["x-forwarded-for"] = getClientIp(req);
  headers["x-forwarded-host"] = req.headers.host || "";
  headers["x-forwarded-proto"] = "http";
  headers.host = `${targetHost}:${targetPort}`;
  headers["content-length"] = String(bodyBuffer.length);

  const timeoutMs = upstreamTimeoutMs;

  const proxyReq = http.request(
    {
      host: targetHost,
      port: targetPort,
      method: req.method,
      path: req.url,
      headers,
      timeout: timeoutMs,
    },
    (proxyRes) => {
      const responseHeaders = { ...proxyRes.headers };
      const updatedHeaders = appendSecurityHeaders({ ...responseHeaders });
      res.writeHead(proxyRes.statusCode || 502, updatedHeaders);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", (error) => {
    reject(res, 502, `Upstream unavailable: ${error.message}`);
  });

  proxyReq.on("timeout", () => {
    proxyReq.destroy();
    reject(res, 504, "Upstream timeout");
  });

  req.on("error", () => {
    proxyReq.destroy();
  });

  if (bodyBuffer.length > 0) {
    proxyReq.write(bodyBuffer);
  }
  proxyReq.end();
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    if (error && typeof error.status === "number") {
      reject(res, error.status, error.reason || "Rejected by WAF");
      return;
    }

    reject(res, 500, "WAF internal error");
  });
});

server.on("clientError", (_err, socket) => {
  socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

setInterval(
  () => {
    const now = Date.now();
    for (const [ip, stamps] of requestBuckets.entries()) {
      const recent = stamps.filter((stamp) => now - stamp <= rateLimitWindowMs);
      if (recent.length === 0) {
        requestBuckets.delete(ip);
      } else {
        requestBuckets.set(ip, recent);
      }
    }
  },
  Math.max(30000, rateLimitWindowMs),
).unref();

server.listen(listenPort, listenHost, () => {
  console.log(
    `[WAF] OWASP mode active on http://${listenHost}:${listenPort} -> http://${targetHost}:${targetPort}`,
  );
});
