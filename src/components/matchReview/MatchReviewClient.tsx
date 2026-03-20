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
  isActive: boolean;
};

type QueueItem = {
  job: Job;
  source: "LinkedIn" | "Upload";
  confidence: number;
  matches: Array<{
    candidate: Candidate;
    score: number;
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

function scoreCandidate(job: Job, candidate: Candidate): number {
  const jobTerms = new Set(toTerms(`${job.title} ${job.rawText}`));
  const roleTerms = toTerms(candidate.suggestedRolesCsv);
  const skillTerms = toTerms(candidate.skillsCsv);
  const overlap = [...new Set([...roleTerms, ...skillTerms])].filter((term) =>
    jobTerms.has(term),
  ).length;
  const base = 50 + Math.min(40, overlap * 8) + (candidate.isActive ? 5 : 0);
  return Math.max(45, Math.min(95, base));
}

function hashText(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function resolveDraftVariant(job: Job, candidate: Candidate): number {
  return hashText(`${job.id}:${candidate.id}:${job.title}`) % 3;
}

function roleRelevantSkills(jobTitle: string, skillsCsv: string): string {
  const skills = skillsCsv
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (skills.length === 0) {
    return "Relevant cloud and platform capability";
  }

  const roleTerms = new Set(toTerms(jobTitle));
  const ranked = skills
    .map((skill) => {
      const overlap = toTerms(skill).filter((term) =>
        roleTerms.has(term),
      ).length;
      return { skill, overlap };
    })
    .sort((left, right) => right.overlap - left.overlap);

  const picked = ranked.slice(0, 6).map((item) => item.skill);
  return picked.join(", ");
}

function buildDraft(job: Job, candidate: Candidate, variant = 0): string {
  const openings = [
    `Based on your ${job.title} brief, ${candidate.fullName} appears to align strongly with the required technical depth and contract delivery expectations.`,
    `${candidate.fullName} looks like a strong fit for your ${job.title} requirement, particularly where delivery pace and technical ownership are important.`,
    `For your ${job.title} role, ${candidate.fullName} stands out on practical capability and contract-readiness against the priorities in your brief.`,
  ];

  const strengths = [
    `Key strengths for this ${job.title} brief: ${roleRelevantSkills(job.title, candidate.skillsCsv)}.`,
    `Most relevant capability for this role includes ${roleRelevantSkills(job.title, candidate.skillsCsv)}.`,
    `For this requirement, the profile is strongest around ${roleRelevantSkills(job.title, candidate.skillsCsv)}.`,
  ];

  const closes = [
    "Would it be unreasonable to share this profile for immediate review and confirm interview availability this week?",
    "Would it be a bad idea to line up a short review call this week to confirm fit and next steps?",
    "If helpful, we can send a concise interview-ready summary and coordinate availability for this week.",
  ];

  const index = Math.abs(variant) % openings.length;

  return `Hi ${job.company?.name?.trim() || "Hiring Team"},\n\n${openings[index]}\n\n${strengths[index]}\n\n${closes[index]}\n\nKind regards`;
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
  const [draftVariant, setDraftVariant] = React.useState(0);
  const [creating, setCreating] = React.useState(false);
  const [approveSuccess, setApproveSuccess] = React.useState<string | null>(
    null,
  );

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
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);

        return {
          job,
          source: getSource(job),
          confidence: scored[0]?.score ?? 50,
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
          const nextVariant = resolveDraftVariant(
            preferredItem.job,
            firstCandidate,
          );
          setSelectedCandidateId(firstCandidate.id);
          setDraftVariant(nextVariant);
          setDraft(buildDraft(preferredItem.job, firstCandidate, nextVariant));
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
        const nextVariant = resolveDraftVariant(nextItem.job, firstCandidate);
        setSelectedCandidateId(firstCandidate.id);
        setDraftVariant(nextVariant);
        setDraft(buildDraft(nextItem.job, firstCandidate, nextVariant));
      } else {
        setSelectedCandidateId(null);
        setDraftVariant(0);
        setDraft("");
      }
    }
  }, [queue, selectedCandidateId, selectedJobId]);

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
      setDraftVariant(0);
      setDraft("");
      return;
    }

    if (!matchedCandidate) {
      setSelectedCandidateId(fallbackCandidate.id);
    }

    if (draft.trim().length === 0) {
      const nextVariant = resolveDraftVariant(
        selectedQueueItem.job,
        fallbackCandidate,
      );
      setDraftVariant(nextVariant);
      setDraft(
        buildDraft(selectedQueueItem.job, fallbackCandidate, nextVariant),
      );
    }
  }, [draft, queue, selectedCandidateId, selectedJobId]);

  const selectedItem =
    queue.find((item) => item.job.id === selectedJobId) ?? null;
  const hasAnyMatches = queue.some((item) => item.matches.length > 0);
  const selectedMatch =
    selectedItem?.matches.find(
      (match) => match.candidate.id === selectedCandidateId,
    ) ?? null;

  const handleOpenReview = (item: QueueItem) => {
    setApproveSuccess(null);
    setActionError(null);
    setSelectedJobId(item.job.id);
    const topCandidate = item.matches[0]?.candidate;
    if (topCandidate) {
      const nextVariant = resolveDraftVariant(item.job, topCandidate);
      setSelectedCandidateId(topCandidate.id);
      setDraftVariant(nextVariant);
      setDraft(buildDraft(item.job, topCandidate, nextVariant));
    }
  };

  const handleChooseCandidate = (item: QueueItem, candidate: Candidate) => {
    setApproveSuccess(null);
    setActionError(null);
    const nextVariant = resolveDraftVariant(item.job, candidate);
    setSelectedJobId(item.job.id);
    setSelectedCandidateId(candidate.id);
    setDraftVariant(nextVariant);
    setDraft(buildDraft(item.job, candidate, nextVariant));
  };

  const handleApprove = async () => {
    if (!selectedItem || !selectedMatch) {
      return;
    }

    setCreating(true);
    try {
      setActionError(null);
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

      <div>
        <h1>Match review</h1>
        <p className="text-sm text-slate-600">
          Review each job with top candidate matches and approve to create an
          application.
        </p>
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
                              <Badge>{match.score}%</Badge>
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
                  <Textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    className="min-h-80"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                      onClick={() => {
                        if (!selectedItem || !selectedMatch) return;
                        const nextVariant = draftVariant + 1;
                        setDraftVariant(nextVariant);
                        setDraft(
                          buildDraft(
                            selectedItem.job,
                            selectedMatch.candidate,
                            nextVariant,
                          ),
                        );
                      }}
                    >
                      Regenerate
                    </Button>
                    <Button
                      type="button"
                      aria-label="Approve draft"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void handleApprove();
                      }}
                      disabled={!selectedMatch || creating}
                    >
                      {creating ? "Approving..." : "Approve draft"}
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
