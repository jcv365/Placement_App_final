import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const defaultStorePath = path.join(process.cwd(), "data", "github-token.enc");
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getStorePath() {
  return process.env.GITHUB_AUTH_STORE_PATH?.trim() || defaultStorePath;
}

function getEncryptionKey(): Buffer {
  const secret =
    process.env.GITHUB_TOKEN_SECRET?.trim() ||
    process.env.ADMIN_SESSION_SECRET?.trim();
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "GITHUB_TOKEN_SECRET or ADMIN_SESSION_SECRET must be set in production",
      );
    }
    return crypto
      .createHash("sha256")
      .update("local-github-token-secret")
      .digest();
  }
  return crypto.createHash("sha256").update(secret).digest();
}

function encryptToken(raw: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(raw, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${authTag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptToken(payload: string): string {
  const [ivPart, authTagPart, encryptedPart] = payload.split(".");
  if (!ivPart || !authTagPart || !encryptedPart) {
    throw new Error("Invalid encrypted GitHub token payload");
  }
  const iv = Buffer.from(ivPart, "base64url");
  const authTag = Buffer.from(authTagPart, "base64url");
  const encrypted = Buffer.from(encryptedPart, "base64url");
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    "utf8",
  );
}

export async function readSharedGithubAccessToken(): Promise<string | null> {
  try {
    const raw = await fs.readFile(getStorePath(), "utf8");
    const cleaned = raw.trim();
    if (!cleaned) return null;

    // Support both legacy plaintext (starts with "gh") and encrypted format
    if (cleaned.startsWith("gh")) {
      return cleaned;
    }

    return decryptToken(cleaned);
  } catch {
    // Fallback: try plaintext token file (e.g. data/github-token.txt)
    try {
      const txtPath = getStorePath().replace(/\.enc$/, ".txt");
      if (txtPath === getStorePath()) return null;
      const raw = await fs.readFile(txtPath, "utf8");
      const cleaned = raw.trim();
      return cleaned.startsWith("gh") ? cleaned : null;
    } catch {
      return null;
    }
  }
}

export async function writeSharedGithubAccessToken(
  token: string,
): Promise<void> {
  const storePath = getStorePath();
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  const encrypted = encryptToken(token.trim());
  await fs.writeFile(storePath, encrypted, "utf8");
}

export async function clearSharedGithubAccessToken(): Promise<void> {
  try {
    await fs.unlink(getStorePath());
  } catch {
    // No-op if token is not present.
  }
}
