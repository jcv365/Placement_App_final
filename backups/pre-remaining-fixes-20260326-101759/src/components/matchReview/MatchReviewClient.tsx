"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { SuccessBanner } from "@/components/ui/success-banner";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson } from "@/lib/client";
import Link from "next/link";
import * as React from "react";

type Job = {
  id: string;
  title: string;
  rawText: string;
  createdAt: string;
  company?: { name: string } | null;
};

type Candidate = {
  id: string;
  fullName: string;
  email: string | null;
  suggestedRolesCsv: string;
  skillsCsv: string;
  certificationsCsv: string;
  isActive: boolean;
};

type MatchScoreBreakdown = {
  overall: number;
  skills: number;
  certifications: number;
  roles: number;
  basis: "SKILLS" | "CERTIFICATIONS" | "WEIGHTED" | "BASELINE";
};

type QueueItem = {
  job: Job;
  source: "LinkedIn" | "Upload";
  confidence: number;
  matches: Array<{
    candidate: Candidate;
    score: MatchScoreBreakdown;
  }>;
};

function toTerms(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 2);
}

function getSource(job: Job): "LinkedIn" | "Upload" {
  return job.rawText.toLowerCase().includes("linkedin") ? "LinkedIn" : "Upload";
}

function splitRequirementChunks(value: string): string[] {
  return value
    .split(/[\n;|.]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toCsvPhrases(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length >= 2);
}

function toCsvTerms(value: string): Set<string> {
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .flatMap((item) => toTerms(item));
  return new Set(items);
}

/* ------------------------------------------------------------------ */
/*  Job → Candidate scoring (title-weighted, bidirectional tokens)    */
/* ------------------------------------------------------------------ */

/** Words that carry no technical signal in job titles. */
const TITLE_STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "a",
  "an",
  "of",
  "or",
  "in",
  "at",
  "to",
  "senior",
  "junior",
  "mid",
  "lead",
  "principal",
  "staff",
  "head",
]);

/** Words that carry no technical signal in job body / LinkedIn posts. */
const BODY_STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "will",
  "are",
  "you",
  "your",
  "our",
  "has",
  "have",
  "had",
  "been",
  "being",
  "can",
  "could",
  "may",
  "might",
  "would",
  "shall",
  "should",
  "about",
  "into",
  "over",
  "after",
  "before",
  "under",
  "between",
  "through",
  "any",
  "all",
  "each",
  "every",
  "not",
  "but",
  "other",
  "than",
  "also",
  "their",
  "them",
  "they",
  "these",
  "those",
  "must",
  "just",
  "more",
  "most",
  "such",
  "able",
  "need",
  "its",
  "per",
  "who",
  "what",
  "how",
  "why",
  "when",
  "where",
  "which",
  "get",
  "got",
  "let",
  "here",
  "there",
  "very",
  "only",
  "some",
  "same",
  "make",
  "made",
  "well",
  "too",
  "own",
  "way",
  "both",
  "then",
  "was",
  "were",
  "one",
  "two",
  "work",
  "working",
  "role",
  "looking",
  "required",
  "experience",
  "ideal",
  "including",
  "using",
  "join",
  "team",
  "company",
  "client",
  "based",
  "strong",
  "good",
  "ensure",
  "provide",
  "opportunity",
  "responsible",
  "knowledge",
  "understanding",
  "please",
  "apply",
  "minimum",
  "preferred",
  "position",
  "day",
  "days",
  "week",
  "new",
  "take",
  "part",
  "year",
  "years",
  "linkedin",
  "post",
  "posts",
  "follow",
  "share",
  "like",
  "comment",
  "hiring",
  "currently",
  "recruiting",
  "see",
  "view",
  "ago",
  "edited",
  "reactions",
  "services",
  "connect",
  "message",
  "feed",
  "3rd",
]);

function significantTokens(
  text: string,
  stops: Set<string>,
  minLen = 3,
): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9+#]+/)
      .filter((t) => t.length >= minLen && !stops.has(t)),
  );
}

function getRequiredCertificationTerms(job: Job): Set<string> {
  const certPattern =
    /certif|certificate|certified|az-\d{3}|aws\s+certified|gcp\s+certified|cissp|cka|ckad|ccna|comptia|pmp|prince2/i;

  const chunks = splitRequirementChunks(`${job.title}\n${job.rawText}`).filter(
    (chunk) => certPattern.test(chunk),
  );

  return new Set(chunks.flatMap((chunk) => toTerms(chunk)));
}

function scoreCandidate(job: Job, candidate: Candidate): MatchScoreBreakdown {
  const rawTitle = job.title.replace(/&amp;/g, "&");
  const bodyText = job.rawText;

  // Candidate's full token set (skills + certs + roles)
  const candidateFullText = [
    candidate.skillsCsv,
    candidate.certificationsCsv,
    candidate.suggestedRolesCsv,
  ].join(", ");
  const candidateTokens = significantTokens(candidateFullText, new Set(), 2);

  // ---------- Title match (0-85 pts) ----------
  // For multi-role titles ("Solution Architect, DevOps Engineer, …"),
  // score each comma-separated segment and keep the best.
  const segments = rawTitle.includes(",")
    ? rawTitle
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [rawTitle];

  const candidateRolePhrases = toCsvPhrases(candidate.suggestedRolesCsv);

  let bestTitleScore = 0;
  for (const segment of segments) {
    const segTokens = significantTokens(segment, TITLE_STOP, 2);
    if (segTokens.size === 0) continue;

    const tokenOverlap = [...segTokens].filter((t) => candidateTokens.has(t));
    const tokenRatio = tokenOverlap.length / segTokens.size;

    // Does any candidate role contain all of this segment's tokens?
    const bestRoleCoverage = Math.max(
      0,
      ...candidateRolePhrases.map((role) => {
        const rTokens = significantTokens(role, TITLE_STOP, 2);
        return (
          [...segTokens].filter((t) => rTokens.has(t)).length / segTokens.size
        );
      }),
    );

    let segScore: number;
    if (bestRoleCoverage >= 1) {
      segScore = 85; // candidate's role matches job title
    } else if (bestRoleCoverage >= 0.6 && tokenRatio >= 1) {
      segScore = 80; // strong overlap
    } else if (tokenRatio >= 1) {
      segScore = 70; // all title tokens in profile
    } else {
      segScore = tokenRatio * 60;
    }
    bestTitleScore = Math.max(bestTitleScore, segScore);
  }

  // ---------- Body bonus (0-15 pts) ----------
  const bodyTokens = significantTokens(bodyText, BODY_STOP);
  const titleTokenSet = new Set(
    segments.flatMap((s) => [...significantTokens(s, TITLE_STOP, 2)]),
  );
  const bodyOnlyTokens = [...bodyTokens].filter((t) => !titleTokenSet.has(t));
  const bodyMatched = bodyOnlyTokens.filter((t) => candidateTokens.has(t));
  const bodyScore = Math.min(bodyMatched.length * 3, 15);

  // ---------- Certification gate ----------
  const requiredCertifications = getRequiredCertificationTerms(job);
  if (requiredCertifications.size > 0) {
    const candidateCertTokens = toCsvTerms(candidate.certificationsCsv);
    const certOverlap = [...requiredCertifications].filter((t) =>
      candidateCertTokens.has(t),
    ).length;
    if (certOverlap === 0) {
      return {
        overall: 0,
        skills: 0,
        certifications: 0,
        roles: 0,
        basis: "CERTIFICATIONS",
      };
    }
  }

  // ---------- Dimension breakdowns (informational) ----------
  const jobAllTokens = new Set([...titleTokenSet, ...bodyTokens]);
  const candSkillTokens = significantTokens(candidate.skillsCsv, new Set(), 2);
  const candCertTokens = significantTokens(
    candidate.certificationsCsv,
    new Set(),
    2,
  );
  const candRoleTokens = significantTokens(
    candidate.suggestedRolesCsv,
    new Set(),
    2,
  );

  const skills =
    candSkillTokens.size > 0
      ? Math.round(
          ([...candSkillTokens].filter((t) => jobAllTokens.has(t)).length /
            candSkillTokens.size) *
            100,
        )
      : 0;
  const certifications =
    candCertTokens.size > 0
      ? Math.round(
          ([...candCertTokens].filter((t) => jobAllTokens.has(t)).length /
            candCertTokens.size) *
            100,
        )
      : 0;
  const roles =
    candRoleTokens.size > 0
      ? Math.round(
          ([...candRoleTokens].filter((t) => jobAllTokens.has(t)).length /
            candRoleTokens.size) *
            100,
        )
      : 0;

  let overall = Math.min(100, Math.round(bestTitleScore + bodyScore));
  const basis: MatchScoreBreakdown["basis"] =
    overall > 0 ? "WEIGHTED" : "BASELINE";

  if (candidate.isActive) {
    overall = Math.min(100, overall + 3);
  }

  return { overall, skills, certifications, roles, basis };
}

function getScoreBasisLabel(basis: MatchScoreBreakdown["basis"]): string {
  if (basis === "SKILLS") {
    return "Skills basis";
  }

  if (basis === "CERTIFICATIONS") {
    return "Certifications basis";
  }

  if (basis === "WEIGHTED") {
    return "Weighted basis";
  }

  return "Baseline basis";
}

type AiDraftResult = {
  id: string;
  subject: string;
  htmlBody: string;
  applicationId?: string;
};

async function generateDraftViaApi(
  jobId: string,
  candidateId: string,
): Promise<AiDraftResult> {
  return fetchJson<AiDraftResult>("/api/email/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, candidateId }),
  });
}

export default function MatchReviewClient({
  initialJobId,
}: {
  initialJobId?: string;
}) {
  const [queue, setQueue] = React.useState<QueueItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [pendingReject, setPendingReject] = React.useState<QueueItem | null>(
    null,
  );
  const [selectedJobId, setSelectedJobId] = React.useState<string | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = React.useState<
    string | null
  >(null);
  const [draft, setDraft] = React.useState("");
  const [draftLoading, setDraftLoading] = React.useState(false);
  const [aiDraftResult, setAiDraftResult] =
    React.useState<AiDraftResult | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [approveSuccess, setApproveSuccess] = React.useState<string | null>(
    null,
  );
  const [bulkDrafting, setBulkDrafting] = React.useState(false);
  const [bulkProgress, setBulkProgress] = React.useState<{
    done: number;
    total: number;
    failed: number;
  } | null>(null);

  React.useEffect(() => {
    if (!approveSuccess) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setApproveSuccess(null);
    }, 2500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [approveSuccess]);

  const triggerDraftGeneration = React.useCallback(
    async (jobId: string, candidateId: string) => {
      setDraftLoading(true);
      setDraft("");
      setAiDraftResult(null);
      setActionError(null);
      try {
        const result = await generateDraftViaApi(jobId, candidateId);
        setAiDraftResult(result);
        setDraft(result.htmlBody);
      } catch (error) {
        setActionError(`Email generation failed: ${(error as Error).message}`);
      } finally {
        setDraftLoading(false);
      }
    },
    [],
  );

  const load = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [jobs, candidates] = await Promise.all([
        fetchJson<Job[]>("/api/jobs"),
        fetchJson<Candidate[]>("/api/candidates"),
      ]);

      const eligibleCandidates = candidates.some(
        (candidate) => candidate.isActive,
      )
        ? candidates.filter((candidate) => candidate.isActive)
        : candidates;
      const nextQueue = jobs.map((job) => {
        const scored = eligibleCandidates
          .map((candidate) => ({
            candidate,
            score: scoreCandidate(job, candidate),
          }))
          .filter((match) => match.score.overall >= 85)
          .sort((a, b) => b.score.overall - a.score.overall)
          .slice(0, 5);

        return {
          job,
          source: getSource(job),
          confidence: scored[0]?.score.overall ?? 0,
          matches: scored,
        };
      });

      setQueue(nextQueue);

      const preferredItem =
        (initialJobId
          ? nextQueue.find((item) => item.job.id === initialJobId)
          : undefined) ?? nextQueue[0];

      if (!selectedJobId && preferredItem) {
        setSelectedJobId(preferredItem.job.id);
        const firstCandidate = preferredItem.matches[0]?.candidate;
        if (firstCandidate) {
          setSelectedCandidateId(firstCandidate.id);
          void triggerDraftGeneration(preferredItem.job.id, firstCandidate.id);
        }
      }
    } catch (error) {
      setLoadError((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [initialJobId, selectedJobId]);

  React.useEffect(() => {
    load();
  }, [load]);

  React.useEffect(() => {
    if (queue.length === 0) {
      return;
    }

    const currentItem = queue.find((item) => item.job.id === selectedJobId);
    const nextItem = currentItem ?? queue[0];

    if (!currentItem) {
      setSelectedJobId(nextItem.job.id);
    }

    const hasSelectedCandidate = nextItem.matches.some(
      (match) => match.candidate.id === selectedCandidateId,
    );

    if (!hasSelectedCandidate) {
      const firstCandidate = nextItem.matches[0]?.candidate;
      if (firstCandidate) {
        setSelectedCandidateId(firstCandidate.id);
        void triggerDraftGeneration(nextItem.job.id, firstCandidate.id);
      } else {
        setSelectedCandidateId(null);
        setDraft("");
      }
    }
  }, [queue, selectedCandidateId, selectedJobId, triggerDraftGeneration]);

  React.useEffect(() => {
    if (!selectedJobId) {
      return;
    }

    const selectedQueueItem = queue.find(
      (item) => item.job.id === selectedJobId,
    );
    if (!selectedQueueItem) {
      return;
    }

    const matchedCandidate = selectedQueueItem.matches.find(
      (match) => match.candidate.id === selectedCandidateId,
    )?.candidate;
    const fallbackCandidate =
      matchedCandidate ?? selectedQueueItem.matches[0]?.candidate;

    if (!fallbackCandidate) {
      setDraft("");
      return;
    }

    if (!matchedCandidate) {
      setSelectedCandidateId(fallbackCandidate.id);
    }

    if (draft.trim().length === 0 && !draftLoading) {
      void triggerDraftGeneration(
        selectedQueueItem.job.id,
        fallbackCandidate.id,
      );
    }
  }, [
    draft,
    draftLoading,
    queue,
    selectedCandidateId,
    selectedJobId,
    triggerDraftGeneration,
  ]);

  const selectedItem =
    queue.find((item) => item.job.id === selectedJobId) ?? null;
  const hasAnyMatches = queue.some((item) => item.matches.length > 0);
  const selectedMatch =
    selectedItem?.matches.find(
      (match) => match.candidate.id === selectedCandidateId,
    ) ?? null;

  const todayHighScoreMatches = React.useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const pairs: Array<{
      jobId: string;
      candidateId: string;
      score: number;
      jobTitle: string;
      candidateName: string;
    }> = [];
    for (const item of queue) {
      const jobDate = new Date(item.job.createdAt);
      jobDate.setHours(0, 0, 0, 0);
      if (jobDate.getTime() !== today.getTime()) continue;
      for (const match of item.matches) {
        if (match.score.overall >= 85) {
          pairs.push({
            jobId: item.job.id,
            candidateId: match.candidate.id,
            score: match.score.overall,
            jobTitle: item.job.title,
            candidateName: match.candidate.fullName,
          });
        }
      }
    }
    return pairs;
  }, [queue]);

  const handleOpenReview = (item: QueueItem) => {
    setApproveSuccess(null);
    setActionError(null);
    setSelectedJobId(item.job.id);
    const topCandidate = item.matches[0]?.candidate;
    if (topCandidate) {
      setSelectedCandidateId(topCandidate.id);
      void triggerDraftGeneration(item.job.id, topCandidate.id);
    }
  };

  const handleChooseCandidate = (item: QueueItem, candidate: Candidate) => {
    setApproveSuccess(null);
    setActionError(null);
    setSelectedJobId(item.job.id);
    setSelectedCandidateId(candidate.id);
    void triggerDraftGeneration(item.job.id, candidate.id);
  };

  const handleBulkAutoDraft = async () => {
    if (todayHighScoreMatches.length === 0) return;
    setBulkDrafting(true);
    setActionError(null);
    const total = todayHighScoreMatches.length;
    let done = 0;
    let failed = 0;
    setBulkProgress({ done, total, failed });
    for (const pair of todayHighScoreMatches) {
      try {
        await generateDraftViaApi(pair.jobId, pair.candidateId);
      } catch {
        failed++;
      }
      done++;
      setBulkProgress({ done, total, failed });
    }
    setBulkDrafting(false);
    if (failed === 0) {
      setApproveSuccess(
        `All ${total} email draft${total === 1 ? " was" : "s were"} created and placed in your Outlook drafts.`,
      );
    } else {
      setActionError(
        `${total - failed} of ${total} drafts created. ${failed} failed — you can retry.`,
      );
    }
    setBulkProgress(null);
  };

  const handleApprove = async () => {
    if (!selectedItem || !selectedMatch) {
      return;
    }

    setCreating(true);
    try {
      setActionError(null);

      // If an AI draft already exists (from the generate API which also creates
      // the application), navigate straight to it.
      if (aiDraftResult?.applicationId) {
        setApproveSuccess("Application created with AI-generated email.");
        window.setTimeout(() => {
          window.location.href = `/applications?applicationId=${aiDraftResult.applicationId}`;
        }, 900);
        return;
      }

      // Fallback: generate AI draft now (also creates the application).
      const result = await generateDraftViaApi(
        selectedItem.job.id,
        selectedMatch.candidate.id,
      );

      if (result.applicationId) {
        setApproveSuccess("Application created with AI-generated email.");
        window.setTimeout(() => {
          window.location.href = `/applications?applicationId=${result.applicationId}`;
        }, 900);
        return;
      }

      // Final fallback: create the application directly.
      const createdApplication = await fetchJson<{ id: string }>(
        "/api/applications",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId: selectedItem.job.id,
            candidateId: selectedMatch.candidate.id,
          }),
        },
      );

      setApproveSuccess("Application created successfully.");
      window.setTimeout(() => {
        window.location.href = `/applications?applicationId=${createdApplication.id}`;
      }, 900);
    } catch (error) {
      setActionError((error as Error).message);
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-56" />
        <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {loadError ? <ErrorBanner message={loadError} /> : null}
      {actionError ? <ErrorBanner message={actionError} /> : null}
      {approveSuccess ? <SuccessBanner message={approveSuccess} /> : null}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1>Match review</h1>
          <p className="text-sm text-slate-600">
            Review each job with top candidate matches and approve to create an
            application.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {bulkProgress ? (
            <span className="text-sm text-slate-600">
              {bulkProgress.done}/{bulkProgress.total} drafted
              {bulkProgress.failed > 0
                ? ` (${bulkProgress.failed} failed)`
                : ""}
            </span>
          ) : null}
          <Button
            type="button"
            disabled={
              bulkDrafting || loading || todayHighScoreMatches.length === 0
            }
            onClick={() => void handleBulkAutoDraft()}
          >
            {bulkDrafting
              ? "Drafting…"
              : `Auto-draft 85%+ matches (${todayHighScoreMatches.length})`}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Review queue</CardTitle>
          </CardHeader>
          <CardContent>
            {queue.length === 0 ? (
              <div className="rounded border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                <p className="font-medium text-slate-900">No matches yet.</p>
                <p className="mt-1">
                  Upload opportunities or run matching to populate the review
                  queue.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button asChild>
                    <Link href="/jobs">Ingest jobs</Link>
                  </Button>
                  <Button
                    asChild
                    className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                  >
                    <Link href="/candidates">Run matching</Link>
                  </Button>
                </div>
              </div>
            ) : !hasAnyMatches ? (
              <div className="rounded border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                <p className="font-medium text-slate-900">No matches yet.</p>
                <p className="mt-1">
                  Jobs exist, but no candidate matches are ready for review.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button asChild>
                    <Link href="/candidates">Review candidates</Link>
                  </Button>
                  <Button
                    asChild
                    className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                  >
                    <Link href="/jobs">Update opportunities</Link>
                  </Button>
                </div>
              </div>
            ) : (
              <ul className="space-y-3 text-sm text-slate-700">
                {queue.map((item) => {
                  const selected = item.job.id === selectedJobId;
                  return (
                    <li
                      key={item.job.id}
                      className={
                        selected
                          ? "rounded border-2 border-slate-900 bg-slate-50 p-3"
                          : "rounded border border-slate-200 p-3"
                      }
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="font-medium text-slate-900">
                          {item.job.title}
                        </p>
                        <div className="flex items-center gap-2">
                          <Badge>{item.source}</Badge>
                          <Badge>{item.confidence}%</Badge>
                          {selected ? <Badge>Selected</Badge> : null}
                        </div>
                      </div>
                      <p className="text-xs text-slate-500">
                        Company: {item.job.company?.name?.trim() || "Unknown"} •
                        New{" "}
                        {new Date(item.job.createdAt).toLocaleString("en-GB")}
                      </p>
                      <p className="text-xs text-slate-500">
                        Matches: {item.matches.length}
                      </p>
                      <div className="mt-2 flex gap-2">
                        <Button
                          type="button"
                          aria-label={`Review ${item.job.title}`}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            handleOpenReview(item);
                          }}
                        >
                          Review
                        </Button>
                        <Button
                          type="button"
                          className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                          onClick={() => setPendingReject(item)}
                        >
                          Reject
                        </Button>
                        <Button
                          className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                          asChild
                        >
                          <Link href="/jobs">View job</Link>
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Match detail</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!selectedItem ? (
              <p className="text-sm text-slate-600">
                Select a job to view match details.
              </p>
            ) : (
              <>
                <div className="rounded border border-slate-200 p-3">
                  <p className="font-medium text-slate-900">
                    {selectedItem.job.title}
                  </p>
                  <p className="text-xs text-slate-500">
                    {selectedItem.job.company?.name?.trim() ||
                      "Unknown company"}
                  </p>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium text-slate-800">
                    Candidate matches
                  </p>
                  {selectedItem.matches.length === 0 ? (
                    <div className="rounded border border-dashed border-slate-300 p-3 text-sm text-slate-600">
                      <p className="font-medium text-slate-900">
                        No matches yet.
                      </p>
                      <p className="mt-1">
                        Add or activate candidates, then run matching again.
                      </p>
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {selectedItem.matches.map((match, index) => {
                        const isSelected =
                          selectedCandidateId === match.candidate.id;
                        return (
                          <li
                            key={match.candidate.id}
                            className="rounded border border-slate-200 p-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm text-slate-900">
                                {index + 1}. {match.candidate.fullName}
                              </p>
                              <Badge>{match.score.overall}% overall</Badge>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                              <Badge>{match.score.skills}% skills</Badge>
                              <Badge>{match.score.roles}% roles</Badge>
                              <Badge>
                                {match.score.certifications}% certifications
                              </Badge>
                              <Badge>
                                {getScoreBasisLabel(match.score.basis)}
                              </Badge>
                            </div>
                            <div className="mt-2 flex gap-2">
                              <Button
                                type="button"
                                className={
                                  isSelected
                                    ? undefined
                                    : "border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                                }
                                onClick={() =>
                                  handleChooseCandidate(
                                    selectedItem,
                                    match.candidate,
                                  )
                                }
                              >
                                Select
                              </Button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium text-slate-800">
                    AI draft email
                  </p>
                  {aiDraftResult?.subject ? (
                    <p className="text-xs font-medium text-slate-600">
                      Subject: {aiDraftResult.subject}
                    </p>
                  ) : null}
                  {draftLoading ? (
                    <div className="flex min-h-80 items-center justify-center rounded border border-slate-200 bg-slate-50">
                      <p className="text-sm text-slate-500">
                        Generating AI email draft&hellip;
                      </p>
                    </div>
                  ) : aiDraftResult?.htmlBody ? (
                    <div
                      className="prose prose-sm max-w-none min-h-80 rounded border border-slate-200 bg-white p-4 overflow-y-auto"
                      dangerouslySetInnerHTML={{
                        __html: aiDraftResult.htmlBody,
                      }}
                    />
                  ) : (
                    <Textarea
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      className="min-h-80"
                      placeholder="Click Regenerate to generate an AI email draft."
                    />
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                      disabled={draftLoading}
                      onClick={() => {
                        if (!selectedItem || !selectedMatch) return;
                        void triggerDraftGeneration(
                          selectedItem.job.id,
                          selectedMatch.candidate.id,
                        );
                      }}
                    >
                      {draftLoading ? "Generating…" : "Regenerate"}
                    </Button>
                    <Button
                      type="button"
                      aria-label="Approve draft"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void handleApprove();
                      }}
                      disabled={!selectedMatch || creating || draftLoading}
                    >
                      {creating ? "Approving…" : "Approve draft"}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={!!pendingReject}
        title="Reject match"
        description="This removes the match from the current review queue. You can rescore by refreshing later."
        confirmLabel="Reject"
        onOpenChange={(open) => !open && setPendingReject(null)}
        onConfirm={() => {
          if (!pendingReject) {
            return;
          }
          setQueue((current) =>
            current.filter((item) => item.job.id !== pendingReject.job.id),
          );
          if (selectedJobId === pendingReject.job.id) {
            setSelectedJobId(null);
            setSelectedCandidateId(null);
            setDraft("");
          }
          setPendingReject(null);
          setApproveSuccess("Match rejected from the review queue.");
        }}
      />
    </div>
  );
}
