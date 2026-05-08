/**
 * automationSources.ts
 *
 * Unified file-source abstraction for the automation pipeline.
 * Supports three source types:
 *   - filesystem  : absolute path inside the container (e.g. /mnt/share/data)
 *   - onedrive    : a user's OneDrive drive, accessed via Microsoft Graph
 *   - sharepoint  : a SharePoint site drive, accessed via Microsoft Graph
 *
 * All three return the same shape: { fileName, data: Buffer }
 */

import { getGraphAppAccessToken } from "@/lib/graph";
import fsSync from "node:fs";
import fsAsync from "node:fs/promises";
import path from "node:path";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AutomationSourceType = "filesystem" | "onedrive" | "sharepoint";

/** Config stored in RuleSet.rulesJson */
export type AutomationSourceConfig =
  | {
      sourceType: "filesystem";
      /** Absolute Linux path inside the container, e.g. /mnt/smb/data */
      sourcePath: string;
    }
  | {
      sourceType: "onedrive";
      /**
       * UPN / email of the user whose OneDrive to read, e.g. jan@contoso.com
       * Requires Files.Read.All application permission on the Graph app.
       */
      onedriveUser: string;
      /**
       * Folder path inside the drive root, without leading slash.
       * e.g. "Placements/linkedinscanner/data"
       */
      onedriveFolderPath: string;
    }
  | {
      sourceType: "sharepoint";
      /**
       * SharePoint site hostname + path, e.g. "contoso.sharepoint.com:/sites/Placements"
       * Requires Sites.Read.All application permission.
       */
      sharepointSite: string;
      /**
       * Folder path relative to the site drive root, e.g. "Shared Documents/linkedin/data"
       */
      sharepointFolderPath: string;
    };

export type FoundFile = {
  fileName: string;
  data: Buffer;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const FILE_PATTERN = /^linkedin_opportunities_(\d{4}-\d{2}-\d{2})(\..+)?$/i;

function pickLatest(names: string[]): string | null {
  const candidates = names
    .filter((n) => FILE_PATTERN.test(n))
    .map((n) => ({ name: n, date: n.match(FILE_PATTERN)![1]! }))
    .sort((a, b) => b.date.localeCompare(a.date));
  return candidates[0]?.name ?? null;
}

function getCurrentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(Object.assign(new Error("ETIMEDOUT"), { code: "ETIMEDOUT" })),
        ms,
      ),
    ),
  ]);
}

// ── Filesystem source ─────────────────────────────────────────────────────────

async function findFileFilesystem(
  sourcePath: string,
): Promise<FoundFile | null> {
  const monthFolder = path.join(
    path.resolve(sourcePath),
    getCurrentYearMonth(),
  );

  if (!fsSync.existsSync(monthFolder)) return null;

  let entries: string[];
  try {
    entries = await withTimeout(fsAsync.readdir(monthFolder), TIMEOUT_MS);
  } catch {
    return null;
  }

  const fileName = pickLatest(entries);
  if (!fileName) return null;

  const filePath = path.join(monthFolder, fileName);
  const data = await withTimeout(fsAsync.readFile(filePath), TIMEOUT_MS);
  return { fileName, data };
}

export async function validateFilesystemSource(
  sourcePath: string,
): Promise<{ valid: true } | { valid: false; error: string }> {
  if (!sourcePath.trim()) {
    return { valid: false, error: "Source path is required." };
  }
  if (!path.isAbsolute(sourcePath)) {
    return {
      valid: false,
      error: "Source path must be an absolute path (starting with /).",
    };
  }
  try {
    const stat = await withTimeout(fsAsync.stat(sourcePath), TIMEOUT_MS);
    if (!stat.isDirectory()) {
      return {
        valid: false,
        error: `Path exists but is not a directory: ${sourcePath}`,
      };
    }
    await withTimeout(fsAsync.readdir(sourcePath), TIMEOUT_MS);
    return { valid: true };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ETIMEDOUT") {
      return {
        valid: false,
        error: `Share did not respond within ${TIMEOUT_MS / 1000}s — ensure it is mounted and reachable.`,
      };
    }
    if (code === "ENOENT")
      return { valid: false, error: `Path does not exist: ${sourcePath}` };
    if (code === "EACCES")
      return { valid: false, error: `Permission denied: ${sourcePath}` };
    return {
      valid: false,
      error: `Cannot access path (${code ?? "unknown"}): ${sourcePath}`,
    };
  }
}

// ── OneDrive source ───────────────────────────────────────────────────────────

async function graphGet<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Graph ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

type GraphDriveItem = {
  name: string;
  file?: object;
  folder?: object;
  "@microsoft.graph.downloadUrl"?: string;
};
type GraphDriveItemList = { value: GraphDriveItem[] };

async function findFileOneDrive(
  user: string,
  folderPath: string,
): Promise<FoundFile | null> {
  const token = await getGraphAppAccessToken();
  const yearMonth = getCurrentYearMonth();
  const encoded = encodeURIComponent(
    `${folderPath.replace(/^\//, "")}/${yearMonth}`,
  );
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(user)}/drive/root:/${encoded}:/children?$select=name,file,folder,@microsoft.graph.downloadUrl`;

  const list = await graphGet<GraphDriveItemList>(url, token);
  const fileNames = list.value.filter((i) => i.file).map((i) => i.name);
  const fileName = pickLatest(fileNames);
  if (!fileName) return null;

  const fileItem = list.value.find((i) => i.name === fileName);
  const downloadUrl = fileItem?.["@microsoft.graph.downloadUrl"];
  if (!downloadUrl) {
    throw new Error(`Could not get download URL for ${fileName}`);
  }

  const dlRes = await fetch(downloadUrl, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!dlRes.ok) throw new Error(`Download failed (${dlRes.status})`);
  const data = Buffer.from(await dlRes.arrayBuffer());
  return { fileName, data };
}

export async function validateOneDriveSource(
  user: string,
  folderPath: string,
): Promise<{ valid: true } | { valid: false; error: string }> {
  if (!user.trim())
    return { valid: false, error: "OneDrive user email is required." };
  if (!folderPath.trim())
    return { valid: false, error: "OneDrive folder path is required." };
  try {
    const token = await getGraphAppAccessToken();
    const encoded = encodeURIComponent(folderPath.replace(/^\//, ""));
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(user)}/drive/root:/${encoded}`;
    await graphGet(url, token);
    return { valid: true };
  } catch (err) {
    return { valid: false, error: (err as Error).message };
  }
}

// ── SharePoint source ─────────────────────────────────────────────────────────

async function findFileSharePoint(
  site: string,
  folderPath: string,
): Promise<FoundFile | null> {
  const token = await getGraphAppAccessToken();
  const yearMonth = getCurrentYearMonth();
  const fullFolder = `${folderPath.replace(/^\//, "")}/${yearMonth}`;
  const encodedFolder = encodeURIComponent(fullFolder);
  const url = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(site)}/drive/root:/${encodedFolder}:/children?$select=name,file,folder,@microsoft.graph.downloadUrl`;

  const list = await graphGet<GraphDriveItemList>(url, token);
  const fileNames = list.value.filter((i) => i.file).map((i) => i.name);
  const fileName = pickLatest(fileNames);
  if (!fileName) return null;

  const fileItem = list.value.find((i) => i.name === fileName);
  const downloadUrl = fileItem?.["@microsoft.graph.downloadUrl"];
  if (!downloadUrl)
    throw new Error(`Could not get download URL for ${fileName}`);

  const dlRes = await fetch(downloadUrl, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!dlRes.ok) throw new Error(`Download failed (${dlRes.status})`);
  const data = Buffer.from(await dlRes.arrayBuffer());
  return { fileName, data };
}

export async function validateSharePointSource(
  site: string,
  folderPath: string,
): Promise<{ valid: true } | { valid: false; error: string }> {
  if (!site.trim())
    return { valid: false, error: "SharePoint site is required." };
  if (!folderPath.trim())
    return { valid: false, error: "SharePoint folder path is required." };
  try {
    const token = await getGraphAppAccessToken();
    const encoded = encodeURIComponent(folderPath.replace(/^\//, ""));
    const url = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(site)}/drive/root:/${encoded}`;
    await graphGet(url, token);
    return { valid: true };
  } catch (err) {
    return { valid: false, error: (err as Error).message };
  }
}

// ── Public dispatcher ─────────────────────────────────────────────────────────

/**
 * Find and download the latest LinkedIn opportunities file for the current
 * year-month, using whichever source type is configured.
 */
export async function findLatestLinkedInFile(
  config: AutomationSourceConfig,
): Promise<FoundFile | null> {
  switch (config.sourceType) {
    case "filesystem":
      return findFileFilesystem(config.sourcePath);
    case "onedrive":
      return findFileOneDrive(config.onedriveUser, config.onedriveFolderPath);
    case "sharepoint":
      return findFileSharePoint(
        config.sharepointSite,
        config.sharepointFolderPath,
      );
  }
}

/**
 * Parse a raw rulesJson object into a typed AutomationSourceConfig.
 * Returns null if the config is invalid or incomplete.
 */
export function parseAutomationSourceConfig(
  rj: Record<string, unknown>,
): AutomationSourceConfig | null {
  const type = rj.automation_source_type as string | undefined;

  if (!type || type === "filesystem") {
    const p =
      typeof rj.automation_source_path === "string"
        ? rj.automation_source_path.trim()
        : "";
    if (!p || !path.isAbsolute(p)) return null;
    return { sourceType: "filesystem", sourcePath: p };
  }

  if (type === "onedrive") {
    const user =
      typeof rj.automation_onedrive_user === "string"
        ? rj.automation_onedrive_user.trim()
        : "";
    const folder =
      typeof rj.automation_onedrive_folder === "string"
        ? rj.automation_onedrive_folder.trim()
        : "";
    if (!user || !folder) return null;
    return {
      sourceType: "onedrive",
      onedriveUser: user,
      onedriveFolderPath: folder,
    };
  }

  if (type === "sharepoint") {
    const site =
      typeof rj.automation_sharepoint_site === "string"
        ? rj.automation_sharepoint_site.trim()
        : "";
    const folder =
      typeof rj.automation_sharepoint_folder === "string"
        ? rj.automation_sharepoint_folder.trim()
        : "";
    if (!site || !folder) return null;
    return {
      sourceType: "sharepoint",
      sharepointSite: site,
      sharepointFolderPath: folder,
    };
  }

  return null;
}
