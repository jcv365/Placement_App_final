type UploadProgressStatus = "running" | "completed" | "failed";

type UploadProgressRecord = {
  uploadId: string;
  tenantId: string;
  status: UploadProgressStatus;
  percent: number;
  message: string;
  updatedAt: number;
  summary?: Record<string, unknown>;
};

type StartUploadProgressInput = {
  uploadId: string;
  tenantId: string;
  message: string;
};

type UpdateUploadProgressInput = {
  uploadId: string;
  tenantId: string;
  percent: number;
  message: string;
};

type FinishUploadProgressInput = {
  uploadId: string;
  tenantId: string;
  message: string;
  summary?: Record<string, unknown>;
};

const uploadProgressStore = new Map<string, UploadProgressRecord>();
const PROGRESS_TTL_MS = 30 * 60 * 1000;
const MAX_STORE_SIZE = 10_000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

// Periodic cleanup to prevent unbounded growth
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensurePeriodicCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    cleanupExpiredUploadProgress();
    if (uploadProgressStore.size === 0 && cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  }, CLEANUP_INTERVAL_MS);
  if (typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    cleanupTimer.unref();
  }
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

function cleanupExpiredUploadProgress(): void {
  const now = Date.now();
  for (const [uploadId, record] of uploadProgressStore.entries()) {
    if (now - record.updatedAt > PROGRESS_TTL_MS) {
      uploadProgressStore.delete(uploadId);
    }
  }
}

export function sanitiseUploadId(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }

  const candidate = raw.trim();
  if (!candidate) {
    return undefined;
  }

  if (!/^[A-Za-z0-9_-]{8,128}$/.test(candidate)) {
    return undefined;
  }

  return candidate;
}

export function startUploadProgress(input: StartUploadProgressInput): void {
  cleanupExpiredUploadProgress();
  ensurePeriodicCleanup();

  if (uploadProgressStore.size >= MAX_STORE_SIZE) {
    // Evict oldest entries if store is full
    const entries = Array.from(uploadProgressStore.entries()).sort(
      (a, b) => a[1].updatedAt - b[1].updatedAt,
    );
    for (let i = 0; i < entries.length / 2; i++) {
      uploadProgressStore.delete(entries[i][0]);
    }
  }

  const now = Date.now();
  uploadProgressStore.set(input.uploadId, {
    uploadId: input.uploadId,
    tenantId: input.tenantId,
    status: "running",
    percent: 1,
    message: input.message,
    updatedAt: now,
  });
}

export function updateUploadProgress(input: UpdateUploadProgressInput): void {
  cleanupExpiredUploadProgress();

  const existing = uploadProgressStore.get(input.uploadId);
  const currentPercent = existing?.percent ?? 0;
  const nextPercent = Math.max(currentPercent, clampPercent(input.percent));

  uploadProgressStore.set(input.uploadId, {
    uploadId: input.uploadId,
    tenantId: input.tenantId,
    status: "running",
    percent: Math.min(nextPercent, 99),
    message: input.message,
    updatedAt: Date.now(),
  });
}

export function completeUploadProgress(input: FinishUploadProgressInput): void {
  cleanupExpiredUploadProgress();

  uploadProgressStore.set(input.uploadId, {
    uploadId: input.uploadId,
    tenantId: input.tenantId,
    status: "completed",
    percent: 100,
    message: input.message,
    updatedAt: Date.now(),
    ...(input.summary ? { summary: input.summary } : {}),
  });
}

export function failUploadProgress(input: FinishUploadProgressInput): void {
  cleanupExpiredUploadProgress();

  const existing = uploadProgressStore.get(input.uploadId);
  uploadProgressStore.set(input.uploadId, {
    uploadId: input.uploadId,
    tenantId: input.tenantId,
    status: "failed",
    percent: existing?.percent ?? 0,
    message: input.message,
    updatedAt: Date.now(),
  });
}

export function getUploadProgress(
  uploadId: string,
): UploadProgressRecord | null {
  cleanupExpiredUploadProgress();
  return uploadProgressStore.get(uploadId) ?? null;
}
