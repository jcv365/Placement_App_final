"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CandidateCombobox } from "@/components/ui/candidate-combobox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SuccessBanner } from "@/components/ui/success-banner";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson } from "@/lib/client";
import * as React from "react";

type Candidate = {
  id: string;
  fullName: string;
  cvStorageMode: "FULL" | "REDACTED" | "UNKNOWN";
  email: string | null;
  phone: string | null;
  skillsCsv: string;
  certificationsCsv: string;
  suggestedRolesCsv: string;
};

type RecommendationResponse = {
  recommendations: Array<{
    jobId: string;
    title: string;
    companyName: string;
  }>;
};

type AtsMatchResponse = {
  job: {
    id: string | null;
    title: string | null;
  };
  result: {
    score: number;
    decision: "PASS" | "REVIEW" | "FLAGGED";
    summary: string;
    missingKeywords: string[];
    fixes: Array<{
      id: string;
      title: string;
      details: string;
      targetArea: "CONTACT" | "SKILLS" | "EXPERIENCE" | "STRUCTURE";
      aiFixable: boolean;
    }>;
    flags: Array<{
      code: string;
      severity: "LOW" | "MEDIUM" | "HIGH";
      message: string;
    }>;
  };
};

type AtsFixResponse = {
  previewOnly: boolean;
  ai: {
    used: boolean;
  };
  proposed: {
    email: string | null;
    phone: string | null;
    skillsCsv: string;
    certificationsCsv: string;
    suggestedRolesCsv: string;
  };
  before: {
    score: number;
    decision: "PASS" | "REVIEW" | "FLAGGED";
  };
  after: {
    score: number;
    decision: "PASS" | "REVIEW" | "FLAGGED";
  };
  summary: {
    scoreDelta: number;
    decisionChanged: boolean;
  };
};

type AtsFixPreviewState = {
  candidateId: string;
  candidateName: string;
  jobId: string;
  jobTitle: string;
  beforeScore: number;
  afterScore: number;
  beforeDecision: "PASS" | "REVIEW" | "FLAGGED";
  afterDecision: "PASS" | "REVIEW" | "FLAGGED";
  current: {
    email: string;
    phone: string;
    skillsCsv: string;
    certificationsCsv: string;
    suggestedRolesCsv: string;
  };
  proposed: {
    email: string;
    phone: string;
    skillsCsv: string;
    certificationsCsv: string;
    suggestedRolesCsv: string;
  };
};

type CandidateAtsState =
  | { state: "loading" }
  | { state: "no-opportunity" }
  | { state: "error"; message: string }
  | {
      state: "ready";
      jobId: string;
      decision: "PASS" | "REVIEW" | "FLAGGED";
      score: number;
      summary: string;
      jobTitle: string;
      companyName?: string;
      missingKeywords: string[];
      fixes: Array<{
        id: string;
        title: string;
        details: string;
        targetArea: "CONTACT" | "SKILLS" | "EXPERIENCE" | "STRUCTURE";
        aiFixable: boolean;
      }>;
      flags: Array<{
        code: string;
        severity: "LOW" | "MEDIUM" | "HIGH";
        message: string;
      }>;
    };

function atsBadgeClass(decision: "PASS" | "REVIEW" | "FLAGGED"): string {
  if (decision === "PASS") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (decision === "REVIEW") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  return "border-red-200 bg-red-50 text-red-700";
}

function atsFlagBadgeClass(severity: "LOW" | "MEDIUM" | "HIGH"): string {
  if (severity === "HIGH") {
    return "border-red-200 bg-red-50 text-red-700";
  }

  if (severity === "MEDIUM") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  return "border-slate-200 bg-slate-50 text-slate-700";
}

function hasValueChanged(currentValue: string, proposedValue: string): boolean {
  return currentValue.trim() !== proposedValue.trim();
}

function cvStorageBadgeClass(mode: Candidate["cvStorageMode"]): string {
  if (mode === "REDACTED") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  if (mode === "FULL") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  return "border-slate-200 bg-slate-50 text-slate-700";
}

function cvStorageLabel(mode: Candidate["cvStorageMode"]): string {
  if (mode === "REDACTED") {
    return "CV text: Redacted";
  }

  if (mode === "FULL") {
    return "CV text: Full";
  }

  return "CV text: Unknown";
}

export default function AtsWindowClient({
  initialCandidateId,
  initialAutoPreview,
}: {
  initialCandidateId: string | null;
  initialAutoPreview?: boolean;
}) {
  const [candidates, setCandidates] = React.useState<Candidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] =
    React.useState<string>("");
  const [atsState, setAtsState] = React.useState<CandidateAtsState>({
    state: "loading",
  });
  const [previewing, setPreviewing] = React.useState(false);
  const [applying, setApplying] = React.useState(false);
  const [atsPreview, setAtsPreview] = React.useState<AtsFixPreviewState | null>(
    null,
  );
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(
    null,
  );
  const [hasAutoPreviewRun, setHasAutoPreviewRun] = React.useState(false);

  const selectedCandidate = React.useMemo(
    () =>
      candidates.find((candidate) => candidate.id === selectedCandidateId) ??
      null,
    [candidates, selectedCandidateId],
  );

  const loadCandidates = React.useCallback(async () => {
    const loaded = await fetchJson<Candidate[]>("/api/candidates");
    setCandidates(loaded);

    const preferredId =
      initialCandidateId &&
      loaded.some((candidate) => candidate.id === initialCandidateId)
        ? initialCandidateId
        : loaded[0]?.id;

    setSelectedCandidateId((current) => current || preferredId || "");
  }, [initialCandidateId]);

  const runAtsForCandidate = React.useCallback(async (candidate: Candidate) => {
    setAtsState({ state: "loading" });

    const recommendations = await fetchJson<RecommendationResponse>(
      `/api/opportunities/recommendations?candidateId=${candidate.id}`,
    );

    const topRecommendation = recommendations.recommendations[0];
    if (!topRecommendation) {
      setAtsState({ state: "no-opportunity" });
      return;
    }

    const ats = await fetchJson<AtsMatchResponse>(
      `/api/candidates/${candidate.id}/ats-match`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: topRecommendation.jobId,
        }),
      },
    );

    setAtsState({
      state: "ready",
      jobId: topRecommendation.jobId,
      decision: ats.result.decision,
      score: ats.result.score,
      summary: ats.result.summary,
      jobTitle: ats.job.title ?? topRecommendation.title,
      companyName: topRecommendation.companyName,
      missingKeywords: ats.result.missingKeywords,
      fixes: ats.result.fixes,
      flags: ats.result.flags,
    });
  }, []);

  React.useEffect(() => {
    void loadCandidates().catch((error: Error) => {
      setActionError(error.message);
      setAtsState({ state: "error", message: error.message });
    });
  }, [loadCandidates]);

  React.useEffect(() => {
    if (!selectedCandidate) {
      return;
    }

    setActionError(null);
    setSuccessMessage(null);
    void runAtsForCandidate(selectedCandidate).catch((error: Error) => {
      setActionError(error.message);
      setAtsState({ state: "error", message: error.message });
    });
  }, [runAtsForCandidate, selectedCandidate]);

  const handlePreviewAiFix = React.useCallback(async () => {
    if (!selectedCandidate || atsState.state !== "ready") {
      return;
    }

    setPreviewing(true);
    setActionError(null);
    setSuccessMessage(null);

    try {
      const response = await fetchJson<AtsFixResponse>(
        `/api/candidates/${selectedCandidate.id}/ats-fix`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId: atsState.jobId,
            previewOnly: true,
          }),
        },
      );

      setAtsPreview({
        candidateId: selectedCandidate.id,
        candidateName: selectedCandidate.fullName,
        jobId: atsState.jobId,
        jobTitle: atsState.jobTitle,
        beforeScore: response.before.score,
        afterScore: response.after.score,
        beforeDecision: response.before.decision,
        afterDecision: response.after.decision,
        current: {
          email: selectedCandidate.email ?? "",
          phone: selectedCandidate.phone ?? "",
          skillsCsv: selectedCandidate.skillsCsv,
          certificationsCsv: selectedCandidate.certificationsCsv,
          suggestedRolesCsv: selectedCandidate.suggestedRolesCsv,
        },
        proposed: {
          email: response.proposed.email ?? "",
          phone: response.proposed.phone ?? "",
          skillsCsv: response.proposed.skillsCsv,
          certificationsCsv: response.proposed.certificationsCsv,
          suggestedRolesCsv: response.proposed.suggestedRolesCsv,
        },
      });
    } catch (error) {
      setActionError((error as Error).message);
    } finally {
      setPreviewing(false);
    }
  }, [atsState, selectedCandidate]);

  React.useEffect(() => {
    if (!initialAutoPreview || hasAutoPreviewRun) {
      return;
    }

    if (atsState.state !== "ready" || previewing || applying || atsPreview) {
      return;
    }

    setHasAutoPreviewRun(true);
    void handlePreviewAiFix().catch((error: Error) => {
      setActionError(error.message);
    });
  }, [
    applying,
    atsPreview,
    atsState.state,
    handlePreviewAiFix,
    hasAutoPreviewRun,
    initialAutoPreview,
    previewing,
  ]);

  const handleApplyAiFix = React.useCallback(async () => {
    if (!atsPreview) {
      return;
    }

    setApplying(true);
    setActionError(null);
    setSuccessMessage(null);

    try {
      const response = await fetchJson<AtsFixResponse>(
        `/api/candidates/${atsPreview.candidateId}/ats-fix`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId: atsPreview.jobId,
            previewOnly: false,
          }),
        },
      );

      const refreshedCandidates =
        await fetchJson<Candidate[]>("/api/candidates");
      setCandidates(refreshedCandidates);
      const refreshedCandidate =
        refreshedCandidates.find(
          (candidate) => candidate.id === atsPreview.candidateId,
        ) ?? null;

      if (refreshedCandidate) {
        await runAtsForCandidate(refreshedCandidate);
      }

      const scoreDirection =
        response.summary.scoreDelta > 0
          ? `Score improved by ${response.summary.scoreDelta}`
          : response.summary.scoreDelta < 0
            ? `Score changed by ${response.summary.scoreDelta}`
            : "Score remained unchanged";

      setAtsPreview(null);
      setSuccessMessage(`AI ATS fix applied. ${scoreDirection}.`);
    } catch (error) {
      setActionError((error as Error).message);
    } finally {
      setApplying(false);
    }
  }, [atsPreview, runAtsForCandidate]);

  return (
    <div className="space-y-4 p-4">
      {actionError ? <ErrorBanner message={actionError} /> : null}
      {successMessage ? <SuccessBanner message={successMessage} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>ATS Journey Window</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <div className="space-y-1">
              <Label htmlFor="ats-candidate-select">Candidate</Label>
              <CandidateCombobox
                id="ats-candidate-select"
                options={candidates.map((c) => ({
                  value: c.id,
                  label: c.fullName,
                }))}
                value={selectedCandidateId}
                onValueChange={setSelectedCandidateId}
                placeholder="Search candidates…"
              />
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                onClick={() =>
                  selectedCandidate
                    ? void runAtsForCandidate(selectedCandidate).catch(
                        (error: Error) => {
                          setActionError(error.message);
                          setAtsState({
                            state: "error",
                            message: error.message,
                          });
                        },
                      )
                    : undefined
                }
                disabled={!selectedCandidate}
              >
                Scan raw CV with ATS benchmark
              </Button>
            </div>
          </div>

          {atsState.state === "loading" ? (
            <Badge className="border-slate-200 bg-slate-50 text-slate-700">
              Scanning raw CV...
            </Badge>
          ) : null}

          {atsState.state === "no-opportunity" ? (
            <Badge className="border-slate-200 bg-slate-50 text-slate-700">
              Not scored: no recommended opportunity yet.
            </Badge>
          ) : null}

          {atsState.state === "error" ? (
            <Badge className="border-red-200 bg-red-50 text-red-700">
              ATS error: {atsState.message}
            </Badge>
          ) : null}

          {atsState.state === "ready" ? (
            <div className="space-y-3">
              <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <p>
                  Candidate:{" "}
                  <span className="font-medium">
                    {selectedCandidate?.fullName}
                  </span>
                </p>
                <p>
                  Scan source:{" "}
                  <span className="font-medium">Stored raw CV text</span>
                </p>
                {selectedCandidate ? (
                  <div className="pt-1">
                    <Badge
                      className={cvStorageBadgeClass(
                        selectedCandidate.cvStorageMode,
                      )}
                    >
                      {cvStorageLabel(selectedCandidate.cvStorageMode)}
                    </Badge>
                  </div>
                ) : null}
                <p>
                  Job: <span className="font-medium">{atsState.jobTitle}</span>
                  {atsState.companyName ? ` (${atsState.companyName})` : ""}
                </p>
                <div className="pt-2">
                  <Badge className={atsBadgeClass(atsState.decision)}>
                    {atsState.decision} {atsState.score}
                  </Badge>
                </div>
                <p className="pt-2">{atsState.summary}</p>
              </div>

              {atsState.fixes.length > 0 ? (
                <div className="space-y-1 rounded border border-slate-200 p-3">
                  <p className="text-sm font-medium text-slate-700">
                    How to fix
                  </p>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
                    {atsState.fixes.map((fix) => (
                      <li key={fix.id}>
                        <span className="font-medium">{fix.title}:</span>{" "}
                        {fix.details}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {atsState.flags.length > 0 ? (
                <div className="space-y-2 rounded border border-slate-200 p-3">
                  <p className="text-sm font-medium text-slate-700">Flags</p>
                  <div className="flex flex-wrap gap-1">
                    {atsState.flags.map((flag) => (
                      <Badge
                        key={`${flag.code}-${flag.message}`}
                        className={atsFlagBadgeClass(flag.severity)}
                      >
                        {flag.severity}
                      </Badge>
                    ))}
                  </div>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
                    {atsState.flags.map((flag) => (
                      <li key={`${flag.code}-${flag.message}-text`}>
                        {flag.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {atsState.missingKeywords.length > 0 ? (
                <div className="rounded border border-slate-200 p-3 text-sm text-slate-700">
                  Missing keywords:{" "}
                  {atsState.missingKeywords.slice(0, 12).join(", ")}
                </div>
              ) : null}

              <div className="flex gap-2">
                <Button
                  type="button"
                  className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                  onClick={() => void handlePreviewAiFix()}
                  disabled={previewing || applying}
                >
                  {previewing ? "Preparing preview..." : "Preview AI ATS fix"}
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {atsPreview ? (
        <Card>
          <CardHeader>
            <CardTitle>Preview AI ATS Fix</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <p>
                Candidate:{" "}
                <span className="font-medium">{atsPreview.candidateName}</span>
              </p>
              <p>
                Job: <span className="font-medium">{atsPreview.jobTitle}</span>
              </p>
              <p>
                ATS score:{" "}
                <span className="font-medium">
                  {atsPreview.beforeDecision} {atsPreview.beforeScore}
                </span>
                {" -> "}
                <span className="font-medium">
                  {atsPreview.afterDecision} {atsPreview.afterScore}
                </span>
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Current email</Label>
                <Input value={atsPreview.current.email} readOnly />
              </div>
              <div className="space-y-1">
                <Label>Proposed email</Label>
                <Input
                  value={atsPreview.proposed.email}
                  readOnly
                  className={
                    hasValueChanged(
                      atsPreview.current.email,
                      atsPreview.proposed.email,
                    )
                      ? "border-amber-300 bg-amber-50"
                      : undefined
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Current phone</Label>
                <Input value={atsPreview.current.phone} readOnly />
              </div>
              <div className="space-y-1">
                <Label>Proposed phone</Label>
                <Input
                  value={atsPreview.proposed.phone}
                  readOnly
                  className={
                    hasValueChanged(
                      atsPreview.current.phone,
                      atsPreview.proposed.phone,
                    )
                      ? "border-amber-300 bg-amber-50"
                      : undefined
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Current skills</Label>
                <Textarea value={atsPreview.current.skillsCsv} readOnly />
              </div>
              <div className="space-y-1">
                <Label>Proposed skills</Label>
                <Textarea
                  value={atsPreview.proposed.skillsCsv}
                  readOnly
                  className={
                    hasValueChanged(
                      atsPreview.current.skillsCsv,
                      atsPreview.proposed.skillsCsv,
                    )
                      ? "border-amber-300 bg-amber-50"
                      : undefined
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Current certifications</Label>
                <Textarea
                  value={atsPreview.current.certificationsCsv}
                  readOnly
                />
              </div>
              <div className="space-y-1">
                <Label>Proposed certifications</Label>
                <Textarea
                  value={atsPreview.proposed.certificationsCsv}
                  readOnly
                  className={
                    hasValueChanged(
                      atsPreview.current.certificationsCsv,
                      atsPreview.proposed.certificationsCsv,
                    )
                      ? "border-amber-300 bg-amber-50"
                      : undefined
                  }
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label>Current suggested roles</Label>
                <Textarea
                  value={atsPreview.current.suggestedRolesCsv}
                  readOnly
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label>Proposed suggested roles</Label>
                <Textarea
                  value={atsPreview.proposed.suggestedRolesCsv}
                  readOnly
                  className={
                    hasValueChanged(
                      atsPreview.current.suggestedRolesCsv,
                      atsPreview.proposed.suggestedRolesCsv,
                    )
                      ? "border-amber-300 bg-amber-50"
                      : undefined
                  }
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={() => void handleApplyAiFix()}
                disabled={applying}
              >
                {applying ? "Applying..." : "Apply AI ATS fix"}
              </Button>
              <Button
                className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                onClick={() => setAtsPreview(null)}
                disabled={applying}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
