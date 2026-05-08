import { requireAdminContextFromRequest } from "@/lib/adminAuth";
import { jsonError, jsonOk } from "@/lib/apiResponses";
import {
    validateFilesystemSource,
    validateOneDriveSource,
    validateSharePointSource,
} from "@/lib/automationSources";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    requireAdminContextFromRequest(request);
  } catch {
    return jsonError("Admin authentication required", 401);
  }

  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? "filesystem";

  let result: { valid: true } | { valid: false; error: string };

  switch (type) {
    case "filesystem": {
      const p = url.searchParams.get("path") ?? "";
      result = await validateFilesystemSource(p);
      break;
    }
    case "onedrive": {
      const user = url.searchParams.get("user") ?? "";
      const folder = url.searchParams.get("folder") ?? "";
      result = await validateOneDriveSource(user, folder);
      break;
    }
    case "sharepoint": {
      const site = url.searchParams.get("site") ?? "";
      const folder = url.searchParams.get("folder") ?? "";
      result = await validateSharePointSource(site, folder);
      break;
    }
    default:
      return jsonError(`Unknown source type: ${type}`, 400);
  }

  return jsonOk(result);
}
