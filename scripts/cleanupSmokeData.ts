async function main() {
  const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";

  const [alertsResponse, timesheetsResponse] = await Promise.all([
    fetch(`${baseUrl}/api/placement-alerts`),
    fetch(`${baseUrl}/api/timesheets`),
  ]);

  if (!alertsResponse.ok || !timesheetsResponse.ok) {
    throw new Error("Unable to fetch alerts/timesheets for cleanup");
  }

  const alertsPayload = (await alertsResponse.json()) as {
    ok: boolean;
    data: Array<{ id: string; title?: string; notes?: string | null }>;
  };
  const timesheetsPayload = (await timesheetsResponse.json()) as {
    ok: boolean;
    data: Array<{
      id: string;
      application?: {
        candidate?: {
          fullName?: string;
        };
      };
    }>;
  };

  if (!alertsPayload.ok || !timesheetsPayload.ok) {
    throw new Error("Cleanup list endpoints returned unsuccessful response");
  }

  const smokeAlerts = alertsPayload.data.filter((alert) => {
    const title = alert.title?.toLowerCase() ?? "";
    const notes = alert.notes?.toLowerCase() ?? "";
    return title.includes("right-to-work") || notes.includes("smoke test");
  });

  let deletedAlerts = 0;
  for (const alert of smokeAlerts) {
    const response = await fetch(
      `${baseUrl}/api/placement-alerts/${alert.id}`,
      {
        method: "DELETE",
      },
    );
    if (response.ok) {
      deletedAlerts += 1;
    }
  }

  const smokeTimesheets = timesheetsPayload.data.filter((timesheet) =>
    (timesheet.application?.candidate?.fullName ?? "")
      .toLowerCase()
      .includes("smoke"),
  );

  let deletedTimesheets = 0;
  let deletedInvoices = 0;
  for (const timesheet of smokeTimesheets) {
    const response = await fetch(`${baseUrl}/api/timesheets/${timesheet.id}`, {
      method: "DELETE",
    });
    if (response.ok) {
      deletedTimesheets += 1;
      deletedInvoices += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        deletedInvoices,
        deletedTimesheets,
        deletedAlerts,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => Promise.resolve());
