export type AutomationRunPhase =
  | "finding_file"
  | "uploading"
  | "waiting_for_drafts"
  | "sending"
  | "done";

export type AutomationRunStatus = "running" | "completed" | "failed";

export type AutomationRunRecord = {
  runId: string;
  tenantId: string;
  status: AutomationRunStatus;
  phase: AutomationRunPhase;
  message: string;
  startedAt: number;
  updatedAt: number;
  filePath?: string;
  uploadId?: string;
  uploadSummary?: Record<string, unknown>;
  draftsFound: number;
  draftsSent: number;
  draftsFailedToSend: number;
  error?: string;
};

const store = new Map<string, AutomationRunRecord>();

const TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const MAX_STORE_SIZE = 100;

function cleanup(): void {
  const now = Date.now();
  for (const [id, rec] of store.entries()) {
    if (now - rec.updatedAt > TTL_MS) {
      store.delete(id);
    }
  }
}

export function startAutomationRun(runId: string, tenantId: string): void {
  cleanup();
  if (store.size >= MAX_STORE_SIZE) {
    const oldest = Array.from(store.entries()).sort(
      (a, b) => a[1].updatedAt - b[1].updatedAt,
    );
    for (let i = 0; i < Math.ceil(oldest.length / 2); i++) {
      store.delete(oldest[i]![0]);
    }
  }
  store.set(runId, {
    runId,
    tenantId,
    status: "running",
    phase: "finding_file",
    message: "Starting automation run.",
    startedAt: Date.now(),
    updatedAt: Date.now(),
    draftsFound: 0,
    draftsSent: 0,
    draftsFailedToSend: 0,
  });
}

export function updateAutomationRun(
  runId: string,
  updates: Partial<
    Omit<AutomationRunRecord, "runId" | "tenantId" | "startedAt">
  >,
): void {
  const rec = store.get(runId);
  if (!rec) return;
  Object.assign(rec, updates, { updatedAt: Date.now() });
}

export function completeAutomationRun(
  runId: string,
  summary: {
    draftsFound: number;
    draftsSent: number;
    draftsFailedToSend: number;
    uploadSummary?: Record<string, unknown>;
  },
): void {
  const rec = store.get(runId);
  if (!rec) return;
  const sentCount = summary.draftsSent;
  Object.assign(rec, {
    status: "completed",
    phase: "done",
    message: `Automation run complete. Sent ${sentCount} email${sentCount === 1 ? "" : "s"}.`,
    ...summary,
    updatedAt: Date.now(),
  });
}

export function failAutomationRun(runId: string, error: string): void {
  const rec = store.get(runId);
  if (!rec) return;
  Object.assign(rec, {
    status: "failed",
    message: error,
    error,
    updatedAt: Date.now(),
  });
}

export function getAutomationRun(
  runId: string,
): AutomationRunRecord | undefined {
  return store.get(runId);
}

export function sanitiseRunId(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const candidate = raw.trim();
  if (!candidate) return undefined;
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(candidate)) return undefined;
  return candidate;
}
