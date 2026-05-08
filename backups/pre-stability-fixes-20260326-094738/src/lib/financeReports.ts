import { sendMail } from "@/lib/mailer";
import { prisma } from "@/lib/prisma";

const DEFAULT_RECIPIENT = "accounts@dotcloud.africa";
const DEFAULT_OUTLOOK_MAILBOX = "placements@dotcloud.africa";
export const DOTCLOUD_PARTNER_NAME = "DotCloud Consulting";

type FinanceRow = {
  brandName: string;
  logoUrl: string;
  splitParties: string;
  timesheetId: string;
  applicationId: string;
  candidateName: string;
  roleTitle: string;
  periodStartDate: Date;
  periodEndDate: Date;
  approvedHours: number;
  contractRate: number;
  engineerRate: number;
  marginRate: number;
  monthlyCharge: number;
  revenueSplitPercent: number;
  dotCloudShareCharge: number;
  companyShareCharge: number;
  currency: string;
};

function parseRecipientsCsv(value?: string | null): string[] {
  const parsed = (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  if (!parsed.includes(DEFAULT_RECIPIENT)) {
    parsed.push(DEFAULT_RECIPIENT);
  }

  return Array.from(new Set(parsed));
}

function toCsvField(value: string | number): string {
  const raw = String(value);
  if (/[",\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }

  return raw;
}

function buildCsv(rows: FinanceRow[]): string {
  const header = [
    "brand_name",
    "logo_url",
    "split_parties",
    "timesheet_id",
    "application_id",
    "candidate_name",
    "role_title",
    "period_start",
    "period_end",
    "approved_hours",
    "contract_rate",
    "engineer_rate",
    "margin_rate",
    "monthly_charge",
    "revenue_split_percent",
    "dotcloud_share_charge",
    "company_share_charge",
    "currency",
  ];

  const dataRows = rows.map((row) =>
    [
      row.brandName,
      row.logoUrl,
      row.splitParties,
      row.timesheetId,
      row.applicationId,
      row.candidateName,
      row.roleTitle,
      row.periodStartDate.toISOString(),
      row.periodEndDate.toISOString(),
      row.approvedHours.toFixed(2),
      row.contractRate.toFixed(2),
      row.engineerRate.toFixed(2),
      row.marginRate.toFixed(2),
      row.monthlyCharge.toFixed(2),
      row.revenueSplitPercent.toFixed(2),
      row.dotCloudShareCharge.toFixed(2),
      row.companyShareCharge.toFixed(2),
      row.currency,
    ]
      .map(toCsvField)
      .join(","),
  );

  return [header.join(","), ...dataRows].join("\n");
}

function getSastYearMonth(date: Date): { year: number; month: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? "0");
  const month = Number(
    parts.find((part) => part.type === "month")?.value ?? "0",
  );

  return { year, month };
}

export function getMonthRangeSast(date: Date): {
  start: Date;
  end: Date;
  label: string;
} {
  const { year, month } = getSastYearMonth(date);
  const start = new Date(Date.UTC(year, month - 1, 1, -2, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, -2, 0, 0, 0));
  const label = `${year}-${String(month).padStart(2, "0")}`;

  return { start, end, label };
}

export async function ensureCompanySettings(
  companyId: string,
  tenantId: string,
) {
  const existing = await prisma.companySettings.findUnique({
    where: { companyId },
    include: {
      company: {
        select: { tenantId: true },
      },
    },
  });

  if (existing && existing.company.tenantId !== tenantId) {
    throw new Error("Company settings not found");
  }

  if (existing) {
    return existing;
  }

  return prisma.companySettings.create({
    data: {
      companyId,
      revenueSplitPercent: 50,
      brandName: null,
      logoUrl: null,
      reportRecipientsCsv: DEFAULT_RECIPIENT,
      outlookMailbox: DEFAULT_OUTLOOK_MAILBOX,
      currency: "ZAR",
    },
  });
}

export async function calculateCompanyCharges(params: {
  companyId: string;
  tenantId: string;
  rangeStart: Date;
  rangeEnd: Date;
}) {
  const settings = await ensureCompanySettings(
    params.companyId,
    params.tenantId,
  );

  const timesheets = await prisma.timesheet.findMany({
    where: {
      tenantId: params.tenantId,
      status: "APPROVED",
      periodStartDate: {
        gte: params.rangeStart,
        lt: params.rangeEnd,
      },
      application: {
        job: {
          companyId: params.companyId,
        },
      },
    },
    include: {
      application: {
        select: {
          agreedHourlyRate: true,
          placementBillingModel: true,
          placementFeePercent: true,
          annualCtc: true,
          contractValue: true,
          candidate: {
            select: {
              fullName: true,
            },
          },
          job: {
            select: {
              title: true,
              company: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy: [{ periodStartDate: "asc" }, { createdAt: "asc" }],
  });

  const rows: FinanceRow[] = timesheets.map(
    (timesheet: (typeof timesheets)[number]) => {
      const placementModel = timesheet.application.placementBillingModel;
      let contractRate: number;
      let engineerRate: number;
      let marginRate: number;
      let monthlyCharge: number;

      if (placementModel === "ONCE_OFF_PLACEMENT_FEE") {
        const cv = timesheet.application.contractValue ?? 0;
        const pct = timesheet.application.placementFeePercent ?? 0;
        monthlyCharge = cv * (pct / 100);
        contractRate = cv;
        engineerRate = 0;
        marginRate = monthlyCharge;
      } else if (placementModel === "PERMANENT_PLACEMENT_FEE") {
        const ctc = timesheet.application.annualCtc ?? 0;
        const pct = timesheet.application.placementFeePercent ?? 0;
        monthlyCharge = ctc * (pct / 100);
        contractRate = ctc;
        engineerRate = 0;
        marginRate = monthlyCharge;
      } else {
        contractRate =
          timesheet.application.agreedHourlyRate ?? timesheet.ratePerHour;
        engineerRate = timesheet.engineerRatePerHour;
        marginRate = contractRate - engineerRate;
        monthlyCharge = marginRate * timesheet.hoursWorked;
      }

      const splitPercent = Math.max(
        0,
        Math.min(100, settings.revenueSplitPercent ?? 50),
      );
      const dotCloudShareCharge = monthlyCharge * (splitPercent / 100);
      const companyShareCharge = monthlyCharge * ((100 - splitPercent) / 100);

      return {
        brandName: settings.brandName ?? "",
        logoUrl: settings.logoUrl ?? "",
        splitParties: `${DOTCLOUD_PARTNER_NAME} | ${timesheet.application.job.company?.name ?? "Client Company"}`,
        timesheetId: timesheet.id,
        applicationId: timesheet.applicationId,
        candidateName: timesheet.application.candidate.fullName,
        roleTitle: timesheet.application.job.title,
        periodStartDate: timesheet.periodStartDate,
        periodEndDate: timesheet.periodEndDate,
        approvedHours: timesheet.hoursWorked,
        contractRate,
        engineerRate,
        marginRate,
        monthlyCharge,
        revenueSplitPercent: splitPercent,
        dotCloudShareCharge,
        companyShareCharge,
        currency: settings.currency,
      };
    },
  );

  const totals = rows.reduce(
    (acc, row) => {
      acc.approvedHours += row.approvedHours;
      acc.monthlyCharge += row.monthlyCharge;
      acc.dotCloudShareCharge += row.dotCloudShareCharge;
      acc.companyShareCharge += row.companyShareCharge;
      return acc;
    },
    {
      approvedHours: 0,
      monthlyCharge: 0,
      dotCloudShareCharge: 0,
      companyShareCharge: 0,
    },
  );

  return {
    settings,
    rows,
    totals: {
      approvedHours: Number(totals.approvedHours.toFixed(2)),
      monthlyCharge: Number(totals.monthlyCharge.toFixed(2)),
      dotCloudShareCharge: Number(totals.dotCloudShareCharge.toFixed(2)),
      companyShareCharge: Number(totals.companyShareCharge.toFixed(2)),
      currency: settings.currency,
      splitPercent: settings.revenueSplitPercent,
    },
  };
}

export async function calculateMonthToDateProjection(
  companyId: string,
  tenantId: string,
) {
  const range = getMonthRangeSast(new Date());
  const settings = await ensureCompanySettings(companyId, tenantId);

  const timesheets = await prisma.timesheet.findMany({
    where: {
      tenantId,
      status: {
        in: ["DRAFT", "SUBMITTED", "APPROVED", "INVOICED"],
      },
      periodStartDate: {
        gte: range.start,
        lt: range.end,
      },
      application: {
        job: {
          companyId,
        },
      },
    },
    select: {
      status: true,
      hoursWorked: true,
      ratePerHour: true,
      engineerRatePerHour: true,
      application: {
        select: {
          agreedHourlyRate: true,
          placementBillingModel: true,
          placementFeePercent: true,
          annualCtc: true,
          contractValue: true,
        },
      },
    },
  });

  function chargeForTimesheet(timesheet: (typeof timesheets)[number]) {
    const model = timesheet.application.placementBillingModel;
    if (model === "ONCE_OFF_PLACEMENT_FEE") {
      return (
        (timesheet.application.contractValue ?? 0) *
        ((timesheet.application.placementFeePercent ?? 0) / 100)
      );
    }
    if (model === "PERMANENT_PLACEMENT_FEE") {
      return (
        (timesheet.application.annualCtc ?? 0) *
        ((timesheet.application.placementFeePercent ?? 0) / 100)
      );
    }
    return (
      ((timesheet.application.agreedHourlyRate ?? timesheet.ratePerHour) -
        timesheet.engineerRatePerHour) *
      timesheet.hoursWorked
    );
  }

  const projected = timesheets.reduce(
    (sum: number, timesheet: (typeof timesheets)[number]) =>
      sum + chargeForTimesheet(timesheet),
    0,
  );

  const approved = timesheets
    .filter(
      (timesheet: (typeof timesheets)[number]) =>
        timesheet.status === "APPROVED",
    )
    .reduce(
      (sum: number, timesheet: (typeof timesheets)[number]) =>
        sum + chargeForTimesheet(timesheet),
      0,
    );

  return {
    monthLabel: range.label,
    projectedCharge: Number(projected.toFixed(2)),
    approvedCharge: Number(approved.toFixed(2)),
    dotCloudShareProjected: Number(
      (projected * (settings.revenueSplitPercent / 100)).toFixed(2),
    ),
    companyShareProjected: Number(
      (projected * ((100 - settings.revenueSplitPercent) / 100)).toFixed(2),
    ),
    splitPercent: settings.revenueSplitPercent,
    currency: settings.currency,
  };
}

export async function generateMonthlyReportForCompany(params: {
  companyId: string;
  tenantId: string;
  actor?: string;
  date?: Date;
}) {
  const runDate = params.date ?? new Date();
  const range = getMonthRangeSast(runDate);

  const company = await prisma.company.findFirst({
    where: {
      id: params.companyId,
      tenantId: params.tenantId,
    },
  });

  if (!company) {
    throw new Error("Company not found");
  }

  const chargeSummary = await calculateCompanyCharges({
    companyId: params.companyId,
    tenantId: params.tenantId,
    rangeStart: range.start,
    rangeEnd: range.end,
  });

  const recipients = parseRecipientsCsv(
    chargeSummary.settings.reportRecipientsCsv,
  );
  const fileName = `finance-report-${company.name.replace(/\s+/g, "-").toLowerCase()}-${range.label}.csv`;
  const csvContent = buildCsv(chargeSummary.rows);

  const report = await prisma.monthlyFinanceReport.create({
    data: {
      companyId: params.companyId,
      periodStart: range.start,
      periodEnd: range.end,
      fileName,
      csvContent,
      recipientsCsv: recipients.join(", "),
      totalApprovedHours: chargeSummary.totals.approvedHours,
      totalCharge: chargeSummary.totals.monthlyCharge,
      currency: chargeSummary.settings.currency,
      emailStatus: "PENDING",
    },
  });

  const emailSubject = `${chargeSummary.settings.brandName ?? company.name} monthly finance report (${range.label})`;
  const mailResult = await sendMail({
    to: recipients,
    subject: emailSubject,
    text:
      `Monthly finance CSV report for ${company.name} (${range.label}).\n` +
      `Approved hours: ${chargeSummary.totals.approvedHours.toFixed(2)}\n` +
      `Total charge: ${chargeSummary.totals.monthlyCharge.toFixed(2)} ${chargeSummary.settings.currency}`,
    attachments: [
      {
        filename: fileName,
        content: csvContent,
        contentType: "text/csv",
      },
    ],
  });

  const updatedReport = await prisma.monthlyFinanceReport.update({
    where: { id: report.id },
    data: {
      emailStatus: mailResult.sent ? "SENT" : "FAILED",
      emailedAt: mailResult.sent ? new Date() : null,
      emailError: mailResult.sent ? null : (mailResult.message ?? null),
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: params.tenantId,
      actor: params.actor ?? "scheduler",
      entityType: "monthly_finance_report",
      entityId: updatedReport.id,
      action: "generated",
      afterJson: {
        companyId: params.companyId,
        periodStart: range.start.toISOString(),
        periodEnd: range.end.toISOString(),
        totalCharge: chargeSummary.totals.monthlyCharge,
        emailStatus: updatedReport.emailStatus,
      },
    },
  });

  return updatedReport;
}

export async function generateMonthlyReportsForAllCompanies(
  tenantId: string | undefined,
  actor = "scheduler",
) {
  const companies = await prisma.company.findMany({
    where: tenantId ? { tenantId } : undefined,
    select: { id: true, tenantId: true },
  });

  const reports = [];
  for (const company of companies) {
    const report = await generateMonthlyReportForCompany({
      companyId: company.id,
      tenantId: company.tenantId,
      actor,
    });
    reports.push(report);
  }

  return reports;
}

export function getDefaultRecipient() {
  return DEFAULT_RECIPIENT;
}

export function normaliseRecipients(input: string[]): string[] {
  return parseRecipientsCsv(input.join(","));
}
