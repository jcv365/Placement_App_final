"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Input } from "@/components/ui/input";
import { SuccessBanner } from "@/components/ui/success-banner";
import { fetchJson } from "@/lib/client";
import Link from "next/link";
import * as React from "react";

type Application = {
  id: string;
  opportunityId: string;
  currentStage: string;
  agreedHourlyRate: number | null;
  candidate: { id: string; fullName: string };
  job: { title: string; company?: { name: string } | null };
};

type Invoice = {
  id: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  dueDate: string;
  status: "DRAFT" | "SENT" | "PAID" | "VOIDED";
};

type Timesheet = {
  id: string;
  periodStartDate: string;
  periodEndDate: string;
  hoursWorked: number;
  ratePerHour: number;
  engineerRatePerHour: number;
  currency: string;
  status: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "INVOICED";
  application: Application;
  invoice: Invoice | null;
};

const TIMESHEET_STATUSES: Timesheet["status"][] = [
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
  "INVOICED",
];

const ALLOWED_TRANSITIONS: Record<Timesheet["status"], Timesheet["status"][]> =
  {
    DRAFT: ["DRAFT", "SUBMITTED"],
    SUBMITTED: ["SUBMITTED", "APPROVED", "REJECTED"],
    APPROVED: ["APPROVED", "INVOICED"],
    REJECTED: ["REJECTED", "DRAFT"],
    INVOICED: ["INVOICED"],
  };

export default function TimesheetsClient() {
  const initialSearchParams = React.useMemo(() => {
    if (typeof window === "undefined") {
      return new URLSearchParams();
    }

    return new URLSearchParams(window.location.search);
  }, []);

  const [applications, setApplications] = React.useState<Application[]>([]);
  const [timesheets, setTimesheets] = React.useState<Timesheet[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [creating, setCreating] = React.useState(false);
  const [updatingTimesheetId, setUpdatingTimesheetId] = React.useState<
    string | null
  >(null);
  const [invoicingTimesheetId, setInvoicingTimesheetId] = React.useState<
    string | null
  >(null);

  const [engineerId, setEngineerId] = React.useState("");
  const [applicationId, setApplicationId] = React.useState("");
  const [periodStartDate, setPeriodStartDate] = React.useState("");
  const [periodEndDate, setPeriodEndDate] = React.useState("");
  const [hoursWorked, setHoursWorked] = React.useState("");
  const [engineerRatePerHour, setEngineerRatePerHour] = React.useState("");
  const [filterCompanyName, setFilterCompanyName] = React.useState(
    initialSearchParams.get("companyName") ?? "",
  );
  const [filterCandidateName, setFilterCandidateName] = React.useState(
    initialSearchParams.get("candidateName") ?? "",
  );
  const [filterMonth, setFilterMonth] = React.useState(
    initialSearchParams.get("month") ?? "",
  );
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(
    null,
  );

  const showError = React.useCallback((msg: string) => {
    setActionError(msg);
    setSuccessMessage(null);
  }, []);

  const showSuccess = React.useCallback((msg: string) => {
    setSuccessMessage(msg);
    setActionError(null);
    setTimeout(
      () => setSuccessMessage((prev) => (prev === msg ? null : prev)),
      4000,
    );
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [applicationData, timesheetData] = await Promise.all([
        fetchJson<Application[]>("/api/applications"),
        fetchJson<Timesheet[]>("/api/timesheets"),
      ]);

      setApplications(applicationData);
      setTimesheets(timesheetData);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const placedApplications = React.useMemo(
    () =>
      applications.filter(
        (application) => application.currentStage === "PLACED",
      ),
    [applications],
  );

  const availableEngineers = React.useMemo(() => {
    const seen = new Set<string>();
    return placedApplications
      .map((application) => application.candidate)
      .filter((candidate) => {
        if (seen.has(candidate.id)) {
          return false;
        }
        seen.add(candidate.id);
        return true;
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [placedApplications]);

  const opportunitiesForEngineer = React.useMemo(() => {
    if (!engineerId) {
      return [] as Application[];
    }

    return placedApplications.filter(
      (application) => application.candidate.id === engineerId,
    );
  }, [engineerId, placedApplications]);

  React.useEffect(() => {
    if (!engineerId) {
      if (availableEngineers[0]?.id) {
        setEngineerId(availableEngineers[0].id);
      }
      return;
    }

    const exists = availableEngineers.some(
      (engineer) => engineer.id === engineerId,
    );
    if (!exists) {
      setEngineerId(availableEngineers[0]?.id ?? "");
    }
  }, [availableEngineers, engineerId]);

  React.useEffect(() => {
    if (!opportunitiesForEngineer.length) {
      setApplicationId("");
      return;
    }

    const exists = opportunitiesForEngineer.some(
      (application) => application.id === applicationId,
    );

    if (!exists) {
      setApplicationId(opportunitiesForEngineer[0].id);
    }
  }, [applicationId, opportunitiesForEngineer]);

  const selectedApplication = React.useMemo(
    () => opportunitiesForEngineer.find((a) => a.id === applicationId),
    [applicationId, opportunitiesForEngineer],
  );

  const monthStart = React.useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }, []);

  const monthToDateTimesheets = React.useMemo(() => {
    return timesheets.filter((timesheet) => {
      const periodStart = new Date(timesheet.periodStartDate);
      const engineerMatches = engineerId
        ? timesheet.application.candidate.id === engineerId
        : true;
      return engineerMatches && periodStart >= monthStart;
    });
  }, [engineerId, monthStart, timesheets]);

  const monthToDateHours = React.useMemo(
    () =>
      monthToDateTimesheets.reduce(
        (sum, timesheet) => sum + timesheet.hoursWorked,
        0,
      ),
    [monthToDateTimesheets],
  );

  const filteredTimesheets = React.useMemo(() => {
    const normalisedCompany = filterCompanyName.trim().toLowerCase();
    const normalisedCandidate = filterCandidateName.trim().toLowerCase();
    const normalisedMonth = filterMonth.trim();

    return timesheets.filter((timesheet) => {
      const companyName =
        timesheet.application.job.company?.name?.trim().toLowerCase() ?? "";
      const candidateName = timesheet.application.candidate.fullName
        .trim()
        .toLowerCase();
      const monthKey = new Date(timesheet.periodStartDate)
        .toISOString()
        .slice(0, 7);

      const companyMatches = normalisedCompany
        ? companyName.includes(normalisedCompany)
        : true;
      const candidateMatches = normalisedCandidate
        ? candidateName.includes(normalisedCandidate)
        : true;
      const monthMatches = normalisedMonth
        ? monthKey === normalisedMonth
        : true;

      return companyMatches && candidateMatches && monthMatches;
    });
  }, [filterCandidateName, filterCompanyName, filterMonth, timesheets]);

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const url = new URL(window.location.href);
    if (filterCompanyName.trim()) {
      url.searchParams.set("companyName", filterCompanyName.trim());
    } else {
      url.searchParams.delete("companyName");
    }

    if (filterCandidateName.trim()) {
      url.searchParams.set("candidateName", filterCandidateName.trim());
    } else {
      url.searchParams.delete("candidateName");
    }

    if (filterMonth.trim()) {
      url.searchParams.set("month", filterMonth.trim());
    } else {
      url.searchParams.delete("month");
    }

    const nextSearch = url.searchParams.toString();
    const nextUrl = `${url.pathname}${nextSearch ? `?${nextSearch}` : ""}${url.hash}`;
    window.history.replaceState({}, "", nextUrl);
  }, [filterCandidateName, filterCompanyName, filterMonth]);

  const clearTimesheetFilters = React.useCallback(() => {
    setFilterCompanyName("");
    setFilterCandidateName("");
    setFilterMonth("");
  }, []);

  const handleExportMonthToDateCsv = React.useCallback(() => {
    if (monthToDateTimesheets.length === 0) {
      showError("No month-to-date timesheets available for export.");
      return;
    }

    const csvHeader = [
      "timesheet_id",
      "engineer",
      "opportunity_id",
      "role",
      "period_start",
      "period_end",
      "hours_worked",
      "rate_per_hour",
      "engineer_rate_per_hour",
      "currency",
      "status",
    ];

    const escapeCsv = (value: string | number): string => {
      const text = String(value);
      if (/[",\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
      }
      return text;
    };

    const csvRows = monthToDateTimesheets.map((timesheet) => [
      timesheet.id,
      timesheet.application.candidate.fullName,
      timesheet.application.opportunityId,
      timesheet.application.job.title,
      new Date(timesheet.periodStartDate).toISOString().slice(0, 10),
      new Date(timesheet.periodEndDate).toISOString().slice(0, 10),
      timesheet.hoursWorked.toFixed(2),
      timesheet.ratePerHour.toFixed(2),
      timesheet.engineerRatePerHour.toFixed(2),
      timesheet.currency,
      timesheet.status,
    ]);

    const csvContent = [csvHeader, ...csvRows]
      .map((row) => row.map((cell) => escapeCsv(cell)).join(","))
      .join("\n");

    const blob = new Blob([csvContent], {
      type: "text/csv;charset=utf-8",
    });
    const link = document.createElement("a");
    const timestamp = new Date().toISOString().slice(0, 10);
    link.href = URL.createObjectURL(blob);
    link.download = `timesheets-month-to-date-${timestamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  }, [monthToDateTimesheets]);

  const handleCreateTimesheet = async () => {
    if (!applicationId) {
      showError("Select an application first.");
      return;
    }

    const parsedHours = Number(hoursWorked);
    const parsedEngineerRate = Number(engineerRatePerHour);

    if (!Number.isFinite(parsedHours) || parsedHours <= 0) {
      showError("Hours worked must be a positive number.");
      return;
    }

    if (parsedHours > 350) {
      showError("Hours worked cannot exceed 350 per month.");
      return;
    }

    if (!Number.isFinite(parsedEngineerRate) || parsedEngineerRate < 0) {
      showError("Engineer rate must be zero or a positive number.");
      return;
    }

    if (!selectedApplication?.agreedHourlyRate) {
      showError("No agreed contract rate found on this placement.");
      return;
    }

    setCreating(true);
    try {
      await fetchJson("/api/timesheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicationId,
          periodStartDate: new Date(periodStartDate).toISOString(),
          periodEndDate: new Date(periodEndDate).toISOString(),
          hoursWorked: parsedHours,
          engineerRatePerHour: parsedEngineerRate,
          currency: "ZAR",
        }),
      });

      setPeriodStartDate("");
      setPeriodEndDate("");
      setHoursWorked("");
      setEngineerRatePerHour("");
      await load();
      showSuccess("Timesheet created.");
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const handleStatusChange = async (
    timesheetId: string,
    status: Timesheet["status"],
  ) => {
    setUpdatingTimesheetId(timesheetId);
    try {
      await fetchJson(`/api/timesheets/${timesheetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setUpdatingTimesheetId(null);
    }
  };

  const handleGenerateInvoice = async (timesheetId: string) => {
    setInvoicingTimesheetId(timesheetId);
    try {
      await fetchJson(`/api/timesheets/${timesheetId}/invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      await load();
      showSuccess("Invoice generated.");
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setInvoicingTimesheetId(null);
    }
  };

  const handleMarkPaid = async (timesheetId: string) => {
    setInvoicingTimesheetId(timesheetId);
    try {
      await fetchJson(`/api/timesheets/${timesheetId}/invoice`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "PAID" }),
      });
      await load();
      showSuccess("Invoice marked paid.");
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setInvoicingTimesheetId(null);
    }
  };

  if (loading) {
    return <p className="text-sm text-slate-500">Loading timesheets...</p>;
  }

  return (
    <div className="space-y-6">
      {actionError ? <ErrorBanner message={actionError} /> : null}
      {successMessage ? <SuccessBanner message={successMessage} /> : null}
      <Card>
        <CardHeader>
          <CardTitle>Create timesheet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {placedApplications.length === 0 ? (
            <div className="rounded border border-dashed border-slate-300 p-3 text-sm text-slate-600">
              No placed opportunities are available yet. Move an application to
              placed first, then create timesheets.
              <div className="mt-2">
                <Button asChild>
                  <Link href="/applications">Go to applications</Link>
                </Button>
              </div>
            </div>
          ) : null}

          <select
            className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
            value={engineerId}
            onChange={(event) => setEngineerId(event.target.value)}
            disabled={availableEngineers.length === 0}
          >
            <option value="">Select engineer</option>
            {availableEngineers.map((engineer) => (
              <option key={engineer.id} value={engineer.id}>
                {engineer.fullName}
              </option>
            ))}
          </select>

          <select
            className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
            value={applicationId}
            onChange={(event) => setApplicationId(event.target.value)}
            disabled={!engineerId || opportunitiesForEngineer.length === 0}
          >
            <option value="">Select placed opportunity</option>
            {opportunitiesForEngineer.map((application) => (
              <option key={application.id} value={application.id}>
                {application.job.title}
                {application.job.company?.name
                  ? ` - ${application.job.company.name}`
                  : ""}
              </option>
            ))}
          </select>

          <Input
            type="date"
            value={periodStartDate}
            onChange={(event) => setPeriodStartDate(event.target.value)}
          />
          <Input
            type="date"
            value={periodEndDate}
            onChange={(event) => setPeriodEndDate(event.target.value)}
          />
          <Input
            value={hoursWorked}
            onChange={(event) => setHoursWorked(event.target.value)}
            placeholder="Hours worked (max 350)"
          />
          {selectedApplication?.agreedHourlyRate != null ? (
            <div className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600">
              Contract rate: {selectedApplication.agreedHourlyRate.toFixed(2)}{" "}
              (from agreement)
            </div>
          ) : (
            <div className="flex h-9 items-center rounded-md border border-amber-200 bg-amber-50 px-3 text-sm text-amber-700">
              No agreed contract rate set on this placement
            </div>
          )}
          <Input
            value={engineerRatePerHour}
            onChange={(event) => setEngineerRatePerHour(event.target.value)}
            placeholder="Engineer rate per hour"
          />

          <Button
            onClick={handleCreateTimesheet}
            disabled={
              creating ||
              !periodStartDate ||
              !periodEndDate ||
              !engineerId ||
              !applicationId ||
              placedApplications.length === 0
            }
          >
            {creating ? "Saving..." : "Create timesheet"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Month-to-date hours</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-700">
            Total hours: <strong>{monthToDateHours.toFixed(2)}</strong>
          </p>
          <Button
            onClick={handleExportMonthToDateCsv}
            disabled={monthToDateTimesheets.length === 0}
          >
            Export CSV
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Timesheets and invoices</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-3 grid gap-2 md:grid-cols-4">
            <Input
              value={filterCompanyName}
              onChange={(event) => setFilterCompanyName(event.target.value)}
              placeholder="Filter by client"
            />
            <Input
              value={filterCandidateName}
              onChange={(event) => setFilterCandidateName(event.target.value)}
              placeholder="Filter by candidate"
            />
            <Input
              type="month"
              value={filterMonth}
              onChange={(event) => setFilterMonth(event.target.value)}
            />
            <Button
              className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
              onClick={clearTimesheetFilters}
            >
              Clear filters
            </Button>
          </div>

          {filteredTimesheets.length === 0 ? (
            <div className="rounded border border-dashed border-slate-300 p-3 text-sm text-slate-600">
              No timesheets match the current filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm text-slate-700">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-2 py-2">Candidate</th>
                    <th className="px-2 py-2">Role</th>
                    <th className="px-2 py-2">Period</th>
                    <th className="px-2 py-2">Hours</th>
                    <th className="px-2 py-2">Rates</th>
                    <th className="px-2 py-2">Gross Margin</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Invoice</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTimesheets.map((timesheet) => (
                    <tr
                      key={timesheet.id}
                      className="border-b border-slate-100 align-top"
                    >
                      <td className="px-2 py-2">
                        {timesheet.application.candidate.fullName}
                      </td>
                      <td className="px-2 py-2">
                        {timesheet.application.job.title}
                      </td>
                      <td className="px-2 py-2">
                        {new Date(timesheet.periodStartDate).toLocaleDateString(
                          "en-GB",
                        )}{" "}
                        to{" "}
                        {new Date(timesheet.periodEndDate).toLocaleDateString(
                          "en-GB",
                        )}
                      </td>
                      <td className="px-2 py-2">
                        {timesheet.hoursWorked.toFixed(2)}
                      </td>
                      <td className="px-2 py-2">
                        <p className="text-xs">
                          Contract: {timesheet.ratePerHour.toFixed(2)}{" "}
                          {timesheet.currency}
                        </p>
                        <p className="text-xs">
                          Engineer: {timesheet.engineerRatePerHour.toFixed(2)}{" "}
                          {timesheet.currency}
                        </p>
                      </td>
                      <td className="px-2 py-2">
                        {(
                          (timesheet.ratePerHour -
                            timesheet.engineerRatePerHour) *
                          timesheet.hoursWorked
                        ).toFixed(2)}{" "}
                        {timesheet.currency}
                      </td>
                      <td className="px-2 py-2">
                        <select
                          className="h-8 rounded border border-slate-300 bg-white px-2 text-sm"
                          value={timesheet.status}
                          onChange={(event) =>
                            handleStatusChange(
                              timesheet.id,
                              event.target.value as Timesheet["status"],
                            )
                          }
                          disabled={updatingTimesheetId === timesheet.id}
                        >
                          {(
                            ALLOWED_TRANSITIONS[timesheet.status] ?? [
                              timesheet.status,
                            ]
                          ).map((status) => (
                            <option key={status} value={status}>
                              {status.replace(/_/g, " ")}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        {timesheet.invoice ? (
                          <div className="space-y-1">
                            <p className="text-xs">
                              {timesheet.invoice.invoiceNumber}
                            </p>
                            <p className="text-xs">
                              {timesheet.invoice.status}
                            </p>
                            <Button
                              onClick={() => handleMarkPaid(timesheet.id)}
                              disabled={invoicingTimesheetId === timesheet.id}
                            >
                              Mark paid
                            </Button>
                          </div>
                        ) : (
                          <Button
                            onClick={() => handleGenerateInvoice(timesheet.id)}
                            disabled={invoicingTimesheetId === timesheet.id}
                          >
                            Generate
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
