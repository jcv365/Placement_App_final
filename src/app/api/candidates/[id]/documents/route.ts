import { jsonError, jsonOk } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";
import { getOwnerFilter, resolveTenantAccessScope } from "@/lib/tenantAccess";
import * as fs from "fs";
import * as path from "path";

export const runtime = "nodejs";

const CV_ROOT = path.join(process.cwd(), "cv");

function nameToSlug(name: string): string {
  return (name || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function getDocumentsDir(fullName: string): string {
  return path.join(CV_ROOT, nameToSlug(fullName), "documents");
}

/** List all documents in the candidate's documents folder */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const scope = resolveTenantAccessScope(request);
    const { id } = await context.params;

    const { searchParams } = new URL(request.url);
    const fileName = searchParams.get("file");

    const candidate = await prisma.candidate.findFirst({
      where: { id, tenantId: scope.tenantId, ...getOwnerFilter(scope) },
      select: { id: true, fullName: true },
    });

    if (!candidate) {
      return jsonError("Candidate not found", 404);
    }

    const docsDir = getDocumentsDir(candidate.fullName);

    // If ?file= query param, serve that specific file
    if (fileName) {
      const safeName = path.basename(fileName);
      const filePath = path.join(docsDir, safeName);

      // Prevent path traversal
      if (!filePath.startsWith(docsDir)) {
        return jsonError("Invalid file name", 400);
      }

      if (!fs.existsSync(filePath)) {
        return jsonError("File not found", 404);
      }

      const data = fs.readFileSync(filePath);
      const ext = path.extname(safeName).toLowerCase();
      const mimeType =
        ext === ".pdf"
          ? "application/pdf"
          : ext === ".docx"
            ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            : "application/octet-stream";

      return new Response(data, {
        status: 200,
        headers: {
          "Content-Type": mimeType,
          "Content-Disposition": `attachment; filename="${safeName}"`,
          "Cache-Control": "private, no-store",
        },
      });
    }

    // Otherwise list all files
    if (!fs.existsSync(docsDir)) {
      return jsonOk({ files: [] });
    }

    const entries = fs.readdirSync(docsDir);
    const files = entries
      .filter((name) => {
        const full = path.join(docsDir, name);
        return fs.statSync(full).isFile();
      })
      .map((name) => {
        const full = path.join(docsDir, name);
        const stat = fs.statSync(full);
        return {
          name,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));

    return jsonOk({ files });
  } catch (error) {
    if ((error as Error).message === "UNAUTHENTICATED") {
      return jsonError("Authentication required", 401);
    }
    console.error("[CANDIDATE_DOCUMENTS]", error);
    return jsonError("Unable to retrieve documents", 500);
  }
}
