"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchJson } from "@/lib/client";
import Link from "next/link";
import * as React from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

type EmailLogEntry = {
  id: string;
  subject: string;
  createdAt: string;
  applicationId: string;
  preferredForLearning: boolean;
  candidate: { id: string; fullName: string; email: string | null };
  job: {
    id: string;
    title: string;
    opportunityEmail: string | null;
    company: { name: string } | null;
  };
};

type EmailLogResponse = {
  items: EmailLogEntry[];
  total: number;
  page: number;
  pageSize: number;
};

type ApplicationSummary = {
  id: string;
  jobId: string;
  candidateId: string;
  currentStage: string;
  emails: Array<{ id: string }>;
  job: { title: string; company: { name: string } | null } | null;
  candidate: { fullName: string; email: string | null } | null;
};

type RepairDraftResult = {
  dbPairs: number;
  alreadyInMailbox: number;
  repaired: number;
  failed: number;
  skippedNoEmail: number;
};

type GeneratedEmailResponse = {
  id: string;
  applicationId: string;
  outlookDraft?: {
    status: "created" | "skipped" | "failed";
    reason?: string;
  };
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function EmailLogClient() {
  const [activeTab, setActiveTab] = React.useState<
    "generated" | "pending" | "repair"
  >("generated");

  // --- Generated tab state ---
  const [date, setDate] = React.useState("");
  const [candidateSearch, setCandidateSearch] = React.useState("");
  const [appliedSearch, setAppliedSearch] = React.useState("");
  const [generated, setGenerated] = React.useState<EmailLogEntry[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [loadingGenerated, setLoadingGenerated] = React.useState(false);
  const [generatedError, setGeneratedError] = React.useState<string | null>(
    null,
  );

  // --- Not yet emailed tab state ---
  const [noEmail, setNoEmail] = React.useState<ApplicationSummary[]>([]);
  const [loadingNoEmail, setLoadingNoEmail] = React.useState(false);
  const [noEmailError, setNoEmailError] = React.useState<string | null>(null);
  const [bulkGenerating, setBulkGenerating] = React.useState(false);
  const [bulkProgress, setBulkProgress] = React.useState({
    done: 0,
    total: 0,
    failed: 0,
  });
  const [bulkResult, setBulkResult] = React.useState<string | null>(null);

  // --- Mailbox repair tab state ---
  const [repairingDrafts, setRepairingDrafts] = React.useState(false);
  const [repairResult, setRepairResult] =
    React.useState<RepairDraftResult | null>(null);
  const [repairError, setRepairError] = React.useState<string | null>(null);

  const pageSize = 50;

  // Fetch generated emails
  const fetchGenerated = React.useCallback(
    async (targetDate: string, search: string, targetPage: number) => {
      setLoadingGenerated(true);
      setGeneratedError(null);
      try {
        const params = new URLSearchParams({
          date: targetDate,
          page: String(targetPage),
          pageSize: String(pageSize),
        });
        if (search) params.set("candidateName", search);
        const data = await fetchJson<EmailLogResponse>(
          `/api/email/log?${params}`,
        );
        setGenerated(data.items);
        setTotal(data.total);
      } catch (error) {
        setGeneratedError((error as Error).message);
      } finally {
        setLoadingGenerated(false);
      }
    },
    [],
  );

  // Fetch apps with no email drafts
  const fetchNoEmail = React.useCallback(async () => {
    setLoadingNoEmail(true);
    setNoEmailError(null);
    try {
      const apps = await fetchJson<ApplicationSummary[]>("/api/applications");
      const missing = apps.filter((a) => (a.emails?.length ?? 0) === 0);
      setNoEmail(missing);
    } catch (error) {
      setNoEmailError((error as Error).message);
    } finally {
      setLoadingNoEmail(false);
    }
  }, []);

  // Load generated on mount and when tab switches to generated
  React.useEffect(() => {
    if (activeTab === "generated") {
      void fetchGenerated(date, appliedSearch, 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Load no-email list when tab switches
  React.useEffect(() => {
    if (activeTab === "pending") {
      void fetchNoEmail();
    }
  }, [activeTab, fetchNoEmail]);

  const handleRepairDrafts = async () => {
    setRepairingDrafts(true);
    setRepairResult(null);
    setRepairError(null);
    try {
      const result = await fetchJson<RepairDraftResult>(
        "/api/email/repair-drafts",
        { method: "POST" },
      );
      setRepairResult(result);
    } catch (error) {
      setRepairError((error as Error).message || "Repair failed");
    } finally {
      setRepairingDrafts(false);
    }
  };

  const handleBulkGenerateEmails = async () => {
    if (noEmail.length === 0) return;
    setBulkGenerating(true);
    setBulkResult(null);
    const total = noEmail.length;
    setBulkProgress({ done: 0, total, failed: 0 });

    let done = 0;
    let failed = 0;
    let skippedOutlook = 0;
    let failedOutlook = 0;

    for (const app of noEmail) {
      try {
        const generated = await fetchJson<GeneratedEmailResponse>(
          "/api/email/generate",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jobId: app.jobId,
              candidateId: app.candidateId,
              applicationId: app.id,
            }),
          },
        );
        if (generated.outlookDraft?.status === "skipped") skippedOutlook += 1;
        if (generated.outlookDraft?.status === "failed") failedOutlook += 1;
        done += 1;
      } catch {
        failed += 1;
      }
      setBulkProgress({ done: done + failed, total, failed });
    }

    await fetchNoEmail();
    setBulkGenerating(false);
    const deliveryNote =
      skippedOutlook > 0 || failedOutlook > 0
        ? ` Outlook delivery: ${done - skippedOutlook - failedOutlook} created, ${skippedOutlook} skipped, ${failedOutlook} failed.`
        : "";
    setBulkResult(
      `Bulk generation complete: ${done} drafted${failed > 0 ? `, ${failed} failed` : ""}.${deliveryNote}`,
    );
  };

  const handleApplyFilter = () => {
    setAppliedSearch(candidateSearch);
    setPage(1);
    void fetchGenerated(date, candidateSearch, 1);
  };

  const handleDateChange = (newDate: string) => {
    setDate(newDate);
    setPage(1);
    void fetchGenerated(newDate, appliedSearch, 1);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    void fetchGenerated(date, appliedSearch, newPage);
  };

  const totalPages = Math.ceil(total / pageSize);

  /* ------------------------------------------------------------------ */
  /*  Render                                                              */
  /* ------------------------------------------------------------------ */

  return (
    <div className="space-y-4">
      {/* Tab switcher */}
      <div className="flex gap-1 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setActiveTab("generated")}
          className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "generated"
              ? "border-slate-900 text-slate-900"
              : "border-transparent text-slate-600 hover:text-slate-900"
          }`}
        >
          Generated
          {total > 0 && activeTab === "generated" ? (
            <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
              {total}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("pending")}
          className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "pending"
              ? "border-slate-900 text-slate-900"
              : "border-transparent text-slate-600 hover:text-slate-900"
          }`}
        >
          Not yet emailed
          {noEmail.length > 0 ? (
            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
              {noEmail.length}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("repair")}
          className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "repair"
              ? "border-slate-900 text-slate-900"
              : "border-transparent text-slate-600 hover:text-slate-900"
          }`}
        >
          Mailbox repair
        </button>
      </div>

      {/* ---- GENERATED TAB ---- */}
      {activeTab === "generated" && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <label
                htmlFor="email-log-date"
                className="text-sm font-medium text-slate-700"
              >
                Date
              </label>
              <Input
                id="email-log-date"
                type="date"
                value={date}
                onChange={(e) => handleDateChange(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="flex items-center gap-2">
              <label
                htmlFor="email-log-search"
                className="text-sm font-medium text-slate-700"
              >
                Candidate
              </label>
              <Input
                id="email-log-search"
                type="text"
                value={candidateSearch}
                onChange={(e) => setCandidateSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleApplyFilter()}
                placeholder="Search by name…"
                className="w-52"
              />
            </div>
            <Button type="button" onClick={handleApplyFilter}>
              Search
            </Button>
            {appliedSearch ? (
              <Button
                type="button"
                className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                onClick={() => {
                  setCandidateSearch("");
                  setAppliedSearch("");
                  setPage(1);
                  void fetchGenerated(date, "", 1);
                }}
              >
                Clear
              </Button>
            ) : null}
          </div>

          {generatedError ? <ErrorBanner message={generatedError} /> : null}

          {loadingGenerated ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : generated.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-slate-500">
                {appliedSearch
                  ? `No emails found for "${appliedSearch}"${date ? ` on ${formatDate(date + "T00:00:00Z")}` : ""}.`
                  : date
                    ? `No emails generated on ${formatDate(date + "T00:00:00Z")}.`
                    : "No email drafts found."}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {total} email{total !== 1 ? "s" : ""}
                  {date
                    ? ` generated on ${formatDate(date + "T00:00:00Z")}`
                    : " generated"}
                  {appliedSearch ? ` for "${appliedSearch}"` : ""}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase text-slate-500">
                        <th className="pb-2 pr-4">Time</th>
                        <th className="pb-2 pr-4">Candidate</th>
                        <th className="pb-2 pr-4">Job</th>
                        <th className="pb-2 pr-4">Company</th>
                        <th className="pb-2 pr-4">Subject</th>
                        <th className="pb-2 pr-4">Recipient</th>
                        <th className="pb-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {generated.map((entry) => (
                        <tr
                          key={entry.id}
                          className="border-b border-slate-100 last:border-0"
                        >
                          <td className="py-2.5 pr-4 text-xs text-slate-500 whitespace-nowrap">
                            {formatTime(entry.createdAt)}
                          </td>
                          <td className="py-2.5 pr-4 font-medium text-slate-900 whitespace-nowrap">
                            {entry.candidate.fullName}
                          </td>
                          <td className="py-2.5 pr-4 max-w-[200px]">
                            <span
                              className="block truncate text-slate-700"
                              title={entry.job.title}
                            >
                              {entry.job.title}
                            </span>
                          </td>
                          <td className="py-2.5 pr-4 text-slate-600 whitespace-nowrap">
                            {entry.job.company?.name ?? "—"}
                          </td>
                          <td className="py-2.5 pr-4 max-w-[280px]">
                            <span
                              className="block truncate text-slate-700"
                              title={entry.subject}
                            >
                              {entry.subject}
                            </span>
                          </td>
                          <td className="py-2.5 pr-4 text-xs text-slate-500 whitespace-nowrap">
                            {entry.job.opportunityEmail ? (
                              entry.job.opportunityEmail.length > 36 ? (
                                `${entry.job.opportunityEmail.slice(0, 36)}…`
                              ) : (
                                entry.job.opportunityEmail
                              )
                            ) : (
                              <Badge>No email</Badge>
                            )}
                          </td>
                          <td className="py-2.5">
                            <Button
                              asChild
                              className="h-7 px-2 text-xs border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                            >
                              <Link
                                href={`/applications?applicationId=${entry.applicationId}`}
                              >
                                View
                              </Link>
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
                    <span>
                      Page {page} of {totalPages}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                        disabled={page <= 1}
                        onClick={() => handlePageChange(page - 1)}
                      >
                        Previous
                      </Button>
                      <Button
                        type="button"
                        className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                        disabled={page >= totalPages}
                        onClick={() => handlePageChange(page + 1)}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ---- NOT YET EMAILED TAB ---- */}
      {activeTab === "pending" && (
        <div className="space-y-4">
          {noEmailError ? <ErrorBanner message={noEmailError} /> : null}

          {loadingNoEmail ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : noEmail.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-slate-500">
                All matched applications have at least one email draft.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <CardTitle className="text-base">
                  {noEmail.length} application
                  {noEmail.length !== 1 ? "s" : ""} with no email draft
                </CardTitle>
                <Button
                  className="bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  disabled={bulkGenerating}
                  onClick={() => void handleBulkGenerateEmails()}
                >
                  {bulkGenerating
                    ? `Generating… ${bulkProgress.done}/${bulkProgress.total}`
                    : `Generate all emails (${noEmail.length})`}
                </Button>
              </CardHeader>
              <CardContent>
                {bulkResult ? (
                  <p className="mb-4 text-xs text-green-700">{bulkResult}</p>
                ) : null}
                <p className="mb-4 text-xs text-slate-500">
                  These applications were created (matched) but no email draft
                  was generated — either because the job had no contact email or
                  generation was skipped. Use{" "}
                  <Link
                    href="/match-review"
                    className="underline underline-offset-2"
                  >
                    Match Review
                  </Link>{" "}
                  to auto-draft missing emails.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase text-slate-500">
                        <th className="pb-2 pr-4">Candidate</th>
                        <th className="pb-2 pr-4">Job</th>
                        <th className="pb-2 pr-4">Company</th>
                        <th className="pb-2 pr-4">Stage</th>
                        <th className="pb-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {noEmail.map((app) => (
                        <tr
                          key={app.id}
                          className="border-b border-slate-100 last:border-0"
                        >
                          <td className="py-2.5 pr-4 font-medium text-slate-900 whitespace-nowrap">
                            {app.candidate?.fullName ?? "—"}
                          </td>
                          <td className="py-2.5 pr-4 max-w-[200px]">
                            <span
                              className="block truncate text-slate-700"
                              title={app.job?.title}
                            >
                              {app.job?.title ?? "—"}
                            </span>
                          </td>
                          <td className="py-2.5 pr-4 text-slate-600 whitespace-nowrap">
                            {app.job?.company?.name ?? "—"}
                          </td>
                          <td className="py-2.5 pr-4">
                            <Badge>{app.currentStage.replace("_", " ")}</Badge>
                          </td>
                          <td className="py-2.5">
                            <Button
                              asChild
                              className="h-7 px-2 text-xs border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                            >
                              <Link
                                href={`/applications?applicationId=${app.id}`}
                              >
                                View
                              </Link>
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
      {/* ---- MAILBOX REPAIR TAB ---- */}
      {activeTab === "repair" && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Repair missing Outlook drafts
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-slate-600">
                Compares every generated email in the database against both the
                Drafts and Sent Items folders of the shared mailbox, then
                recreates any that are missing as Outlook drafts.
              </p>
              <Button
                type="button"
                onClick={() => void handleRepairDrafts()}
                disabled={repairingDrafts}
              >
                {repairingDrafts ? "Repairing…" : "Repair missing drafts"}
              </Button>

              {repairError ? <ErrorBanner message={repairError} /> : null}

              {repairResult && (
                <div className="rounded border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 space-y-1">
                  <p>
                    <span className="font-medium">DB unique pairs:</span>{" "}
                    {repairResult.dbPairs}
                  </p>
                  <p>
                    <span className="font-medium">Already in mailbox:</span>{" "}
                    {repairResult.alreadyInMailbox}
                  </p>
                  <p className="text-green-700">
                    <span className="font-medium">Repaired:</span>{" "}
                    {repairResult.repaired}
                  </p>
                  {repairResult.failed > 0 && (
                    <p className="text-red-600">
                      <span className="font-medium">Failed:</span>{" "}
                      {repairResult.failed}
                    </p>
                  )}
                  <p className="text-slate-500">
                    <span className="font-medium">
                      Skipped (no recruiter email):
                    </span>{" "}
                    {repairResult.skippedNoEmail}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
