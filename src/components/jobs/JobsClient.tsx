"use client";

import UploadPanel from "@/components/forms/UploadPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Input } from "@/components/ui/input";
import { SuccessBanner } from "@/components/ui/success-banner";
import { fetchJson, uploadFormDataJson } from "@/lib/client";
import Link from "next/link";
import * as React from "react";

type JobsUploadSummary = {
  uploadOutcome: "success" | "partial" | "no_changes";
  uploadMessage: string;
  uploadedOpportunities: number;
  createdJobs: number;
  matchedCandidates: number;
  generatedEmails: number;
  failedEmails: number;
  skippedExistingOpportunities: number;
};

type OpportunitiesUploadResponse = {
  ok?: boolean;
  data?: JobsUploadSummary;
  error?: {
    message?: string;
    details?: {
      message?: string;
      popupMessage?: string;
      requiresInvestigation?: boolean;
    };
  };
};

type UploadProgressResponse = {
  status: "running" | "completed" | "failed";
  percent: number;
  message: string;
  updatedAt: number;
};

type DeletionRequestResponse = {
  id: string;
  entityId: string;
  action: string;
  createdAt: string;
};

type PendingDeletionRequest = {
  id: string;
  entityId: string;
  action: string;
  createdAt: string;
  resourceType: "job" | null;
};

type Job = {
  id: string;
  title: string;
  rawText: string;
  opportunityEmail?: string | null;
  opportunityUrl?: string | null;
  createdAt: string;
  company?: {
    name: string;
  } | null;
};

function getSource(job: Job): "LinkedIn" | "Upload" {
  const blob = `${job.opportunityUrl ?? ""} ${job.rawText}`.toLowerCase();
  return blob.includes("linkedin") ? "LinkedIn" : "Upload";
}

function cleanText(value: string): string {
  return value
    .replace(/\uFFFD/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function truncateText(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, Math.max(0, limit - 3)).trim()}...`;
}

function normaliseRoleTitle(title: string, rawText: string): string {
  const cleanTitle = cleanText(title).replace(/^linkedin opportunity:\s*/i, "");
  if (
    cleanTitle &&
    cleanTitle.length <= 90 &&
    !cleanTitle.toLowerCase().includes("http")
  ) {
    return cleanTitle;
  }

  const firstSentence = cleanText(rawText)
    .replace(/^linkedin opportunity:\s*/i, "")
    .split(/[.\n]/)
    .map((part) => part.trim())
    .find(Boolean);

  return truncateText(firstSentence || cleanTitle || "Untitled role", 90);
}

export default function JobsClient() {
  const [jobs, setJobs] = React.useState<Job[]>([]);
  const [search, setSearch] = React.useState("");
  const [jobCompanyName, setJobCompanyName] = React.useState("");
  const [jobRoleTitle, setJobRoleTitle] = React.useState("");
  const [opportunityFile, setOpportunityFile] = React.useState<File | null>(
    null,
  );
  const [uploadingOpportunities, setUploadingOpportunities] =
    React.useState(false);
  const [
    opportunitiesUploadTransferPercent,
    setOpportunitiesUploadTransferPercent,
  ] = React.useState(0);
  const [
    opportunitiesUploadProcessingPercent,
    setOpportunitiesUploadProcessingPercent,
  ] = React.useState(0);
  const [opportunitiesUploadPhaseMessage, setOpportunitiesUploadPhaseMessage] =
    React.useState("Uploading file.");
  const [hasServerProgress, setHasServerProgress] = React.useState(false);
  const [requestingJobId, setRequestingJobId] = React.useState<string | null>(
    null,
  );
  const [uploadSummary, setUploadSummary] =
    React.useState<JobsUploadSummary | null>(null);
  const [previewJob, setPreviewJob] = React.useState<Job | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(
    null,
  );
  const [pendingJobIds, setPendingJobIds] = React.useState<Set<string>>(
    new Set(),
  );

  const load = React.useCallback(async () => {
    const [data, pending] = await Promise.all([
      fetchJson<Job[]>("/api/jobs"),
      fetchJson<PendingDeletionRequest[]>(
        "/api/deletion-requests?resourceType=job",
      ),
    ]);
    setJobs(data);
    setPendingJobIds(new Set(pending.map((item) => item.entityId)));
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const opportunitiesUploadProgressPercent = React.useMemo(() => {
    if (!hasServerProgress) {
      return opportunitiesUploadTransferPercent;
    }

    const weightedTransfer = opportunitiesUploadTransferPercent * 0.35;
    const weightedProcessing = opportunitiesUploadProcessingPercent * 0.65;
    return Math.min(100, Math.round(weightedTransfer + weightedProcessing));
  }, [
    hasServerProgress,
    opportunitiesUploadTransferPercent,
    opportunitiesUploadProcessingPercent,
  ]);

  const handleUploadOpportunities = async () => {
    if (!opportunityFile) {
      setErrorMessage("Select a CSV or XLSX opportunities file first.");
      return;
    }

    setErrorMessage(null);
    setSuccessMessage(null);
    setUploadingOpportunities(true);
    setOpportunitiesUploadTransferPercent(0);
    setOpportunitiesUploadProcessingPercent(0);
    setOpportunitiesUploadPhaseMessage("Uploading file.");
    setHasServerProgress(false);
    setUploadSummary(null);

    try {
      const formData = new FormData();
      formData.append("file", opportunityFile);
      const uploadId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID().replace(/-/g, "")
          : `${Date.now()}${Math.random().toString(16).slice(2)}`;
      formData.append("uploadId", uploadId);

      const githubAccessToken =
        typeof window !== "undefined"
          ? localStorage.getItem("githubAccessToken")
          : null;
      const aiProvider =
        typeof window !== "undefined"
          ? localStorage.getItem("aiProvider")
          : null;
      if (githubAccessToken) {
        formData.append("githubAccessToken", githubAccessToken);
      }
      if (aiProvider) {
        formData.append("aiProvider", aiProvider);
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
          setOpportunitiesUploadProcessingPercent(payload.data.percent);
          setOpportunitiesUploadPhaseMessage(payload.data.message);
        } catch {
          // Keep polling quietly; transient network issues should not break upload.
        }
      };

      const pollInterval = window.setInterval(() => {
        void pollServerProgress();
      }, 1000);
      void pollServerProgress();

      const result = await (async () => {
        try {
          return await uploadFormDataJson<OpportunitiesUploadResponse>({
            endpoint: "/api/opportunities/upload",
            formData,
            onProgress: (percent) => {
              setOpportunitiesUploadTransferPercent(percent);
              if (percent >= 100) {
                setOpportunitiesUploadPhaseMessage(
                  "File uploaded. Processing opportunities.",
                );
              }
            },
          });
        } finally {
          shouldPoll = false;
          window.clearInterval(pollInterval);
        }
      })();

      const payload = result.payload;

      if (!payload) {
        throw new Error(`Upload failed with HTTP ${result.status}`);
      }

      const requiresInvestigation = Boolean(
        payload?.error?.details?.requiresInvestigation,
      );
      const popupMessage =
        payload?.error?.details?.popupMessage ??
        "AI extraction failed. Investigate and fix before retrying.";

      if (!result.ok || payload?.ok === false) {
        if (requiresInvestigation) {
          alert(popupMessage);
        }
        throw new Error(
          payload?.error?.details?.message ??
            payload?.error?.message ??
            "Upload failed",
        );
      }

      const summary = payload.data;
      if (!summary) {
        throw new Error("Upload succeeded but no summary was returned");
      }
      setOpportunitiesUploadTransferPercent(100);
      setOpportunitiesUploadProcessingPercent(100);
      setOpportunitiesUploadPhaseMessage("Upload complete.");
      setUploadSummary(summary);

      if (summary.uploadOutcome === "partial") {
        setSuccessMessage(
          `${summary.uploadMessage} Check the summary for failed email details.`,
        );
      } else {
        setSuccessMessage(summary.uploadMessage);
      }
      await load();
    } catch (error) {
      const message = (error as Error).message || "Upload failed";
      if (/^Upload timed out after/i.test(message)) {
        setErrorMessage(
          "Upload is taking too long. Keep this page open and retry, or reconnect your AI provider if delays continue.",
        );
      } else {
        setErrorMessage(message);
      }
    } finally {
      setUploadingOpportunities(false);
    }
  };

  const handleRequestDeleteJob = async (jobId: string) => {
    const proceed = window.confirm(
      "Submit a deletion request for this record? An admin must approve it before anything is removed.",
    );
    if (!proceed) {
      return;
    }

    setRequestingJobId(jobId);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await fetchJson<DeletionRequestResponse>("/api/deletion-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resourceType: "job",
          resourceId: jobId,
        }),
      });

      setSuccessMessage(
        "Deletion request submitted. It will appear in the Admin console for approval.",
      );
      setPendingJobIds((current) => {
        const next = new Set(current);
        next.add(jobId);
        return next;
      });
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setRequestingJobId(null);
    }
  };

  const filteredJobs = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return jobs;
    }

    return jobs.filter((job) => {
      const company = job.company?.name ?? "";
      return (
        job.title.toLowerCase().includes(term) ||
        company.toLowerCase().includes(term) ||
        job.rawText.toLowerCase().includes(term)
      );
    });
  }, [jobs, search]);

  return (
    <div className="space-y-6">
      {errorMessage ? <ErrorBanner message={errorMessage} /> : null}
      {successMessage ? <SuccessBanner message={successMessage} /> : null}

      <UploadPanel
        title="Upload a job description"
        endpoint="/api/upload/jd"
        helper="Paste the JD or upload a file and ChatGPT 5.3 will extract role and company."
        metadataFields={[
          {
            key: "companyName",
            label: "Company name",
            value: jobCompanyName,
            onChange: setJobCompanyName,
            placeholder: "Optional hint for AI",
          },
          {
            key: "role",
            label: "Role",
            value: jobRoleTitle,
            onChange: setJobRoleTitle,
            placeholder: "Optional hint for AI",
          },
        ]}
        onSuccess={() => load()}
      />

      <Card>
        <CardHeader>
          <CardTitle>Upload opportunities (CSV/XLSX)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-600">
            Upload opportunities and the app will map them to matching active
            candidates and start generating submission emails.
          </p>
          <Input
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(event) =>
              setOpportunityFile(event.target.files?.[0] ?? null)
            }
          />
          <Button
            onClick={handleUploadOpportunities}
            disabled={!opportunityFile || uploadingOpportunities}
          >
            {uploadingOpportunities
              ? "Processing opportunities..."
              : "Upload opportunities"}
          </Button>

          {uploadingOpportunities ? (
            <div className="space-y-1" role="status" aria-live="polite">
              <div className="h-2 w-full overflow-hidden rounded bg-slate-200">
                <div
                  className="h-full rounded bg-blue-600 transition-all"
                  style={{ width: `${opportunitiesUploadProgressPercent}%` }}
                />
              </div>
              <p className="text-xs text-slate-600">
                Upload progress: {opportunitiesUploadProgressPercent}% -{" "}
                {opportunitiesUploadPhaseMessage}
              </p>
            </div>
          ) : null}

          {uploadSummary ? (
            <div className="rounded border border-slate-200 p-3 text-sm text-slate-700">
              <p className="font-medium">{uploadSummary.uploadMessage}</p>
              <p>
                Opportunities uploaded: {uploadSummary.uploadedOpportunities}
              </p>
              <p>Jobs created: {uploadSummary.createdJobs}</p>
              <p>Candidate matches: {uploadSummary.matchedCandidates}</p>
              <p>Emails generated: {uploadSummary.generatedEmails}</p>
              <p>Email failures: {uploadSummary.failedEmails}</p>
              <p>
                Existing opportunities skipped:{" "}
                {uploadSummary.skippedExistingOpportunities}
              </p>
            </div>
          ) : null}

          <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-slate-700">
            Deletion requests now require admin approval in the Admin console.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent jobs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by role, company, or keyword"
          />
          {filteredJobs.length === 0 ? (
            <div className="rounded border border-dashed border-slate-300 p-4 text-sm text-slate-600">
              {jobs.length === 0
                ? "No jobs yet. Upload a job description or opportunities file to start matching."
                : "No jobs match your search."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-2 py-2">Role</th>
                    <th className="px-2 py-2">Company</th>
                    <th className="px-2 py-2">Source</th>
                    <th className="px-2 py-2">Created</th>
                    <th className="px-2 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredJobs.map((job) => (
                    <tr key={job.id} className="border-b border-slate-100">
                      <td className="px-2 py-2 font-medium text-slate-900">
                        <div className="max-w-[340px]">
                          {normaliseRoleTitle(job.title, job.rawText)}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-slate-700">
                        {job.company?.name?.trim() || "Unknown"}
                      </td>
                      <td className="px-2 py-2 text-slate-700">
                        {getSource(job)}
                      </td>
                      <td className="px-2 py-2 text-slate-700">
                        {new Date(job.createdAt).toLocaleString("en-GB")}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            className="h-8 border border-slate-300 bg-white px-2 text-xs text-slate-900 hover:bg-slate-50"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setPreviewJob(job);
                            }}
                          >
                            Preview
                          </Button>
                          <Button
                            asChild
                            type="button"
                            aria-label={`Review matches for ${job.title}`}
                            className="h-8 border border-slate-300 bg-white px-2 text-xs text-slate-900 hover:bg-slate-50"
                          >
                            <Link href={`/match-review?jobId=${job.id}`}>
                              Review matches
                            </Link>
                          </Button>
                          <Button
                            type="button"
                            className="h-8 border border-slate-300 bg-white px-2 text-xs text-slate-900 hover:bg-slate-50"
                            disabled={
                              requestingJobId === job.id ||
                              pendingJobIds.has(job.id)
                            }
                            onClick={() => handleRequestDeleteJob(job.id)}
                          >
                            {requestingJobId === job.id
                              ? "Requesting..."
                              : pendingJobIds.has(job.id)
                                ? "Pending"
                                : "Request delete"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={!!previewJob}
        onOpenChange={(open: boolean) => !open && setPreviewJob(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Job preview</DialogTitle>
          </DialogHeader>
          {previewJob ? (
            <div className="space-y-3 text-sm text-slate-700">
              <p className="font-medium text-slate-900">
                {cleanText(previewJob.title)}
              </p>
              <p>Company: {previewJob.company?.name?.trim() || "Unknown"}</p>
              <p>
                Created:{" "}
                {new Date(previewJob.createdAt).toLocaleString("en-GB")}
              </p>
              <p>
                Contact email:{" "}
                {previewJob.opportunityEmail?.trim() || "Unknown"}
              </p>
              <p className="whitespace-pre-wrap rounded-md border border-slate-200 p-3">
                {cleanText(previewJob.rawText)}
              </p>
              {previewJob.opportunityUrl ? (
                <Button
                  asChild
                  className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                >
                  <Link
                    href={previewJob.opportunityUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View full post
                  </Link>
                </Button>
              ) : null}
              <Button
                type="button"
                className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                onClick={() => setPreviewJob(null)}
              >
                Close
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
