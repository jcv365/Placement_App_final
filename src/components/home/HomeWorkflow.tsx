"use client";

import UploadPanel from "@/components/forms/UploadPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBanner } from "@/components/ui/error-banner";
import { SuccessBanner } from "@/components/ui/success-banner";
import { fetchJson } from "@/lib/client";
import Link from "next/link";
import * as React from "react";

type UploadedJob = {
  id: string;
  title?: string | null;
  companyName?: string | null;
};

type UploadedCandidate = {
  id: string;
  fullName?: string | null;
};

type Application = {
  id: string;
};

type GeneratedEmail = {
  id: string;
  applicationId: string;
  subject: string;
  htmlBody: string;
  outlookDraft?: {
    status: "created" | "skipped" | "failed";
    reason?: string;
  };
};

type OpportunitiesUploadSummary = {
  uploadOutcome: "success" | "partial" | "no_changes" | "queued";
  uploadMessage: string;
  uploadedOpportunities: number;
  createdJobs: number;
  matchedCandidates: number;
  generatedEmails: number;
  failedEmails: number;
  skippedExistingOpportunities: number;
  skippedDuplicateInUpload: number;
  skippedAlreadyExistsInSystem: number;
  skippedOpportunities: Array<{
    role: string;
    companyName: string;
    reason: "duplicate_in_upload" | "already_exists_in_system";
  }>;
  emailFailures: Array<{
    role: string;
    candidateName: string;
    reason: string;
  }>;
};

export default function HomeWorkflow() {
  const [showNew, setShowNew] = React.useState(false);
  const [job, setJob] = React.useState<UploadedJob | null>(null);
  const [candidate, setCandidate] = React.useState<UploadedCandidate | null>(
    null,
  );
  const [application, setApplication] = React.useState<Application | null>(
    null,
  );
  const [creating, setCreating] = React.useState(false);
  const [generatingEmail, setGeneratingEmail] = React.useState(false);
  const [generatedEmail, setGeneratedEmail] =
    React.useState<GeneratedEmail | null>(null);
  const [emailError, setEmailError] = React.useState<string | null>(null);
  const [isAiConnected, setIsAiConnected] = React.useState(false);
  const [companyName, setCompanyName] = React.useState("");
  const [roleTitle, setRoleTitle] = React.useState("");
  const [candidateName, setCandidateName] = React.useState("");
  const [opportunityFile, setOpportunityFile] = React.useState<File | null>(
    null,
  );
  const [uploadingOpportunities, setUploadingOpportunities] =
    React.useState(false);
  const [opportunitiesSummary, setOpportunitiesSummary] =
    React.useState<OpportunitiesUploadSummary | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(
    null,
  );

  const showError = React.useCallback((msg: string) => {
    setActionError(msg);
    setSuccessMessage(null);
  }, []);

  const showSuccess = React.useCallback((msg: string) => {
    setSuccessMessage(msg);
    setActionError(null);
    setTimeout(
      () => setSuccessMessage((prev) => (prev === msg ? null : prev)),
      4000,
    );
  }, []);

  const loadAiConnectionStatus = React.useCallback(async () => {
    try {
      const response = await fetch("/api/ai/status", {
        method: "GET",
        credentials: "include",
      });

      if (response.ok) {
        const payload = (await response.json()) as {
          data?: {
            liteLlmConfigured?: boolean;
          };
        };

        setIsAiConnected(Boolean(payload.data?.liteLlmConfigured));
        return;
      }
    } catch {}

    setIsAiConnected(false);
  }, []);

  React.useEffect(() => {
    const syncConnectionStatus = () => {
      void loadAiConnectionStatus();
    };

    syncConnectionStatus();
    window.addEventListener("storage", syncConnectionStatus);
    window.addEventListener("focus", syncConnectionStatus);

    return () => {
      window.removeEventListener("storage", syncConnectionStatus);
      window.removeEventListener("focus", syncConnectionStatus);
    };
  }, [loadAiConnectionStatus]);

  const canCreate = Boolean(job && candidate);
  const canGenerateEmail = Boolean(
    job?.companyName?.trim() &&
    job?.title?.trim() &&
    candidate?.fullName?.trim(),
  );

  const handleCreate = async () => {
    if (!job || !candidate) return;
    setCreating(true);
    try {
      const created = await fetchJson<Application>("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, candidateId: candidate.id }),
      });
      setApplication(created);
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const handleGenerateEmail = async () => {
    if (!job || !candidate) return;
    if (!canGenerateEmail) {
      const message =
        "Company name, role, and candidate name are required before generating the email.";
      setEmailError(message);
      showError(message);
      return;
    }

    setGeneratingEmail(true);
    setEmailError(null);
    try {
      const draft = await fetchJson<GeneratedEmail>("/api/email/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.id,
          candidateId: candidate.id,
          applicationId: application?.id,
        }),
      });

      setGeneratedEmail(draft);
      if (!application || application.id !== draft.applicationId) {
        setApplication({ id: draft.applicationId });
      }

      if (draft.outlookDraft?.status === "created") {
        showSuccess("Email draft generated and Outlook draft created.");
      } else if (draft.outlookDraft?.status === "skipped") {
        showSuccess(
          `Email draft generated. Outlook draft skipped: ${draft.outlookDraft.reason ?? "No valid opportunity email."}`,
        );
      } else if (draft.outlookDraft?.status === "failed") {
        showSuccess(
          `Email draft generated. Outlook draft failed: ${draft.outlookDraft.reason ?? "Unable to create Outlook draft."}`,
        );
      } else {
        showSuccess("Email draft generated.");
      }
    } catch (error) {
      const message = (error as Error).message;
      setEmailError(message);
      showError(message);
    } finally {
      setGeneratingEmail(false);
    }
  };

  const resetFlow = () => {
    setJob(null);
    setCandidate(null);
    setApplication(null);
    setGeneratedEmail(null);
    setEmailError(null);
    setCompanyName("");
    setRoleTitle("");
    setCandidateName("");
    setActionError(null);
    setSuccessMessage(null);
  };

  const handleUploadOpportunities = async () => {
    if (!opportunityFile) {
      showError("Select a CSV or XLSX opportunities file first.");
      return;
    }

    setUploadingOpportunities(true);
    setOpportunitiesSummary(null);

    try {
      const uploadId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID().replace(/-/g, "")
          : `${Date.now()}${Math.random().toString(16).slice(2)}`;

      const formData = new FormData();
      formData.append("file", opportunityFile);
      formData.append("uploadId", uploadId);

      const response = await fetch("/api/opportunities/upload", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        data?: OpportunitiesUploadSummary;
        error?: {
          message?: string;
          details?: {
            message?: string;
            popupMessage?: string;
            requiresInvestigation?: boolean;
          };
        };
      };

      const requiresInvestigation = Boolean(
        payload?.error?.details?.requiresInvestigation,
      );
      const popupMessage =
        payload?.error?.details?.popupMessage ??
        "AI extraction failed. Investigate and fix before retrying.";

      if (!response.ok || payload?.ok === false) {
        if (requiresInvestigation) {
          showError(popupMessage);
        }
        throw new Error(
          payload?.error?.details?.message ??
            payload?.error?.message ??
            "Upload failed",
        );
      }

      if (payload.data?.uploadOutcome === "queued") {
        // Background processing — poll progress until completed or failed.
        showSuccess("Upload accepted — processing in the background.");

        const deadline = Date.now() + 5 * 60 * 1000;
        while (Date.now() < deadline) {
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, 1500);
          });
          try {
            const resp = await fetch(
              `/api/upload/progress?uploadId=${encodeURIComponent(uploadId)}`,
              { cache: "no-store" },
            );
            if (!resp.ok) continue;
            const prog = (await resp.json()) as {
              ok?: boolean;
              data?: {
                status: "running" | "completed" | "failed";
                percent: number;
                message: string;
                summary?: Record<string, unknown> | null;
              };
            };
            if (!prog.ok || !prog.data) continue;
            if (prog.data.status === "completed") {
              showSuccess(prog.data.message);
              if (prog.data.summary) {
                setOpportunitiesSummary(
                  prog.data.summary as OpportunitiesUploadSummary,
                );
              }
              break;
            }
            if (prog.data.status === "failed") {
              showError(prog.data.message || "Upload processing failed.");
              break;
            }
          } catch {
            // Transient poll failure — keep waiting.
          }
        }
        return;
      }

      setOpportunitiesSummary(payload.data as OpportunitiesUploadSummary);
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setUploadingOpportunities(false);
    }
  };

  return (
    <div className="space-y-8">
      {actionError ? <ErrorBanner message={actionError} /> : null}
      {successMessage ? <SuccessBanner message={successMessage} /> : null}
      <Card className="border-slate-200">
        <CardHeader>
          <CardTitle>Workflow</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 text-sm md:grid-cols-4">
            <div className="rounded border border-slate-200 p-2">
              <p className="font-medium text-slate-900">1. Ingest</p>
              <p className="text-xs text-slate-600">
                Upload jobs and opportunities.
              </p>
            </div>
            <div className="rounded border border-slate-200 p-2">
              <p className="font-medium text-slate-900">2. Match</p>
              <p className="text-xs text-slate-600">
                Review candidate role alignment.
              </p>
            </div>
            <div className="rounded border border-slate-200 p-2">
              <p className="font-medium text-slate-900">3. Draft</p>
              <p className="text-xs text-slate-600">
                Generate, edit, and approve emails.
              </p>
            </div>
            <div className="rounded border border-slate-200 p-2">
              <p className="font-medium text-slate-900">4. Track</p>
              <p className="text-xs text-slate-600">
                Manage applications and delivery.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/jobs">Open ingested roles</Link>
            </Button>
            <Button
              className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
              asChild
            >
              <Link href="/match-review">Open match review</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200">
        <CardHeader>
          <CardTitle>Start from the review queue</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge
              className={
                isAiConnected
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-amber-200 bg-amber-50 text-amber-700"
              }
            >
              AI {isAiConnected ? "Connected" : "Not connected"}
            </Badge>
          </div>
          <p className="text-sm text-slate-600">
            Prioritise new opportunities and approve the best candidate matches
            before creating applications.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/match-review">Review LinkedIn matches</Link>
            </Button>
            <Button
              className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
              onClick={() => setShowNew(true)}
            >
              Start adhoc application
            </Button>
            <Button
              className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
              asChild
            >
              <Link href="/applications">Open applications board</Link>
            </Button>
            <Button
              className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
              asChild
            >
              <Link href="/settings">Open settings</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200">
        <CardHeader>
          <CardTitle>Upload opportunities (CSV/XLSX)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-600">
            Upload a CSV/XLSX file to map roles to matching candidates and start
            email generation.
          </p>
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(event) =>
              setOpportunityFile(event.target.files?.[0] ?? null)
            }
            className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700"
          />
          <Button
            onClick={handleUploadOpportunities}
            disabled={!opportunityFile || uploadingOpportunities}
          >
            {uploadingOpportunities
              ? "Processing opportunities..."
              : "Upload opportunities"}
          </Button>

          {opportunitiesSummary ? (
            <div className="rounded border border-slate-200 p-2 text-xs text-slate-700">
              <p className="font-medium">
                {opportunitiesSummary.uploadMessage}
              </p>
              <p>Opportunities: {opportunitiesSummary.uploadedOpportunities}</p>
              <p>Jobs created: {opportunitiesSummary.createdJobs}</p>
              <p>Matches: {opportunitiesSummary.matchedCandidates}</p>
              <p>Emails: {opportunitiesSummary.generatedEmails}</p>
              <p>Email failures: {opportunitiesSummary.failedEmails}</p>
              <p>
                Existing opportunities skipped:{" "}
                {opportunitiesSummary.skippedExistingOpportunities}
              </p>
              <p>
                Duplicate rows in upload:{" "}
                {opportunitiesSummary.skippedDuplicateInUpload}
              </p>
              <p>
                Already in system:{" "}
                {opportunitiesSummary.skippedAlreadyExistsInSystem}
              </p>
              {opportunitiesSummary.skippedOpportunities.length > 0 ? (
                <div className="mt-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs">
                  <p className="font-medium">Skipped opportunities (sample):</p>
                  {opportunitiesSummary.skippedOpportunities
                    .slice(0, 5)
                    .map((item) => (
                      <p
                        key={`${item.reason}-${item.companyName}-${item.role}`}
                      >
                        {item.companyName || "Unknown company"} -{" "}
                        {item.role || "Unknown role"} (
                        {item.reason === "duplicate_in_upload"
                          ? "duplicate in upload"
                          : "already exists"}
                        )
                      </p>
                    ))}
                </div>
              ) : null}
              {opportunitiesSummary.emailFailures.length > 0 ? (
                <div className="mt-2 space-y-1 rounded border border-amber-200 bg-amber-50 p-2 text-amber-800">
                  <p className="font-medium">Failed email generation:</p>
                  {opportunitiesSummary.emailFailures
                    .slice(0, 3)
                    .map((item) => (
                      <p
                        key={`${item.role}-${item.candidateName}-${item.reason}`}
                      >
                        {item.candidateName} ({item.role}): {item.reason}
                      </p>
                    ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {showNew && (
        <div className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-2">
            <UploadPanel
              title="Job or contract description"
              endpoint="/api/upload/jd"
              helper="Paste the role brief or upload a file and ChatGPT 5.3 will extract role and company."
              metadataFields={[
                {
                  key: "companyName",
                  label: "Company name",
                  value: companyName,
                  onChange: setCompanyName,
                  placeholder: "Optional hint for AI",
                },
                {
                  key: "role",
                  label: "Role",
                  value: roleTitle,
                  onChange: setRoleTitle,
                  placeholder: "Optional hint for AI",
                },
              ]}
              onSuccess={(data) => {
                const uploaded = data as UploadedJob;
                setJob({
                  id: uploaded.id,
                  title: uploaded.title,
                  companyName: uploaded.companyName ?? null,
                });
                const result = data as { warning?: string } | undefined;
                if (result?.warning) {
                  showError(result.warning);
                }
              }}
            />
            <UploadPanel
              title="Engineer CV"
              endpoint="/api/upload/cv"
              helper="Upload the original CV as a PDF file so formatting is preserved."
              acceptedFileTypes=".pdf,application/pdf"
              showTextInput={false}
              metadataFields={[
                {
                  key: "candidateName",
                  label: "Candidate name",
                  value: candidateName,
                  onChange: setCandidateName,
                  placeholder: "Enter candidate name",
                  required: true,
                },
              ]}
              onSuccess={(data) => {
                const uploaded = data as UploadedCandidate;
                setCandidate({ id: uploaded.id, fullName: uploaded.fullName });
              }}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Application summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-sm text-slate-700">
                <p>
                  <span className="font-medium">Company name:</span>{" "}
                  {(job?.companyName ?? companyName) || "Awaiting job upload"}
                </p>
                <p>
                  <span className="font-medium">Role:</span>{" "}
                  {job?.title ?? "Awaiting job upload"}
                </p>
                <p>
                  <span className="font-medium">Engineer:</span>{" "}
                  {candidate?.fullName ?? "Awaiting CV upload"}
                </p>
              </div>

              {application ? (
                <div className="space-y-3">
                  <p className="text-sm text-slate-600">
                    Application created. You can review it on the board or
                    generate a draft below.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <Button asChild>
                      <Link href="/applications">Open board</Link>
                    </Button>
                    <Button
                      className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                      onClick={resetFlow}
                    >
                      Start another
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    onClick={handleCreate}
                    disabled={!canCreate || creating}
                  >
                    {creating ? "Creating..." : "Create application"}
                  </Button>
                  <Button
                    className="bg-transparent text-slate-900 hover:bg-slate-100"
                    onClick={resetFlow}
                  >
                    Reset uploads
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Email draft preview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-slate-600">
                Generate the submission email directly from the uploaded role
                brief and CV. This will use AI and show a preview here.
              </p>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  onClick={handleGenerateEmail}
                  disabled={!canCreate || !canGenerateEmail || generatingEmail}
                >
                  {generatingEmail
                    ? "Generating..."
                    : application
                      ? "Regenerate email"
                      : "Generate email and create application"}
                </Button>
                {application ? (
                  <Button
                    className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                    asChild
                  >
                    <Link href="/applications">Open board</Link>
                  </Button>
                ) : null}
              </div>

              {emailError ? (
                <p className="text-sm text-rose-700">{emailError}</p>
              ) : null}

              {generatedEmail ? (
                <div className="space-y-3 rounded-md border border-slate-200 p-3">
                  <p className="text-sm font-medium text-slate-900">
                    Subject: {generatedEmail.subject}
                  </p>
                  <div
                    className="text-sm text-slate-700"
                    dangerouslySetInnerHTML={{
                      __html: generatedEmail.htmlBody,
                    }}
                  />
                </div>
              ) : (
                <p className="text-sm text-slate-500">
                  No draft generated yet.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
