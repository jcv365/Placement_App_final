import crypto from "node:crypto";

const DEFAULT_CONNECTION_SECRET = "local-graph-connection-secret";
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getConnectionSecret(): Buffer {
  const secret =
    process.env.GRAPH_CONNECTION_SECRET?.trim() ||
    process.env.ADMIN_SESSION_SECRET?.trim() ||
    DEFAULT_CONNECTION_SECRET;

  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptGraphAccessToken(rawToken: string): string {
  const token = rawToken.trim();
  if (!token) {
    throw new Error("Graph access token cannot be empty");
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getConnectionSecret(), iv);
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("base64url")}.${authTag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptGraphAccessToken(payload: string): string {
  const [ivPart, authTagPart, encryptedPart] = payload.split(".");
  if (!ivPart || !authTagPart || !encryptedPart) {
    throw new Error("Invalid encrypted Graph token payload");
  }

  const iv = Buffer.from(ivPart, "base64url");
  const authTag = Buffer.from(authTagPart, "base64url");
  const encrypted = Buffer.from(encryptedPart, "base64url");

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getConnectionSecret(),
    iv,
  );
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString("utf8");

  if (!decrypted.trim()) {
    throw new Error("Decrypted Graph token is empty");
  }

  return decrypted;
}

export function isGraphConnectionUsable(params: {
  graphAccessTokenEncrypted?: string | null;
  graphTokenExpiresAt?: Date | string | null;
}): boolean {
  if (!params.graphAccessTokenEncrypted) {
    return false;
  }

  if (!params.graphTokenExpiresAt) {
    return true;
  }

  const expiresAt =
    params.graphTokenExpiresAt instanceof Date
      ? params.graphTokenExpiresAt
      : new Date(params.graphTokenExpiresAt);

  if (Number.isNaN(expiresAt.getTime())) {
    return false;
  }

  return expiresAt.getTime() > Date.now() + 60_000;
}
