import { requireAdminContextFromRequest } from "@/lib/adminAuth";
import { jsonError, jsonOk } from "@/lib/apiResponses";
import {
    completeAutomationRun,
    failAutomationRun,
    getAutomationRun,
    sanitiseRunId,
    startAutomationRun,
    updateAutomationRun,
} from "@/lib/automationProgress";
import {
    AutomationSourceConfig,
    findLatestLinkedInFile,
    parseAutomationSourceConfig,
    validateFilesystemSource,
    validateOneDriveSource,
    validateSharePointSource,
} from "@/lib/automationSources";
import { prisma } from "@/lib/prisma";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";

const UPLOAD_POLL_INTERVAL_MS = 5_000;
const UPLOAD_POLL_MAX_MS = 10 * 60 * 1000;
const DRAFT_WAIT_POLL_INTERVAL_MS = 15_000;
const DRAFT_WAIT_MAX_MS = 15 * 60 * 1000;

// ── Auth ──────────────────────────────────────────────────────────────────────

function getAdminContext(
  request: Request,
): { username: string; tenantId: string } | null {
  try {
    return requireAdminContextFromRequest(request);
  } catch {
    return null;
  }
}

// ── Upload polling ────────────────────────────────────────────────────────────

async function pollUploadProgress(
  uploadId: string,
  cookieHeader: string,
  appBaseUrl: string,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + UPLOAD_POLL_MAX_MS;

  while (Date.now() < deadline) {
    await new Promise((resolve) =>
      setTimeout(resolve, UPLOAD_POLL_INTERVAL_MS),
    );

    let data: { status?: string; summary?: Record<string, unknown> };
    try {
      const res = await fetch(
        `${appBaseUrl}/api/upload/progress?uploadId=${encodeURIComponent(uploadId)}`,
        { headers: { cookie: cookieHeader } },
      );
      if (!res.ok) continue;
      data = (await res.json()) as typeof data;
    } catch {
      continue;
    }

    if (data?.status === "completed") return data.summary ?? {};
    if (data?.status === "failed") {
      const msg =
        typeof (data.summary as Record<string, unknown> | undefined)
          ?.message === "string"
          ? ((data.summary as Record<string, unknown>).message as string)
          : "Upload processing failed";
      throw new Error(msg);
    }
  }

  throw new Error("Upload progress timed out after 10 minutes");
}

// ── Draft polling ─────────────────────────────────────────────────────────────

async function waitForEmailDrafts(
  tenantId: string,
  runStart: Date,
  expectedCount: number,
): Promise<string[]> {
  const deadline = Date.now() + DRAFT_WAIT_MAX_MS;

  while (Date.now() < deadline) {
    const drafts = await prisma.emailDraft.findMany({
      where: { tenantId, createdAt: { gte: runStart } },
      select: { id: true },
    });
    if (drafts.length >= expectedCount) return drafts.map((d) => d.id);
    await new Promise((resolve) =>
      setTimeout(resolve, DRAFT_WAIT_POLL_INTERVAL_MS),
    );
  }

  // Return whatever exists even if below expected count
  const final = await prisma.emailDraft.findMany({
    where: { tenantId, createdAt: { gte: runStart } },
    select: { id: true },
  });
  return final.map((d) => d.id);
}

// ── Background runner ─────────────────────────────────────────────────────────

async function runAutomationBackground(params: {
  runId: string;
  tenantId: string;
  sourceConfig: AutomationSourceConfig;
  cookieHeader: string;
  appBaseUrl: string;
}): Promise<void> {
  const { runId, tenantId, sourceConfig, cookieHeader, appBaseUrl } = params;
  const runStart = new Date();

  try {
    // Phase 1 — find file
    updateAutomationRun(runId, {
      phase: "finding_file",
      message: "Looking for LinkedIn opportunities file.",
    });

    const found = await findLatestLinkedInFile(sourceConfig);

    if (!found) {
      const location =
        sourceConfig.sourceType === "filesystem"
          ? sourceConfig.sourcePath
          : sourceConfig.sourceType === "onedrive"
            ? `OneDrive: ${sourceConfig.onedriveFolderPath} (${sourceConfig.onedriveUser})`
            : `SharePoint: ${sourceConfig.sharepointFolderPath} (${sourceConfig.sharepointSite})`;
      throw new Error(
        `No LinkedIn opportunities file found in ${location}/<current month>. ` +
          `Expected a file named: linkedin_opportunities_YYYY-MM-DD[.xlsx|.csv]`,
      );
    }

    const { fileName, data: fileBuffer } = found;

    updateAutomationRun(runId, {
      message: `Found file: ${fileName}.`,
    });

    // Phase 2 — upload
    updateAutomationRun(runId, {
      phase: "uploading",
      message: "Uploading opportunities file for processing.",
    });

    const mimeType = /\.csv$/i.test(fileName)
      ? "text/csv"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    const uploadId = randomUUID();
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([fileBuffer], { type: mimeType }),
      fileName,
    );
    formData.append("uploadId", uploadId);

    const uploadRes = await fetch(`${appBaseUrl}/api/opportunities/upload`, {
      method: "POST",
      headers: { cookie: cookieHeader },
      body: formData,
    });

    if (!uploadRes.ok) {
      const text = await uploadRes.text().catch(() => "(no body)");
      throw new Error(
        `Opportunities upload request failed (${uploadRes.status}): ${text}`,
      );
    }

    updateAutomationRun(runId, {
      uploadId,
      message: "File uploaded — waiting for AI processing to complete.",
    });

    // Phase 3 — wait for upload to complete
    const uploadSummary = await pollUploadProgress(
      uploadId,
      cookieHeader,
      appBaseUrl,
    );
    const expectedEmailCount =
      typeof uploadSummary.generatedEmails === "number"
        ? uploadSummary.generatedEmails
        : 0;

    updateAutomationRun(runId, {
      uploadSummary,
      message: `Processing complete. Waiting for ${expectedEmailCount} email draft${expectedEmailCount === 1 ? "" : "s"} to be generated.`,
    });

    // Phase 4 — wait for email drafts
    updateAutomationRun(runId, {
      phase: "waiting_for_drafts",
      message: `Waiting for email generation (expecting ${expectedEmailCount}).`,
    });

    const draftIds = await waitForEmailDrafts(
      tenantId,
      runStart,
      expectedEmailCount,
    );

    updateAutomationRun(runId, {
      draftsFound: draftIds.length,
      message: `Found ${draftIds.length} email draft${draftIds.length === 1 ? "" : "s"}. Sending now.`,
    });

    if (draftIds.length === 0) {
      completeAutomationRun(runId, {
        draftsFound: 0,
        draftsSent: 0,
        draftsFailedToSend: 0,
        uploadSummary,
      });
      return;
    }

    // Phase 5 — send each draft
    updateAutomationRun(runId, {
      phase: "sending",
      message: `Sending ${draftIds.length} email draft${draftIds.length === 1 ? "" : "s"}.`,
    });

    let sent = 0;
    let failed = 0;

    for (const draftId of draftIds) {
      try {
        const draft = await prisma.emailDraft.findFirst({
          where: { id: draftId, tenantId },
          select: {
            id: true,
            applicationId: true,
            application: {
              select: {
                id: true,
                job: { select: { opportunityEmail: true } },
              },
            },
          },
        });

        const opportunityEmail = draft?.application?.job?.opportunityEmail;
        if (!opportunityEmail) {
          failed += 1;
          continue;
        }

        const sendRes = await fetch(`${appBaseUrl}/api/email/send`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: cookieHeader,
          },
          body: JSON.stringify({
            emailDraftId: draftId,
            applicationId: draft!.application!.id,
            to: [opportunityEmail],
          }),
        });

        if (sendRes.ok) {
          sent += 1;
        } else {
          failed += 1;
        }
      } catch {
        failed += 1;
      }

      updateAutomationRun(runId, {
        draftsSent: sent,
        draftsFailedToSend: failed,
        message: `Sending: ${sent + failed} of ${draftIds.length} processed.`,
      });
    }

    completeAutomationRun(runId, {
      draftsFound: draftIds.length,
      draftsSent: sent,
      draftsFailedToSend: failed,
      uploadSummary,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Automation run failed.";
    console.error("[AUTOMATION_RUN] Background error", { runId, message });
    failAutomationRun(runId, message);
  }
}

// ── GET — poll run status ─────────────────────────────────────────────────────

export async function GET(request: Request) {
  const ctx = getAdminContext(request);
  if (!ctx) return jsonError("Admin authentication required", 401);

  const url = new URL(request.url);
  const runId = sanitiseRunId(url.searchParams.get("runId"));
  if (!runId) return jsonError("runId is required", 400);

  const record = getAutomationRun(runId);
  if (!record || record.tenantId !== ctx.tenantId) {
    return jsonError("Automation run not found", 404);
  }

  return jsonOk(record);
}

// ── POST — start a run ────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const ctx = getAdminContext(request);
  if (!ctx) return jsonError("Admin authentication required", 401);

  const { tenantId } = ctx;

  // Load automation config from the default RuleSet
  const ruleSet = await prisma.ruleSet.findFirst({
    where: { tenantId, isDefault: true },
    select: { rulesJson: true },
  });

  const rulesJson =
    ruleSet?.rulesJson != null &&
    typeof ruleSet.rulesJson === "object" &&
    !Array.isArray(ruleSet.rulesJson)
      ? (ruleSet.rulesJson as Record<string, unknown>)
      : {};

  if (rulesJson.automation_enabled !== true) {
    return jsonError(
      "Automation is not enabled. Enable it in the Automation settings tab first.",
      400,
    );
  }

  const sourceConfig = parseAutomationSourceConfig(rulesJson);
  if (!sourceConfig) {
    return jsonError(
      "Automation source is not fully configured. Check the Automation settings tab.",
      400,
    );
  }

  // Quick pre-flight validation before starting the background run.
  let preflightResult: { valid: true } | { valid: false; error: string };
  if (sourceConfig.sourceType === "filesystem") {
    preflightResult = await validateFilesystemSource(sourceConfig.sourcePath);
  } else if (sourceConfig.sourceType === "onedrive") {
    preflightResult = await validateOneDriveSource(
      sourceConfig.onedriveUser,
      sourceConfig.onedriveFolderPath,
    );
  } else {
    preflightResult = await validateSharePointSource(
      sourceConfig.sharepointSite,
      sourceConfig.sharepointFolderPath,
    );
  }
  if (!preflightResult.valid) {
    return jsonError(preflightResult.error, 400);
  }

  const runId = randomUUID();
  startAutomationRun(runId, tenantId);

  const cookieHeader = request.headers.get("cookie") ?? "";
  const appBaseUrl =
    process.env.APP_BASE_URL?.trim() ?? "http://localhost:3000";

  // Fire-and-forget — do not await
  void runAutomationBackground({
    runId,
    tenantId,
    sourceConfig,
    cookieHeader,
    appBaseUrl,
  });

  return jsonOk({ runId });
}

// ── Trigger endpoint for the cron scheduler ───────────────────────────────────
// Called internally with a synthesised admin session cookie.
// No separate export needed — the POST above handles both cases.

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      Allow: "GET, POST, OPTIONS",
    },
  });
}
