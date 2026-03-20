import { promises as fs } from "node:fs";
import path from "node:path";

const defaultStorePath = path.join(process.cwd(), "data", "github-token.txt");

function getStorePath() {
  return process.env.GITHUB_AUTH_STORE_PATH?.trim() || defaultStorePath;
}

export async function readSharedGithubAccessToken(): Promise<string | null> {
  try {
    const token = await fs.readFile(getStorePath(), "utf8");
    const cleaned = token.trim();
    return cleaned.length > 0 ? cleaned : null;
  } catch {
    return null;
  }
}

export async function writeSharedGithubAccessToken(
  token: string,
): Promise<void> {
  const storePath = getStorePath();
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, token.trim(), "utf8");
}

export async function clearSharedGithubAccessToken(): Promise<void> {
  try {
    await fs.unlink(getStorePath());
  } catch {
    // No-op if token is not present.
  }
}
