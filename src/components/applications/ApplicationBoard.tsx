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
};

type PlacementTarget = {
  id: string;
  candidateName: string;
  roleTitle: string;
  agreedHourlyRate: number | null;
  agreedRateLockedAt: string | null;
  signedContractFileName: string | null;
  signedContractUploadedAt: string | null;
};

function isPlacementRequirementsMissing(application: {
  currentStage: ApplicationStage;
  agreedHourlyRate: number | null;
  signedContractUploadedAt: string | null;
}): boolean {
  return (
    application.currentStage === "PLACED" &&
    (application.agreedHourlyRate == null ||
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
  const [placementContractFile, setPlacementContractFile] =
    React.useState<File | null>(null);
  const [savingPlacement, setSavingPlacement] = React.useState(false);
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
    async (filters?: {
      candidateEmail?: string;
      companyName?: string;
      role?: string;
    }) => {
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
        const data = await fetchJson<Application[]>(endpoint);
        setApplications(data);
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
    await loadApplications();
  }, [loadApplications]);

  React.useEffect(() => {
    loadApplications();
    hasLoadedOnce.current = true;
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
        });
        continue;
      }

      existing.applicationIds.push(application.id);
      existing.groupedCount += 1;
      existing.totalNotes += application.notes.length;
      existing.totalEmails += application.emails.length;

      if (
        new Date(application.updatedAt).getTime() >
        new Date(existing.representative.updatedAt).getTime()
      ) {
        existing.representative = application;
        existing.id = application.id;
      }
    }

    return Array.from(grouped.values());
  }, [applications]);

  const visibleGroupedApplications = React.useMemo(() => {
    if (filterStage === "ALL") {
      return groupedApplications;
    }

    return groupedApplications.filter((item) => item.stage === filterStage);
  }, [groupedApplications, filterStage]);

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
            signedContractFileName: movedApplication.signedContractFileName,
            signedContractUploadedAt: movedApplication.signedContractUploadedAt,
          });
          setPlacementRate(
            movedApplication.agreedHourlyRate !== null
              ? String(movedApplication.agreedHourlyRate)
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
      signedContractFileName: application.signedContractFileName,
      signedContractUploadedAt: application.signedContractUploadedAt,
    });
    setPlacementRate(
      application.agreedHourlyRate !== null
        ? String(application.agreedHourlyRate)
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
    if (!selected) return;
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
    }
  };

  const handleCreateDraft = async (emailDraftId?: string) => {
    if (!selected || !emailDraftId) return;
    const accessToken = localStorage.getItem("graphAccessToken")?.trim();
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
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 pt-2 md:grid-cols-5">
          <Input
            value={filterCandidateEmail}
            onChange={(event) => setFilterCandidateEmail(event.target.value)}
            placeholder="Candidate"
          />
          <Input
            value={filterCompanyName}
            onChange={(event) => setFilterCompanyName(event.target.value)}
            placeholder="Company"
          />
          <Input
            value={filterRole}
            onChange={(event) => setFilterRole(event.target.value)}
            placeholder="Role"
          />
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
          <div className="flex items-center gap-2">
            <Button
              className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
              onClick={clearFilters}
            >
              Clear
            </Button>
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
                >
                  {items.map((item) => (
                    <DraggableCard
                      key={item.id}
                      groupedApplication={item}
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
            setPlacementContractFile(null);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Placed contract and agreed rate</DialogTitle>
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
                    Rate locked at {placementTarget.agreedHourlyRate.toFixed(2)}
                    .
                  </p>
                ) : null}
              </div>

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
                  onClick={() => setPlacementTarget(null)}
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
                  <Button onClick={handleAddNote}>Save note</Button>
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
                  >
                    Create draft
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
  children,
}: {
  id: ApplicationStage;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`inline-flex w-[260px] shrink-0 flex-col space-y-3 rounded-lg p-2 ${isOver ? "bg-slate-100" : ""}`}
      style={{ flex: "0 0 260px" }}
    >
      <div className="flex items-center justify-between">
        <h2 className="whitespace-nowrap text-sm font-semibold text-slate-700">
          {title}
        </h2>
        <Badge>{count}</Badge>
      </div>
      <div className="space-y-3">{children}</div>
      {count === 0 ? (
        <div className="rounded border border-dashed border-slate-300 px-2 py-3 text-xs text-slate-500">
          No applications in this stage yet.
        </div>
      ) : null}
    </div>
  );
}

function DraggableCard({
  groupedApplication,
  onEdit,
  onCompletePlacement,
}: {
  groupedApplication: GroupedApplication;
  onEdit: () => void;
  onCompletePlacement: () => void;
}) {
  const application = groupedApplication.representative;
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
      <CardHeader>
        <div className="flex items-start justify-end gap-2">
          <button
            type="button"
            className="rounded border border-slate-200 px-2 py-1 text-[10px] uppercase text-slate-500"
            onClick={(event) => event.stopPropagation()}
            {...listeners}
            {...attributes}
          >
            Drag
          </button>
        </div>
        <div className="space-y-1 text-xs">
          <p className="grid grid-cols-[74px_1fr] items-center gap-2">
            <span className="font-medium text-slate-700">Candidate</span>
            <span
              className="truncate text-slate-600"
              title={application.candidate.fullName}
            >
              {application.candidate.fullName}
            </span>
          </p>
          {companyName ? (
            <p className="grid grid-cols-[74px_1fr] items-center gap-2">
              <span className="font-medium text-slate-700">Company</span>
              <span className="truncate text-slate-600" title={companyName}>
                {companyName}
              </span>
            </p>
          ) : null}
          <p className="grid grid-cols-[74px_1fr] items-center gap-2">
            <span className="font-medium text-slate-700">Role</span>
            <span
              className="truncate text-slate-600"
              title={application.job.title}
            >
              {application.job.title}
            </span>
          </p>
          {roleDescription ? (
            <p className="grid grid-cols-[74px_1fr] items-start gap-2">
              <span className="font-medium text-slate-700">Description</span>
              <span
                className="line-clamp-2 break-words text-slate-600"
                title={roleDescription}
              >
                {roleDescription}
              </span>
            </p>
          ) : null}
          {opportunityEmail ? (
            <p className="grid grid-cols-[74px_1fr] items-center gap-2">
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
            <p className="grid grid-cols-[74px_1fr] items-center gap-2">
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
      <CardContent className="space-y-2">
        {placementMissing ? (
          <Badge className="border-amber-200 bg-amber-50 text-amber-700">
            Missing contract/rate
          </Badge>
        ) : null}
        <div className="flex gap-2">
          <Button
            type="button"
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
              className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
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
