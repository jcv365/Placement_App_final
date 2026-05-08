"use client";

import { fetchJson } from "@/lib/client";
import * as React from "react";
import {
    type Application,
    type ApplicationStage,
    type BoardDensity,
    type BoardSort,
    type DetailData,
    type GeneratedEmailResponse,
    type GroupedApplication,
    type LifecycleActionType,
    type PipelineViewFilter,
    type PlacementTarget,
    isPlacementRequirementsMissing,
    LIFECYCLE_ACTIONS,
} from "./types";

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
  if (!term) return true;

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
  if (view === "ALL") return true;
  if (view === "ACTIVE")
    return !["PLACED", "REJECTED", "ON_HOLD"].includes(grouped.stage);
  if (view === "PLACED_ONLY") return grouped.stage === "PLACED";
  if (view === "INACTIVE")
    return ["REJECTED", "ON_HOLD"].includes(grouped.stage);
  return grouped.hasPlacementIssue;
}

export function useApplicationBoard() {
  const initialSearchParams = React.useMemo(() => {
    if (typeof window === "undefined") return new URLSearchParams();
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
  const [confirmDeleteDrafts, setConfirmDeleteDrafts] = React.useState(false);
  const [emailGenerationBlock, setEmailGenerationBlock] = React.useState<{
    message: string;
    hallucinatedClaims: string[];
    atsScore?: number;
    hint?: string;
  } | null>(null);
  const hasLoadedOnce = React.useRef(false);

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
        if (filters?.candidateEmail?.trim())
          searchParams.set("candidateEmail", filters.candidateEmail.trim());
        if (filters?.companyName?.trim())
          searchParams.set("companyName", filters.companyName.trim());
        if (filters?.role?.trim())
          searchParams.set("role", filters.role.trim());

        const endpoint = searchParams.toString()
          ? `/api/applications?${searchParams.toString()}`
          : "/api/applications";
        const data = await fetchJson<Application[]>(endpoint, { signal });
        setApplications(Array.isArray(data) ? data : []);
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        setActionError(
          (error as Error).message ?? "Failed to load applications.",
        );
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
      if (filters.candidateEmail.trim())
        url.searchParams.set("candidateEmail", filters.candidateEmail.trim());
      else url.searchParams.delete("candidateEmail");
      if (filters.companyName.trim())
        url.searchParams.set("companyName", filters.companyName.trim());
      else url.searchParams.delete("companyName");
      if (filters.role.trim())
        url.searchParams.set("role", filters.role.trim());
      else url.searchParams.delete("role");

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
    return () => controller.abort();
  }, [loadApplications]);

  React.useEffect(() => {
    if (!hasLoadedOnce.current) {
      hasLoadedOnce.current = true;
      return;
    }
    const timeoutId = window.setTimeout(() => {
      void applyFilters();
    }, 300);
    return () => window.clearTimeout(timeoutId);
  }, [filterCandidateEmail, filterCompanyName, filterRole, applyFilters]);

  React.useEffect(() => {
    setActiveAiProvider("LiteLLM gateway");
  }, []);

  React.useEffect(() => {
    if (!successMessage) return;
    const timeoutId = window.setTimeout(() => {
      setSuccessMessage(null);
    }, 6000);
    return () => window.clearTimeout(timeoutId);
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

    if (filterStage !== "ALL")
      filtered = filtered.filter((item) => item.stage === filterStage);
    filtered = filtered.filter((item) =>
      matchesPipelineView(item, pipelineView),
    );
    filtered = filtered.filter((item) => matchesQuickSearch(item, quickSearch));
    if (groupedOnly)
      filtered = filtered.filter((item) => item.groupedCount > 1);

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

  const onDragEnd = async (event: {
    active: { id: string | number };
    over: { id: string | number } | null;
  }) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over || active.id === over.id) return;

    const groupedApplication = groupedApplications.find(
      (item) => item.id === active.id,
    );
    if (!groupedApplication) return;

    const toStage = over.id as ApplicationStage;
    if (groupedApplication.stage === toStage) return;

    const idsToMove = groupedApplication.applicationIds;
    const previous = applications;
    setApplications((current) =>
      current.map((app) =>
        idsToMove.includes(app.id) ? { ...app, currentStage: toStage } : app,
      ),
    );

    try {
      const results = await Promise.allSettled(
        idsToMove.map((applicationId) =>
          fetchJson(`/api/applications/${applicationId}/stage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ toStage }),
          }),
        ),
      );

      const failures = results.filter((r) => r.status === "rejected");
      if (failures.length === idsToMove.length)
        throw new Error("All stage updates failed");
      if (failures.length > 0) {
        setActionError(
          `${failures.length} of ${idsToMove.length} updates failed. Refreshing.`,
        );
      } else {
        setSuccessMessage("Application stage updated.");
        setActionError(null);
      }

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
    if (!placementTarget) return;
    setSavingPlacement(true);
    setActionError(null);
    setSuccessMessage(null);

    try {
      const formData = new FormData();
      formData.append("agreedHourlyRate", placementRate.trim());
      formData.append("actor", "application_board");
      if (placementBillingModel)
        formData.append("placementBillingModel", placementBillingModel);
      if (placementFeePercent.trim())
        formData.append("placementFeePercent", placementFeePercent.trim());
      if (placementAnnualCtc.trim())
        formData.append("annualCtc", placementAnnualCtc.trim());
      if (placementContractValue.trim())
        formData.append("contractValue", placementContractValue.trim());
      if (placementContractFile) formData.append("file", placementContractFile);

      await fetchJson(`/api/applications/${placementTarget.id}/placement`, {
        method: "POST",
        body: formData,
      });

      await loadApplications();
      if (selected?.id === placementTarget.id)
        await openDetails(placementTarget.id);

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
    setEmailGenerationBlock(null);
    try {
      // Use raw fetch so we can extract structured error details (hallucinatedClaims,
      // atsScore) that fetchJson would discard when it converts to a plain Error string.
      const response = await fetch("/api/email/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: app.job.id,
          candidateId: app.candidate.id,
          applicationId: app.id,
        }),
        signal: AbortSignal.timeout(120_000),
      });

      const rawBody = await response.text();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let data: any = null;
      try {
        data = rawBody ? JSON.parse(rawBody) : null;
      } catch {
        // ignore parse error — handled below
      }

      if (!response.ok) {
        const details = data?.error?.details ?? {};
        const hallucinatedClaims: string[] = Array.isArray(
          details.hallucinatedClaims,
        )
          ? details.hallucinatedClaims
          : [];
        const atsScore: number | undefined =
          typeof details.ats?.score === "number"
            ? details.ats.score
            : undefined;
        const message: string =
          data?.error?.message ??
          `Email generation failed (${response.status}).`;
        const hint: string | undefined =
          typeof details.hint === "string" ? details.hint : undefined;

        if (hallucinatedClaims.length > 0 || response.status === 409) {
          // Structured block — surface details to the drawer.
          setEmailGenerationBlock({
            message,
            hallucinatedClaims,
            atsScore,
            hint,
          });
        } else {
          setActionError([message, hint].filter(Boolean).join("\n"));
        }
        return;
      }

      const generated: GeneratedEmailResponse = data?.data ?? data;

      await loadApplications();
      if (selected?.id === app.id) await openDetails(app.id);

      if (generated.outlookDraft?.status === "created") {
        setSuccessMessage("Email draft generated and Outlook draft created.");
      } else if (generated.outlookDraft?.status === "skipped") {
        setSuccessMessage(
          `Email draft generated. Outlook draft skipped: ${generated.outlookDraft.reason ?? "No recipient was available."}`,
        );
      } else if (generated.outlookDraft?.status === "failed") {
        setSuccessMessage(
          `Email draft generated. Outlook draft failed: ${generated.outlookDraft.reason ?? "Unable to create Outlook draft."}`,
        );
      } else {
        setSuccessMessage("Email draft generated.");
      }
    } catch (error) {
      setActionError((error as Error).message);
    } finally {
      setGeneratingEmailDraft(false);
    }
  };

  const handleSaveDetails = async () => {
    if (!selected) return;
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
    const accessToken = sessionStorage.getItem("graphAccessToken")?.trim();
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
    if (!selectedEmail) return;
    await navigator.clipboard.writeText(selectedEmail.subject);
    setSuccessMessage("Subject copied.");
  };

  const handleCopyBody = async () => {
    if (!selectedEmail) return;
    const plainText = htmlToPlainText(selectedEmail.htmlBody);
    await navigator.clipboard.writeText(plainText);
    setSuccessMessage("Email body copied.");
  };

  const handleCopyFullEmail = async () => {
    if (!selectedEmail) return;
    const plainText = htmlToPlainText(selectedEmail.htmlBody);
    await navigator.clipboard.writeText(
      `Subject: ${selectedEmail.subject}\n\n${plainText}`,
    );
    setSuccessMessage("Full email copied.");
  };

  const handleMarkAsLearningReference = async () => {
    if (!selectedEmail) return;
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
      if (selected) await openDetails(selected.id);
      setSuccessMessage("Saved as learning reference.");
    } catch (error) {
      setActionError((error as Error).message);
    } finally {
      setSavingLearningPreference(false);
    }
  };

  const handleDeleteOtherDrafts = async () => {
    if (!selected || !selectedEmail) return;
    setConfirmDeleteDrafts(true);
  };

  const executeDeleteOtherDrafts = async () => {
    setConfirmDeleteDrafts(false);
    if (!selected || !selectedEmail) return;

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
    if (!selected) return;
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
        body: JSON.stringify({ toStage: targetStage, note }),
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

  const dismissSuccess = React.useCallback(() => setSuccessMessage(null), []);
  const dismissError = React.useCallback(() => setActionError(null), []);

  return {
    // Data
    applications,
    loading,
    activeId,
    setActiveId,
    selected,
    setSelected,
    selectedEmail,
    selectedEmailDraftId,
    setSelectedEmailDraftId,
    noteContent,
    setNoteContent,
    editFullName,
    setEditFullName,
    editEmail,
    setEditEmail,
    editPhone,
    setEditPhone,
    editHourlyRate,
    setEditHourlyRate,
    savingDetails,
    generatingEmailDraft,
    savingLearningPreference,
    runningLifecycleAction,
    lifecycleAction,
    setLifecycleAction,
    lifecycleReason,
    setLifecycleReason,
    actionError,
    successMessage,
    dismissSuccess,
    dismissError,
    placementTarget,
    setPlacementTarget,
    placementRate,
    setPlacementRate,
    placementBillingModel,
    setPlacementBillingModel,
    placementFeePercent,
    setPlacementFeePercent,
    placementAnnualCtc,
    setPlacementAnnualCtc,
    placementContractValue,
    setPlacementContractValue,
    placementContractFile,
    setPlacementContractFile,
    savingPlacement,
    addingNote,
    creatingDraft,
    draftTo,
    setDraftTo,
    activeAiProvider,
    confirmDeleteDrafts,
    setConfirmDeleteDrafts,
    emailGenerationBlock,
    dismissEmailGenerationBlock: React.useCallback(
      () => setEmailGenerationBlock(null),
      [],
    ),

    // Filters
    filterCandidateEmail,
    setFilterCandidateEmail,
    filterCompanyName,
    setFilterCompanyName,
    filterRole,
    setFilterRole,
    filterStage,
    setFilterStage,
    quickSearch,
    setQuickSearch,
    pipelineView,
    setPipelineView,
    groupedOnly,
    setGroupedOnly,
    boardSort,
    setBoardSort,
    boardDensity,
    setBoardDensity,
    showAdvancedFilters,
    setShowAdvancedFilters,

    // Computed
    groupedApplications,
    visibleGroupedApplications,
    activeFilterCount,
    placementMissingCount,

    // Actions
    applyFilters,
    clearFilters,
    onDragEnd,
    openPlacementModal,
    handleSavePlacementDetails,
    openDetails,
    handleGenerateEmail,
    handleSaveDetails,
    handleAddNote,
    handleCreateDraft,
    handleCopySubject,
    handleCopyBody,
    handleCopyFullEmail,
    handleMarkAsLearningReference,
    handleDeleteOtherDrafts,
    executeDeleteOtherDrafts,
    handleLifecycleAction,
  };
}
