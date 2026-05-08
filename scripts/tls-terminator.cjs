#!/usr/bin/env node
const fs = require("node:fs");
const https = require("node:https");
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
const targetPort = Number.parseInt(getArg("--target-port", "9081"), 10);
const certPath = getArg("--cert-path", "SSL/certificate.crt");
const keyPath = getArg("--key-path", "SSL/private.key");
const caPath = getArg("--ca-path", "");

if (!fs.existsSync(certPath)) {
  throw new Error(`TLS cert not found: ${certPath}`);
}
if (!fs.existsSync(keyPath)) {
  throw new Error(`TLS key not found: ${keyPath}`);
}

const certBuffer = fs.readFileSync(certPath);
const keyBuffer = fs.readFileSync(keyPath);

let fullChainBuffer = certBuffer;
if (caPath && fs.existsSync(caPath)) {
  const caBuffer = fs.readFileSync(caPath);
  // Present certificate chain to clients (server cert + intermediates in bundle).
  fullChainBuffer = Buffer.concat([certBuffer, Buffer.from("\n"), caBuffer]);
}

const tlsOptions = {
  cert: fullChainBuffer,
  key: keyBuffer,
};

const server = https.createServer(tlsOptions, (req, res) => {
  const headers = { ...req.headers };
  headers["x-forwarded-proto"] = "https";
  headers["x-forwarded-host"] = req.headers.host || "";
  headers["x-forwarded-for"] = req.socket.remoteAddress || "";
  headers.host = `${targetHost}:${targetPort}`;

  const proxyReq = http.request(
    {
      host: targetHost,
      port: targetPort,
      method: req.method,
      path: req.url,
      headers,
      timeout: 15000,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("timeout", () => {
    proxyReq.destroy();
    res.statusCode = 504;
    res.end("TLS terminator upstream timeout");
  });

  proxyReq.on("error", (error) => {
    res.statusCode = 502;
    res.end(`TLS terminator upstream error: ${error.message}`);
  });

  req.on("error", () => {
    proxyReq.destroy();
  });

  req.pipe(proxyReq);
});

server.on("clientError", (_err, socket) => {
  socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

server.listen(listenPort, listenHost, () => {
  console.log(
    `[TLS] Listening on https://${listenHost}:${listenPort} -> http://${targetHost}:${targetPort}`,
  );
});
