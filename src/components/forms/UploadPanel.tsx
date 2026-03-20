"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { uploadFormDataJson } from "@/lib/client";
import * as React from "react";

const DEFAULT_UPLOAD_TIMEOUT_MS = 300_000;

type UploadPanelResponse = {
  ok?: boolean;
  data?: unknown;
  error?: {
    message?: string;
    details?: {
      message?: string;
      hint?: string;
    };
  };
};

type UploadProgressResponse = {
  status: "running" | "completed" | "failed";
  percent: number;
  message: string;
  updatedAt: number;
};

export default function UploadPanel({
  title,
  endpoint,
  helper,
  onSuccess,
  metadataFields,
  timeoutMs = DEFAULT_UPLOAD_TIMEOUT_MS,
}: {
  title: string;
  endpoint: string;
  helper: string;
  onSuccess?: (data: unknown) => void;
  timeoutMs?: number;
  metadataFields?: {
    key: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    required?: boolean;
  }[];
}) {
  const [text, setText] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [uploaded, setUploaded] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [uploadProgressPercent, setUploadProgressPercent] =
    React.useState<number>(0);
  const [uploadTransferPercent, setUploadTransferPercent] =
    React.useState<number>(0);
  const [uploadProcessingPercent, setUploadProcessingPercent] =
    React.useState<number>(0);
  const [uploadPhaseMessage, setUploadPhaseMessage] =
    React.useState("Uploading file.");
  const [hasServerProgress, setHasServerProgress] = React.useState(false);
  const [validationError, setValidationError] = React.useState<string | null>(
    null,
  );

  const missingRequiredFields = (metadataFields ?? []).filter(
    (field) => field.required && !field.value.trim(),
  );

  const handleSubmit = async () => {
    if (missingRequiredFields.length > 0) {
      setValidationError(
        `Please complete: ${missingRequiredFields.map((field) => field.label).join(", ")}.`,
      );
      return;
    }

    setValidationError(null);
    setLoading(true);
    setUploadProgressPercent(0);
    setUploadTransferPercent(0);
    setUploadProcessingPercent(0);
    setUploadPhaseMessage("Uploading file.");
    setHasServerProgress(false);
    setUploaded(false);
    try {
      const formData = new FormData();
      if (text) {
        formData.append("text", text);
      }
      if (file) {
        formData.append("file", file);
      }

      const uploadId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID().replace(/-/g, "")
          : `${Date.now()}${Math.random().toString(16).slice(2)}`;
      formData.append("uploadId", uploadId);

      const githubAccessToken =
        typeof window !== "undefined"
          ? localStorage.getItem("githubAccessToken")
          : null;
      if (githubAccessToken) {
        formData.append("githubAccessToken", githubAccessToken);
      }

      for (const field of metadataFields ?? []) {
        if (field.value.trim()) {
          formData.append(field.key, field.value.trim());
        }
      }

      let shouldPoll = true;
      const pollServerProgress = async () => {
        if (!shouldPoll) {
          return;
        }

        try {
          const response = await fetch(
            `/api/upload/progress?uploadId=${encodeURIComponent(uploadId)}`,
            {
              method: "GET",
              cache: "no-store",
            },
          );

          if (!response.ok) {
            return;
          }

          const payload = (await response.json()) as {
            ok?: boolean;
            data?: UploadProgressResponse;
          };

          if (!payload.ok || !payload.data) {
            return;
          }

          setHasServerProgress(true);
          setUploadProcessingPercent(payload.data.percent);
          setUploadPhaseMessage(payload.data.message);
        } catch {
          // Ignore polling errors and keep upload running.
        }
      };

      const pollInterval = window.setInterval(() => {
        void pollServerProgress();
      }, 1000);
      void pollServerProgress();

      const result = await (async () => {
        try {
          return await uploadFormDataJson<UploadPanelResponse>({
            endpoint,
            formData,
            timeoutMs,
            onProgress: (percent) => {
              setUploadTransferPercent(percent);
              if (percent >= 100) {
                setUploadPhaseMessage("File uploaded. Processing request.");
              }
            },
          });
        } finally {
          shouldPoll = false;
          window.clearInterval(pollInterval);
        }
      })();

      const data = result.payload;

      if (!result.ok || !data || data?.ok === false) {
        const errorParts = [
          data?.error?.details?.message,
          data?.error?.details?.hint,
          data?.error?.message,
          !data && !result.ok
            ? `Upload failed with HTTP ${result.status}`
            : undefined,
        ].filter((part): part is string => Boolean(part));

        const errorMessage = Array.from(new Set(errorParts)).join("\n");
        throw new Error(errorMessage || "Upload failed");
      }

      setUploadTransferPercent(100);
      setUploadProcessingPercent(100);
      setUploadProgressPercent(100);
      setUploadPhaseMessage("Upload complete.");
      setUploaded(true);
      onSuccess?.(data.data);
    } catch (error) {
      alert((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    const nextProgress = hasServerProgress
      ? Math.min(
          100,
          Math.round(
            uploadTransferPercent * 0.35 + uploadProcessingPercent * 0.65,
          ),
        )
      : uploadTransferPercent;
    setUploadProgressPercent(nextProgress);
  }, [hasServerProgress, uploadProcessingPercent, uploadTransferPercent]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="text-sm text-slate-600">{helper}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {(metadataFields ?? []).map((field) => (
          <div key={field.key} className="space-y-1">
            <label className="text-sm font-medium text-slate-700">
              {field.label}
              {field.required ? " *" : ""}
            </label>
            <Input
              value={field.value}
              onChange={(event) => field.onChange(event.target.value)}
              placeholder={field.placeholder}
              required={field.required}
            />
          </div>
        ))}
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Paste text (optional)"
        />
        <Input
          type="file"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        <Button
          onClick={handleSubmit}
          disabled={loading || missingRequiredFields.length > 0}
        >
          {loading ? "Uploading..." : "Upload"}
        </Button>

        {loading ? (
          <div className="space-y-1" role="status" aria-live="polite">
            <div className="h-2 w-full overflow-hidden rounded bg-slate-200">
              <div
                className="h-full rounded bg-blue-600 transition-all"
                style={{ width: `${uploadProgressPercent}%` }}
              />
            </div>
            <p className="text-xs text-slate-600">
              Upload progress: {uploadProgressPercent}% - {uploadPhaseMessage}
            </p>
          </div>
        ) : null}

        {validationError ? (
          <p className="text-sm text-rose-700">{validationError}</p>
        ) : null}

        {uploaded ? (
          <p className="text-sm text-emerald-700">Uploaded successfully.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
