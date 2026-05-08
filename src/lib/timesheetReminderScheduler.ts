import { sendMail } from "@/lib/mailer";
import { prisma } from "@/lib/prisma";
import cron from "node-cron";

const SAST_TIMEZONE = "Africa/Johannesburg";

type GlobalState = {
  timesheetReminderSchedulerStarted?: boolean;
};

type OutstandingPlacement = {
  applicationId: string;
  tenantId: string;
  candidateName: string;
  roleTitle: string;
  companyName: string;
  companyId: string | null;
  outstandingMonths: string[];
};

function getSastDateParts(date: Date): {
  year: number;
  month: number;
  day: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SAST_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  return {
    year: Number(parts.find((part) => part.type === "year")?.value ?? "0"),
    month: Number(parts.find((part) => part.type === "month")?.value ?? "0"),
    day: Number(parts.find((part) => part.type === "day")?.value ?? "0"),
  };
}

function getSastDayRange(date: Date): {
  start: Date;
  end: Date;
  label: string;
} {
  const { year, month, day } = getSastDateParts(date);
  const start = new Date(Date.UTC(year, month - 1, day, -2, 0, 0, 0));
  const end = new Date(Date.UTC(year, month - 1, day + 1, -2, 0, 0, 0));
  const label = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { start, end, label };
}

function toMonthKey(value: Date): string {
  const year = value.getUTCFullYear();
  const month = `${value.getUTCMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}`;
}

function monthRangeInclusive(start: Date, end: Date): string[] {
  const months: string[] = [];
  const cursor = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1),
  );
  const endMonth = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1),
  );

  while (cursor.getTime() <= endMonth.getTime()) {
    months.push(toMonthKey(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return months;
}

function parseRecipientsCsv(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

async function hasReminderAlreadySentToday(
  tenantId: string,
  date: Date,
): Promise<boolean> {
  const range = getSastDayRange(date);
  const existing = await prisma.auditLog.findFirst({
    where: {
      tenantId,
      entityType: "timesheet_reminder",
      action: "daily_missing_submissions_sent",
      createdAt: {
        gte: range.start,
        lt: range.end,
      },
    },
    select: { id: true },
  });

  return Boolean(existing);
}

async function collectOutstandingPlacements(): Promise<OutstandingPlacement[]> {
  const placedApps = await prisma.application.findMany({
    where: {
      currentStage: "PLACED",
    },
    select: {
      id: true,
      tenantId: true,
      createdAt: true,
      placedAt: true,
      candidate: {
        select: {
          fullName: true,
        },
      },
      job: {
        select: {
          title: true,
          companyId: true,
          company: {
            select: {
              name: true,
            },
          },
        },
      },
      timesheets: {
        select: {
          status: true,
          periodStartDate: true,
        },
      },
    },
  });

  const now = new Date();

  return placedApps
    .map((application) => {
      const submittedMonths = new Set(
        application.timesheets
          .filter((timesheet) =>
            ["SUBMITTED", "APPROVED", "INVOICED", "REJECTED"].includes(
              timesheet.status,
            ),
          )
          .map((timesheet) => toMonthKey(timesheet.periodStartDate)),
      );

      const startMonth = application.placedAt ?? application.createdAt;
      const allMonths = monthRangeInclusive(startMonth, now);
      const outstandingMonths = allMonths.filter(
        (month) => !submittedMonths.has(month),
      );

      if (outstandingMonths.length === 0) {
        return null;
      }

      return {
        applicationId: application.id,
        tenantId: application.tenantId,
        candidateName: application.candidate.fullName,
        roleTitle: application.job.title,
        companyName: application.job.company?.name ?? "Unknown company",
        companyId: application.job.companyId,
        outstandingMonths,
      } satisfies OutstandingPlacement;
    })
    .filter((item): item is OutstandingPlacement => item !== null);
}

function buildReminderBody(params: {
  tenantId: string;
  dateLabel: string;
  rows: OutstandingPlacement[];
}): string {
  const lines = params.rows.map(
    (row) =>
      `- ${row.candidateName} | ${row.roleTitle} | ${row.companyName} | missing months: ${row.outstandingMonths.join(", ")}`,
  );

  return [
    `Timesheet reminder for tenant ${params.tenantId} (${params.dateLabel}).`,
    "",
    "Placed engineers with missing submitted timesheets:",
    ...lines,
    "",
    "Please submit outstanding timesheets in the Timesheets module.",
  ].join("\n");
}

export async function sendDailyMissingTimesheetReminders(date = new Date()) {
  const range = getSastDayRange(date);
  const outstanding = await collectOutstandingPlacements();

  if (outstanding.length === 0) {
    return { sent: 0, skipped: 0 };
  }

  const admins = await prisma.tenantUser.findMany({
    where: {
      role: "ADMIN",
      isActive: true,
    },
    select: {
      tenantId: true,
      email: true,
    },
  });

  const companyIds = Array.from(
    new Set(
      outstanding
        .map((row) => row.companyId)
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const companySettings = companyIds.length
    ? await prisma.companySettings.findMany({
        where: {
          companyId: {
            in: companyIds,
          },
        },
        select: {
          companyId: true,
          reportRecipientsCsv: true,
        },
      })
    : [];

  const settingsByCompany = new Map(
    companySettings.map((item) => [item.companyId, item.reportRecipientsCsv]),
  );

  const adminsByTenant = new Map<string, string[]>();
  for (const admin of admins) {
    const list = adminsByTenant.get(admin.tenantId) ?? [];
    list.push(admin.email.toLowerCase());
    adminsByTenant.set(admin.tenantId, list);
  }

  const rowsByTenant = new Map<string, OutstandingPlacement[]>();
  for (const row of outstanding) {
    const list = rowsByTenant.get(row.tenantId) ?? [];
    list.push(row);
    rowsByTenant.set(row.tenantId, list);
  }

  let sent = 0;
  let skipped = 0;

  for (const [tenantId, rows] of rowsByTenant.entries()) {
    const alreadySent = await hasReminderAlreadySentToday(tenantId, date);
    if (alreadySent) {
      skipped += 1;
      continue;
    }

    const recipientSet = new Set<string>();

    for (const adminEmail of adminsByTenant.get(tenantId) ?? []) {
      recipientSet.add(adminEmail);
    }

    for (const row of rows) {
      if (!row.companyId) {
        continue;
      }

      const companyRecipients = parseRecipientsCsv(
        settingsByCompany.get(row.companyId),
      );
      for (const recipient of companyRecipients) {
        recipientSet.add(recipient);
      }
    }

    const recipients = Array.from(recipientSet);
    const subject = `Timesheet reminder: ${rows.length} placed opportunity${rows.length === 1 ? "" : "ies"} missing submissions`;
    const text = buildReminderBody({
      tenantId,
      dateLabel: range.label,
      rows,
    });

    const mailResult = await sendMail({
      to: recipients,
      subject,
      text,
    });

    await prisma.auditLog.create({
      data: {
        tenantId,
        actor: "scheduler",
        entityType: "timesheet_reminder",
        entityId: tenantId,
        action: mailResult.sent
          ? "daily_missing_submissions_sent"
          : "daily_missing_submissions_failed",
        afterJson: {
          dateLabel: range.label,
          placements: rows.length,
          recipients,
          sent: mailResult.sent,
          message: mailResult.message ?? null,
        },
      },
    });

    if (mailResult.sent) {
      sent += 1;
    }
  }

  return { sent, skipped };
}

export function startTimesheetReminderScheduler() {
  const globalState = globalThis as typeof globalThis & GlobalState;
  if (globalState.timesheetReminderSchedulerStarted) {
    return;
  }

  globalState.timesheetReminderSchedulerStarted = true;

  cron.schedule(
    "0 8 * * *",
    async () => {
      try {
        await sendDailyMissingTimesheetReminders(new Date());
      } catch (error) {
        console.error("Timesheet reminder scheduler failed", {
          message: (error as Error).message,
        });
      }
    },
    {
      timezone: SAST_TIMEZONE,
    },
  );
}
