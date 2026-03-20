type UploadProgressStatus = "running" | "completed" | "failed";

type UploadProgressRecord = {
  uploadId: string;
  tenantId: string;
  status: UploadProgressStatus;
  percent: number;
  message: string;
  updatedAt: number;
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
};

const uploadProgressStore = new Map<string, UploadProgressRecord>();
const PROGRESS_TTL_MS = 30 * 60 * 1000;

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
