"use client";

import UploadPanel from "@/components/forms/UploadPanel";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SuccessBanner } from "@/components/ui/success-banner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson } from "@/lib/client";
import * as React from "react";

type Candidate = {
  id: string;
  fullName: string;
  isActive: boolean;
  cvStorageMode: "FULL" | "REDACTED" | "UNKNOWN";
  status: "ACTIVE" | "NON_ACTIVE" | "PLACED";
  vettingStatus: "NOT_STARTED" | "PENDING_VETTING" | "VETTED" | "REJECTED";
  vettedAt: string | null;
  vettingNotes: string | null;
  email: string | null;
  phone: string | null;
  skillsCsv: string;
  certificationsCsv: string;
  suggestedRolesCsv: string;
  agreements: Array<{
    id: string;
    type: "NDA" | "TEAMING_AGREEMENT";
    status: "NOT_SENT" | "SENT" | "COMPLETED" | "DECLINED" | "VOIDED";
    sentAt: string | null;
    signedAt: string | null;
  }>;
};

type CandidateForm = {
  fullName: string;
  status: "ACTIVE" | "NON_ACTIVE" | "PLACED";
  email: string;
  phone: string;
  skillsCsv: string;
  certificationsCsv: string;
  suggestedRolesCsv: string;
};

type DeletionRequestResponse = {
  id: string;
  entityId: string;
  action: string;
  createdAt: string;
};

type PendingDeletionRequest = {
  id: string;
  entityId: string;
  action: string;
  createdAt: string;
  resourceType: "candidate" | null;
};

const SAMPLE_CANDIDATES: Candidate[] = [
  {
    id: "sample-candidate-1",
    fullName: "Alex Johnson",
    isActive: true,
    cvStorageMode: "FULL",
    status: "ACTIVE",
    vettingStatus: "VETTED",
    vettedAt: null,
    vettingNotes: "Sample candidate",
    email: "alex.johnson@example.com",
    phone: "+44 7700 900101",
    skillsCsv: "Azure, SQL, Python",
    certificationsCsv: "AZ-900",
    suggestedRolesCsv: "Data Engineer",
    agreements: [
      {
        id: "sample-nda-1",
        type: "NDA",
        status: "COMPLETED",
        sentAt: null,
        signedAt: null,
      },
      {
        id: "sample-team-1",
        type: "TEAMING_AGREEMENT",
        status: "COMPLETED",
        sentAt: null,
        signedAt: null,
      },
    ],
  },
  {
    id: "sample-candidate-2",
    fullName: "Morgan Lee",
    isActive: true,
    cvStorageMode: "FULL",
    status: "ACTIVE",
    vettingStatus: "PENDING_VETTING",
    vettedAt: null,
    vettingNotes: "Sample candidate",
    email: "morgan.lee@example.com",
    phone: "+44 7700 900102",
    skillsCsv: "Kubernetes, Terraform, Azure",
    certificationsCsv: "CKA",
    suggestedRolesCsv: "Platform Engineer",
    agreements: [
      {
        id: "sample-nda-2",
        type: "NDA",
        status: "SENT",
        sentAt: null,
        signedAt: null,
      },
      {
        id: "sample-team-2",
        type: "TEAMING_AGREEMENT",
        status: "NOT_SENT",
        sentAt: null,
        signedAt: null,
      },
    ],
  },
  {
    id: "sample-candidate-3",
    fullName: "Chris Bennett",
    isActive: false,
    cvStorageMode: "REDACTED",
    status: "NON_ACTIVE",
    vettingStatus: "REJECTED",
    vettedAt: null,
    vettingNotes: "Sample candidate",
    email: "chris.bennett@example.com",
    phone: "+44 7700 900103",
    skillsCsv: "FinOps, Cost Management",
    certificationsCsv: "FinOps Practitioner",
    suggestedRolesCsv: "FinOps Analyst",
    agreements: [
      {
        id: "sample-nda-3",
        type: "NDA",
        status: "DECLINED",
        sentAt: null,
        signedAt: null,
      },
      {
        id: "sample-team-3",
        type: "TEAMING_AGREEMENT",
        status: "VOIDED",
        sentAt: null,
        signedAt: null,
      },
    ],
  },
];

function vettingBadgeClass(status: Candidate["vettingStatus"]): string {
  if (status === "VETTED") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "PENDING_VETTING") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (status === "REJECTED") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function statusBadgeClass(status: Candidate["status"]): string {
  if (status === "ACTIVE") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (status === "PLACED") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }

  return "border-slate-200 bg-slate-50 text-slate-700";
}

function statusLabel(status: Candidate["status"]): string {
  if (status === "NON_ACTIVE") {
    return "Non Active";
  }

  return status.charAt(0) + status.slice(1).toLowerCase();
}

function availabilityBadgeClass(status: Candidate["status"]): string {
  if (status === "ACTIVE") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (status === "PLACED") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }

  return "border-slate-200 bg-slate-50 text-slate-700";
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
    return "CV: Redacted";
  }

  if (mode === "FULL") {
    return "CV: Full";
  }

  return "CV: Unknown";
}

export default function CandidatesClient() {
  const [candidates, setCandidates] = React.useState<Candidate[]>([]);
  const [editingCandidateId, setEditingCandidateId] = React.useState<
    string | null
  >(null);
  const [savingCandidateId, setSavingCandidateId] = React.useState<
    string | null
  >(null);
  const [regeneratingRolesCandidateId, setRegeneratingRolesCandidateId] =
    React.useState<string | null>(null);
  const [editForm, setEditForm] = React.useState<CandidateForm>({
    fullName: "",
    status: "ACTIVE",
    email: "",
    phone: "",
    skillsCsv: "",
    certificationsCsv: "",
    suggestedRolesCsv: "",
  });
  const [savedCandidateId, setSavedCandidateId] = React.useState<string | null>(
    null,
  );
  const [activeTab, setActiveTab] = React.useState<
    "all" | "active" | "non-active" | "placed"
  >("all");
  const [actioningCandidateId, setActioningCandidateId] = React.useState<
    string | null
  >(null);
  const [requestingDeleteCandidateId, setRequestingDeleteCandidateId] =
    React.useState<string | null>(null);
  const [updatingCvPrivacyCandidateId, setUpdatingCvPrivacyCandidateId] =
    React.useState<string | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(
    null,
  );
  const [pendingCandidateIds, setPendingCandidateIds] = React.useState<
    Set<string>
  >(new Set());

  const load = React.useCallback(async () => {
    setLoadError(null);
    const [candidatesResult, pendingResult] = await Promise.allSettled([
      fetchJson<Candidate[]>("/api/candidates"),
      fetchJson<PendingDeletionRequest[]>(
        "/api/deletion-requests?resourceType=candidate",
      ),
    ]);

    if (candidatesResult.status === "fulfilled") {
      setCandidates(candidatesResult.value);
    } else {
      setLoadError((candidatesResult.reason as Error).message);
      setCandidates([]);
    }

    if (pendingResult.status === "fulfilled") {
      setPendingCandidateIds(
        new Set(pendingResult.value.map((item) => item.entityId)),
      );
    } else {
      setPendingCandidateIds(new Set());
      setActionError((pendingResult.reason as Error).message);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  React.useEffect(() => {
    if (!savedCandidateId) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setSavedCandidateId(null);
    }, 3000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [savedCandidateId]);

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

  const handleOpenAtsWindow = React.useCallback(
    (candidateId: string, options?: { autoPreview?: boolean }) => {
      const params = new URLSearchParams({ candidateId });
      if (options?.autoPreview) {
        params.set("autoPreview", "1");
      }

      const atsWindow = window.open(
        `/ats-window?${params.toString()}`,
        "atsWindow",
        "popup=yes,width=1280,height=900,resizable=yes,scrollbars=yes",
      );

      if (!atsWindow) {
        setActionError(
          "Could not open ATS window. Please allow pop-up windows for this site.",
        );
        return;
      }

      atsWindow.focus();
    },
    [],
  );

  const handleEditStart = React.useCallback((candidate: Candidate) => {
    setSavedCandidateId(null);
    setActionError(null);
    setEditingCandidateId(candidate.id);
    setEditForm({
      fullName: candidate.fullName,
      status: candidate.status,
      email: candidate.email ?? "",
      phone: candidate.phone ?? "",
      skillsCsv: candidate.skillsCsv,
      certificationsCsv: candidate.certificationsCsv,
      suggestedRolesCsv: candidate.suggestedRolesCsv,
    });
  }, []);

  const handleEditCancel = React.useCallback(() => {
    setEditingCandidateId(null);
    setSavingCandidateId(null);
    setEditForm({
      fullName: "",
      status: "ACTIVE",
      email: "",
      phone: "",
      skillsCsv: "",
      certificationsCsv: "",
      suggestedRolesCsv: "",
    });
  }, []);

  const handleEditFieldChange = React.useCallback(
    <K extends keyof CandidateForm>(field: K, value: CandidateForm[K]) => {
      setEditForm((current) => ({ ...current, [field]: value }));
    },
    [],
  );

  const candidatesToDisplay = candidates;

  const filteredCandidates = React.useMemo(() => {
    if (activeTab === "active") {
      return candidatesToDisplay.filter(
        (candidate) => candidate.status === "ACTIVE",
      );
    }

    if (activeTab === "non-active") {
      return candidatesToDisplay.filter(
        (candidate) => candidate.status === "NON_ACTIVE",
      );
    }

    if (activeTab === "placed") {
      return candidatesToDisplay.filter(
        (candidate) => candidate.status === "PLACED",
      );
    }

    return candidatesToDisplay;
  }, [activeTab, candidatesToDisplay]);

  const editingCandidate = React.useMemo(
    () =>
      editingCandidateId
        ? (candidates.find(
            (candidate) => candidate.id === editingCandidateId,
          ) ?? null)
        : null,
    [candidates, editingCandidateId],
  );

  const handleEditSave = React.useCallback(async () => {
    if (!editingCandidateId) {
      return;
    }

    if (editForm.fullName.trim().length < 2) {
      setActionError("Candidate name must be at least 2 characters.");
      return;
    }

    setActionError(null);
    setSuccessMessage(null);
    setSavingCandidateId(editingCandidateId);

    try {
      await fetchJson(`/api/candidates/${editingCandidateId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fullName: editForm.fullName,
          status: editForm.status,
          email: editForm.email,
          phone: editForm.phone,
          skillsCsv: editForm.skillsCsv,
          certificationsCsv: editForm.certificationsCsv,
          suggestedRolesCsv: editForm.suggestedRolesCsv,
        }),
      });

      await load();
      setSavedCandidateId(editingCandidateId);
      setSuccessMessage("Candidate details saved.");
      handleEditCancel();
    } catch (error) {
      setSavedCandidateId(null);
      setActionError((error as Error).message);
      setSavingCandidateId(null);
    }
  }, [editForm, editingCandidateId, handleEditCancel, load]);

  const handleRegenerateRoles = React.useCallback(async () => {
    if (!editingCandidateId) {
      return;
    }

    if (
      !editForm.skillsCsv.trim().length &&
      !editForm.certificationsCsv.trim().length
    ) {
      setActionError(
        "Add at least one skill or certification before regenerating suggested roles.",
      );
      return;
    }

    setActionError(null);
    setRegeneratingRolesCandidateId(editingCandidateId);
    try {
      const aiProvider =
        (typeof window !== "undefined"
          ? localStorage.getItem("aiProvider")
          : null) ?? "auto";

      const response = await fetchJson<{
        suggestedRolesCsv: string;
        suggestedRoles: string[];
      }>(`/api/candidates/${editingCandidateId}/roles`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          skillsCsv: editForm.skillsCsv,
          certificationsCsv: editForm.certificationsCsv,
          aiProvider,
        }),
      });

      setEditForm((current) => ({
        ...current,
        suggestedRolesCsv:
          response.suggestedRolesCsv || response.suggestedRoles.join(", "),
      }));
      setSuccessMessage("Suggested roles regenerated.");
    } catch (error) {
      setActionError((error as Error).message);
    } finally {
      setRegeneratingRolesCandidateId(null);
    }
  }, [editForm.certificationsCsv, editForm.skillsCsv, editingCandidateId]);

  const handleSendAgreement = React.useCallback(
    async (
      candidateId: string,
      type: "NDA" | "TEAMING_AGREEMENT",
      candidateEmail?: string | null,
      candidateName?: string,
    ) => {
      if (!candidateEmail?.trim()) {
        setActionError("Candidate email is required before sending agreement.");
        return;
      }

      setActionError(null);
      setSuccessMessage(null);
      setActioningCandidateId(candidateId);
      try {
        await fetchJson(`/api/candidates/${candidateId}/agreements`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type,
            recipientEmail: candidateEmail,
            recipientName: candidateName,
          }),
        });
        await load();
        setSuccessMessage(
          type === "NDA"
            ? "NDA sent successfully."
            : "Teaming agreement sent successfully.",
        );
      } catch (error) {
        setActionError((error as Error).message);
      } finally {
        setActioningCandidateId(null);
      }
    },
    [load],
  );

  const handleMarkVetted = React.useCallback(
    async (candidateId: string) => {
      setActionError(null);
      setSuccessMessage(null);
      setActioningCandidateId(candidateId);
      try {
        await fetchJson(`/api/candidates/${candidateId}/vetting`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "VETTED" }),
        });
        await load();
        setSuccessMessage("Candidate marked as vetted.");
      } catch (error) {
        setActionError((error as Error).message);
      } finally {
        setActioningCandidateId(null);
      }
    },
    [load],
  );

  const handleRequestDeleteCandidate = React.useCallback(
    async (candidateId: string) => {
      const proceed = window.confirm(
        "Submit a deletion request for this candidate? An admin must approve it before removal.",
      );

      if (!proceed) {
        return;
      }

      setActionError(null);
      setSuccessMessage(null);
      setRequestingDeleteCandidateId(candidateId);

      try {
        await fetchJson<DeletionRequestResponse>("/api/deletion-requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            resourceType: "candidate",
            resourceId: candidateId,
          }),
        });

        setSuccessMessage(
          "Deletion request submitted. Admin approval is required.",
        );
        setPendingCandidateIds((current) => {
          const next = new Set(current);
          next.add(candidateId);
          return next;
        });
      } catch (error) {
        setActionError((error as Error).message);
      } finally {
        setRequestingDeleteCandidateId(null);
      }
    },
    [],
  );

  const handleRedactCandidateCv = React.useCallback(
    async (candidateId: string) => {
      setActionError(null);
      setSuccessMessage(null);
      setUpdatingCvPrivacyCandidateId(candidateId);

      try {
        await fetchJson(`/api/candidates/${candidateId}/cv-contact-privacy`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "REDACTED" }),
        });

        await load();
        setSuccessMessage("Stored CV text contact details removed.");
      } catch (error) {
        setActionError((error as Error).message);
      } finally {
        setUpdatingCvPrivacyCandidateId(null);
      }
    },
    [load],
  );

  return (
    <div className="space-y-6">
      {loadError ? (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Could not load saved candidates. Please check your session and tenant
          context, then refresh.
        </div>
      ) : null}
      {actionError ? <ErrorBanner message={actionError} /> : null}
      {successMessage ? <SuccessBanner message={successMessage} /> : null}

      <UploadPanel
        title="Upload a candidate CV"
        endpoint="/api/upload/cv"
        helper="Paste the CV or upload a file. AI extracts name, email, contact number, skills, and suggested roles. Choose whether stored CV text should keep or remove contact details."
        onSuccess={() => load()}
      />

      <Dialog
        open={!!editingCandidateId}
        onOpenChange={(open: boolean) => {
          if (!open) {
            handleEditCancel();
          }
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit candidate</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1 rounded border border-slate-200 p-3">
              <Label htmlFor={`candidate-status-${editingCandidateId}`}>
                Status
              </Label>
              <Select
                value={editForm.status}
                onValueChange={(value) =>
                  handleEditFieldChange(
                    "status",
                    value as CandidateForm["status"],
                  )
                }
              >
                <SelectTrigger id={`candidate-status-${editingCandidateId}`}>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="NON_ACTIVE">Non Active</SelectItem>
                  <SelectItem value="PLACED" disabled>
                    Placed (automatic)
                  </SelectItem>
                </SelectContent>
              </Select>
              {editingCandidate?.status === "PLACED" ? (
                <p className="text-xs text-slate-500">
                  Placed is assigned automatically when an opportunity reaches
                  the placed stage.
                </p>
              ) : null}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor={`candidate-full-name-${editingCandidateId}`}>
                  Full name
                </Label>
                <Input
                  id={`candidate-full-name-${editingCandidateId}`}
                  value={editForm.fullName}
                  onChange={(event) =>
                    handleEditFieldChange("fullName", event.target.value)
                  }
                  placeholder="Full name"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`candidate-email-${editingCandidateId}`}>
                  Email
                </Label>
                <Input
                  id={`candidate-email-${editingCandidateId}`}
                  value={editForm.email}
                  onChange={(event) =>
                    handleEditFieldChange("email", event.target.value)
                  }
                  placeholder="Email"
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label htmlFor={`candidate-phone-${editingCandidateId}`}>
                  Contact number
                </Label>
                <Input
                  id={`candidate-phone-${editingCandidateId}`}
                  value={editForm.phone}
                  onChange={(event) =>
                    handleEditFieldChange("phone", event.target.value)
                  }
                  placeholder="Contact number"
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label htmlFor={`candidate-skills-${editingCandidateId}`}>
                  Skills
                </Label>
                <Textarea
                  id={`candidate-skills-${editingCandidateId}`}
                  value={editForm.skillsCsv}
                  onChange={(event) =>
                    handleEditFieldChange("skillsCsv", event.target.value)
                  }
                  placeholder="Skills"
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label
                  htmlFor={`candidate-certifications-${editingCandidateId}`}
                >
                  Certifications
                </Label>
                <Textarea
                  id={`candidate-certifications-${editingCandidateId}`}
                  value={editForm.certificationsCsv}
                  onChange={(event) =>
                    handleEditFieldChange(
                      "certificationsCsv",
                      event.target.value,
                    )
                  }
                  placeholder="Certifications"
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label htmlFor={`candidate-roles-${editingCandidateId}`}>
                  Suggested roles
                </Label>
                <Textarea
                  id={`candidate-roles-${editingCandidateId}`}
                  value={editForm.suggestedRolesCsv}
                  onChange={(event) =>
                    handleEditFieldChange(
                      "suggestedRolesCsv",
                      event.target.value,
                    )
                  }
                  placeholder="Suggested roles"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                className="h-8 border border-slate-300 bg-white px-2 text-xs text-slate-900 hover:bg-slate-50"
                onClick={() =>
                  editingCandidate
                    ? handleSendAgreement(
                        editingCandidate.id,
                        "NDA",
                        editingCandidate.email,
                        editingCandidate.fullName,
                      )
                    : undefined
                }
                disabled={
                  !editingCandidate ||
                  actioningCandidateId === editingCandidate.id
                }
              >
                Send NDA
              </Button>
              <Button
                className="h-8 border border-slate-300 bg-white px-2 text-xs text-slate-900 hover:bg-slate-50"
                onClick={() =>
                  editingCandidate
                    ? handleSendAgreement(
                        editingCandidate.id,
                        "TEAMING_AGREEMENT",
                        editingCandidate.email,
                        editingCandidate.fullName,
                      )
                    : undefined
                }
                disabled={
                  !editingCandidate ||
                  actioningCandidateId === editingCandidate.id
                }
              >
                Send teaming agreement
              </Button>
              <Button
                className="h-8 border border-slate-300 bg-white px-2 text-xs text-slate-900 hover:bg-slate-50"
                onClick={() =>
                  editingCandidate
                    ? handleMarkVetted(editingCandidate.id)
                    : undefined
                }
                disabled={
                  !editingCandidate ||
                  actioningCandidateId === editingCandidate.id
                }
              >
                Mark vetted
              </Button>
              <Button
                className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                onClick={handleRegenerateRoles}
                disabled={regeneratingRolesCandidateId === editingCandidateId}
              >
                {regeneratingRolesCandidateId === editingCandidateId
                  ? "Regenerating roles..."
                  : "Regenerate roles with AI"}
              </Button>
              <Button
                onClick={handleEditSave}
                disabled={savingCandidateId === editingCandidateId}
              >
                {savingCandidateId === editingCandidateId
                  ? "Saving..."
                  : "Save"}
              </Button>
              <Button
                className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                onClick={handleEditCancel}
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle>Recent candidates</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Tabs
            value={activeTab}
            onValueChange={(value) =>
              setActiveTab(value as "all" | "active" | "non-active" | "placed")
            }
          >
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="active">Active</TabsTrigger>
              <TabsTrigger value="non-active">Non Active</TabsTrigger>
              <TabsTrigger value="placed">Placed</TabsTrigger>
            </TabsList>
          </Tabs>

          {filteredCandidates.length === 0 ? (
            <div className="rounded border border-dashed border-slate-300 p-4 text-sm text-slate-600">
              No candidates yet. Upload a CV to create your first candidate.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-2 py-2">Candidate</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Vetting</th>
                    <th className="px-2 py-2">Availability</th>
                    <th className="px-2 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCandidates.map((candidate) => {
                    const ndaStatus =
                      candidate.agreements.find((item) => item.type === "NDA")
                        ?.status ?? "NOT_SENT";
                    const teamingStatus =
                      candidate.agreements.find(
                        (item) => item.type === "TEAMING_AGREEMENT",
                      )?.status ?? "NOT_SENT";

                    return (
                      <tr
                        key={candidate.id}
                        className="border-b border-slate-100"
                      >
                        <td className="px-2 py-2">
                          <p className="font-medium text-slate-900">
                            {candidate.fullName}
                          </p>
                          <p className="text-xs text-slate-500">
                            {candidate.email ?? "Email not extracted"}
                          </p>
                          <div className="mt-1">
                            <Badge
                              className={cvStorageBadgeClass(
                                candidate.cvStorageMode,
                              )}
                            >
                              {cvStorageLabel(candidate.cvStorageMode)}
                            </Badge>
                          </div>
                          <div className="mt-2">
                            <Button
                              type="button"
                              className="h-7 border border-slate-300 bg-white px-2 text-xs text-slate-900 hover:bg-slate-50"
                              onClick={() =>
                                handleRedactCandidateCv(candidate.id)
                              }
                              disabled={
                                updatingCvPrivacyCandidateId === candidate.id ||
                                candidate.cvStorageMode === "REDACTED" ||
                                !candidates.length
                              }
                            >
                              {updatingCvPrivacyCandidateId === candidate.id
                                ? "Removing..."
                                : candidate.cvStorageMode === "REDACTED"
                                  ? "Contact information removed"
                                  : "Remove contact information"}
                            </Button>
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          <Badge className={statusBadgeClass(candidate.status)}>
                            {statusLabel(candidate.status)}
                          </Badge>
                        </td>
                        <td className="px-2 py-2">
                          <Badge
                            className={vettingBadgeClass(
                              candidate.vettingStatus,
                            )}
                          >
                            {candidate.vettingStatus.replace(/_/g, " ")}
                          </Badge>
                        </td>
                        <td className="px-2 py-2">
                          <Badge
                            className={availabilityBadgeClass(candidate.status)}
                          >
                            {candidate.status === "ACTIVE"
                              ? "Available"
                              : candidate.status === "PLACED"
                                ? "Placed"
                                : "Unavailable"}
                          </Badge>
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge>NDA: {ndaStatus}</Badge>
                            <Badge>Teaming: {teamingStatus}</Badge>
                            {!candidates.length ? <Badge>Sample</Badge> : null}
                            <Button
                              type="button"
                              className="h-8 border border-slate-300 bg-white px-2 text-xs text-slate-900 hover:bg-slate-50"
                              onClick={() => handleEditStart(candidate)}
                              disabled={!candidates.length}
                            >
                              Edit
                            </Button>
                            <Button
                              type="button"
                              className="h-8 border border-slate-300 bg-white px-2 text-xs text-slate-900 hover:bg-slate-50"
                              onClick={() => handleOpenAtsWindow(candidate.id)}
                              disabled={!candidates.length}
                            >
                              Scan raw CV (ATS benchmark)
                            </Button>
                            <Button
                              type="button"
                              className="h-8 border border-slate-300 bg-white px-2 text-xs text-slate-900 hover:bg-slate-50"
                              onClick={() =>
                                handleOpenAtsWindow(candidate.id, {
                                  autoPreview: true,
                                })
                              }
                              disabled={!candidates.length}
                            >
                              Suggest corrections from raw CV
                            </Button>
                            <Button
                              type="button"
                              className="h-8 border border-slate-300 bg-white px-2 text-xs text-slate-900 hover:bg-slate-50"
                              onClick={() =>
                                handleSendAgreement(
                                  candidate.id,
                                  "NDA",
                                  candidate.email,
                                  candidate.fullName,
                                )
                              }
                              disabled={
                                actioningCandidateId === candidate.id ||
                                !candidates.length
                              }
                            >
                              NDA
                            </Button>
                            <Button
                              type="button"
                              className="h-8 border border-slate-300 bg-white px-2 text-xs text-slate-900 hover:bg-slate-50"
                              onClick={() =>
                                handleSendAgreement(
                                  candidate.id,
                                  "TEAMING_AGREEMENT",
                                  candidate.email,
                                  candidate.fullName,
                                )
                              }
                              disabled={
                                actioningCandidateId === candidate.id ||
                                !candidates.length
                              }
                            >
                              Teaming
                            </Button>
                            <Button
                              type="button"
                              className="h-8 border border-slate-300 bg-white px-2 text-xs text-slate-900 hover:bg-slate-50"
                              onClick={() => handleMarkVetted(candidate.id)}
                              disabled={
                                actioningCandidateId === candidate.id ||
                                !candidates.length
                              }
                            >
                              Mark vetted
                            </Button>
                            <Button
                              type="button"
                              className="h-8 border border-slate-300 bg-white px-2 text-xs text-slate-900 hover:bg-slate-50"
                              onClick={() =>
                                handleRequestDeleteCandidate(candidate.id)
                              }
                              disabled={
                                requestingDeleteCandidateId === candidate.id ||
                                pendingCandidateIds.has(candidate.id) ||
                                !candidates.length
                              }
                            >
                              {requestingDeleteCandidateId === candidate.id
                                ? "Requesting..."
                                : pendingCandidateIds.has(candidate.id)
                                  ? "Pending"
                                  : "Request delete"}
                            </Button>
                          </div>
                          {savedCandidateId === candidate.id ? (
                            <p className="mt-2 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700">
                              Candidate details saved.
                            </p>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
