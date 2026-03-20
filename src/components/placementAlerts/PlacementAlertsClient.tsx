"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson } from "@/lib/client";
import Link from "next/link";
import * as React from "react";

type Application = {
  id: string;
  opportunityId: string;
  candidate: { fullName: string };
  job: { title: string };
};

type PlacementAlert = {
  id: string;
  title: string;
  dueDate: string;
  status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
  notes: string | null;
  application: Application;
};

const ALERT_STATUSES: PlacementAlert["status"][] = [
  "OPEN",
  "ACKNOWLEDGED",
  "RESOLVED",
];

export default function PlacementAlertsClient() {
  const [applications, setApplications] = React.useState<Application[]>([]);
  const [alerts, setAlerts] = React.useState<PlacementAlert[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [creating, setCreating] = React.useState(false);
  const [updatingAlertId, setUpdatingAlertId] = React.useState<string | null>(
    null,
  );

  const [applicationId, setApplicationId] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [dueDate, setDueDate] = React.useState("");
  const [notes, setNotes] = React.useState("");

  const now = new Date();
  const upcomingAlerts = alerts.filter(
    (alertItem) => new Date(alertItem.dueDate) >= now,
  );
  const pastAlerts = alerts.filter(
    (alertItem) => new Date(alertItem.dueDate) < now,
  );

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [applicationData, alertData] = await Promise.all([
        fetchJson<Application[]>("/api/applications"),
        fetchJson<PlacementAlert[]>("/api/placement-alerts"),
      ]);

      setApplications(applicationData);
      setAlerts(alertData);

      if (!applicationId && applicationData[0]?.id) {
        setApplicationId(applicationData[0].id);
      }
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  React.useEffect(() => {
    load();
  }, [load]);

  const handleCreateAlert = async () => {
    if (!applicationId) {
      alert("Select an application first.");
      return;
    }

    setCreating(true);
    try {
      await fetchJson("/api/placement-alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicationId,
          title,
          dueDate: new Date(dueDate).toISOString(),
          notes,
        }),
      });

      setTitle("");
      setDueDate("");
      setNotes("");
      await load();
      alert("Placement alert created.");
    } catch (error) {
      alert((error as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const handleStatusChange = async (
    alertId: string,
    status: PlacementAlert["status"],
  ) => {
    setUpdatingAlertId(alertId);
    try {
      await fetchJson(`/api/placement-alerts/${alertId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (error) {
      alert((error as Error).message);
    } finally {
      setUpdatingAlertId(null);
    }
  };

  if (loading) {
    return (
      <p className="text-sm text-slate-500">Loading placement alerts...</p>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Create placement alert</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {applications.length === 0 ? (
            <div className="rounded border border-dashed border-slate-300 p-3 text-sm text-slate-600">
              No applications available yet. Create or match applications first
              before adding placement alerts.
              <div className="mt-2">
                <Button asChild>
                  <Link href="/applications">Go to applications</Link>
                </Button>
              </div>
            </div>
          ) : null}
          <select
            className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
            value={applicationId}
            onChange={(event) => setApplicationId(event.target.value)}
            disabled={applications.length === 0}
          >
            <option value="">Select application</option>
            {applications.map((application) => (
              <option key={application.id} value={application.id}>
                {application.candidate.fullName} - {application.job.title}
              </option>
            ))}
          </select>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Alert title"
          />
          <Input
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
          <Textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Notes"
          />
          <Button
            onClick={handleCreateAlert}
            disabled={creating || !dueDate || applications.length === 0}
          >
            {creating ? "Saving..." : "Create alert"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Upcoming alerts</CardTitle>
        </CardHeader>
        <CardContent>
          {upcomingAlerts.length === 0 ? (
            <div className="rounded border border-dashed border-slate-300 p-3 text-sm text-slate-600">
              No upcoming alerts.
            </div>
          ) : (
            <ul className="space-y-3 text-sm text-slate-700">
              {upcomingAlerts.map((alertItem) => (
                <li
                  key={alertItem.id}
                  className="rounded border border-slate-200 p-3"
                >
                  <p className="font-medium text-slate-900">
                    {alertItem.title}
                  </p>
                  <p>Candidate: {alertItem.application.candidate.fullName}</p>
                  <p>Role: {alertItem.application.job.title}</p>
                  <p>Opportunity: {alertItem.application.opportunityId}</p>
                  <p>
                    Due date:{" "}
                    {new Date(alertItem.dueDate).toLocaleDateString("en-GB")}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-slate-500">Status</span>
                    <select
                      className="h-8 rounded border border-slate-300 bg-white px-2 text-sm"
                      value={alertItem.status}
                      onChange={(event) =>
                        handleStatusChange(
                          alertItem.id,
                          event.target.value as PlacementAlert["status"],
                        )
                      }
                      disabled={updatingAlertId === alertItem.id}
                    >
                      {ALERT_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {status.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Past alerts</CardTitle>
        </CardHeader>
        <CardContent>
          {pastAlerts.length === 0 ? (
            <div className="rounded border border-dashed border-slate-300 p-3 text-sm text-slate-600">
              No past alerts.
            </div>
          ) : (
            <ul className="space-y-3 text-sm text-slate-700">
              {pastAlerts.map((alertItem) => (
                <li
                  key={alertItem.id}
                  className="rounded border border-slate-200 p-3"
                >
                  <p className="font-medium text-slate-900">
                    {alertItem.title}
                  </p>
                  <p>Candidate: {alertItem.application.candidate.fullName}</p>
                  <p>Role: {alertItem.application.job.title}</p>
                  <p>
                    Due date:{" "}
                    {new Date(alertItem.dueDate).toLocaleDateString("en-GB")}
                  </p>
                  <p>Status: {alertItem.status.replace(/_/g, " ")}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
