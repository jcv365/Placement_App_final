import { requireAdminContextFromRequest } from "@/lib/adminAuth";
import { jsonError, jsonOk } from "@/lib/apiResponses";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const TIMEOUT_MS = 8_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(Object.assign(new Error("TIMEOUT"), { code: "ETIMEDOUT" })),
        ms,
      ),
    ),
  ]);
}

async function checkPath(
  rawPath: string,
): Promise<{ valid: true } | { valid: false; error: string }> {
  if (!rawPath.trim()) {
    return { valid: false, error: "Source path is required." };
  }

  if (!path.isAbsolute(rawPath)) {
    return {
      valid: false,
      error: "Source path must be an absolute path (starting with /).",
    };
  }

  try {
    const stat = await withTimeout(fs.stat(rawPath), TIMEOUT_MS);
    if (!stat.isDirectory()) {
      return {
        valid: false,
        error: `Path exists but is not a directory: ${rawPath}`,
      };
    }
    await withTimeout(fs.readdir(rawPath), TIMEOUT_MS);
    return { valid: true };
  } catch (err) {
    const code =
      err instanceof Error && "code" in err
        ? (err as NodeJS.ErrnoException).code
        : undefined;

    if (code === "ETIMEDOUT") {
      return {
        valid: false,
        error: `SMB share did not respond within ${TIMEOUT_MS / 1000}s — ensure the share is mounted and reachable.`,
      };
    }
    if (code === "ENOENT") {
      return { valid: false, error: `Directory does not exist: ${rawPath}` };
    }
    if (code === "EACCES") {
      return {
        valid: false,
        error: `Permission denied — the app cannot read: ${rawPath}`,
      };
    }
    return {
      valid: false,
      error: `Cannot access path (${code ?? "unknown error"}): ${rawPath}`,
    };
  }
}

export async function GET(request: Request) {
  try {
    requireAdminContextFromRequest(request);
  } catch {
    return jsonError("Admin authentication required", 401);
  }

  const url = new URL(request.url);
  const rawPath = url.searchParams.get("path") ?? "";

  const result = await checkPath(rawPath);
  if (!result.valid) {
    return jsonOk({ valid: false, error: result.error });
  }

  return jsonOk({ valid: true });
}
