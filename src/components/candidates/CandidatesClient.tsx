"use client";

import UploadPanel from "@/components/forms/UploadPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CandidateCombobox,
  type ComboboxOption,
} from "@/components/ui/candidate-combobox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
  status: "ACTIVE" | "NON_ACTIVE" | "PLACED";
  vettingStatus: "NOT_STARTED" | "PENDING_VETTING" | "VETTED" | "REJECTED";
  vettedAt: string | null;
  vettingNotes: string | null;
  criminalRecordFileName: string | null;
  criminalRecordUploadedAt: string | null;
  email: string | null;
  phone: string | null;
  skillsCsv: string;
  certificationsCsv: string;
  suggestedRolesCsv: string;
  preferredRolesCsv: string;
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
  preferredRolesCsv: string;
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

type UploadedCvResult = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  skills: string[];
  certifications: string[];
  suggestedRoles: string[];
};

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

function agreementBadgeClass(
  status: "NOT_SENT" | "SENT" | "COMPLETED" | "DECLINED" | "VOIDED",
): string {
  if (status === "COMPLETED") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "SENT") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (status === "DECLINED" || status === "VOIDED") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function toggleRoleInCsv(csv: string, role: string): string {
  const roles = csv
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  const idx = roles.findIndex((r) => r.toLowerCase() === role.toLowerCase());
  if (idx >= 0) {
    roles.splice(idx, 1);
  } else {
    roles.push(role);
  }
  return roles.join(", ");
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
    preferredRolesCsv: "",
  });
  const [savedCandidateId, setSavedCandidateId] = React.useState<string | null>(
    null,
  );
  const [activeTab, setActiveTab] = React.useState<
    "all" | "active" | "non-active" | "placed"
  >("all");
  const [searchTerm, setSearchTerm] = React.useState("");
  const [actioningCandidateId, setActioningCandidateId] = React.useState<
    string | null
  >(null);
  const [requestingDeleteCandidateId, setRequestingDeleteCandidateId] =
    React.useState<string | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(
    null,
  );
  const [pendingCandidateIds, setPendingCandidateIds] = React.useState<
    Set<string>
  >(new Set());
  const [deleteConfirmCandidateId, setDeleteConfirmCandidateId] =
    React.useState<string | null>(null);
  const [uploadingCriminalRecordId, setUploadingCriminalRecordId] =
    React.useState<string | null>(null);
  const criminalRecordInputRef = React.useRef<HTMLInputElement>(null);
  const criminalRecordTargetIdRef = React.useRef<string | null>(null);
  const [uploadedCv, setUploadedCv] = React.useState<UploadedCvResult | null>(
    null,
  );
  const [selectedRoles, setSelectedRoles] = React.useState<Set<string>>(
    new Set(),
  );
  const [savingRoles, setSavingRoles] = React.useState(false);
  const [candidateDocuments, setCandidateDocuments] = React.useState<
    Array<{ name: string; size: number; modifiedAt: string }>
  >([]);
  const [loadingDocuments, setLoadingDocuments] = React.useState(false);
  const [roleFilter, setRoleFilter] = React.useState<string | null>(null);
  const [certFilter, setCertFilter] = React.useState<string | null>(null);

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

  const handleEditStart = React.useCallback((candidate: Candidate) => {
    setSavedCandidateId(null);
    setActionError(null);
    setEditingCandidateId(candidate.id);
    // When no preferred roles have been set yet (existing candidates), default
    // to all suggested roles so every chip starts highlighted.
    const preferredRolesCsv =
      candidate.preferredRolesCsv.trim() || candidate.suggestedRolesCsv;
    setEditForm({
      fullName: candidate.fullName,
      status: candidate.status,
      email: candidate.email ?? "",
      phone: candidate.phone ?? "",
      skillsCsv: candidate.skillsCsv,
      certificationsCsv: candidate.certificationsCsv,
      suggestedRolesCsv: candidate.suggestedRolesCsv,
      preferredRolesCsv,
    });
    // Fetch documents for this candidate
    setCandidateDocuments([]);
    setLoadingDocuments(true);
    fetchJson<{
      files: Array<{ name: string; size: number; modifiedAt: string }>;
    }>(`/api/candidates/${candidate.id}/documents`)
      .then((result) => setCandidateDocuments(result.files))
      .catch(() => setCandidateDocuments([]))
      .finally(() => setLoadingDocuments(false));
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
      preferredRolesCsv: "",
    });
  }, []);

  const handleEditFieldChange = React.useCallback(
    <K extends keyof CandidateForm>(field: K, value: CandidateForm[K]) => {
      setEditForm((current) => ({ ...current, [field]: value }));
    },
    [],
  );

  const candidatesToDisplay = candidates;

  const allRoles = React.useMemo((): ComboboxOption[] => {
    const roleSet = new Set<string>();
    candidates.forEach((c) => {
      c.suggestedRolesCsv
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean)
        .forEach((r) => roleSet.add(r));
    });
    return [...roleSet].sort().map((r) => ({ value: r, label: r }));
  }, [candidates]);

  const allCerts = React.useMemo((): ComboboxOption[] => {
    const certSet = new Set<string>();
    candidates.forEach((c) => {
      c.certificationsCsv
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean)
        .forEach((r) => certSet.add(r));
    });
    return [...certSet].sort().map((r) => ({ value: r, label: r }));
  }, [candidates]);

  const filteredCandidates = React.useMemo(() => {
    let result = candidatesToDisplay;

    if (activeTab === "active") {
      result = result.filter((c) => c.status === "ACTIVE");
    } else if (activeTab === "non-active") {
      result = result.filter((c) => c.status === "NON_ACTIVE");
    } else if (activeTab === "placed") {
      result = result.filter((c) => c.status === "PLACED");
    }

    if (roleFilter) {
      const role = roleFilter.toLowerCase();
      result = result.filter((c) =>
        c.suggestedRolesCsv
          .split(",")
          .map((r) => r.trim())
          .some((r) => r.toLowerCase() === role),
      );
    }

    if (certFilter) {
      const cert = certFilter.toLowerCase();
      result = result.filter((c) =>
        c.certificationsCsv
          .split(",")
          .map((r) => r.trim())
          .some((r) => r.toLowerCase() === cert),
      );
    }

    if (searchTerm.trim()) {
      const term = searchTerm.trim().toLowerCase();
      result = result.filter((c) => c.fullName.toLowerCase().includes(term));
    }

    return result;
  }, [activeTab, candidatesToDisplay, certFilter, roleFilter, searchTerm]);

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
          preferredRolesCsv: editForm.preferredRolesCsv,
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

  const handleToggleStatus = React.useCallback(
    async (candidate: Candidate) => {
      if (candidate.status === "PLACED") return;
      const newStatus = candidate.status === "ACTIVE" ? "NON_ACTIVE" : "ACTIVE";
      setActionError(null);
      setSuccessMessage(null);
      setActioningCandidateId(candidate.id);
      try {
        await fetchJson(`/api/candidates/${candidate.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fullName: candidate.fullName,
            email: candidate.email ?? "",
            phone: candidate.phone ?? "",
            skillsCsv: candidate.skillsCsv,
            certificationsCsv: candidate.certificationsCsv,
            suggestedRolesCsv: candidate.suggestedRolesCsv,
            preferredRolesCsv: candidate.preferredRolesCsv ?? "",
            status: newStatus,
          }),
        });
        await load();
        setSuccessMessage(
          `${candidate.fullName} set to ${newStatus === "ACTIVE" ? "Active" : "Non Active"}.`,
        );
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
      setDeleteConfirmCandidateId(candidateId);
    },
    [],
  );

  const handleConfirmDeleteCandidate = React.useCallback(async () => {
    const candidateId = deleteConfirmCandidateId;
    setDeleteConfirmCandidateId(null);
    if (!candidateId) return;

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
  }, [deleteConfirmCandidateId]);

  const handleCriminalRecordUploadClick = React.useCallback(
    (candidateId: string) => {
      criminalRecordTargetIdRef.current = candidateId;
      criminalRecordInputRef.current?.click();
    },
    [],
  );

  const handleCriminalRecordFileChange = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      const candidateId = criminalRecordTargetIdRef.current;
      if (!file || !candidateId) return;
      event.target.value = "";

      setActionError(null);
      setSuccessMessage(null);
      setUploadingCriminalRecordId(candidateId);
      try {
        const formData = new FormData();
        formData.append("file", file);
        await fetchJson(`/api/candidates/${candidateId}/criminal-record`, {
          method: "POST",
          body: formData,
        });
        await load();
        setSuccessMessage("Criminal record check uploaded.");
      } catch (error) {
        setActionError((error as Error).message);
      } finally {
        setUploadingCriminalRecordId(null);
        criminalRecordTargetIdRef.current = null;
      }
    },
    [load],
  );

  const handleCriminalRecordDownload = React.useCallback(
    (candidateId: string) => {
      window.open(`/api/candidates/${candidateId}/criminal-record`, "_blank");
    },
    [],
  );

  const handleCriminalRecordDelete = React.useCallback(
    async (candidateId: string) => {
      setActionError(null);
      setSuccessMessage(null);
      setUploadingCriminalRecordId(candidateId);
      try {
        await fetchJson(`/api/candidates/${candidateId}/criminal-record`, {
          method: "DELETE",
        });
        await load();
        setSuccessMessage("Criminal record check removed.");
      } catch (error) {
        setActionError((error as Error).message);
      } finally {
        setUploadingCriminalRecordId(null);
      }
    },
    [load],
  );

  const handleCvUploadSuccess = React.useCallback(
    (data: unknown) => {
      const result = data as UploadedCvResult;
      void load();
      if (result?.suggestedRoles?.length) {
        setUploadedCv(result);
        setSelectedRoles(new Set(result.suggestedRoles));
      }
    },
    [load],
  );

  const handleToggleRole = React.useCallback((role: string) => {
    setSelectedRoles((current) => {
      const next = new Set(current);
      if (next.has(role)) {
        next.delete(role);
      } else {
        next.add(role);
      }
      return next;
    });
  }, []);

  const handleRolePickerSave = React.useCallback(async () => {
    if (!uploadedCv) {
      return;
    }
    setSavingRoles(true);
    setActionError(null);
    try {
      await fetchJson(`/api/candidates/${uploadedCv.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: uploadedCv.fullName,
          email: uploadedCv.email ?? "",
          phone: uploadedCv.phone ?? "",
          skillsCsv: uploadedCv.skills.join(", "),
          certificationsCsv: uploadedCv.certifications.join(", "),
          suggestedRolesCsv: uploadedCv.suggestedRoles.join(", "),
          preferredRolesCsv: [...selectedRoles].join(", "),
          status: "ACTIVE",
        }),
      });
      await load();
      setUploadedCv(null);
      setSelectedRoles(new Set());
      setSuccessMessage("Preferred roles saved.");
    } catch (error) {
      setActionError((error as Error).message);
    } finally {
      setSavingRoles(false);
    }
  }, [uploadedCv, selectedRoles, load]);

  const handleRolePickerDismiss = React.useCallback(() => {
    setUploadedCv(null);
    setSelectedRoles(new Set());
  }, []);

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

      <input
        ref={criminalRecordInputRef}
        type="file"
        className="hidden"
        accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png"
        onChange={handleCriminalRecordFileChange}
      />

      <UploadPanel
        title="Upload a candidate CV"
        endpoint="/api/upload/cv"
        helper="Upload the original CV as a PDF file so formatting is preserved. AI extracts name, email, contact number, skills, and suggested roles."
        acceptedFileTypes=".pdf,application/pdf"
        showTextInput={false}
        onSuccess={handleCvUploadSuccess}
      />

      <Dialog
        open={!!uploadedCv}
        onOpenChange={(open) => {
          if (!open) {
            handleRolePickerDismiss();
          }
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Select preferred roles</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Select the roles{" "}
              <span className="font-medium">{uploadedCv?.fullName}</span> is
              happy to be matched against. Deselect any they are not interested
              in.
            </p>
            <div className="flex flex-wrap gap-2">
              {(uploadedCv?.suggestedRoles ?? []).map((role) => {
                const active = selectedRoles.has(role);
                return (
                  <button
                    key={role}
                    type="button"
                    onClick={() => handleToggleRole(role)}
                    className={[
                      "rounded-full border px-3 py-1 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                      active
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-slate-300 bg-white text-slate-600 hover:border-slate-400",
                    ].join(" ")}
                  >
                    {role}
                  </button>
                );
              })}
            </div>
            {selectedRoles.size === 0 ? (
              <p className="text-xs text-amber-700">
                No roles selected — this candidate will not be matched to any
                opportunities.
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                className="border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                onClick={handleRolePickerDismiss}
                disabled={savingRoles}
              >
                Skip
              </Button>
              <Button
                onClick={() => void handleRolePickerSave()}
                disabled={savingRoles}
              >
                {savingRoles ? "Saving..." : "Save preferred roles"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
                  AI suggested roles
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
              <div className="space-y-1 md:col-span-2">
                <div className="flex items-center justify-between">
                  <Label>Preferred roles</Label>
                  {editForm.suggestedRolesCsv
                    .split(",")
                    .map((r) => r.trim())
                    .filter(Boolean).length > 0 && (
                    <span className="text-xs text-slate-500">
                      <button
                        type="button"
                        className="text-blue-600 hover:underline"
                        onClick={() =>
                          handleEditFieldChange(
                            "preferredRolesCsv",
                            editForm.suggestedRolesCsv,
                          )
                        }
                      >
                        Select all
                      </button>
                      {" · "}
                      <button
                        type="button"
                        className="text-blue-600 hover:underline"
                        onClick={() =>
                          handleEditFieldChange("preferredRolesCsv", "")
                        }
                      >
                        Deselect all
                      </button>
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500">
                  Click a role to select or deselect it. Only selected (blue)
                  roles are used for opportunity matching.
                </p>
                {editForm.suggestedRolesCsv
                  .split(",")
                  .map((r) => r.trim())
                  .filter(Boolean).length === 0 ? (
                  <p className="text-xs text-slate-400">
                    Add suggested roles above to enable selection.
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-2 rounded border border-slate-200 bg-slate-50 p-3">
                      {editForm.suggestedRolesCsv
                        .split(",")
                        .map((r) => r.trim())
                        .filter(Boolean)
                        .map((role) => {
                          const preferred = editForm.preferredRolesCsv
                            .split(",")
                            .map((r) => r.trim())
                            .filter(Boolean)
                            .some(
                              (r) => r.toLowerCase() === role.toLowerCase(),
                            );
                          return (
                            <button
                              key={role}
                              type="button"
                              onClick={() =>
                                handleEditFieldChange(
                                  "preferredRolesCsv",
                                  toggleRoleInCsv(
                                    editForm.preferredRolesCsv,
                                    role,
                                  ),
                                )
                              }
                              className={[
                                "rounded-full border px-3 py-1 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                                preferred
                                  ? "border-blue-600 bg-blue-600 text-white"
                                  : "border-slate-300 bg-white text-slate-600 hover:border-slate-400",
                              ].join(" ")}
                            >
                              {role}
                            </button>
                          );
                        })}
                    </div>
                    {editForm.preferredRolesCsv
                      .split(",")
                      .map((r) => r.trim())
                      .filter(Boolean).length === 0 && (
                      <p className="text-xs text-amber-600">
                        No roles selected — this candidate will not be matched
                        to any opportunities.
                      </p>
                    )}
                  </>
                )}
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
                className="h-8 border border-slate-300 bg-white px-2 text-xs text-slate-900 hover:bg-slate-50"
                onClick={() =>
                  editingCandidate
                    ? handleCriminalRecordUploadClick(editingCandidate.id)
                    : undefined
                }
                disabled={
                  !editingCandidate ||
                  uploadingCriminalRecordId === editingCandidate?.id
                }
              >
                {uploadingCriminalRecordId === editingCandidate?.id
                  ? "Uploading..."
                  : "Upload criminal record check"}
              </Button>
              {editingCandidate?.criminalRecordFileName ? (
                <>
                  <Button
                    className="h-8 border border-emerald-300 bg-emerald-50 px-2 text-xs text-emerald-700 hover:bg-emerald-100"
                    onClick={() =>
                      editingCandidate
                        ? handleCriminalRecordDownload(editingCandidate.id)
                        : undefined
                    }
                  >
                    Download: {editingCandidate.criminalRecordFileName}
                  </Button>
                  <Button
                    className="h-8 border border-red-300 bg-red-50 px-2 text-xs text-red-700 hover:bg-red-100"
                    onClick={() =>
                      editingCandidate
                        ? handleCriminalRecordDelete(editingCandidate.id)
                        : undefined
                    }
                    disabled={
                      uploadingCriminalRecordId === editingCandidate?.id
                    }
                  >
                    Remove criminal record check
                  </Button>
                </>
              ) : null}
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

            {/* Signed documents section */}
            {editingCandidate && (
              <div className="mt-4 rounded border border-slate-200 p-3">
                <h4 className="mb-2 text-sm font-semibold text-slate-700">
                  Signed Documents
                </h4>
                {loadingDocuments ? (
                  <p className="text-xs text-slate-500">Loading…</p>
                ) : candidateDocuments.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No signed documents on file yet.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {candidateDocuments.map((doc) => (
                      <li
                        key={doc.name}
                        className="flex items-center gap-2 text-xs"
                      >
                        <a
                          href={`/api/candidates/${editingCandidate.id}/documents?file=${encodeURIComponent(doc.name)}`}
                          className="font-medium text-blue-600 underline hover:text-blue-800"
                          download
                        >
                          {doc.name}
                        </a>
                        <span className="text-slate-400">
                          {formatFileSize(doc.size)}
                        </span>
                        <span className="text-slate-400">
                          {new Date(doc.modifiedAt).toLocaleDateString("en-GB")}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
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

          <div className="flex flex-wrap items-center gap-3">
            <Input
              placeholder="Search candidates\u2026"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-52"
            />
            <div className="w-56">
              <CandidateCombobox
                options={allRoles}
                value={roleFilter ?? ""}
                onValueChange={(v) => setRoleFilter(v || null)}
                placeholder="Filter by role\u2026"
              />
            </div>
            <div className="w-56">
              <CandidateCombobox
                options={allCerts}
                value={certFilter ?? ""}
                onValueChange={(v) => setCertFilter(v || null)}
                placeholder="Filter by certification\u2026"
              />
            </div>
            {(roleFilter ?? certFilter) && (
              <button
                type="button"
                className="text-xs text-slate-500 hover:text-slate-800 hover:underline"
                onClick={() => {
                  setRoleFilter(null);
                  setCertFilter(null);
                }}
              >
                Clear filters
              </button>
            )}
          </div>

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
                        </td>
                        <td className="px-2 py-2">
                          <Badge className={statusBadgeClass(candidate.status)}>
                            {statusLabel(candidate.status)}
                          </Badge>
                          {candidate.status !== "PLACED" ? (
                            <Button
                              type="button"
                              className="ml-1 h-6 border border-slate-300 bg-white px-1.5 text-[10px] text-slate-700 hover:bg-slate-50"
                              onClick={() => handleToggleStatus(candidate)}
                              disabled={actioningCandidateId === candidate.id}
                            >
                              {actioningCandidateId === candidate.id
                                ? "..."
                                : candidate.status === "ACTIVE"
                                  ? "Deactivate"
                                  : "Activate"}
                            </Button>
                          ) : null}
                        </td>
                        <td className="px-2 py-2">
                          <Badge
                            className={vettingBadgeClass(
                              candidate.vettingStatus,
                            )}
                          >
                            {candidate.vettingStatus.replace(/_/g, " ")}
                          </Badge>
                          <div className="mt-1">
                            <Badge
                              className={
                                candidate.criminalRecordFileName
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-slate-200 bg-slate-50 text-slate-700"
                              }
                            >
                              {candidate.criminalRecordFileName
                                ? "Criminal record: On file"
                                : "Criminal record: None"}
                            </Badge>
                          </div>
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
                            <Badge className={agreementBadgeClass(ndaStatus)}>
                              NDA: {ndaStatus.replace(/_/g, " ")}
                            </Badge>
                            <Badge
                              className={agreementBadgeClass(teamingStatus)}
                            >
                              Teaming: {teamingStatus.replace(/_/g, " ")}
                            </Badge>
                            <Button
                              type="button"
                              className="h-8 border border-slate-300 bg-white px-2 text-xs text-slate-900 hover:bg-slate-50"
                              onClick={() => handleEditStart(candidate)}
                            >
                              Edit
                            </Button>
                            <Button
                              type="button"
                              className="h-8 border border-slate-300 bg-white px-2 text-xs text-slate-900 hover:bg-slate-50"
                              onClick={() =>
                                window.open(
                                  `/api/candidates/${candidate.id}/formatted-cv`,
                                  "_blank",
                                )
                              }
                            >
                              Download CV
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
      <ConfirmDialog
        open={deleteConfirmCandidateId !== null}
        title="Request candidate deletion"
        description="Submit a deletion request for this candidate? An admin must approve it before removal."
        confirmLabel="Submit request"
        onConfirm={handleConfirmDeleteCandidate}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirmCandidateId(null);
        }}
      />
    </div>
  );
}
