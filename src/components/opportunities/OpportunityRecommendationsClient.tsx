"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SuccessBanner } from "@/components/ui/success-banner";
import { fetchJson } from "@/lib/client";
import * as React from "react";

type CandidateOption = {
  id: string;
  fullName: string;
  email: string | null;
  status: "ACTIVE" | "NON_ACTIVE" | "PLACED";
};

type OpportunityRecommendation = {
  jobId: string;
  title: string;
  companyName: string;
  createdAt: string;
  opportunityEmail: string | null;
  opportunityUrl: string | null;
  rawText: string;
  score: number;
  reasons: string[];
  matchedSkills: string[];
  matchedRoles: string[];
};

type RecommendationResponse = {
  candidate: {
    id: string;
    fullName: string;
  };
  summary: {
    scoredJobs: number;
    excludedAppliedJobs: number;
    recommendations: number;
  };
  recommendations: OpportunityRecommendation[];
};

type GeneratedEmailResponse = {
  id: string;
  applicationId: string;
  subject: string;
  htmlBody: string;
  skipped?: boolean;
  reason?: string;
  outlookDraft?: {
    status: "created" | "skipped" | "failed";
    reason?: string;
  };
};

type BulkProgress = {
  phase: "generate" | "send";
  current: number;
  total: number;
  succeeded: number;
  failed: number;
};

function scoreBadgeClass(score: number): string {
  if (score >= 75) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (score >= 50) {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function statusLabel(status: CandidateOption["status"]): {
  text: string;
  className: string;
} {
  if (status === "ACTIVE") {
    return {
      text: "Active",
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    };
  }
  if (status === "PLACED") {
    return {
      text: "Placed",
      className: "border-sky-200 bg-sky-50 text-sky-700",
    };
  }
  return {
    text: "Inactive",
    className: "border-slate-200 bg-slate-50 text-slate-500",
  };
}

function EngineerDropdown({
  candidates,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  candidates: CandidateOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [search, setSearch] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const filtered = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return candidates;
    return candidates.filter(
      (c) =>
        c.fullName.toLowerCase().includes(term) ||
        (c.email ?? "").toLowerCase().includes(term),
    );
  }, [candidates, search]);

  const selected = candidates.find((c) => c.id === value);

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <Input
        value={
          open
            ? search
            : selected
              ? `${selected.fullName}${selected.email ? ` (${selected.email})` : ""}`
              : ""
        }
        placeholder={placeholder ?? "Search engineers..."}
        disabled={disabled}
        onFocus={() => {
          setOpen(true);
          setSearch("");
        }}
        onChange={(e) => {
          setSearch(e.target.value);
          if (!open) setOpen(true);
        }}
      />
      {open && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-slate-500">
              No engineers found.
            </div>
          ) : (
            filtered.map((c) => {
              const status = statusLabel(c.status);
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-100 ${
                    c.id === value ? "bg-slate-50 font-medium" : ""
                  }`}
                  onClick={() => {
                    onChange(c.id);
                    setOpen(false);
                    setSearch("");
                  }}
                >
                  <span className="truncate">
                    {c.fullName}
                    {c.email ? (
                      <span className="ml-1 text-slate-500">({c.email})</span>
                    ) : null}
                  </span>
                  <Badge className={`shrink-0 text-[10px] ${status.className}`}>
                    {status.text}
                  </Badge>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getDisplayReasons(item: OpportunityRecommendation): string[] {
  const reasons = item.reasons.filter((reason) => {
    const lowerReason = reason.toLowerCase();
    if (
      item.matchedSkills.length > 0 &&
      /\bskills?\s+matched\b/.test(lowerReason)
    ) {
      return false;
    }
    if (item.matchedRoles.length > 0 && /\brole\s+fit\b/.test(lowerReason)) {
      return false;
    }
    return true;
  });

  return reasons.length > 0
    ? reasons
    : ["Strong overall fit based on engineer profile and opportunity details."];
}

function triggerHtmlPrint(html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.setAttribute("aria-hidden", "true");
    document.body.appendChild(iframe);

    const cleanup = () => {
      iframe.remove();
    };

    const frameWindow = iframe.contentWindow;
    if (!frameWindow) {
      cleanup();
      reject(new Error("Unable to create print frame."));
      return;
    }

    frameWindow.document.open();
    frameWindow.document.write(html);
    frameWindow.document.close();

    // Give the browser a brief moment to lay out before printing.
    window.setTimeout(() => {
      try {
        frameWindow.focus();
        frameWindow.print();
        window.setTimeout(cleanup, 500);
        resolve();
      } catch {
        cleanup();
        reject(new Error("Unable to open print dialog."));
      }
    }, 150);
  });
}

function downloadHtmlFallback(html: string, candidateName: string): void {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const safeName =
    candidateName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "engineer";

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `opportunity-recommendations-${safeName}.html`;
  anchor.click();

  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

export default function OpportunityRecommendationsClient() {
  const [candidates, setCandidates] = React.useState<CandidateOption[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] =
    React.useState<string>("");
  const [loadingCandidates, setLoadingCandidates] = React.useState(true);
  const [loadingRecommendations, setLoadingRecommendations] =
    React.useState(false);
  const [applyingJobId, setApplyingJobId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(
    null,
  );
  const [data, setData] = React.useState<RecommendationResponse | null>(null);
  const [viewingOpportunity, setViewingOpportunity] =
    React.useState<OpportunityRecommendation | null>(null);
  const [bulkProgress, setBulkProgress] = React.useState<BulkProgress | null>(
    null,
  );
  // Maps jobId → { emailDraftId, applicationId, opportunityEmail } after generation
  const [generatedDrafts, setGeneratedDrafts] = React.useState<
    Map<
      string,
      { emailDraftId: string; applicationId: string; opportunityEmail: string }
    >
  >(new Map());
  const [sentJobIds, setSentJobIds] = React.useState<Set<string>>(new Set());
  const bulkAbortRef = React.useRef(false);

  const loadCandidates = React.useCallback(async () => {
    setLoadingCandidates(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const response = await fetchJson<CandidateOption[]>("/api/candidates");
      setCandidates(response);
      if (response.length > 0) {
        setSelectedCandidateId(response[0].id);
      }
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setLoadingCandidates(false);
    }
  }, []);

  const loadRecommendations = React.useCallback(async () => {
    if (!selectedCandidateId) {
      setData(null);
      return;
    }

    setLoadingRecommendations(true);
    setError(null);
    try {
      const response = await fetchJson<RecommendationResponse>(
        `/api/opportunities/recommendations?candidateId=${selectedCandidateId}`,
      );
      setData(response);
    } catch (loadError) {
      setError((loadError as Error).message);
      setData(null);
    } finally {
      setLoadingRecommendations(false);
    }
  }, [selectedCandidateId]);

  const handleApplyAndGenerateEmail = React.useCallback(
    async (jobId: string) => {
      if (!selectedCandidateId) {
        return;
      }

      setApplyingJobId(jobId);
      setError(null);
      setSuccessMessage(null);

      try {
        const generated = await fetchJson<GeneratedEmailResponse>(
          "/api/email/generate",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jobId,
              candidateId: selectedCandidateId,
            }),
          },
        );

        if (generated.outlookDraft?.status === "created") {
          setSuccessMessage(
            "Application created and Outlook draft generated successfully.",
          );
        } else if (generated.outlookDraft?.status === "skipped") {
          setSuccessMessage(
            `Application created and email draft generated. Outlook draft skipped: ${generated.outlookDraft.reason ?? "No valid opportunity email."}`,
          );
        } else if (generated.outlookDraft?.status === "failed") {
          setSuccessMessage(
            `Application created and email draft generated. Outlook draft failed: ${generated.outlookDraft.reason ?? "Unable to create Outlook draft."}`,
          );
        } else {
          setSuccessMessage(
            "Application created and draft email generated using the normal process.",
          );
        }
        await loadRecommendations();
      } catch (applyError) {
        setError((applyError as Error).message);
      } finally {
        setApplyingJobId(null);
      }
    },
    [loadRecommendations, selectedCandidateId],
  );

  const handleBulkGenerate = React.useCallback(async () => {
    if (!selectedCandidateId || !data?.recommendations.length) return;

    bulkAbortRef.current = false;
    setError(null);
    setSuccessMessage(null);
    setGeneratedDrafts(new Map());
    setSentJobIds(new Set());

    const recs = data.recommendations;
    const progress: BulkProgress = {
      phase: "generate",
      current: 0,
      total: recs.length,
      succeeded: 0,
      failed: 0,
    };
    setBulkProgress({ ...progress });

    const drafts = new Map<
      string,
      { emailDraftId: string; applicationId: string; opportunityEmail: string }
    >();

    for (const rec of recs) {
      if (bulkAbortRef.current) break;
      progress.current += 1;
      setBulkProgress({ ...progress });

      try {
        const generated = await fetchJson<GeneratedEmailResponse>(
          "/api/email/generate",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jobId: rec.jobId,
              candidateId: selectedCandidateId,
            }),
          },
        );

        if (generated.skipped) {
          progress.failed += 1;
        } else {
          drafts.set(rec.jobId, {
            emailDraftId: generated.id,
            applicationId: generated.applicationId,
            opportunityEmail: rec.opportunityEmail ?? "",
          });
          progress.succeeded += 1;
        }
      } catch {
        progress.failed += 1;
      }
      setBulkProgress({ ...progress });
    }

    setGeneratedDrafts(drafts);
    setBulkProgress(null);
    setSuccessMessage(
      `Email generation complete: ${progress.succeeded} drafts created, ${progress.failed} failed.`,
    );
    await loadRecommendations();
  }, [data, selectedCandidateId, loadRecommendations]);

  const handleBulkSend = React.useCallback(async () => {
    if (generatedDrafts.size === 0) return;

    bulkAbortRef.current = false;
    setError(null);
    setSuccessMessage(null);

    const entries = Array.from(generatedDrafts.entries());
    const progress: BulkProgress = {
      phase: "send",
      current: 0,
      total: entries.length,
      succeeded: 0,
      failed: 0,
    };
    setBulkProgress({ ...progress });

    const sent = new Set<string>();

    for (const [jobId, draft] of entries) {
      if (bulkAbortRef.current) break;
      progress.current += 1;
      setBulkProgress({ ...progress });

      if (!draft.opportunityEmail) {
        progress.failed += 1;
        setBulkProgress({ ...progress });
        continue;
      }

      try {
        await fetchJson("/api/email/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            applicationId: draft.applicationId,
            emailDraftId: draft.emailDraftId,
            to: [draft.opportunityEmail],
          }),
        });
        sent.add(jobId);
        progress.succeeded += 1;
      } catch {
        progress.failed += 1;
      }
      setBulkProgress({ ...progress });
    }

    setSentJobIds(sent);
    setBulkProgress(null);
    setSuccessMessage(
      `Outlook drafts created: ${progress.succeeded} sent, ${progress.failed} failed.`,
    );
    await loadRecommendations();
  }, [generatedDrafts, loadRecommendations]);

  const handleSaveToPdf = React.useCallback(async () => {
    if (!data || data.recommendations.length === 0) {
      return;
    }

    const selectedCandidate = candidates.find(
      (candidate) => candidate.id === selectedCandidateId,
    );
    const reportDate = new Date().toLocaleString("en-GB");
    const safeCandidateName = escapeHtml(
      data.candidate.fullName || selectedCandidate?.fullName || "Engineer",
    );

    const rows = data.recommendations
      .map((item, index) => {
        const displayReasons = getDisplayReasons(item);
        const reasons = displayReasons
          .map((reason) => `<li>${escapeHtml(reason)}</li>`)
          .join("");
        const skills =
          item.matchedSkills.length > 0
            ? escapeHtml(item.matchedSkills.join(", "))
            : "None";
        const roles =
          item.matchedRoles.length > 0
            ? escapeHtml(item.matchedRoles.join(", "))
            : "None";

        return `
          <section class="recommendation">
            <h3>${index + 1}. ${escapeHtml(item.title)}</h3>
            <p><strong>Company:</strong> ${escapeHtml(item.companyName)}</p>
            <p><strong>Match score:</strong> ${item.score}</p>
            <p><strong>Added:</strong> ${escapeHtml(formatDate(item.createdAt))}</p>
            <p><strong>Matched skills:</strong> ${skills}</p>
            <p><strong>Matched roles:</strong> ${roles}</p>
            <p><strong>Why this match:</strong></p>
            <ul>${reasons}</ul>
          </section>
        `;
      })
      .join("");

    const html = `
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <title>Opportunity recommendations report</title>
          <style>
            body {
              font-family: "Segoe UI", Tahoma, sans-serif;
              color: #0f172a;
              margin: 24px;
              line-height: 1.45;
            }
            h1 {
              margin: 0 0 6px 0;
              font-size: 24px;
            }
            h2 {
              margin: 0 0 16px 0;
              font-size: 16px;
              font-weight: 500;
              color: #334155;
            }
            .meta {
              display: grid;
              grid-template-columns: repeat(3, minmax(0, 1fr));
              gap: 8px;
              border: 1px solid #cbd5e1;
              border-radius: 8px;
              padding: 10px;
              margin-bottom: 18px;
              font-size: 13px;
              background: #f8fafc;
            }
            .recommendation {
              border: 1px solid #e2e8f0;
              border-radius: 8px;
              padding: 12px;
              margin-bottom: 10px;
              page-break-inside: avoid;
            }
            .recommendation h3 {
              margin: 0 0 8px 0;
              font-size: 16px;
            }
            .recommendation p {
              margin: 4px 0;
              font-size: 13px;
            }
            .recommendation ul {
              margin: 6px 0 0 18px;
              padding: 0;
              font-size: 13px;
            }
          </style>
        </head>
        <body>
          <h1>Opportunity recommendations report</h1>
          <h2>Engineer: ${safeCandidateName}</h2>
          <div class="meta">
            <p><strong>Generated:</strong> ${escapeHtml(reportDate)}</p>
            <p><strong>Opportunities scored:</strong> ${data.summary.scoredJobs}</p>
            <p><strong>Recommended:</strong> ${data.summary.recommendations}</p>
          </div>
          ${rows}
        </body>
      </html>
    `;

    try {
      await triggerHtmlPrint(html);
      setSuccessMessage(
        "Print dialog opened. Choose 'Save as PDF' in your browser print destination.",
      );
    } catch {
      downloadHtmlFallback(html, safeCandidateName);
      setSuccessMessage(
        "Print dialog was blocked. Downloaded an HTML report you can print to PDF.",
      );
    }
  }, [candidates, data, selectedCandidateId]);

  React.useEffect(() => {
    loadCandidates();
  }, [loadCandidates]);

  React.useEffect(() => {
    if (!selectedCandidateId) {
      return;
    }

    void loadRecommendations();
  }, [selectedCandidateId, loadRecommendations]);

  return (
    <div className="space-y-4">
      {error ? <ErrorBanner message={error} /> : null}
      {successMessage ? <SuccessBanner message={successMessage} /> : null}
      <Card>
        <CardHeader className="space-y-2">
          <CardTitle>Engineer Opportunity Match</CardTitle>
          <p className="text-sm text-slate-600">
            Pick an engineer to see the highest-rated opportunities they should
            apply for next.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <div className="space-y-1.5">
              <Label>Engineer</Label>
              <EngineerDropdown
                candidates={candidates}
                value={selectedCandidateId}
                onChange={setSelectedCandidateId}
                disabled={loadingCandidates || candidates.length === 0}
                placeholder={
                  loadingCandidates
                    ? "Loading engineers..."
                    : "Search engineers..."
                }
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => void loadRecommendations()}
                disabled={!selectedCandidateId || loadingRecommendations}
              >
                {loadingRecommendations ? "Scoring..." : "Refresh ranking"}
              </Button>
              <Button
                onClick={() => void handleBulkGenerate()}
                disabled={
                  !data ||
                  data.recommendations.length === 0 ||
                  Boolean(bulkProgress)
                }
              >
                {bulkProgress?.phase === "generate"
                  ? `Generating ${bulkProgress.current}/${bulkProgress.total}...`
                  : "Generate emails"}
              </Button>
              <Button
                onClick={() => void handleBulkSend()}
                disabled={generatedDrafts.size === 0 || Boolean(bulkProgress)}
              >
                {bulkProgress?.phase === "send"
                  ? `Sending ${bulkProgress.current}/${bulkProgress.total}...`
                  : `Send draft emails${generatedDrafts.size > 0 ? ` (${generatedDrafts.size})` : ""}`}
              </Button>
              <Button
                variant="outline"
                onClick={handleSaveToPdf}
                disabled={!data || data.recommendations.length === 0}
              >
                Save to PDF
              </Button>
            </div>
          </div>

          {bulkProgress ? (
            <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-slate-700">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-medium">
                  {bulkProgress.phase === "generate"
                    ? "Generating email drafts..."
                    : "Creating Outlook drafts..."}
                </span>
                <span>
                  {bulkProgress.current} / {bulkProgress.total}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-sky-200">
                <div
                  className="h-full rounded-full bg-sky-600 transition-all"
                  style={{
                    width: `${Math.round((bulkProgress.current / bulkProgress.total) * 100)}%`,
                  }}
                />
              </div>
              <div className="mt-1 flex gap-3 text-xs">
                <span className="text-emerald-700">
                  {bulkProgress.succeeded} succeeded
                </span>
                {bulkProgress.failed > 0 ? (
                  <span className="text-red-600">
                    {bulkProgress.failed} failed
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          {data ? (
            <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 md:grid-cols-3">
              <p>
                Opportunities scored: <strong>{data.summary.scoredJobs}</strong>
              </p>
              <p>
                Already applied:{" "}
                <strong>{data.summary.excludedAppliedJobs}</strong>
              </p>
              <p>
                Recommended: <strong>{data.summary.recommendations}</strong>
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {data && data.recommendations.length === 0 ? (
        <Card>
          <CardContent className="pt-4 text-sm text-slate-700">
            No strong opportunity matches were found for this engineer yet.
            Upload more opportunities or enrich candidate skills and roles.
          </CardContent>
        </Card>
      ) : null}

      {data?.recommendations.map((item) => (
        <Card key={item.jobId}>
          <CardHeader className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base text-slate-900">
                {item.title}
              </CardTitle>
              <Badge className={scoreBadgeClass(item.score)}>
                Match score: {item.score}
              </Badge>
            </div>
            <p className="text-sm text-slate-600">
              {item.companyName} | Added {formatDate(item.createdAt)}
            </p>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-slate-700">
            {getDisplayReasons(item).map((reason) => (
              <p key={`${item.jobId}-${reason}`}>{reason}</p>
            ))}

            {item.matchedSkills.length > 0 ? (
              <p>
                Matched skills: <strong>{item.matchedSkills.join(", ")}</strong>
              </p>
            ) : null}

            {item.matchedRoles.length > 0 ? (
              <p>
                Matched roles: <strong>{item.matchedRoles.join(", ")}</strong>
              </p>
            ) : null}

            <div className="flex flex-wrap gap-3 pt-1">
              <button
                type="button"
                className="text-sm font-medium text-sky-700 underline underline-offset-4"
                onClick={() => setViewingOpportunity(item)}
              >
                View opportunity
              </button>

              {item.opportunityEmail ? (
                <a
                  href={`mailto:${item.opportunityEmail}`}
                  className="text-sm font-medium text-sky-700 underline underline-offset-4"
                >
                  Email opportunity owner
                </a>
              ) : null}

              <Button
                onClick={() => void handleApplyAndGenerateEmail(item.jobId)}
                disabled={Boolean(applyingJobId) || Boolean(bulkProgress)}
                className="h-8"
              >
                {applyingJobId === item.jobId
                  ? "Applying..."
                  : "Apply and generate email"}
              </Button>
              {generatedDrafts.has(item.jobId) ? (
                <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
                  {sentJobIds.has(item.jobId) ? "Sent" : "Draft ready"}
                </Badge>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ))}

      <Dialog
        open={Boolean(viewingOpportunity)}
        onOpenChange={(open) => {
          if (!open) setViewingOpportunity(null);
        }}
      >
        <DialogContent className="max-h-[85vh] w-[90vw] max-w-2xl overflow-y-auto">
          {viewingOpportunity ? (
            <>
              <DialogHeader>
                <DialogTitle>{viewingOpportunity.title}</DialogTitle>
                <p className="text-sm text-slate-600">
                  {viewingOpportunity.companyName} | Added{" "}
                  {formatDate(viewingOpportunity.createdAt)}
                </p>
              </DialogHeader>

              <div className="space-y-3 text-sm text-slate-700">
                {viewingOpportunity.opportunityEmail ? (
                  <p>
                    <strong>Contact email:</strong>{" "}
                    {viewingOpportunity.opportunityEmail}
                  </p>
                ) : null}

                <div className="flex items-center gap-2">
                  <Badge className={scoreBadgeClass(viewingOpportunity.score)}>
                    Match score: {viewingOpportunity.score}
                  </Badge>
                </div>

                <div>
                  <strong>Opportunity details:</strong>
                  <pre className="mt-1 max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 font-sans text-sm leading-relaxed">
                    {viewingOpportunity.rawText}
                  </pre>
                </div>
              </div>

              <div className="mt-4 flex justify-end">
                <DialogClose asChild>
                  <Button variant="outline">Close</Button>
                </DialogClose>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
