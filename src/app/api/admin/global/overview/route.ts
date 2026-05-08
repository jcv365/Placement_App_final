import { requireSuperAdminFromRequest } from "@/lib/adminAuth";
import { jsonError, jsonOk } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type CompanyInvoiceSummary = {
  companyId: string;
  pendingInvoiceCount: number;
  pendingInvoiceAmount: number;
  currency: "ZAR";
};

type CompanyBillingSettings = {
  billingModel: "PER_HOUR_PER_CANDIDATE" | "PERCENTAGE";
  billingRatePerHour: number;
  revenueSplitPercent: number;
};

type PlacedWithoutSubmittedTimesheet = {
  applicationId: string;
  candidateName: string;
  roleTitle: string;
  outstandingMonths: string[];
  outstandingMonthCount: number;
};

type CompanyPaymentSummary = {
  expectedAmount: number;
  invoicedAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  paidAsPerAgreement: boolean;
  paymentCoveragePercent: number;
};

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

function toInvoiceAmount(
  timesheet: {
    hoursWorked: number;
    ratePerHour: number;
    engineerRatePerHour: number;
    application: { agreedHourlyRate: number | null };
  },
  settings: CompanyBillingSettings,
): number {
  if (settings.billingModel === "PER_HOUR_PER_CANDIDATE") {
    const hourlyRate =
      settings.billingRatePerHour > 0
        ? settings.billingRatePerHour
        : (timesheet.application.agreedHourlyRate ?? timesheet.ratePerHour);
    return hourlyRate * timesheet.hoursWorked;
  }

  const contractRate =
    timesheet.application.agreedHourlyRate ?? timesheet.ratePerHour;
  const margin = contractRate - timesheet.engineerRatePerHour;
  return margin * timesheet.hoursWorked * (settings.revenueSplitPercent / 100);
}

export async function GET(request: Request) {
  try {
    requireSuperAdminFromRequest(request);

    const [
      tenants,
      companies,
      tenantAdmins,
      approvedTimesheets,
      allTimesheets,
      placedApps,
      signedContractApps,
    ] = await Promise.all([
      prisma.tenant.findMany({
        orderBy: { createdAt: "asc" },
        select: {
          tenantId: true,
          displayName: true,
          createdAt: true,
        },
      }),
      prisma.company.findMany({
        orderBy: [{ tenantId: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          tenantId: true,
          name: true,
          createdAt: true,
          settings: {
            select: {
              billingModel: true,
              billingRatePerHour: true,
              revenueSplitPercent: true,
            },
          },
        },
      }),
      prisma.tenantUser.findMany({
        where: {
          role: "ADMIN",
          isActive: true,
        },
        orderBy: [{ tenantId: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          tenantId: true,
          fullName: true,
          email: true,
          createdAt: true,
        },
      }),
      prisma.timesheet.findMany({
        where: {
          status: "APPROVED",
        },
        select: {
          id: true,
          hoursWorked: true,
          ratePerHour: true,
          engineerRatePerHour: true,
          application: {
            select: {
              agreedHourlyRate: true,
              job: {
                select: {
                  companyId: true,
                },
              },
            },
          },
        },
      }),
      prisma.timesheet.findMany({
        where: {
          periodStartDate: {
            gte: new Date(Date.now() - 730 * 24 * 60 * 60 * 1000),
          },
        },
        select: {
          status: true,
          hoursWorked: true,
          ratePerHour: true,
          engineerRatePerHour: true,
          periodStartDate: true,
          application: {
            select: {
              agreedHourlyRate: true,
              job: {
                select: {
                  companyId: true,
                },
              },
            },
          },
          invoice: {
            select: {
              amount: true,
              status: true,
            },
          },
        },
      }),
      prisma.application.findMany({
        where: {
          currentStage: "PLACED",
        },
        select: {
          id: true,
          candidate: {
            select: {
              fullName: true,
            },
          },
          placedAt: true,
          createdAt: true,
          job: {
            select: {
              title: true,
              companyId: true,
            },
          },
          timesheets: {
            select: {
              status: true,
              periodStartDate: true,
            },
          },
        },
      }),
      prisma.application.findMany({
        where: {
          signedContractUploadedAt: {
            not: null,
          },
        },
        select: {
          tenantId: true,
          signedContractUploadedAt: true,
          job: {
            select: {
              companyId: true,
            },
          },
        },
      }),
    ]);

    const billingByCompany = new Map<string, CompanyBillingSettings>();

    for (const company of companies) {
      billingByCompany.set(company.id, {
        billingModel: company.settings?.billingModel ?? "PERCENTAGE",
        billingRatePerHour: company.settings?.billingRatePerHour ?? 0,
        revenueSplitPercent: company.settings?.revenueSplitPercent ?? 50,
      });
    }

    const invoiceByCompany = new Map<string, CompanyInvoiceSummary>();

    for (const timesheet of approvedTimesheets) {
      const companyId = timesheet.application.job.companyId;
      if (!companyId) {
        continue;
      }

      const existing = invoiceByCompany.get(companyId) ?? {
        companyId,
        pendingInvoiceCount: 0,
        pendingInvoiceAmount: 0,
        currency: "ZAR" as const,
      };

      const billing = billingByCompany.get(companyId) ?? {
        billingModel: "PERCENTAGE" as const,
        billingRatePerHour: 0,
        revenueSplitPercent: 50,
      };

      existing.pendingInvoiceCount += 1;
      existing.pendingInvoiceAmount += toInvoiceAmount(timesheet, billing);
      invoiceByCompany.set(companyId, existing);
    }

    const placedNoTimesheetByCompany = new Map<
      string,
      PlacedWithoutSubmittedTimesheet[]
    >();

    const paymentByCompany = new Map<string, CompanyPaymentSummary>();

    for (const timesheet of allTimesheets) {
      const companyId = timesheet.application.job.companyId;
      if (!companyId) {
        continue;
      }

      const billing = billingByCompany.get(companyId) ?? {
        billingModel: "PERCENTAGE" as const,
        billingRatePerHour: 0,
        revenueSplitPercent: 50,
      };

      const summary = paymentByCompany.get(companyId) ?? {
        expectedAmount: 0,
        invoicedAmount: 0,
        paidAmount: 0,
        outstandingAmount: 0,
        paidAsPerAgreement: true,
        paymentCoveragePercent: 100,
      };

      if (["APPROVED", "INVOICED"].includes(timesheet.status)) {
        summary.expectedAmount += toInvoiceAmount(timesheet, billing);
      }

      if (timesheet.invoice && timesheet.invoice.status !== "VOIDED") {
        summary.invoicedAmount += timesheet.invoice.amount;
      }

      if (timesheet.invoice?.status === "PAID") {
        summary.paidAmount += timesheet.invoice.amount;
      }

      paymentByCompany.set(companyId, summary);
    }

    for (const [companyId, summary] of paymentByCompany.entries()) {
      summary.outstandingAmount = Math.max(
        0,
        summary.expectedAmount - summary.paidAmount,
      );
      summary.paidAsPerAgreement = summary.outstandingAmount <= 0.01;
      summary.paymentCoveragePercent =
        summary.expectedAmount > 0
          ? Math.min(100, (summary.paidAmount / summary.expectedAmount) * 100)
          : 100;
      paymentByCompany.set(companyId, summary);
    }

    for (const application of placedApps) {
      const companyId = application.job.companyId;
      if (!companyId) {
        continue;
      }

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
      const allMonths = monthRangeInclusive(startMonth, new Date());
      const outstandingMonths = allMonths.filter(
        (month) => !submittedMonths.has(month),
      );

      if (outstandingMonths.length === 0) {
        continue;
      }

      const list = placedNoTimesheetByCompany.get(companyId) ?? [];
      list.push({
        applicationId: application.id,
        candidateName: application.candidate.fullName,
        roleTitle: application.job.title,
        outstandingMonths,
        outstandingMonthCount: outstandingMonths.length,
      });
      placedNoTimesheetByCompany.set(companyId, list);
    }

    const adminsByTenant = new Map<
      string,
      Array<{
        id: string;
        fullName: string;
        email: string;
        createdAt: Date;
      }>
    >();

    for (const admin of tenantAdmins) {
      const list = adminsByTenant.get(admin.tenantId) ?? [];
      list.push({
        id: admin.id,
        fullName: admin.fullName,
        email: admin.email,
        createdAt: admin.createdAt,
      });
      adminsByTenant.set(admin.tenantId, list);
    }

    const companiesByTenant = new Map<
      string,
      Array<{
        id: string;
        name: string;
        createdAt: Date;
        billing: CompanyBillingSettings;
        invoice: CompanyInvoiceSummary;
        payment: CompanyPaymentSummary;
        isAgreementCompany: boolean;
        signedAgreementCount: number;
        placedWithoutSubmittedTimesheets: PlacedWithoutSubmittedTimesheet[];
      }>
    >();

    const signedAgreementsByCompany = new Map<string, number>();
    const latestAgreementCompanyByTenant = new Map<
      string,
      { companyId: string; signedAt: Date }
    >();

    for (const application of signedContractApps) {
      const companyId = application.job.companyId;
      const signedAt = application.signedContractUploadedAt;
      if (!companyId) {
        continue;
      }

      if (!signedAt) {
        continue;
      }

      const current = signedAgreementsByCompany.get(companyId) ?? 0;
      signedAgreementsByCompany.set(companyId, current + 1);

      const existing = latestAgreementCompanyByTenant.get(application.tenantId);
      if (!existing || signedAt.getTime() > existing.signedAt.getTime()) {
        latestAgreementCompanyByTenant.set(application.tenantId, {
          companyId,
          signedAt,
        });
      }
    }

    for (const company of companies) {
      const list = companiesByTenant.get(company.tenantId) ?? [];
      list.push({
        id: company.id,
        name: company.name,
        createdAt: company.createdAt,
        billing: billingByCompany.get(company.id) ?? {
          billingModel: "PERCENTAGE",
          billingRatePerHour: 0,
          revenueSplitPercent: 50,
        },
        invoice: invoiceByCompany.get(company.id) ?? {
          companyId: company.id,
          pendingInvoiceCount: 0,
          pendingInvoiceAmount: 0,
          currency: "ZAR",
        },
        payment: paymentByCompany.get(company.id) ?? {
          expectedAmount: 0,
          invoicedAmount: 0,
          paidAmount: 0,
          outstandingAmount: 0,
          paidAsPerAgreement: true,
          paymentCoveragePercent: 100,
        },
        isAgreementCompany:
          latestAgreementCompanyByTenant.get(company.tenantId)?.companyId ===
          company.id,
        signedAgreementCount: signedAgreementsByCompany.get(company.id) ?? 0,
        placedWithoutSubmittedTimesheets:
          placedNoTimesheetByCompany.get(company.id) ?? [],
      });
      companiesByTenant.set(company.tenantId, list);
    }

    const result = tenants.map((tenant) => {
      const tenantCompanies = companiesByTenant.get(tenant.tenantId) ?? [];
      const tenantAdminsList = adminsByTenant.get(tenant.tenantId) ?? [];
      const pendingInvoiceAmount = tenantCompanies.reduce(
        (sum, company) => sum + company.invoice.pendingInvoiceAmount,
        0,
      );
      const pendingInvoiceCount = tenantCompanies.reduce(
        (sum, company) => sum + company.invoice.pendingInvoiceCount,
        0,
      );
      const placedWithoutSubmittedTimesheetCount = tenantCompanies.reduce(
        (sum, company) => sum + company.placedWithoutSubmittedTimesheets.length,
        0,
      );

      return {
        tenantId: tenant.tenantId,
        tenantDisplayName: tenant.displayName,
        createdAt: tenant.createdAt,
        pendingInvoiceAmount: Number(pendingInvoiceAmount.toFixed(2)),
        pendingInvoiceCount,
        placedWithoutSubmittedTimesheetCount,
        admins: tenantAdminsList,
        companies: tenantCompanies.map((company) => ({
          id: company.id,
          name: company.name,
          createdAt: company.createdAt,
          billingModel: company.billing.billingModel,
          billingRatePerHour: company.billing.billingRatePerHour,
          revenueSplitPercent: company.billing.revenueSplitPercent,
          pendingInvoiceCount: company.invoice.pendingInvoiceCount,
          pendingInvoiceAmount: Number(
            company.invoice.pendingInvoiceAmount.toFixed(2),
          ),
          expectedAmount: Number(company.payment.expectedAmount.toFixed(2)),
          invoicedAmount: Number(company.payment.invoicedAmount.toFixed(2)),
          paidAmount: Number(company.payment.paidAmount.toFixed(2)),
          outstandingAmount: Number(
            company.payment.outstandingAmount.toFixed(2),
          ),
          paidAsPerAgreement: company.payment.paidAsPerAgreement,
          paymentCoveragePercent: Number(
            company.payment.paymentCoveragePercent.toFixed(2),
          ),
          isAgreementCompany: company.isAgreementCompany,
          signedAgreementCount: company.signedAgreementCount,
          currency: company.invoice.currency,
          placedWithoutSubmittedTimesheets:
            company.placedWithoutSubmittedTimesheets,
        })),
      };
    });

    return jsonOk({
      tenants: result,
    });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "UNAUTHORISED_ADMIN") {
      return jsonError("Admin sign-in is required", 401);
    }

    if (message === "FORBIDDEN_SUPER_ADMIN") {
      return jsonError("Super admin access is required", 403);
    }

    return jsonError("Unable to load global admin overview", 400);
  }
}
