"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Skeleton } from "@/components/ui/skeleton";
import { SuccessBanner } from "@/components/ui/success-banner";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson } from "@/lib/client";
import * as React from "react";

type ClientAccount = {
  id: string;
  name: string;
};

type ClientContact = {
  id: string;
  fullName: string;
  clientAccount: {
    id: string;
    name: string;
  };
};

type Vacancy = {
  id: string;
  title: string;
  description: string;
  stage:
    | "OPEN"
    | "SCREENING"
    | "INTERVIEW"
    | "OFFER"
    | "FILLED"
    | "ON_HOLD"
    | "CLOSED";
  slaDate: string | null;
  offerStatus: string | null;
  reasonCode: string | null;
  clientAccount: {
    id: string;
    name: string;
  };
  hiringManager: {
    id: string;
    fullName: string;
    email: string;
  } | null;
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
  resourceType: "vacancy" | null;
};

const STAGES: Vacancy["stage"][] = [
  "OPEN",
  "SCREENING",
  "INTERVIEW",
  "OFFER",
  "FILLED",
  "ON_HOLD",
  "CLOSED",
];

export default function VacanciesClient() {
  const [accounts, setAccounts] = React.useState<ClientAccount[]>([]);
  const [contacts, setContacts] = React.useState<ClientContact[]>([]);
  const [vacancies, setVacancies] = React.useState<Vacancy[]>([]);
  const [loading, setLoading] = React.useState(true);

  const [clientAccountId, setClientAccountId] = React.useState("");
  const [hiringManagerId, setHiringManagerId] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [slaDate, setSlaDate] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [updatingVacancyId, setUpdatingVacancyId] = React.useState<
    string | null
  >(null);
  const [requestingDeleteVacancyId, setRequestingDeleteVacancyId] =
    React.useState<string | null>(null);
  const [sortBy, setSortBy] = React.useState<"title" | "client" | "date">(
    "date",
  );
  const [sortDirection, setSortDirection] = React.useState<"asc" | "desc">(
    "desc",
  );
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(
    null,
  );
  const [previewVacancy, setPreviewVacancy] = React.useState<Vacancy | null>(
    null,
  );
  const [pendingVacancyIds, setPendingVacancyIds] = React.useState<Set<string>>(
    new Set(),
  );

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

  const load = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [accountData, contactData, vacancyData, pendingRequests] =
        await Promise.all([
          fetchJson<ClientAccount[]>("/api/client-accounts"),
          fetchJson<ClientContact[]>("/api/client-contacts"),
          fetchJson<Vacancy[]>("/api/vacancies"),
          fetchJson<PendingDeletionRequest[]>(
            "/api/deletion-requests?resourceType=vacancy",
          ),
        ]);

      setAccounts(accountData);
      setContacts(contactData);
      setVacancies(vacancyData);
      setPendingVacancyIds(
        new Set(pendingRequests.map((item) => item.entityId)),
      );

      if (!clientAccountId && accountData[0]?.id) {
        setClientAccountId(accountData[0].id);
      }
    } catch (error) {
      setLoadError((error as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const filteredContacts = contacts.filter(
    (contact) => contact.clientAccount.id === clientAccountId,
  );

  const sortedVacancies = React.useMemo(() => {
    const source = vacancies;
    const next = [...source];
    next.sort((left, right) => {
      let leftValue = "";
      let rightValue = "";

      if (sortBy === "title") {
        leftValue = left.title.toLowerCase();
        rightValue = right.title.toLowerCase();
      } else if (sortBy === "client") {
        leftValue = left.clientAccount.name.toLowerCase();
        rightValue = right.clientAccount.name.toLowerCase();
      } else {
        leftValue = left.slaDate ?? "";
        rightValue = right.slaDate ?? "";
      }

      if (leftValue < rightValue) {
        return sortDirection === "asc" ? -1 : 1;
      }
      if (leftValue > rightValue) {
        return sortDirection === "asc" ? 1 : -1;
      }
      return 0;
    });
    return next;
  }, [vacancies, sortBy, sortDirection]);

  const handleCreateVacancy = async () => {
    if (!clientAccountId) {
      setFormError("Select a client account first.");
      return;
    }
    if (title.trim().length < 2) {
      setFormError("Vacancy title must be at least 2 characters.");
      return;
    }
    if (description.trim().length < 10) {
      setFormError("Vacancy description must be at least 10 characters.");
      return;
    }

    setFormError(null);
    setSuccessMessage(null);
    setCreating(true);
    try {
      await fetchJson("/api/vacancies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientAccountId,
          hiringManagerId: hiringManagerId || undefined,
          title,
          description,
          slaDate: slaDate ? new Date(slaDate).toISOString() : undefined,
          stage: "OPEN",
        }),
      });

      setTitle("");
      setDescription("");
      setSlaDate("");
      setHiringManagerId("");
      await load();
      setSuccessMessage("Vacancy created.");
    } catch (error) {
      setFormError((error as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const handleStageChange = async (
    vacancyId: string,
    stage: Vacancy["stage"],
  ) => {
    setUpdatingVacancyId(vacancyId);
    try {
      setFormError(null);
      setSuccessMessage(null);
      await fetchJson(`/api/vacancies/${vacancyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      await load();
      setSuccessMessage("Vacancy status updated.");
    } catch (error) {
      setFormError((error as Error).message);
    } finally {
      setUpdatingVacancyId(null);
    }
  };

  const [confirmDeleteVacancyId, setConfirmDeleteVacancyId] = React.useState<
    string | null
  >(null);

  const handleRequestDeleteVacancy = async (vacancyId: string) => {
    setConfirmDeleteVacancyId(vacancyId);
  };

  const executeRequestDeleteVacancy = async () => {
    const vacancyId = confirmDeleteVacancyId;
    setConfirmDeleteVacancyId(null);
    if (!vacancyId) return;

    setRequestingDeleteVacancyId(vacancyId);
    setFormError(null);
    setSuccessMessage(null);

    try {
      await fetchJson<DeletionRequestResponse>("/api/deletion-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resourceType: "vacancy",
          resourceId: vacancyId,
        }),
      });

      setSuccessMessage(
        "Deletion request submitted. Admin approval is required.",
      );
      setPendingVacancyIds((current) => {
        const next = new Set(current);
        next.add(vacancyId);
        return next;
      });
    } catch (error) {
      setFormError((error as Error).message);
    } finally {
      setRequestingDeleteVacancyId(null);
    }
  };

  const applySort = (column: "title" | "client" | "date") => {
    if (sortBy === column) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(column);
    setSortDirection("asc");
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {loadError ? <ErrorBanner message={loadError} /> : null}
      {formError ? <ErrorBanner message={formError} /> : null}
      {successMessage ? <SuccessBanner message={successMessage} /> : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>Vacancies</h1>
          <p className="text-sm text-slate-600">
            Create vacancies, assign hiring managers, and track progress.
          </p>
        </div>
        <Button onClick={handleCreateVacancy} disabled={creating}>
          {creating ? "Creating..." : "Create vacancy"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New vacancy</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <select
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={clientAccountId}
            onChange={(event) => {
              setClientAccountId(event.target.value);
              setHiringManagerId("");
            }}
          >
            <option value="">Select client account</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>

          <select
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={hiringManagerId}
            onChange={(event) => setHiringManagerId(event.target.value)}
          >
            <option value="">Select hiring manager (optional)</option>
            {filteredContacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.fullName}
              </option>
            ))}
          </select>

          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Vacancy title"
            className={
              title.trim().length >= 2
                ? "md:col-span-2"
                : "border-red-300 md:col-span-2"
            }
          />
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Vacancy description"
            className={
              description.trim().length >= 10
                ? "md:col-span-2"
                : "border-red-300 md:col-span-2"
            }
          />
          <Input
            type="date"
            value={slaDate}
            onChange={(event) => setSlaDate(event.target.value)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vacancy table</CardTitle>
        </CardHeader>
        <CardContent>
          {sortedVacancies.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-600">
              No vacancies yet. Use the form above to create your first vacancy.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-y-2 text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th>
                      <button
                        type="button"
                        className="font-semibold"
                        onClick={() => applySort("title")}
                      >
                        Name
                      </button>
                    </th>
                    <th>
                      <button
                        type="button"
                        className="font-semibold"
                        onClick={() => applySort("client")}
                      >
                        Client
                      </button>
                    </th>
                    <th>
                      <button
                        type="button"
                        className="font-semibold"
                        onClick={() => applySort("date")}
                      >
                        Date
                      </button>
                    </th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedVacancies.map((vacancy) => (
                    <tr key={vacancy.id} className="rounded-md bg-white">
                      <td className="rounded-l-md border border-r-0 border-slate-200 px-3 py-2">
                        <p className="font-medium text-slate-900">
                          {vacancy.title}
                        </p>
                        <p className="text-xs text-slate-500">
                          {vacancy.hiringManager?.fullName ??
                            "No hiring manager"}
                        </p>
                      </td>
                      <td className="border border-r-0 border-slate-200 px-3 py-2 text-slate-700">
                        {vacancy.clientAccount.name}
                      </td>
                      <td className="border border-r-0 border-slate-200 px-3 py-2 text-slate-700">
                        {vacancy.slaDate
                          ? new Date(vacancy.slaDate).toLocaleDateString(
                              "en-GB",
                            )
                          : "Not set"}
                      </td>
                      <td className="border border-r-0 border-slate-200 px-3 py-2">
                        <Badge>{vacancy.stage.replace(/_/g, " ")}</Badge>
                        {!vacancies.length ? (
                          <Badge className="ml-2">Sample</Badge>
                        ) : null}
                      </td>
                      <td className="rounded-r-md border border-slate-200 px-3 py-2">
                        <div className="flex items-center gap-2">
                          <select
                            className="h-8 rounded-md border border-slate-200 bg-white px-2 text-sm"
                            value={vacancy.stage}
                            onChange={(event) =>
                              handleStageChange(
                                vacancy.id,
                                event.target.value as Vacancy["stage"],
                              )
                            }
                            disabled={
                              updatingVacancyId === vacancy.id ||
                              vacancy.id.startsWith("sample-")
                            }
                          >
                            {STAGES.map((stage) => (
                              <option key={stage} value={stage}>
                                {stage.replace(/_/g, " ")}
                              </option>
                            ))}
                          </select>
                          <Button
                            type="button"
                            className="h-8 border border-slate-300 bg-white px-2 text-xs text-slate-900 hover:bg-slate-50"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setPreviewVacancy(vacancy);
                            }}
                          >
                            Preview
                          </Button>
                          <Button
                            type="button"
                            className="h-8 border border-slate-300 bg-white px-2 text-xs text-slate-900 hover:bg-slate-50"
                            disabled={
                              requestingDeleteVacancyId === vacancy.id ||
                              pendingVacancyIds.has(vacancy.id) ||
                              vacancy.id.startsWith("sample-")
                            }
                            onClick={() =>
                              handleRequestDeleteVacancy(vacancy.id)
                            }
                          >
                            {requestingDeleteVacancyId === vacancy.id
                              ? "Requesting..."
                              : pendingVacancyIds.has(vacancy.id)
                                ? "Pending"
                                : "Request delete"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={!!previewVacancy}
        onOpenChange={(open: boolean) => !open && setPreviewVacancy(null)}
      >
        <DialogContent className="left-auto right-0 top-0 h-screen w-[420px] max-w-[92vw] translate-x-0 translate-y-0 rounded-none">
          <DialogHeader>
            <DialogTitle>Vacancy preview</DialogTitle>
          </DialogHeader>
          {previewVacancy ? (
            <div className="space-y-3 text-sm text-slate-700">
              <div>
                <p className="text-xs text-slate-500">Title</p>
                <p className="font-medium text-slate-900">
                  {previewVacancy.title}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Client</p>
                <p>{previewVacancy.clientAccount.name}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Hiring manager</p>
                <p>
                  {previewVacancy.hiringManager?.fullName ?? "Not assigned"}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">SLA date</p>
                <p>
                  {previewVacancy.slaDate
                    ? new Date(previewVacancy.slaDate).toLocaleDateString(
                        "en-GB",
                      )
                    : "Not set"}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Description</p>
                <p className="whitespace-pre-wrap rounded-md border border-slate-200 p-3">
                  {previewVacancy.description || "No description available."}
                </p>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmDeleteVacancyId}
        title="Request deletion"
        message="Submit a deletion request for this vacancy? An admin must approve it before removal."
        confirmLabel="Submit request"
        onConfirm={executeRequestDeleteVacancy}
        onCancel={() => setConfirmDeleteVacancyId(null)}
      />
    </div>
  );
}
