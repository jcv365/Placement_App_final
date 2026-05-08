"use client";

import { Badge } from "@/components/ui/badge";
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
import { Textarea } from "@/components/ui/textarea";
import { fetchJson } from "@/lib/client";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import Link from "next/link";
import * as React from "react";

type ApplicationStage =
  | "NEW"
  | "SHORTLISTED"
  | "EMAIL_DRAFTED"
  | "SENT_TO_CLIENT"
  | "INTERVIEW_1"
  | "INTERVIEW_2"
  | "OFFER"
  | "PLACED"
  | "REJECTED"
  | "ON_HOLD";

type LifecycleActionType =
  | "STOP_CONTRACT"
  | "TERMINATE_CONTRACT"
  | "ACCESS_REVOKED"
  | "ACCESS_RESTORED"
  | "CLIENT_PAUSED"
  | "CANDIDATE_UNAVAILABLE";

const STAGES: ApplicationStage[] = [
  "NEW",
  "EMAIL_DRAFTED",
  "SENT_TO_CLIENT",
  "INTERVIEW_1",
  "INTERVIEW_2",
  "OFFER",
  "ON_HOLD",
  "REJECTED",
  "PLACED",
];

const STAGE_LABELS: Record<ApplicationStage, string> = {
  NEW: "New",
  SHORTLISTED: "Shortlisted",
  EMAIL_DRAFTED: "Email drafted",
  SENT_TO_CLIENT: "Sent to client",
  INTERVIEW_1: "Interview 1",
  INTERVIEW_2: "Interview 2",
  OFFER: "Offer",
  PLACED: "Placed",
  REJECTED: "Rejected",
  ON_HOLD: "On hold",
};

const LIFECYCLE_ACTIONS: Array<{
  value: LifecycleActionType;
  label: string;
  targetStage: ApplicationStage | "KEEP";
}> = [
  {
    value: "STOP_CONTRACT",
    label: "Stop contract",
    targetStage: "ON_HOLD",
  },
  {
    value: "TERMINATE_CONTRACT",
    label: "Terminate contract",
    targetStage: "REJECTED",
  },
  {
    value: "ACCESS_REVOKED",
    label: "Access revoked",
    targetStage: "ON_HOLD",
  },
  {
    value: "ACCESS_RESTORED",
    label: "Access restored",
    targetStage: "PLACED",
  },
  {
    value: "CLIENT_PAUSED",
    label: "Client paused assignment",
    targetStage: "ON_HOLD",
  },
  {
    value: "CANDIDATE_UNAVAILABLE",
    label: "Candidate unavailable",
    targetStage: "ON_HOLD",
  },
];

type Application = {
  id: string;
  opportunityId: string;
  currentStage: ApplicationStage;
  placedAt: string | null;
  agreedHourlyRate: number | null;
  agreedRateLockedAt: string | null;
  placementBillingModel: string | null;
  placementFeePercent: number | null;
  annualCtc: number | null;
  contractValue: number | null;
  signedContractFileName: string | null;
  signedContractMimeType: string | null;
  signedContractUploadedAt: string | null;
  job: {
    id: string;
    title: string;
    rawText: string;
    opportunityEmail: string | null;
    opportunityUrl: string | null;
    company?: {
      id: string;
      name: string;
    } | null;
  };
  candidate: {
    id: string;
    fullName: string;
    email: string | null;
    phone: string | null;
    rawCV: string;
  };
  notes: { id: string }[];
  emails: { id: string }[];
  updatedAt: string;
};

type DetailData = Omit<Application, "emails"> & {
  history?: {
    id: string;
    fromStage: ApplicationStage | null;
    toStage: ApplicationStage;
    changedAt: string;
  }[];
  notes?: {
    id: string;
    content: string;
    author: string | null;
    createdAt: string;
  }[];
  emails?: {
    id: string;
    subject: string;
    htmlBody: string;
    preferredForLearning?: boolean;
    createdAt: string;
  }[];
};

type GroupedApplication = {
  id: string;
  stage: ApplicationStage;
  representative: Application;
  applicationIds: string[];
  groupedCount: number;
  totalNotes: number;
  totalEmails: number;
  hasPlacementIssue: boolean;
  latestUpdatedAt: string;
};

type PipelineViewFilter =
  | "ALL"
  | "ACTIVE"
  | "PLACED_ONLY"
  | "INACTIVE"
  | "PLACEMENT_ISSUES";

type BoardSort = "UPDATED_DESC" | "UPDATED_ASC" | "GROUP_SIZE_DESC";
type BoardDensity = "COMPACT" | "COMFORTABLE";

type PlacementTarget = {
  id: string;
  candidateName: string;
  roleTitle: string;
  agreedHourlyRate: number | null;
  agreedRateLockedAt: string | null;
  placementBillingModel: string | null;
  placementFeePercent: number | null;
  annualCtc: number | null;
  contractValue: number | null;
  signedContractFileName: string | null;
  signedContractUploadedAt: string | null;
};

function isPlacementRequirementsMissing(application: {
  currentStage: ApplicationStage;
  agreedHourlyRate: number | null;
  placementBillingModel: string | null;
  signedContractUploadedAt: string | null;
}): boolean {
  return (
    application.currentStage === "PLACED" &&
    (application.agreedHourlyRate == null ||
      application.placementBillingModel == null ||
      application.signedContractUploadedAt == null)
  );
}

function normaliseGroupValue(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function getGroupKey(application: Application): string {
  const fallbackKey = [
    normaliseGroupValue(application.job.title),
    normaliseGroupValue(application.candidate.fullName),
    normaliseGroupValue(application.candidate.email),
  ].join("|");

  return [
    application.currentStage,
    normaliseGroupValue(application.opportunityId) || fallbackKey,
  ].join("|");
}

function matchesQuickSearch(
  grouped: GroupedApplication,
  query: string,
): boolean {
  const term = query.trim().toLowerCase();
  if (!term) {
    return true;
  }

  const fields = [
    grouped.representative.candidate.fullName,
    grouped.representative.candidate.email,
    grouped.representative.job.title,
    grouped.representative.job.company?.name,
    grouped.representative.opportunityId,
  ];

  return fields.some((value) => (value ?? "").toLowerCase().includes(term));
}

function matchesPipelineView(
  grouped: GroupedApplication,
  view: PipelineViewFilter,
): boolean {
  if (view === "ALL") {
    return true;
  }

  if (view === "ACTIVE") {
    return !["PLACED", "REJECTED", "ON_HOLD"].includes(grouped.stage);
  }

  if (view === "PLACED_ONLY") {
    return grouped.stage === "PLACED";
  }

  if (view === "INACTIVE") {
    return ["REJECTED", "ON_HOLD"].includes(grouped.stage);
  }

  return grouped.hasPlacementIssue;
}

export default function ApplicationBoard() {
  const initialSearchParams = React.useMemo(() => {
    if (typeof window === "undefined") {
      return new URLSearchParams();
    }

    return new URLSearchParams(window.location.search);
  }, []);

  const [applications, setApplications] = React.useState<Application[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<DetailData | null>(null);
  const [selectedEmailDraftId, setSelectedEmailDraftId] = React.useState<
    string | null
  >(null);
  const [noteContent, setNoteContent] = React.useState("");
  const [editFullName, setEditFullName] = React.useState("");
  const [editEmail, setEditEmail] = React.useState("");
  const [editPhone, setEditPhone] = React.useState("");
  const [editHourlyRate, setEditHourlyRate] = React.useState("");
  const [savingDetails, setSavingDetails] = React.useState(false);
  const [generatingEmailDraft, setGeneratingEmailDraft] = React.useState(false);
  const [bulkGenerating, setBulkGenerating] = React.useState(false);
  const [bulkProgress, setBulkProgress] = React.useState({
    done: 0,
    total: 0,
    failed: 0,
  });
  const [savingLearningPreference, setSavingLearningPreference] =
    React.useState(false);
  const [runningLifecycleAction, setRunningLifecycleAction] =
    React.useState(false);
  const [lifecycleAction, setLifecycleAction] =
    React.useState<LifecycleActionType>("STOP_CONTRACT");
  const [lifecycleReason, setLifecycleReason] = React.useState("");
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(
    null,
  );
  const [placementTarget, setPlacementTarget] =
    React.useState<PlacementTarget | null>(null);
  const [placementRate, setPlacementRate] = React.useState("");
  const [placementBillingModel, setPlacementBillingModel] = React.useState("");
  const [placementFeePercent, setPlacementFeePercent] = React.useState("");
  const [placementAnnualCtc, setPlacementAnnualCtc] = React.useState("");
  const [placementContractValue, setPlacementContractValue] =
    React.useState("");
  const [placementContractFile, setPlacementContractFile] =
    React.useState<File | null>(null);
  const [savingPlacement, setSavingPlacement] = React.useState(false);
  const [addingNote, setAddingNote] = React.useState(false);
  const [creatingDraft, setCreatingDraft] = React.useState(false);
  const [draftTo, setDraftTo] = React.useState("");
  const [activeAiProvider, setActiveAiProvider] = React.useState("fallback");
  const [filterCandidateEmail, setFilterCandidateEmail] = React.useState(
    initialSearchParams.get("candidateEmail") ?? "",
  );
  const [filterCompanyName, setFilterCompanyName] = React.useState(
    initialSearchParams.get("companyName") ?? "",
  );
  const [filterRole, setFilterRole] = React.useState(
    initialSearchParams.get("role") ?? "",
  );
  const [filterStage, setFilterStage] = React.useState<
    ApplicationStage | "ALL"
  >("ALL");
  const [quickSearch, setQuickSearch] = React.useState("");
  const [pipelineView, setPipelineView] =
    React.useState<PipelineViewFilter>("ALL");
  const [groupedOnly, setGroupedOnly] = React.useState(false);
  const [boardSort, setBoardSort] = React.useState<BoardSort>("UPDATED_DESC");
  const [boardDensity, setBoardDensity] =
    React.useState<BoardDensity>("COMPACT");
  const [showAdvancedFilters, setShowAdvancedFilters] = React.useState(false);
  const hasLoadedOnce = React.useRef(false);
  const sensors = useSensors(useSensor(PointerSensor));

  const selectedEmail = React.useMemo(
    () =>
      (selected?.emails ?? []).find(
        (email) => email.id === selectedEmailDraftId,
      ) ?? null,
    [selected, selectedEmailDraftId],
  );

  const htmlToPlainText = React.useCallback((html: string) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    return doc.body.textContent?.trim() ?? "";
  }, []);

  const placementMissingCount = React.useMemo(
    () =>
      applications.filter((application) =>
        isPlacementRequirementsMissing(application),
      ).length,
    [applications],
  );

  const loadApplications = React.useCallback(
    async (
      filters?: {
        candidateEmail?: string;
        companyName?: string;
        role?: string;
      },
      signal?: AbortSignal,
    ) => {
      setLoading(true);
      try {
        const searchParams = new URLSearchParams();

        if (filters?.candidateEmail?.trim()) {
          searchParams.set("candidateEmail", filters.candidateEmail.trim());
        }

        if (filters?.companyName?.trim()) {
          searchParams.set("companyName", filters.companyName.trim());
        }

        if (filters?.role?.trim()) {
          searchParams.set("role", filters.role.trim());
        }

        const endpoint = searchParams.toString()
          ? `/api/applications?${searchParams.toString()}`
          : "/api/applications";
        const data = await fetchJson<Application[]>(endpoint, { signal });
        setApplications(data);
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const applyFilters = React.useCallback(async () => {
    const filters = {
      candidateEmail: filterCandidateEmail,
      companyName: filterCompanyName,
      role: filterRole,
    };

    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);

      if (filters.candidateEmail.trim()) {
        url.searchParams.set("candidateEmail", filters.candidateEmail.trim());
      } else {
        url.searchParams.delete("candidateEmail");
      }

      if (filters.companyName.trim()) {
        url.searchParams.set("companyName", filters.companyName.trim());
      } else {
        url.searchParams.delete("companyName");
      }

      if (filters.role.trim()) {
        url.searchParams.set("role", filters.role.trim());
      } else {
        url.searchParams.delete("role");
      }

      const nextSearch = url.searchParams.toString();
      const nextUrl = `${url.pathname}${nextSearch ? `?${nextSearch}` : ""}${url.hash}`;
      window.history.replaceState({}, "", nextUrl);
    }

    await loadApplications(filters);
  }, [filterCandidateEmail, filterCompanyName, filterRole, loadApplications]);

  const clearFilters = React.useCallback(async () => {
    setFilterCandidateEmail("");
    setFilterCompanyName("");
    setFilterRole("");
    setFilterStage("ALL");
    setQuickSearch("");
    setPipelineView("ALL");
    setGroupedOnly(false);
    setBoardSort("UPDATED_DESC");
    await loadApplications();
  }, [loadApplications]);

  React.useEffect(() => {
    const controller = new AbortController();
    loadApplications(undefined, controller.signal);
    hasLoadedOnce.current = true;
    return () => controller.abort();
  }, [loadApplications]);

  React.useEffect(() => {
    if (!hasLoadedOnce.current) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void applyFilters();
    }, 300);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [filterCandidateEmail, filterCompanyName, filterRole, applyFilters]);

  React.useEffect(() => {
    const provider = localStorage.getItem("aiProvider") ?? "auto";
    const hasGithubToken = Boolean(localStorage.getItem("githubAccessToken"));

    if (provider === "github-models" && hasGithubToken) {
      setActiveAiProvider("GitHub Models");
      return;
    }

    if (provider === "azure-openai") {
      setActiveAiProvider("Azure OpenAI");
      return;
    }

    if (provider === "copilot-studio") {
      setActiveAiProvider("Copilot Studio");
      return;
    }

    setActiveAiProvider("Fallback template");
  }, []);

  React.useEffect(() => {
    if (!successMessage) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setSuccessMessage(null);
    }, 3000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [successMessage]);

  React.useEffect(() => {
    if (!selected) {
      setEditFullName("");
      setEditEmail("");
      setEditPhone("");
      setEditHourlyRate("");
      setLifecycleReason("");
      setLifecycleAction("STOP_CONTRACT");
      return;
    }

    setEditFullName(selected.candidate.fullName ?? "");
    setEditEmail(selected.candidate.email ?? "");
    setEditPhone(selected.candidate.phone ?? "");
    setEditHourlyRate("");
    setLifecycleReason("");
    setLifecycleAction("STOP_CONTRACT");
  }, [selected]);

  const getLifecycleActionLabel = React.useCallback(
    (action: LifecycleActionType): string =>
      LIFECYCLE_ACTIONS.find((item) => item.value === action)?.label ?? action,
    [],
  );

  const groupedApplications = React.useMemo(() => {
    const grouped = new Map<string, GroupedApplication>();

    for (const application of applications) {
      const key = getGroupKey(application);
      const existing = grouped.get(key);

      if (!existing) {
        grouped.set(key, {
          id: application.id,
          stage: application.currentStage,
          representative: application,
          applicationIds: [application.id],
          groupedCount: 1,
          totalNotes: application.notes.length,
          totalEmails: application.emails.length,
          hasPlacementIssue: isPlacementRequirementsMissing(application),
          latestUpdatedAt: application.updatedAt,
        });
        continue;
      }

      existing.applicationIds.push(application.id);
      existing.groupedCount += 1;
      existing.totalNotes += application.notes.length;
      existing.totalEmails += application.emails.length;
      existing.hasPlacementIssue =
        existing.hasPlacementIssue ||
        isPlacementRequirementsMissing(application);

      if (
        new Date(application.updatedAt).getTime() >
        new Date(existing.representative.updatedAt).getTime()
      ) {
        existing.representative = application;
        existing.id = application.id;
      }

      if (
        new Date(application.updatedAt).getTime() >
        new Date(existing.latestUpdatedAt).getTime()
      ) {
        existing.latestUpdatedAt = application.updatedAt;
      }
    }

    return Array.from(grouped.values());
  }, [applications]);

  const visibleGroupedApplications = React.useMemo(() => {
    let filtered = groupedApplications;

    if (filterStage !== "ALL") {
      filtered = filtered.filter((item) => item.stage === filterStage);
    }

    filtered = filtered.filter((item) =>
      matchesPipelineView(item, pipelineView),
    );
    filtered = filtered.filter((item) => matchesQuickSearch(item, quickSearch));

    if (groupedOnly) {
      filtered = filtered.filter((item) => item.groupedCount > 1);
    }

    const sorted = [...filtered];

    if (boardSort === "UPDATED_DESC") {
      sorted.sort(
        (a, b) =>
          new Date(b.latestUpdatedAt).getTime() -
          new Date(a.latestUpdatedAt).getTime(),
      );
      return sorted;
    }

    if (boardSort === "UPDATED_ASC") {
      sorted.sort(
        (a, b) =>
          new Date(a.latestUpdatedAt).getTime() -
          new Date(b.latestUpdatedAt).getTime(),
      );
      return sorted;
    }

    sorted.sort((a, b) => b.groupedCount - a.groupedCount);
    return sorted;
  }, [
    boardSort,
    filterStage,
    groupedApplications,
    groupedOnly,
    pipelineView,
    quickSearch,
  ]);

  const activeFilterCount = React.useMemo(() => {
    let count = 0;

    if (filterCandidateEmail.trim()) count += 1;
    if (filterCompanyName.trim()) count += 1;
    if (filterRole.trim()) count += 1;
    if (filterStage !== "ALL") count += 1;
    if (quickSearch.trim()) count += 1;
    if (pipelineView !== "ALL") count += 1;
    if (groupedOnly) count += 1;
    if (boardSort !== "UPDATED_DESC") count += 1;

    return count;
  }, [
    boardSort,
    filterCandidateEmail,
    filterCompanyName,
    filterRole,
    filterStage,
    groupedOnly,
    pipelineView,
    quickSearch,
  ]);

  const onDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over || active.id === over.id) {
      return;
    }

    const groupedApplication = groupedApplications.find(
      (item) => item.id === active.id,
    );
    if (!groupedApplication) {
      return;
    }

    const toStage = over.id as ApplicationStage;
    if (groupedApplication.stage === toStage) {
      return;
    }

    const idsToMove = groupedApplication.applicationIds;
    const previous = applications;
    setApplications((current) =>
      current.map((app) =>
        idsToMove.includes(app.id) ? { ...app, currentStage: toStage } : app,
      ),
    );

    try {
      await Promise.all(
        idsToMove.map((applicationId) =>
          fetchJson(`/api/applications/${applicationId}/stage`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ toStage }),
          }),
        ),
      );
      setSuccessMessage("Application stage updated.");
      setActionError(null);

      if (toStage === "PLACED") {
        const movedApplication = previous.find(
          (app) => app.id === idsToMove[0],
        );
        if (movedApplication) {
          setPlacementTarget({
            id: movedApplication.id,
            candidateName: movedApplication.candidate.fullName,
            roleTitle: movedApplication.job.title,
            agreedHourlyRate: movedApplication.agreedHourlyRate,
            agreedRateLockedAt: movedApplication.agreedRateLockedAt,
            placementBillingModel: movedApplication.placementBillingModel,
            placementFeePercent: movedApplication.placementFeePercent,
            annualCtc: movedApplication.annualCtc,
            contractValue: movedApplication.contractValue,
            signedContractFileName: movedApplication.signedContractFileName,
            signedContractUploadedAt: movedApplication.signedContractUploadedAt,
          });
          setPlacementRate(
            movedApplication.agreedHourlyRate !== null
              ? String(movedApplication.agreedHourlyRate)
              : "",
          );
          setPlacementBillingModel(
            movedApplication.placementBillingModel ?? "",
          );
          setPlacementFeePercent(
            movedApplication.placementFeePercent != null
              ? String(movedApplication.placementFeePercent)
              : "",
          );
          setPlacementAnnualCtc(
            movedApplication.annualCtc != null
              ? String(movedApplication.annualCtc)
              : "",
          );
          setPlacementContractValue(
            movedApplication.contractValue != null
              ? String(movedApplication.contractValue)
              : "",
          );
          setPlacementContractFile(null);
        }
      }

      await loadApplications();
    } catch (error) {
      setApplications(previous);
      setActionError((error as Error).message);
    }
  };

  const openPlacementModal = (application: Application) => {
    setPlacementTarget({
      id: application.id,
      candidateName: application.candidate.fullName,
      roleTitle: application.job.title,
      agreedHourlyRate: application.agreedHourlyRate,
      agreedRateLockedAt: application.agreedRateLockedAt,
      placementBillingModel: application.placementBillingModel,
      placementFeePercent: application.placementFeePercent,
      annualCtc: application.annualCtc,
      contractValue: application.contractValue,
      signedContractFileName: application.signedContractFileName,
      signedContractUploadedAt: application.signedContractUploadedAt,
    });
    setPlacementRate(
      application.agreedHourlyRate !== null
        ? String(application.agreedHourlyRate)
        : "",
    );
    setPlacementBillingModel(application.placementBillingModel ?? "");
    setPlacementFeePercent(
      application.placementFeePercent != null
        ? String(application.placementFeePercent)
        : "",
    );
    setPlacementAnnualCtc(
      application.annualCtc != null ? String(application.annualCtc) : "",
    );
    setPlacementContractValue(
      application.contractValue != null
        ? String(application.contractValue)
        : "",
    );
    setPlacementContractFile(null);
  };

  const handleSavePlacementDetails = async () => {
    if (!placementTarget) {
      return;
    }

    setSavingPlacement(true);
    setActionError(null);
    setSuccessMessage(null);

    try {
      const formData = new FormData();
      formData.append("agreedHourlyRate", placementRate.trim());
      formData.append("actor", "application_board");

      if (placementBillingModel) {
        formData.append("placementBillingModel", placementBillingModel);
      }
      if (placementFeePercent.trim()) {
        formData.append("placementFeePercent", placementFeePercent.trim());
      }
      if (placementAnnualCtc.trim()) {
        formData.append("annualCtc", placementAnnualCtc.trim());
      }
      if (placementContractValue.trim()) {
        formData.append("contractValue", placementContractValue.trim());
      }

      if (placementContractFile) {
        formData.append("file", placementContractFile);
      }

      await fetchJson(`/api/applications/${placementTarget.id}/placement`, {
        method: "POST",
        body: formData,
      });

      await loadApplications();
      if (selected?.id === placementTarget.id) {
        await openDetails(placementTarget.id);
      }

      setSuccessMessage("Placed contract and agreed rate saved.");
      setPlacementTarget(null);
      setPlacementRate("");
      setPlacementBillingModel("");
      setPlacementFeePercent("");
      setPlacementAnnualCtc("");
      setPlacementContractValue("");
      setPlacementContractFile(null);
    } catch (error) {
      setActionError((error as Error).message);
    } finally {
      setSavingPlacement(false);
    }
  };

  const openDetails = async (id: string) => {
    const detail = await fetchJson<DetailData>(`/api/applications/${id}`);
    setSelected(detail);
    setSelectedEmailDraftId(detail.emails?.[0]?.id ?? null);
    setDraftTo(detail.job.opportunityEmail?.trim() ?? "");
  };

  const handleGenerateEmail = async (app: {
    id: string;
    job: { id: string };
    candidate: { id: string };
  }) => {
    setGeneratingEmailDraft(true);
    setActionError(null);
    setSuccessMessage(null);
    try {
      const aiProvider = localStorage.getItem("aiProvider") ?? "auto";
      const githubAccessToken =
        localStorage.getItem("githubAccessToken") ?? undefined;

      await fetchJson("/api/email/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: app.job.id,
          candidateId: app.candidate.id,
          applicationId: app.id,
          aiProvider,
          githubAccessToken,
        }),
      });
      await loadApplications();
      if (selected?.id === app.id) {
        await openDetails(app.id);
      }
      setSuccessMessage("Email draft generated.");
    } catch (error) {
      setActionError((error as Error).message);
    } finally {
      setGeneratingEmailDraft(false);
    }
  };

  const newAppsWithoutEmail = React.useMemo(
    () =>
      visibleGroupedApplications.filter(
        (item) => item.stage === "NEW" && item.totalEmails === 0,
      ),
    [visibleGroupedApplications],
  );

  const handleBulkGenerateEmails = async () => {
    if (newAppsWithoutEmail.length === 0) return;
    setBulkGenerating(true);
    setActionError(null);
    setSuccessMessage(null);
    const total = newAppsWithoutEmail.length;
    setBulkProgress({ done: 0, total, failed: 0 });

    const aiProvider = localStorage.getItem("aiProvider") ?? "auto";
    const githubAccessToken =
      localStorage.getItem("githubAccessToken") ?? undefined;

    let done = 0;
    let failed = 0;

    for (const grouped of newAppsWithoutEmail) {
      const app = grouped.representative;
      try {
        await fetchJson("/api/email/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId: app.job.id,
            candidateId: app.candidate.id,
            applicationId: app.id,
            aiProvider,
            githubAccessToken,
          }),
        });
        done += 1;
      } catch {
        failed += 1;
      }
      setBulkProgress({ done: done + failed, total, failed });
    }

    await loadApplications();
    setBulkGenerating(false);
    setSuccessMessage(
      `Bulk generation complete: ${done} drafted${failed > 0 ? `, ${failed} failed` : ""}.`,
    );
  };

  const handleSaveDetails = async () => {
    if (!selected) {
      return;
    }

    setSavingDetails(true);
    setActionError(null);
    setSuccessMessage(null);
    try {
      await fetchJson(`/api/applications/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateName: editFullName,
          candidateEmail: editEmail || null,
          candidatePhone: editPhone || null,
          hourlyRate: editHourlyRate,
        }),
      });
      await loadApplications();
      await openDetails(selected.id);
      setSuccessMessage("Application details saved.");
    } catch (error) {
      setActionError((error as Error).message);
    } finally {
      setSavingDetails(false);
    }
  };

  const handleAddNote = async () => {
    if (!selected || addingNote) return;
    setAddingNote(true);
    try {
      setActionError(null);
      await fetchJson(`/api/applications/${selected.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: noteContent, author: "Consultant" }),
      });
      setNoteContent("");
      await openDetails(selected.id);
      setSuccessMessage("Note saved.");
    } catch (error) {
      setActionError((error as Error).message);
    } finally {
      setAddingNote(false);
    }
  };

  const handleCreateDraft = async (emailDraftId?: string) => {
    if (!selected || !emailDraftId || creatingDraft) return;
    const accessToken = localStorage.getItem("graphAccessToken")?.trim();
    setCreatingDraft(true);
    try {
      setActionError(null);
      await fetchJson("/api/email/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicationId: selected.id,
          emailDraftId,
          to: draftTo
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
          ...(accessToken ? { accessToken } : {}),
        }),
      });
      setDraftTo("");
      await openDetails(selected.id);
      setSuccessMessage("Draft created in Outlook.");
    } catch (error) {
      setActionError((error as Error).message);
    } finally {
      setCreatingDraft(false);
    }
  };

  const handleCopySubject = async () => {
    if (!selectedEmail) {
      return;
    }

    await navigator.clipboard.writeText(selectedEmail.subject);
    setSuccessMessage("Subject copied.");
  };

  const handleCopyBody = async () => {
    if (!selectedEmail) {
      return;
    }

    const plainText = htmlToPlainText(selectedEmail.htmlBody);
    await navigator.clipboard.writeText(plainText);
    setSuccessMessage("Email body copied.");
  };

  const handleCopyFullEmail = async () => {
    if (!selectedEmail) {
      return;
    }

    const plainText = htmlToPlainText(selectedEmail.htmlBody);
    await navigator.clipboard.writeText(
      `Subject: ${selectedEmail.subject}\n\n${plainText}`,
    );
    setSuccessMessage("Full email copied.");
  };

  const handleMarkAsLearningReference = async () => {
    if (!selectedEmail) {
      return;
    }

    setSavingLearningPreference(true);
    try {
      await fetchJson("/api/email/learn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailDraftId: selectedEmail.id,
          preferredForLearning: true,
        }),
      });

      if (selected) {
        await openDetails(selected.id);
      }

      setSuccessMessage("Saved as learning reference.");
    } catch (error) {
      setActionError((error as Error).message);
    } finally {
      setSavingLearningPreference(false);
    }
  };

  const handleDeleteOtherDrafts = async () => {
    if (!selected || !selectedEmail) {
      return;
    }

    const shouldDelete = window.confirm(
      "Delete all other drafts for this application and keep the selected draft?",
    );

    if (!shouldDelete) {
      return;
    }

    try {
      const result = await fetchJson<{ deletedCount: number }>(
        "/api/email/draft",
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            applicationId: selected.id,
            keepEmailDraftId: selectedEmail.id,
          }),
        },
      );

      await openDetails(selected.id);
      setSuccessMessage(`${result.deletedCount} drafts deleted.`);
    } catch (error) {
      setActionError((error as Error).message);
    }
  };

  const handleLifecycleAction = async () => {
    if (!selected) {
      return;
    }

    const reason = lifecycleReason.trim();
    if (reason.length < 5) {
      setActionError(
        "Please provide a clear reason (at least 5 characters) before applying a lifecycle action.",
      );
      return;
    }

    const actionDefinition = LIFECYCLE_ACTIONS.find(
      (item) => item.value === lifecycleAction,
    );
    if (!actionDefinition) {
      setActionError("Unknown lifecycle action selected.");
      return;
    }

    const targetStage: ApplicationStage =
      actionDefinition.targetStage === "KEEP"
        ? selected.currentStage
        : actionDefinition.targetStage;
    const note = `Lifecycle action: ${actionDefinition.label}. Reason: ${reason}`;

    setRunningLifecycleAction(true);
    setActionError(null);
    setSuccessMessage(null);

    try {
      await fetchJson(`/api/applications/${selected.id}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toStage: targetStage,
          note,
        }),
      });

      await loadApplications();
      await openDetails(selected.id);

      setLifecycleReason("");
      setSuccessMessage(
        `${getLifecycleActionLabel(lifecycleAction)} recorded successfully.`,
      );
    } catch (error) {
      setActionError((error as Error).message);
    } finally {
      setRunningLifecycleAction(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-slate-500">Loading board...</p>;
  }

  return (
    <div className="w-full space-y-6">
      {actionError ? <ErrorBanner message={actionError} /> : null}
      {successMessage ? <SuccessBanner message={successMessage} /> : null}
      {placementMissingCount > 0 ? (
        <ErrorBanner
          message={`${placementMissingCount} placed application(s) still require signed contract upload and agreed hourly rate.`}
        />
      ) : null}

      <div className="flex items-center justify-between">
        <div>
          <h1>Applications</h1>
          <div className="flex items-center gap-2">
            <p className="text-sm text-slate-600">
              Drag cards between stages to update status.
            </p>
            <Badge>AI: {activeAiProvider}</Badge>
          </div>
        </div>
        <Button onClick={applyFilters}>Refresh</Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">Filters</CardTitle>
            <Badge>{activeFilterCount} active</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-2">
          <div className="grid gap-3 md:grid-cols-6">
            <Input
              value={quickSearch}
              onChange={(event) => setQuickSearch(event.target.value)}
              placeholder="Search candidate, role, company or opportunity"
              className="md:col-span-2"
            />
            <select
              className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={pipelineView}
              onChange={(event) =>
                setPipelineView(event.target.value as PipelineViewFilter)
              }
            >
              <option value="ALL">All pipeline states</option>
              <option value="ACTIVE">Active pipeline only</option>
              <option value="PLACED_ONLY">Placed only</option>
              <option value="INACTIVE">Rejected and on hold</option>
              <option value="PLACEMENT_ISSUES">
                Placed with missing docs/rate
              </option>
            </select>
            <select
              className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={filterStage}
              onChange={(event) =>
                setFilterStage(event.target.value as ApplicationStage | "ALL")
              }
            >
              <option value="ALL">All stages</option>
              {STAGES.map((stage) => (
                <option key={stage} value={stage}>
                  {STAGE_LABELS[stage]}
                </option>
              ))}
            </select>
            <Button
              className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
              onClick={() => setShowAdvancedFilters((current) => !current)}
            >
              {showAdvancedFilters ? "Hide advanced" : "Show advanced"}
            </Button>
            <select
              className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={boardDensity}
              onChange={(event) =>
                setBoardDensity(event.target.value as BoardDensity)
              }
            >
              <option value="COMPACT">Density: Compact</option>
              <option value="COMFORTABLE">Density: Comfortable</option>
            </select>
            <div className="flex items-center gap-2">
              <Button
                className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                onClick={clearFilters}
              >
                Clear
              </Button>
            </div>
          </div>

          {showAdvancedFilters ? (
            <div className="grid gap-3 border-t border-slate-100 pt-3 md:grid-cols-5">
              <Input
                value={filterCandidateEmail}
                onChange={(event) =>
                  setFilterCandidateEmail(event.target.value)
                }
                placeholder="Candidate email"
              />
              <Input
                value={filterCompanyName}
                onChange={(event) => setFilterCompanyName(event.target.value)}
                placeholder="Company name"
              />
              <Input
                value={filterRole}
                onChange={(event) => setFilterRole(event.target.value)}
                placeholder="Role title"
              />
              <select
                className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
                value={boardSort}
                onChange={(event) =>
                  setBoardSort(event.target.value as BoardSort)
                }
              >
                <option value="UPDATED_DESC">Newest updates first</option>
                <option value="UPDATED_ASC">Oldest updates first</option>
                <option value="GROUP_SIZE_DESC">
                  Largest grouped cards first
                </option>
              </select>
              <label className="flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={groupedOnly}
                  onChange={(event) => setGroupedOnly(event.target.checked)}
                />
                Grouped only
              </label>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
              onClick={() => {
                setPipelineView("ACTIVE");
                setFilterStage("ALL");
              }}
            >
              Active view
            </Button>
            <Button
              className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
              onClick={() => {
                setPipelineView("PLACED_ONLY");
                setFilterStage("PLACED");
              }}
            >
              Placed view
            </Button>
            <Button
              className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
              onClick={() => {
                setPipelineView("PLACEMENT_ISSUES");
                setFilterStage("PLACED");
              }}
            >
              Missing placement docs
            </Button>
            {newAppsWithoutEmail.length > 0 && (
              <Button
                className="bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                disabled={bulkGenerating || generatingEmailDraft}
                onClick={handleBulkGenerateEmails}
              >
                {bulkGenerating
                  ? `Generating… ${bulkProgress.done}/${bulkProgress.total}`
                  : `Generate all emails (${newAppsWithoutEmail.length})`}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Stage summary</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 pt-2">
          {STAGES.map((stage) => {
            const count = visibleGroupedApplications.filter(
              (item) => item.stage === stage,
            ).length;
            return (
              <Badge key={stage}>
                {STAGE_LABELS[stage]}: {count}
              </Badge>
            );
          })}
        </CardContent>
      </Card>

      <DndContext
        sensors={sensors}
        onDragStart={(event) => setActiveId(String(event.active.id))}
        onDragEnd={onDragEnd}
      >
        {visibleGroupedApplications.length === 0 ? (
          <Card>
            <CardContent className="space-y-3 py-6">
              <p className="text-sm font-medium text-slate-900">
                No applications yet.
              </p>
              <p className="text-sm text-slate-600">
                Start by uploading opportunities, then review matched candidates
                and generate drafts to create applications.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild>
                  <Link href="/jobs">Upload opportunities</Link>
                </Button>
                <Button
                  className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                  asChild
                >
                  <Link href="/candidates">Review candidates</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <p className="text-xs text-slate-500">
            Scroll horizontally to view all stages.
          </p>
        )}
        <div className="overflow-x-auto pb-2" style={{ overflowX: "auto" }}>
          <div
            className="flex min-w-max flex-nowrap items-start gap-4"
            style={{
              display: "flex",
              flexWrap: "nowrap",
              width: "max-content",
            }}
          >
            {STAGES.map((stage) => {
              const items = visibleGroupedApplications.filter(
                (item) => item.stage === stage,
              );
              return (
                <StageColumn
                  key={stage}
                  id={stage}
                  title={STAGE_LABELS[stage]}
                  count={items.length}
                  density={boardDensity}
                >
                  {items.map((item) => (
                    <DraggableCard
                      key={item.id}
                      groupedApplication={item}
                      density={boardDensity}
                      onEdit={() => openDetails(item.representative.id)}
                      onCompletePlacement={() =>
                        openPlacementModal(item.representative)
                      }
                    />
                  ))}
                </StageColumn>
              );
            })}
          </div>
        </div>
        <DragOverlay>
          {activeId ? (
            <div className="rounded-md bg-white px-3 py-2 shadow">
              Moving...
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <Dialog
        open={!!placementTarget}
        onOpenChange={(open: boolean) => {
          if (!open && !savingPlacement) {
            setPlacementTarget(null);
            setPlacementBillingModel("");
            setPlacementFeePercent("");
            setPlacementAnnualCtc("");
            setPlacementContractValue("");
            setPlacementContractFile(null);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Placement details</DialogTitle>
          </DialogHeader>
          {placementTarget ? (
            <div className="space-y-3 text-sm text-slate-700">
              <p>
                Candidate: <strong>{placementTarget.candidateName}</strong>
              </p>
              <p>
                Role: <strong>{placementTarget.roleTitle}</strong>
              </p>

              <div className="space-y-1">
                <p className="text-xs text-slate-600">Billing model</p>
                <select
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={placementBillingModel}
                  onChange={(event) =>
                    setPlacementBillingModel(event.target.value)
                  }
                >
                  <option value="">Select billing model…</option>
                  <option value="EOR_MARGIN">
                    Ongoing margin – EOR (20–30%)
                  </option>
                  <option value="INDEPENDENT_CONTRACTOR_MARGIN">
                    Ongoing margin – Independent Contractor (10–20%)
                  </option>
                  <option value="ONCE_OFF_PLACEMENT_FEE">
                    Once-off contracting placement fee (5–10%)
                  </option>
                  <option value="PERMANENT_PLACEMENT_FEE">
                    Permanent conversion fee (10–20% of CTC)
                  </option>
                </select>
              </div>

              {placementBillingModel ? (
                <div className="space-y-1">
                  <p className="text-xs text-slate-600">
                    Agreed fee percentage
                  </p>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={placementFeePercent}
                    onChange={(event) =>
                      setPlacementFeePercent(event.target.value)
                    }
                    placeholder="e.g. 25"
                  />
                  <p className="text-xs text-slate-500">
                    {placementBillingModel === "EOR_MARGIN" &&
                      "Typical range: 20–30%"}
                    {placementBillingModel ===
                      "INDEPENDENT_CONTRACTOR_MARGIN" &&
                      "Typical range: 10–20%"}
                    {placementBillingModel === "ONCE_OFF_PLACEMENT_FEE" &&
                      "Typical range: 5–10% of total contract value"}
                    {placementBillingModel === "PERMANENT_PLACEMENT_FEE" &&
                      "Typical range: 10–20% of annual CTC"}
                  </p>
                </div>
              ) : null}

              {(placementBillingModel === "EOR_MARGIN" ||
                placementBillingModel === "INDEPENDENT_CONTRACTOR_MARGIN") && (
                <div className="space-y-1">
                  <p className="text-xs text-slate-600">Agreed hourly rate</p>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={placementRate}
                    onChange={(event) => setPlacementRate(event.target.value)}
                    disabled={placementTarget.agreedHourlyRate !== null}
                    placeholder="Enter agreed hourly rate"
                  />
                  {placementTarget.agreedHourlyRate !== null ? (
                    <p className="text-xs text-slate-500">
                      Rate locked at{" "}
                      {placementTarget.agreedHourlyRate.toFixed(2)}.
                    </p>
                  ) : null}
                </div>
              )}

              {placementBillingModel === "PERMANENT_PLACEMENT_FEE" && (
                <div className="space-y-1">
                  <p className="text-xs text-slate-600">
                    Annual cost to company (CTC)
                  </p>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={placementAnnualCtc}
                    onChange={(event) =>
                      setPlacementAnnualCtc(event.target.value)
                    }
                    placeholder="Enter annual CTC"
                  />
                </div>
              )}

              {placementBillingModel === "ONCE_OFF_PLACEMENT_FEE" && (
                <div className="space-y-1">
                  <p className="text-xs text-slate-600">Total contract value</p>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={placementContractValue}
                    onChange={(event) =>
                      setPlacementContractValue(event.target.value)
                    }
                    placeholder="Enter total contract value"
                  />
                </div>
              )}

              <div className="space-y-1">
                <p className="text-xs text-slate-600">Signed contract upload</p>
                <Input
                  type="file"
                  accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                  onChange={(event) =>
                    setPlacementContractFile(event.target.files?.[0] ?? null)
                  }
                />
                {placementTarget.signedContractFileName ? (
                  <p className="text-xs text-slate-500">
                    Uploaded: {placementTarget.signedContractFileName}
                  </p>
                ) : (
                  <p className="text-xs text-amber-700">
                    Contract file is required for placed applications.
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                  onClick={() => {
                    setPlacementTarget(null);
                    setPlacementBillingModel("");
                    setPlacementFeePercent("");
                    setPlacementAnnualCtc("");
                    setPlacementContractValue("");
                  }}
                  disabled={savingPlacement}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSavePlacementDetails}
                  disabled={savingPlacement}
                >
                  {savingPlacement ? "Saving..." : "Save placement details"}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!selected}
        onOpenChange={(open: boolean) => !open && setSelected(null)}
      >
        <DialogContent className="max-h-[92vh] w-[95vw] max-w-5xl overflow-hidden p-0">
          {selected && (
            <div className="max-h-[92vh] overflow-y-auto p-6 pr-4">
              <DialogHeader>
                <DialogTitle>Application detail</DialogTitle>
              </DialogHeader>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Job text</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-sm text-slate-600">
                      {selected.job.rawText}
                    </pre>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Candidate CV text</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-sm text-slate-600">
                      {selected.candidate.rawCV}
                    </pre>
                  </CardContent>
                </Card>
              </div>

              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-slate-700">
                    Candidate details
                  </h3>
                  <Input
                    value={editFullName}
                    onChange={(event) => setEditFullName(event.target.value)}
                    placeholder="Candidate name"
                  />
                  <Input
                    value={editEmail}
                    onChange={(event) => setEditEmail(event.target.value)}
                    placeholder="Candidate email"
                  />
                  <Input
                    value={editPhone}
                    onChange={(event) => setEditPhone(event.target.value)}
                    placeholder="Candidate contact number"
                  />
                  <Input
                    value={editHourlyRate}
                    onChange={(event) => setEditHourlyRate(event.target.value)}
                    placeholder="Hourly rate (for example £85/hr)"
                  />
                  <Button onClick={handleSaveDetails} disabled={savingDetails}>
                    {savingDetails ? "Saving..." : "Save details"}
                  </Button>

                  {selected.job.company?.name?.trim() ? (
                    <>
                      <h3 className="pt-2 text-sm font-semibold text-slate-700">
                        Company details
                      </h3>
                      <Input
                        value={selected.job.company?.name ?? ""}
                        readOnly
                      />
                    </>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-slate-700">
                    Notes
                  </h3>
                  <Textarea
                    value={noteContent}
                    onChange={(event) => setNoteContent(event.target.value)}
                    placeholder="Add a note"
                    className="min-h-64"
                  />
                  <Button onClick={handleAddNote} disabled={addingNote}>
                    {addingNote ? "Saving\u2026" : "Save note"}
                  </Button>
                </div>
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-slate-700">
                    Contract lifecycle actions
                  </h3>
                  <select
                    className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                    value={lifecycleAction}
                    onChange={(event) =>
                      setLifecycleAction(
                        event.target.value as LifecycleActionType,
                      )
                    }
                  >
                    {LIFECYCLE_ACTIONS.map((action) => (
                      <option key={action.value} value={action.value}>
                        {action.label}
                      </option>
                    ))}
                  </select>
                  <Textarea
                    value={lifecycleReason}
                    onChange={(event) => setLifecycleReason(event.target.value)}
                    placeholder="Reason for this action (required)"
                    className="min-h-24"
                  />
                  <p className="text-xs text-slate-500">
                    These actions update stage and create auditable
                    notes/history to cover scenarios like contract stop,
                    termination, access revocation, and restoration.
                  </p>
                  <Button
                    onClick={handleLifecycleAction}
                    disabled={runningLifecycleAction}
                  >
                    {runningLifecycleAction
                      ? "Applying action..."
                      : "Apply lifecycle action"}
                  </Button>
                </div>
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-slate-700">
                    Create Outlook draft
                  </h3>
                  <Button
                    onClick={() =>
                      handleGenerateEmail({
                        id: selected.id,
                        job: { id: selected.job.id },
                        candidate: { id: selected.candidate.id },
                      })
                    }
                    disabled={generatingEmailDraft}
                  >
                    {generatingEmailDraft
                      ? "Generating email..."
                      : "Generate email"}
                  </Button>
                  <Input
                    value={draftTo}
                    onChange={(event) => setDraftTo(event.target.value)}
                    placeholder="Recipient email(s), comma separated"
                  />
                  <p className="text-xs text-slate-500">
                    Recipient is auto-filled from extracted job contact email
                    when available.
                  </p>
                  <Button
                    onClick={() =>
                      handleCreateDraft(selectedEmailDraftId ?? undefined)
                    }
                    disabled={creatingDraft}
                  >
                    {creatingDraft ? "Creating\u2026" : "Create draft"}
                  </Button>
                  <p className="text-xs text-slate-500">
                    Sign in first to store a Graph token.
                  </p>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-700">
                  Email drafts
                </h3>
                {(selected.emails?.length ?? 0) === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">
                    No email drafts yet.
                  </p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {(selected.emails ?? []).map((email) => (
                      <button
                        key={email.id}
                        type="button"
                        onClick={() => setSelectedEmailDraftId(email.id)}
                        className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                          selectedEmailDraftId === email.id
                            ? "border-slate-400 bg-slate-100"
                            : "border-slate-200 bg-white"
                        }`}
                      >
                        <div className="font-medium text-slate-800">
                          {email.subject}
                        </div>
                        <div className="text-xs text-slate-500">
                          {new Date(email.createdAt).toLocaleString("en-GB")}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-700">
                  Email preview
                </h3>
                {!selectedEmail ? (
                  <p className="mt-2 text-sm text-slate-500">
                    Select an email draft to view it.
                  </p>
                ) : (
                  <div className="mt-2 space-y-2 rounded-md border border-slate-200 bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-slate-800">
                        {selectedEmail.subject}
                      </p>
                      <div className="flex gap-2">
                        <Button
                          onClick={handleMarkAsLearningReference}
                          disabled={
                            savingLearningPreference ||
                            selectedEmail.preferredForLearning === true
                          }
                        >
                          {selectedEmail.preferredForLearning
                            ? "Learning reference saved"
                            : savingLearningPreference
                              ? "Saving..."
                              : "Use as learning reference"}
                        </Button>
                        <Button onClick={handleCopySubject}>
                          Copy subject
                        </Button>
                        <Button onClick={handleCopyBody}>Copy body</Button>
                        <Button onClick={handleCopyFullEmail}>
                          Copy full email
                        </Button>
                        <Button onClick={handleDeleteOtherDrafts}>
                          Delete other drafts
                        </Button>
                      </div>
                    </div>
                    <div
                      className="max-h-64 overflow-auto rounded border border-slate-100 bg-slate-50 p-3 text-sm text-slate-700 sm:max-h-72"
                      dangerouslySetInnerHTML={{
                        __html: selectedEmail.htmlBody,
                      }}
                    />
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-700">
                  History
                </h3>
                <ul className="mt-2 space-y-1 text-sm text-slate-600">
                  {(selected.history ?? []).map((entry) => (
                    <li key={entry.id}>
                      {entry.fromStage ?? "Start"} → {entry.toStage}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StageColumn({
  id,
  title,
  count,
  density,
  children,
}: {
  id: ApplicationStage;
  title: string;
  count: number;
  density: BoardDensity;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const compact = density === "COMPACT";
  return (
    <div
      ref={setNodeRef}
      className={`inline-flex shrink-0 flex-col rounded-lg ${compact ? "w-[220px] space-y-2 p-1.5" : "w-[260px] space-y-3 p-2"} ${
        isOver ? "bg-slate-100" : ""
      }`}
      style={{ flex: compact ? "0 0 220px" : "0 0 260px" }}
    >
      <div className="flex items-center justify-between">
        <h2
          className={`whitespace-nowrap font-semibold text-slate-700 ${
            compact ? "text-xs" : "text-sm"
          }`}
        >
          {title}
        </h2>
        <Badge>{count}</Badge>
      </div>
      <div className={compact ? "space-y-2" : "space-y-3"}>{children}</div>
      {count === 0 ? (
        <div
          className={`rounded border border-dashed border-slate-300 text-slate-500 ${
            compact ? "px-2 py-2 text-[11px]" : "px-2 py-3 text-xs"
          }`}
        >
          No applications in this stage yet.
        </div>
      ) : null}
    </div>
  );
}

function DraggableCard({
  groupedApplication,
  density,
  onEdit,
  onCompletePlacement,
}: {
  groupedApplication: GroupedApplication;
  density: BoardDensity;
  onEdit: () => void;
  onCompletePlacement: () => void;
}) {
  const application = groupedApplication.representative;
  const compact = density === "COMPACT";
  const placementMissing = isPlacementRequirementsMissing(application);
  const companyName = application.job.company?.name?.trim() || "";
  const roleDescription = application.job.rawText?.trim() || "";
  const opportunityEmail = application.job.opportunityEmail?.trim() || "";
  const opportunityUrl = application.job.opportunityUrl?.trim() || "";
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: groupedApplication.id,
    });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <Card
      ref={setNodeRef as never}
      style={style}
      className={`cursor-pointer ${isDragging ? "opacity-60" : ""}`}
    >
      <CardHeader
        className={compact ? "space-y-2 px-3 py-2" : "space-y-2 px-3 py-3"}
      >
        <div className="flex items-start justify-end gap-2">
          <button
            type="button"
            className={`rounded border border-slate-200 uppercase text-slate-500 ${
              compact ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-1 text-[10px]"
            }`}
            onClick={(event) => event.stopPropagation()}
            {...listeners}
            {...attributes}
          >
            Drag
          </button>
        </div>
        <div
          className={compact ? "space-y-1 text-[11px]" : "space-y-1 text-xs"}
        >
          <p
            className={`grid items-center ${
              compact
                ? "grid-cols-[64px_1fr] gap-1.5"
                : "grid-cols-[74px_1fr] gap-2"
            }`}
          >
            <span className="font-medium text-slate-700">Candidate</span>
            <span
              className="truncate text-slate-600"
              title={application.candidate.fullName}
            >
              {application.candidate.fullName}
            </span>
          </p>
          {companyName ? (
            <p
              className={`grid items-center ${
                compact
                  ? "grid-cols-[64px_1fr] gap-1.5"
                  : "grid-cols-[74px_1fr] gap-2"
              }`}
            >
              <span className="font-medium text-slate-700">Company</span>
              <span className="truncate text-slate-600" title={companyName}>
                {companyName}
              </span>
            </p>
          ) : null}
          <p
            className={`grid items-center ${
              compact
                ? "grid-cols-[64px_1fr] gap-1.5"
                : "grid-cols-[74px_1fr] gap-2"
            }`}
          >
            <span className="font-medium text-slate-700">Role</span>
            <span
              className="truncate text-slate-600"
              title={application.job.title}
            >
              {application.job.title}
            </span>
          </p>
          {roleDescription ? (
            <p
              className={`grid items-start ${
                compact
                  ? "grid-cols-[64px_1fr] gap-1.5"
                  : "grid-cols-[74px_1fr] gap-2"
              }`}
            >
              <span className="font-medium text-slate-700">Description</span>
              <span
                className={`break-words text-slate-600 ${
                  compact ? "line-clamp-1" : "line-clamp-2"
                }`}
                title={roleDescription}
              >
                {roleDescription}
              </span>
            </p>
          ) : null}
          {opportunityEmail ? (
            <p
              className={`grid items-center ${
                compact
                  ? "grid-cols-[64px_1fr] gap-1.5"
                  : "grid-cols-[74px_1fr] gap-2"
              }`}
            >
              <span className="font-medium text-slate-700">Email</span>
              <span
                className="truncate text-slate-600"
                title={opportunityEmail}
              >
                {opportunityEmail}
              </span>
            </p>
          ) : null}
          {opportunityUrl ? (
            <p
              className={`grid items-center ${
                compact
                  ? "grid-cols-[64px_1fr] gap-1.5"
                  : "grid-cols-[74px_1fr] gap-2"
              }`}
            >
              <span className="font-medium text-slate-700">URL</span>
              <a
                href={opportunityUrl}
                target="_blank"
                rel="noreferrer"
                className="truncate text-slate-600 underline"
                title={opportunityUrl}
                onClick={(event) => event.stopPropagation()}
              >
                {opportunityUrl}
              </a>
            </p>
          ) : null}
        </div>
      </CardHeader>
      <CardContent
        className={
          compact ? "space-y-1.5 px-3 pb-3 pt-0" : "space-y-2 px-3 pb-3 pt-0"
        }
      >
        {placementMissing ? (
          <Badge
            className={`border-amber-200 bg-amber-50 text-amber-700 ${
              compact ? "text-[10px]" : "text-xs"
            }`}
          >
            Missing contract/rate
          </Badge>
        ) : null}
        <div className={compact ? "flex gap-1.5" : "flex gap-2"}>
          <Button
            type="button"
            className={compact ? "h-7 px-2 text-xs" : "h-8 px-3 text-sm"}
            aria-label={`Edit ${application.candidate.fullName} for ${application.job.title}`}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onEdit();
            }}
          >
            Edit
          </Button>
          {application.currentStage === "PLACED" ? (
            <Button
              type="button"
              className={`border border-slate-300 bg-white text-slate-900 hover:bg-slate-50 ${
                compact ? "h-7 px-2 text-xs" : "h-8 px-3 text-sm"
              }`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onCompletePlacement();
              }}
            >
              Contract/rate
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
