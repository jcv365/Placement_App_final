"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SuccessBanner } from "@/components/ui/success-banner";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson } from "@/lib/client";
import { guardCandidateForOpportunity } from "@/lib/roleMatchGuard";
import Link from "next/link";
import * as React from "react";

type Job = {
  id: string;
  title: string;
  rawText: string;
  createdAt: string;
  opportunityEmail?: string | null;
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
  basis: "SKILLS" | "CERTIFICATIONS" | "WEIGHTED" | "BASELINE" | "AI";
};

type AiScoredCandidate = {
  id: string;
  fullName: string;
  email: string | null;
  skillsCsv: string;
  certificationsCsv: string;
  suggestedRolesCsv: string;
  isActive: boolean;
  aiScore: number;
  rationale: string;
};

type QueueItem = {
  job: Job;
  source: "LinkedIn" | "Upload";
  confidence: number;
  aiScored?: boolean;
  matches: Array<{
    candidate: Candidate;
    score: MatchScoreBreakdown;
    rationale?: string;
  }>;
};

type ExistingApplication = {
  jobId: string;
  candidateId: string;
  emails?: Array<{ id: string }>;
};

type DraftedApplication = {
  id: string;
  job: { id: string; opportunityEmail: string | null };
  emails: Array<{ id: string }>;
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

function tokenFrequency(
  text: string,
  stops: Set<string>,
  minLen = 3,
): Map<string, number> {
  const counts = new Map<string, number>();
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((token) => token.length >= minLen && !stops.has(token));

  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return counts;
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
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
  let bestRoleCoverage = 0;
  let bestTitleTokenRatio = 0;
  for (const segment of segments) {
    const segTokens = significantTokens(segment, TITLE_STOP, 2);
    if (segTokens.size === 0) continue;

    const tokenOverlap = [...segTokens].filter((t) => candidateTokens.has(t));
    const tokenRatio = tokenOverlap.length / segTokens.size;
    bestTitleTokenRatio = Math.max(bestTitleTokenRatio, tokenRatio);

    // Does any candidate role phrase match this segment?
    // Use bidirectional coverage so that verbose LinkedIn titles like
    // "job alert! needs a DevOps Engineer - 11 Month Contract" still score
    // 1.0 when the candidate's role ("DevOps Engineer") is fully contained
    // within the title, even though the title has many extra tokens.
    // Require the role phrase to have >=2 tokens to avoid single-word false
    // positives (e.g. "Engineer" superficially matching any engineering role).
    const segmentRoleCoverage = Math.max(
      0,
      ...candidateRolePhrases.map((role) => {
        const rTokens = significantTokens(role, TITLE_STOP, 2);
        if (rTokens.size === 0) return 0;
        const intersection = [...segTokens].filter((t) =>
          rTokens.has(t),
        ).length;
        const forward = intersection / segTokens.size;
        // Reverse: fraction of the candidate's role tokens present in the title.
        // If the role is fully contained in the title, treat as full match.
        const reverse = rTokens.size >= 2 ? intersection / rTokens.size : 0;
        return Math.max(forward, reverse);
      }),
    );
    bestRoleCoverage = Math.max(bestRoleCoverage, segmentRoleCoverage);

    let segScore: number;
    if (segmentRoleCoverage >= 1) {
      segScore = 85; // candidate's role matches job title
    } else if (segmentRoleCoverage >= 0.6 && tokenRatio >= 1) {
      segScore = 80; // strong overlap
    } else if (tokenRatio >= 1) {
      segScore = 70; // all title tokens in profile
    } else {
      segScore = tokenRatio * 60;
    }
    bestTitleScore = Math.max(bestTitleScore, segScore);
  }

  // ---------- Job token sets for sub-scores ----------
  const bodyTokens = significantTokens(bodyText, BODY_STOP);
  const titleTokenSet = new Set(
    segments.flatMap((s) => [...significantTokens(s, TITLE_STOP, 2)]),
  );

  // Build a focused requirement token set so percentages are interpretable.
  // Title tokens get extra weight because they represent the core role intent.
  const weightedJobSignals = tokenFrequency(
    `${rawTitle}\n${bodyText}`,
    BODY_STOP,
  );
  for (const titleToken of titleTokenSet) {
    weightedJobSignals.set(
      titleToken,
      (weightedJobSignals.get(titleToken) ?? 0) + 3,
    );
  }
  const topRequirementTokens = Array.from(weightedJobSignals.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }
      return a[0].localeCompare(b[0]);
    })
    .slice(0, 18)
    .map(([token]) => token);

  // ---------- Certification gate ----------
  const requiredCertifications = getRequiredCertificationTerms(job);
  const candidateCertTokens = toCsvTerms(candidate.certificationsCsv);
  const requiredCertOverlap = [...requiredCertifications].filter((t) =>
    candidateCertTokens.has(t),
  ).length;
  if (requiredCertifications.size > 0) {
    if (requiredCertOverlap === 0) {
      return {
        overall: 0,
        skills: 0,
        certifications: 0,
        roles: 0,
        basis: "CERTIFICATIONS",
      };
    }
  }

  // ---------- Body bonus (0-15 pts) ----------
  // Extra credit for matching JD body keywords beyond the title.
  const bodyOnlyTokens = [...bodyTokens].filter((t) => !titleTokenSet.has(t));
  const bodyMatched = bodyOnlyTokens.filter((t) => candidateTokens.has(t));
  const bodyScore = Math.min(bodyMatched.length * 3, 15);

  // ---------- Dimension breakdowns (informational) ----------
  // "Does the candidate possess what the JD asks for?"
  // Denominator = job tokens so broadly-skilled candidates are NOT penalised.
  const jobAllTokens = new Set([...titleTokenSet, ...bodyTokens]);
  const candSkillTokens = significantTokens(candidate.skillsCsv, new Set(), 2);

  const effectiveRequirementTokens =
    topRequirementTokens.length > 0
      ? topRequirementTokens
      : [...jobAllTokens].slice(0, 18);

  const skills =
    effectiveRequirementTokens.length > 0
      ? clampPct(
          ([...effectiveRequirementTokens].filter((t) => candSkillTokens.has(t))
            .length /
            effectiveRequirementTokens.length) *
            100,
        )
      : 0;

  const roles = clampPct(Math.max(bestRoleCoverage, bestTitleTokenRatio) * 100);

  const certifications =
    requiredCertifications.size > 0
      ? clampPct((requiredCertOverlap / requiredCertifications.size) * 100)
      : 0;

  // ---------- Unified overall ----------
  // Keep title/body influence strong, but blend with component coverage so
  // overall cannot drift far from visible skills/roles/certification scores.
  const titleBodyOverall = Math.min(
    100,
    Math.round(bestTitleScore + bodyScore),
  );
  const certWeight = requiredCertifications.size > 0 ? 0.1 : 0;
  const roleWeight = 0.45;
  const skillWeight = 0.45;
  const denom = roleWeight + skillWeight + certWeight;
  const componentOverall =
    denom > 0
      ? (roles * roleWeight +
          skills * skillWeight +
          certifications * certWeight) /
        denom
      : 0;

  let overall = clampPct(titleBodyOverall * 0.8 + componentOverall * 0.2);

  if (candidate.isActive) {
    overall = clampPct(overall + 3);
  }

  const basis: MatchScoreBreakdown["basis"] =
    overall > 0 ? "WEIGHTED" : "BASELINE";

  return { overall, skills, certifications, roles, basis };
}

function getScoreBasisLabel(basis: MatchScoreBreakdown["basis"]): string {
  if (basis === "AI") {
    return "AI scored";
  }

  if (basis === "SKILLS") {
    return "Skills basis";
  }

  if (basis === "CERTIFICATIONS") {
    return "Certifications basis";
  }

  if (basis === "WEIGHTED") {
    return "Weighted basis";
  }

  return "Keyword basis";
}

type AiDraftResult = {
  id: string;
  subject: string;
  htmlBody: string;
  applicationId?: string;
  skipped?: boolean;
  reason?: string;
  outlookDraft?: {
    status: "created" | "skipped" | "failed";
    mailbox?: string;
    reason?: string;
  };
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
  const lastAutoDraftAttemptKeyRef = React.useRef<string | null>(null);
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
  const [pendingBulkCount, setPendingBulkCount] = React.useState<number | null>(
    null,
  );
  const cancelBulkRef = React.useRef(false);
  const [sendingToOutlook, setSendingToOutlook] = React.useState(false);
  const [bulkSending, setBulkSending] = React.useState(false);
  const [unsentDraftCount, setUnsentDraftCount] = React.useState<number | null>(
    null,
  );
  // AI scoring state — ref tracks which jobs have been attempted (avoids stale closure loops);
  // state drives loading indicators and "AI scored" badges.
  const aiScoredJobIdsRef = React.useRef(new Set<string>());
  const [aiScoringJobIds, setAiScoringJobIds] = React.useState<Set<string>>(
    new Set(),
  );
  const [aiScoredBadgeJobIds, setAiScoredBadgeJobIds] = React.useState<
    Set<string>
  >(new Set());
  const [bulkAiScoring, setBulkAiScoring] = React.useState(false);
  const [aiScoringBulkProgress, setAiScoringBulkProgress] = React.useState<{
    done: number;
    total: number;
  } | null>(null);
  const cancelBulkAiRef = React.useRef(false);

  // Review queue filters
  const [filterDate, setFilterDate] = React.useState<"all" | "today" | "week">(
    "all",
  );
  const [filterOpportunity, setFilterOpportunity] = React.useState("");
  const [filterRole, setFilterRole] = React.useState("");

  const displayQueue = React.useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 7);

    const opp = filterOpportunity.trim().toLowerCase();
    const role = filterRole.trim().toLowerCase();

    return queue.filter((item) => {
      if (filterDate === "today") {
        if (new Date(item.job.createdAt) < todayStart) return false;
      } else if (filterDate === "week") {
        if (new Date(item.job.createdAt) < weekStart) return false;
      }
      if (opp) {
        const title = item.job.title.toLowerCase();
        const company = (item.job.company?.name ?? "").toLowerCase();
        if (!title.includes(opp) && !company.includes(opp)) return false;
      }
      if (role) {
        const jobTitle = item.job.title.toLowerCase();
        const candidateRoles = item.matches
          .flatMap((m) =>
            m.candidate.suggestedRolesCsv
              .split(",")
              .map((r) => r.trim().toLowerCase()),
          )
          .join(" ");
        if (!jobTitle.includes(role) && !candidateRoles.includes(role))
          return false;
      }
      return true;
    });
  }, [queue, filterDate, filterOpportunity, filterRole]);

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

  const triggerAiScoring = React.useCallback(async (jobId: string) => {
    if (aiScoredJobIdsRef.current.has(jobId)) return;
    aiScoredJobIdsRef.current.add(jobId); // Mark immediately to guard concurrent calls
    setAiScoringJobIds((prev) => {
      const next = new Set(prev);
      next.add(jobId);
      return next;
    });
    try {
      const result = await fetchJson<{ candidates: AiScoredCandidate[] }>(
        `/api/match/score?jobId=${encodeURIComponent(jobId)}`,
      );
      if (result.candidates.length > 0) {
        setQueue((prev) =>
          prev.map((item) => {
            if (item.job.id !== jobId) return item;
            const aiMatches = result.candidates.map((sc) => {
              const existing = item.matches.find(
                (m) => m.candidate.id === sc.id,
              );
              const candidate: Candidate = existing?.candidate ?? {
                id: sc.id,
                fullName: sc.fullName,
                email: sc.email,
                skillsCsv: sc.skillsCsv,
                certificationsCsv: sc.certificationsCsv,
                suggestedRolesCsv: sc.suggestedRolesCsv,
                isActive: sc.isActive,
              };
              return {
                candidate,
                score: {
                  overall: sc.aiScore,
                  skills: 0,
                  certifications: 0,
                  roles: sc.aiScore,
                  basis: "AI" as const,
                },
                rationale: sc.rationale?.trim() || "AI confirmed match.",
              };
            });
            return {
              ...item,
              aiScored: true,
              confidence: aiMatches[0]?.score.overall ?? item.confidence,
              matches: aiMatches,
            };
          }),
        );
        setAiScoredBadgeJobIds((prev) => {
          const next = new Set(prev);
          next.add(jobId);
          return next;
        });
      } else {
        // No AI matches — mark as scored but keep the keyword queue
        setQueue((prev) =>
          prev.map((item) =>
            item.job.id === jobId ? { ...item, aiScored: true } : item,
          ),
        );
      }
    } catch {
      // Keep keyword matches on error — job ref already marked so no retry loop
    } finally {
      setAiScoringJobIds((prev) => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });
    }
  }, []);

  const handleBulkAiScore = async () => {
    const unscored = queue.filter(
      (item) => !aiScoredJobIdsRef.current.has(item.job.id),
    );
    if (unscored.length === 0) return;
    setBulkAiScoring(true);
    cancelBulkAiRef.current = false;
    const total = unscored.length;
    let done = 0;
    setAiScoringBulkProgress({ done, total });
    for (const item of unscored) {
      if (cancelBulkAiRef.current) break;
      await triggerAiScoring(item.job.id);
      done++;
      setAiScoringBulkProgress({ done, total });
    }
    cancelBulkAiRef.current = false;
    setBulkAiScoring(false);
    setAiScoringBulkProgress(null);
  };

  const triggerDraftGeneration = React.useCallback(
    async (jobId: string, candidateId: string) => {
      const pairKey = `${jobId}::${candidateId}`;
      lastAutoDraftAttemptKeyRef.current = pairKey;
      setDraftLoading(true);
      setDraft("");
      setAiDraftResult(null);
      setActionError(null);
      try {
        const result = await generateDraftViaApi(jobId, candidateId);
        if (result.skipped) {
          const reason =
            result.reason === "no_opportunity_email"
              ? "Skipped: this job has no recruiter contact email. Add an opportunity email to the job first."
              : `Skipped: ${result.reason ?? "unknown reason"}`;
          setActionError(reason);
        } else {
          setAiDraftResult(result);
          setDraft(result.htmlBody);
        }
      } catch (error) {
        setActionError(`Email generation failed: ${(error as Error).message}`);
      } finally {
        setDraftLoading(false);
      }
    },
    [],
  );

  const sendToOutlook = React.useCallback(
    async (draftResult: AiDraftResult, job: Job) => {
      if (
        !draftResult.id ||
        !draftResult.applicationId ||
        !job.opportunityEmail
      )
        return;

      const emails = job.opportunityEmail
        .split(/[;,]/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

      if (emails.length === 0) {
        setActionError(
          "No valid opportunity email on this job. Update the job contact email first.",
        );
        return;
      }

      setSendingToOutlook(true);
      setActionError(null);
      try {
        await fetchJson("/api/email/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            emailDraftId: draftResult.id,
            applicationId: draftResult.applicationId,
            to: emails,
          }),
        });
        setAiDraftResult((prev) =>
          prev
            ? {
                ...prev,
                outlookDraft: { status: "created" as const },
              }
            : prev,
        );
        setApproveSuccess("Outlook draft created successfully.");
      } catch (error) {
        setActionError(`Send to Outlook failed: ${(error as Error).message}`);
      } finally {
        setSendingToOutlook(false);
      }
    },
    [],
  );

  const load = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [jobs, candidates] = await Promise.all([
        fetchJson<Job[]>("/api/jobs?contactable=true"),
        fetchJson<Candidate[]>("/api/candidates?slim=true"),
      ]);

      const eligibleCandidates = candidates.filter(
        (candidate) => candidate.isActive,
      );
      const nextQueue = jobs
        .map((job) => {
          const scored = eligibleCandidates
            .map((candidate) => ({
              candidate,
              score: scoreCandidate(job, candidate),
            }))
            .filter((match) => {
              if (match.score.overall < 75) return false;
              const roles = match.candidate.suggestedRolesCsv
                .split(",")
                .map((r) => r.trim())
                .filter(Boolean);
              return guardCandidateForOpportunity(roles, job.title).allowed;
            })
            .sort((a, b) => b.score.overall - a.score.overall)
            .slice(0, 5);

          return {
            job,
            source: getSource(job),
            confidence: scored[0]?.score.overall ?? 0,
            matches: scored,
          };
        })
        .sort((a, b) => b.confidence - a.confidence);

      // Bulk-fetch all cached AI scores in one query so cached jobs show AI
      // results immediately — no per-job "Scoring…" flash on page load.
      let cachedByJobId = new Map<string, AiScoredCandidate[]>();
      try {
        const bulkResult = await fetchJson<{
          results: { jobId: string; candidates: AiScoredCandidate[] }[];
        }>("/api/match/score/cached", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobIds: nextQueue.map((item) => item.job.id),
          }),
        });
        cachedByJobId = new Map(
          bulkResult.results.map((r) => [r.jobId, r.candidates]),
        );
      } catch {
        // Non-fatal — proceed with keyword queue if cache fetch fails
      }

      const preScoredIds = new Set<string>();
      const mergedQueue = nextQueue.map((item) => {
        const cached = cachedByJobId.get(item.job.id);
        if (!cached || cached.length === 0) return item;

        preScoredIds.add(item.job.id);
        const aiMatches = cached.map((sc) => {
          const existing = item.matches.find((m) => m.candidate.id === sc.id);
          const candidate: Candidate = existing?.candidate ?? {
            id: sc.id,
            fullName: sc.fullName,
            email: sc.email,
            skillsCsv: sc.skillsCsv,
            certificationsCsv: sc.certificationsCsv,
            suggestedRolesCsv: sc.suggestedRolesCsv,
            isActive: sc.isActive,
          };
          return {
            candidate,
            score: {
              overall: sc.aiScore,
              skills: 0,
              certifications: 0,
              roles: sc.aiScore,
              basis: "AI" as const,
            },
            rationale: sc.rationale?.trim() || "AI confirmed match.",
          };
        });
        return {
          ...item,
          aiScored: true,
          confidence: aiMatches[0]?.score.overall ?? item.confidence,
          matches: aiMatches,
        };
      });

      // Re-sort: AI-scored jobs bubble up by AI confidence, keyword-only jobs follow
      const finalQueue = [
        ...mergedQueue
          .filter((item) => preScoredIds.has(item.job.id))
          .sort((a, b) => b.confidence - a.confidence),
        ...mergedQueue
          .filter((item) => !preScoredIds.has(item.job.id))
          .sort((a, b) => b.confidence - a.confidence),
      ];

      // Pre-populate the ref so triggerAiScoring won't re-fetch cached jobs
      for (const id of preScoredIds) {
        aiScoredJobIdsRef.current.add(id);
      }

      setQueue(finalQueue);
      if (preScoredIds.size > 0) {
        setAiScoredBadgeJobIds(preScoredIds);
      }

      const preferredItem =
        (initialJobId
          ? finalQueue.find((item) => item.job.id === initialJobId)
          : undefined) ?? finalQueue[0];

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJobId]);

  React.useEffect(() => {
    load();
  }, [load]);

  // When a job is selected, fire off AI scoring for it (lazy, one-shot per job).
  React.useEffect(() => {
    if (!selectedJobId) return;
    void triggerAiScoring(selectedJobId);
  }, [selectedJobId, triggerAiScoring]);

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
        // Only trigger generation if we haven't already attempted this pair.
        // This prevents AI scoring queue updates from wiping an in-flight or
        // completed draft when the AI top candidate differs from keyword top.
        const newPairKey = `${nextItem.job.id}::${firstCandidate.id}`;
        if (lastAutoDraftAttemptKeyRef.current !== newPairKey) {
          void triggerDraftGeneration(nextItem.job.id, firstCandidate.id);
        }
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

    const pairKey = `${selectedQueueItem.job.id}::${fallbackCandidate.id}`;
    if (
      draft.trim().length === 0 &&
      !draftLoading &&
      lastAutoDraftAttemptKeyRef.current !== pairKey
    ) {
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

  const allHighScoreMatches = React.useMemo(() => {
    const pairs: Array<{
      jobId: string;
      candidateId: string;
      score: number;
      jobTitle: string;
      candidateName: string;
    }> = [];
    for (const item of queue) {
      for (const match of item.matches) {
        if (match.score.overall >= 75) {
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

  const fetchDraftedPairKeys = React.useCallback(async () => {
    const keyOf = (jobId: string, candidateId: string) =>
      `${jobId}::${candidateId}`;
    const applications = await fetchJson<ExistingApplication[]>(
      "/api/applications?drafted=true",
    );
    return new Set(
      applications
        .filter((application) => (application.emails?.length ?? 0) > 0)
        .map((application) =>
          keyOf(application.jobId, application.candidateId),
        ),
    );
  }, []);

  React.useEffect(() => {
    if (allHighScoreMatches.length === 0) {
      setPendingBulkCount(0);
      return;
    }

    let cancelled = false;
    const keyOf = (jobId: string, candidateId: string) =>
      `${jobId}::${candidateId}`;

    void (async () => {
      try {
        const draftedPairs = await fetchDraftedPairKeys();
        const pending = allHighScoreMatches.filter(
          (pair) => !draftedPairs.has(keyOf(pair.jobId, pair.candidateId)),
        ).length;
        if (!cancelled) {
          setPendingBulkCount(pending);
        }
      } catch {
        if (!cancelled) {
          // Fallback to total matches if we cannot resolve drafted state.
          setPendingBulkCount(allHighScoreMatches.length);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fetchDraftedPairKeys, allHighScoreMatches]);

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
    if (allHighScoreMatches.length === 0) return;
    cancelBulkRef.current = false;
    setBulkDrafting(true);
    setActionError(null);
    const keyOf = (jobId: string, candidateId: string) =>
      `${jobId}::${candidateId}`;

    let draftedPairs = new Set<string>();
    try {
      draftedPairs = await fetchDraftedPairKeys();
    } catch (error) {
      // Continue with current queue if drafted-state lookup fails.
      console.warn("[MATCH_REVIEW_BULK_DRAFT_LOOKUP]", error);
    }

    const pendingPairs = allHighScoreMatches.filter(
      (pair) => !draftedPairs.has(keyOf(pair.jobId, pair.candidateId)),
    );

    const skipped = allHighScoreMatches.length - pendingPairs.length;
    const total = pendingPairs.length;

    if (pendingPairs.length === 0) {
      setBulkDrafting(false);
      setBulkProgress(null);
      setApproveSuccess(
        `No new drafts to create. ${skipped} already drafted match${skipped === 1 ? " was" : "es were"} skipped.`,
      );
      return;
    }

    let done = 0;
    let failed = 0;
    const failureMessages: string[] = [];
    setBulkProgress({ done, total, failed });
    for (const pair of pendingPairs) {
      if (cancelBulkRef.current) break;
      try {
        await generateDraftViaApi(pair.jobId, pair.candidateId);
      } catch (error) {
        failed++;
        const message =
          error instanceof Error
            ? error.message.trim()
            : "Unknown draft generation error";
        if (
          message &&
          !failureMessages.includes(message) &&
          failureMessages.length < 3
        ) {
          failureMessages.push(message);
        }
      }
      done++;
      setBulkProgress({ done, total, failed });
    }
    const wasCancelled = cancelBulkRef.current;
    cancelBulkRef.current = false;
    setBulkDrafting(false);
    if (wasCancelled) {
      setActionError(
        `Cancelled after ${done} of ${total} draft${done === 1 ? "" : "s"}.${done > 0 && failed > 0 ? ` ${failed} failed.` : ""}`,
      );
    } else if (failed === 0) {
      setApproveSuccess(
        `All ${total} new email draft${total === 1 ? " was" : "s were"} created and placed in your Outlook drafts.${skipped > 0 ? ` ${skipped} already drafted match${skipped === 1 ? " was" : "es were"} skipped.` : ""}`,
      );
    } else {
      setActionError(
        `${total - failed} of ${total} new drafts created. ${failed} failed — you can retry.${failureMessages.length > 0 ? ` First error: ${failureMessages[0]}` : ""}${skipped > 0 ? ` ${skipped} already drafted match${skipped === 1 ? " was" : "es were"} skipped.` : ""}`,
      );
    }
    setBulkProgress(null);

    try {
      const refreshedDraftedPairs = await fetchDraftedPairKeys();
      const refreshedPending = allHighScoreMatches.filter(
        (pair) =>
          !refreshedDraftedPairs.has(keyOf(pair.jobId, pair.candidateId)),
      ).length;
      setPendingBulkCount(refreshedPending);
    } catch {
      setPendingBulkCount(allHighScoreMatches.length);
    }

    void refreshUnsentCount();
  };

  const handleDownloadUniqueRoles = () => {
    const seen = new Set<string>();
    for (const item of queue) {
      for (const match of item.matches) {
        for (const role of match.candidate.suggestedRolesCsv
          .split(",")
          .map((r) => r.trim())
          .filter(Boolean)) {
          seen.add(role.toLowerCase());
        }
      }
    }
    const sorted = [...seen].sort((a, b) => a.localeCompare(b));
    const blob = new Blob([sorted.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "unique-suggested-roles.txt";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const fetchUnsentDrafts = React.useCallback(async () => {
    const apps = await fetchJson<DraftedApplication[]>(
      "/api/applications?stage=EMAIL_DRAFTED",
    );
    return apps.filter(
      (app) => app.emails.length > 0 && app.job.opportunityEmail?.trim(),
    );
  }, []);

  const refreshUnsentCount = React.useCallback(async () => {
    try {
      const unsent = await fetchUnsentDrafts();
      setUnsentDraftCount(unsent.length);
    } catch {
      setUnsentDraftCount(null);
    }
  }, [fetchUnsentDrafts]);

  React.useEffect(() => {
    void refreshUnsentCount();
  }, [refreshUnsentCount]);

  const handleBulkSendToOutlook = async () => {
    setBulkSending(true);
    setActionError(null);
    try {
      const unsent = await fetchUnsentDrafts();
      if (unsent.length === 0) {
        setApproveSuccess(
          "No unsent drafts found — all drafts are already in Outlook.",
        );
        setBulkSending(false);
        setUnsentDraftCount(0);
        return;
      }
      const total = unsent.length;
      let done = 0;
      let failed = 0;
      const failureMessages: string[] = [];
      setBulkProgress({ done, total, failed });
      for (const app of unsent) {
        if (cancelBulkRef.current) break;
        const emails = (app.job.opportunityEmail ?? "")
          .split(/[;,]/)
          .map((e) => e.trim().toLowerCase())
          .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
        const draftId = app.emails[app.emails.length - 1]?.id;
        if (emails.length > 0 && draftId) {
          try {
            await fetchJson("/api/email/send", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                emailDraftId: draftId,
                applicationId: app.id,
                to: emails,
              }),
            });
          } catch (error) {
            failed++;
            const message =
              error instanceof Error ? error.message.trim() : "Unknown error";
            if (
              message &&
              !failureMessages.includes(message) &&
              failureMessages.length < 3
            ) {
              failureMessages.push(message);
            }
          }
        } else {
          failed++;
        }
        done++;
        setBulkProgress({ done, total, failed });
      }
      const wasCancelled = cancelBulkRef.current;
      cancelBulkRef.current = false;
      setBulkProgress(null);
      if (wasCancelled) {
        setActionError(
          `Cancelled after ${done} of ${total} sent.${failed > 0 ? ` ${failed} failed.` : ""}`,
        );
      } else if (failed === 0) {
        setApproveSuccess(
          `All ${total} draft${total === 1 ? "" : "s"} sent to Outlook.`,
        );
      } else {
        setActionError(
          `${total - failed} of ${total} sent. ${failed} failed.${failureMessages.length > 0 ? ` First error: ${failureMessages[0]}` : ""}`,
        );
      }
      void refreshUnsentCount();
    } catch (error) {
      setActionError(`Bulk send failed: ${(error as Error).message}`);
    } finally {
      setBulkSending(false);
    }
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
          {bulkAiScoring ? (
            <>
              <span className="text-sm text-slate-600">
                AI scoring {aiScoringBulkProgress?.done}/
                {aiScoringBulkProgress?.total}…
              </span>
              <Button
                type="button"
                className="border border-red-300 bg-white text-red-700 hover:bg-red-50"
                onClick={() => {
                  cancelBulkAiRef.current = true;
                }}
              >
                Cancel scoring
              </Button>
            </>
          ) : (
            <Button
              type="button"
              className="border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
              disabled={loading || queue.length === 0 || bulkDrafting}
              onClick={() => void handleBulkAiScore()}
            >
              Score all with AI
            </Button>
          )}
          {hasAnyMatches ? (
            <>
              {bulkProgress ? (
                <span className="text-sm text-slate-600">
                  {bulkProgress.done}/{bulkProgress.total} drafted
                  {bulkProgress.failed > 0
                    ? ` (${bulkProgress.failed} failed)`
                    : ""}
                </span>
              ) : null}
              {bulkDrafting ? (
                <Button
                  type="button"
                  className="border border-red-300 bg-white text-red-700 hover:bg-red-50"
                  onClick={() => {
                    cancelBulkRef.current = true;
                  }}
                >
                  Cancel drafts
                </Button>
              ) : null}
              <Button
                type="button"
                disabled={
                  bulkDrafting ||
                  loading ||
                  pendingBulkCount === null ||
                  pendingBulkCount === 0
                }
                onClick={() => void handleBulkAutoDraft()}
              >
                {bulkDrafting
                  ? "Drafting…"
                  : pendingBulkCount === null
                    ? "Auto-draft 75%+ matches (calculating…)"
                    : `Auto-draft 75%+ matches (${pendingBulkCount} pending)`}
              </Button>
            </>
          ) : null}
          <Button
            type="button"
            className="border border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100"
            disabled={
              bulkSending || bulkDrafting || loading || unsentDraftCount === 0
            }
            onClick={() => void handleBulkSendToOutlook()}
          >
            {bulkSending
              ? "Sending…"
              : unsentDraftCount === null
                ? "Send draft emails (loading…)"
                : `Send draft emails (${unsentDraftCount})`}
          </Button>
          <Button
            type="button"
            className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
            disabled={loading || queue.length === 0}
            onClick={handleDownloadUniqueRoles}
          >
            Download unique roles
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Review queue</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Filters */}
            {queue.length > 0 ? (
              <div className="mb-3 flex flex-wrap gap-2">
                <select
                  value={filterDate}
                  onChange={(e) =>
                    setFilterDate(e.target.value as "all" | "today" | "week")
                  }
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-400"
                >
                  <option value="all">All dates</option>
                  <option value="today">Today</option>
                  <option value="week">Last 7 days</option>
                </select>
                <Input
                  type="text"
                  placeholder="Filter by opportunity…"
                  value={filterOpportunity}
                  onChange={(e) => setFilterOpportunity(e.target.value)}
                  className="h-7 w-44 text-xs"
                />
                <Input
                  type="text"
                  placeholder="Filter by role…"
                  value={filterRole}
                  onChange={(e) => setFilterRole(e.target.value)}
                  className="h-7 w-36 text-xs"
                />
                {(filterDate !== "all" || filterOpportunity || filterRole) && (
                  <Button
                    type="button"
                    className="h-7 border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-50"
                    onClick={() => {
                      setFilterDate("all");
                      setFilterOpportunity("");
                      setFilterRole("");
                    }}
                  >
                    Clear filters
                  </Button>
                )}
                <span className="self-center text-xs text-slate-500">
                  {displayQueue.length} of {queue.length}
                </span>
              </div>
            ) : null}
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
            ) : displayQueue.length === 0 ? (
              <div className="rounded border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                <p className="font-medium text-slate-900">
                  No results match your filters.
                </p>
                <p className="mt-1">
                  Try adjusting or clearing the filters above.
                </p>
              </div>
            ) : (
              <ul className="space-y-3 text-sm text-slate-700">
                {displayQueue.map((item) => {
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
                          {aiScoringJobIds.has(item.job.id) ? (
                            <Badge className="animate-pulse border-blue-300 bg-blue-50 text-blue-700">
                              Scoring…
                            </Badge>
                          ) : aiScoredBadgeJobIds.has(item.job.id) ? (
                            <Badge className="border-emerald-300 bg-emerald-50 text-emerald-700">
                              AI
                            </Badge>
                          ) : null}
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
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-slate-800">
                      Candidate matches
                    </p>
                    {selectedJobId && aiScoringJobIds.has(selectedJobId) ? (
                      <span className="animate-pulse text-xs text-blue-600">
                        Refining with AI…
                      </span>
                    ) : selectedJobId &&
                      aiScoredBadgeJobIds.has(selectedJobId) ? (
                      <span className="text-xs text-emerald-600">
                        AI scored
                      </span>
                    ) : null}
                  </div>
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
                              <Badge
                                className={
                                  match.score.basis === "AI"
                                    ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                                    : undefined
                                }
                              >
                                {match.score.overall}%
                                {match.score.basis === "AI" ? " AI" : " match"}
                              </Badge>
                            </div>
                            {match.score.basis === "AI" ? (
                              <p className="mt-1 text-xs text-slate-600 leading-snug">
                                {match.rationale || "AI confirmed match."}
                              </p>
                            ) : (
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
                            )}
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

                {selectedItem.matches.length > 0 && selectedMatch ? (
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
                        placeholder="Click Generate draft to create an AI email."
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
                        {draftLoading
                          ? "Generating…"
                          : aiDraftResult
                            ? "Regenerate"
                            : "Generate draft"}
                      </Button>
                      {aiDraftResult?.htmlBody &&
                      aiDraftResult.applicationId ? (
                        <>
                          {aiDraftResult.outlookDraft?.status === "created" && (
                            <span className="inline-flex items-center rounded bg-green-50 px-3 py-1.5 text-sm font-medium text-green-700 border border-green-200">
                              Sent to Outlook
                            </span>
                          )}
                          {aiDraftResult.outlookDraft?.status === "failed" && (
                            <span className="inline-flex items-center rounded bg-amber-50 px-3 py-1.5 text-sm text-amber-700 border border-amber-200">
                              Auto-send failed
                              {aiDraftResult.outlookDraft.reason
                                ? `: ${aiDraftResult.outlookDraft.reason}`
                                : ""}
                            </span>
                          )}
                          {aiDraftResult.outlookDraft?.status === "skipped" &&
                            aiDraftResult.outlookDraft.reason && (
                              <span className="inline-flex items-center rounded bg-amber-50 px-3 py-1.5 text-sm text-amber-700 border border-amber-200">
                                {aiDraftResult.outlookDraft.reason}
                              </span>
                            )}
                          <Button
                            type="button"
                            className="border border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100"
                            disabled={
                              sendingToOutlook ||
                              draftLoading ||
                              !selectedItem?.job.opportunityEmail
                            }
                            onClick={() => {
                              if (!selectedItem) return;
                              void sendToOutlook(
                                aiDraftResult,
                                selectedItem.job,
                              );
                            }}
                          >
                            {sendingToOutlook
                              ? "Sending…"
                              : aiDraftResult.outlookDraft?.status === "created"
                                ? "Resend to Outlook"
                                : "Send to Outlook"}
                          </Button>
                          <Button
                            type="button"
                            className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                            aria-label="Approve draft"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              void handleApprove();
                            }}
                            disabled={creating || draftLoading}
                          >
                            {creating ? "Approving…" : "Approve & view"}
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                ) : null}
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
