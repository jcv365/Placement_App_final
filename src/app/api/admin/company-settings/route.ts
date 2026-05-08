import { requireAdminContextFromRequest } from "@/lib/adminAuth";
import { jsonError, jsonOk } from "@/lib/apiResponses";
import { DEFAULT_OUTLOOK_MAILBOX } from "@/lib/constants";
import {
  PARTNER_NAME,
  ensureCompanySettings,
  getDefaultRecipient,
  normaliseRecipients,
} from "@/lib/financeReports";
import { isGraphConnectionUsable } from "@/lib/graphConnectionStore";
import { prisma } from "@/lib/prisma";
import { companySettingsUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { tenantId } = requireAdminContextFromRequest(request);

    let companies = await prisma.company.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
      include: {
        settings: true,
      },
    });

    if (companies.length === 0) {
      const company = await prisma.company.create({
        data: {
          tenantId,
          name: "Default Company",
        },
      });
      await ensureCompanySettings(company.id, tenantId);
      companies = await prisma.company.findMany({
        where: { tenantId },
        orderBy: { createdAt: "asc" },
        include: {
          settings: true,
        },
      });
    }

    const data = await Promise.all(
      companies.map(async (company: (typeof companies)[number]) => {
        const settings =
          company.settings ??
          (await ensureCompanySettings(company.id, tenantId));
        return {
          companyId: company.id,
          companyName: company.name,
          revenueSplitPercent: settings.revenueSplitPercent,
          splitLabel: `${settings.revenueSplitPercent}/${100 - settings.revenueSplitPercent}`,
          splitParties: `${PARTNER_NAME} | ${company.name}`,
          billingModel: settings.billingModel,
          billingRatePerHour: settings.billingRatePerHour,
          brandName: settings.brandName,
          logoUrl: settings.logoUrl,
          reportRecipients: normaliseRecipients(
            settings.reportRecipientsCsv
              .split(",")
              .map((item: string) => item.trim())
              .filter(Boolean),
          ),
          outlookMailbox: settings.outlookMailbox || DEFAULT_OUTLOOK_MAILBOX,
          graphConnected: isGraphConnectionUsable({
            graphAccessTokenEncrypted: settings.graphAccessTokenEncrypted,
            graphTokenExpiresAt: settings.graphTokenExpiresAt,
          }),
          graphConnectedEmail: settings.graphConnectedEmail,
          graphTokenExpiresAt: settings.graphTokenExpiresAt,
          graphConnectedAt: settings.graphConnectedAt,
          currency: settings.currency,
        };
      }),
    );

    return jsonOk({
      companies: data,
      requiredRecipient: getDefaultRecipient(),
    });
  } catch (error) {
    if ((error as Error).message === "UNAUTHORISED_ADMIN") {
      return jsonError("Admin sign-in is required", 401);
    }

    return jsonError("Unable to load company settings", 400);
  }
}

export async function PATCH(request: Request) {
  try {
    const { username: actor, tenantId } =
      requireAdminContextFromRequest(request);
    const body = companySettingsUpdateSchema.parse(await request.json());

    const company = await prisma.company.findFirst({
      where: {
        id: body.companyId,
        tenantId,
      },
      include: { settings: true },
    });

    if (!company) {
      return jsonError("Company not found", 404);
    }

    const previous =
      company.settings ??
      (await ensureCompanySettings(body.companyId, tenantId));

    const recipients = normaliseRecipients(body.reportRecipients);
    const outlookMailbox =
      body.outlookMailbox?.trim().toLowerCase() || DEFAULT_OUTLOOK_MAILBOX;

    const settings = await prisma.companySettings.upsert({
      where: { companyId: body.companyId },
      create: {
        companyId: body.companyId,
        revenueSplitPercent:
          body.revenueSplitPercent ?? previous.revenueSplitPercent,
        billingModel: body.billingModel ?? previous.billingModel,
        billingRatePerHour:
          body.billingRatePerHour ?? previous.billingRatePerHour,
        brandName: body.brandName,
        logoUrl: previous.logoUrl,
        reportRecipientsCsv: recipients.join(", "),
        outlookMailbox,
        currency: body.currency ?? previous.currency ?? "ZAR",
      },
      update: {
        revenueSplitPercent:
          body.revenueSplitPercent ?? previous.revenueSplitPercent,
        billingModel: body.billingModel ?? previous.billingModel,
        billingRatePerHour:
          body.billingRatePerHour ?? previous.billingRatePerHour,
        brandName: body.brandName,
        reportRecipientsCsv: recipients.join(", "),
        outlookMailbox,
        currency: body.currency ?? previous.currency ?? "ZAR",
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId,
        actor,
        entityType: "company_settings",
        entityId: settings.id,
        action: "updated",
        beforeJson: previous,
        afterJson: settings,
      },
    });

    return jsonOk({
      companyId: body.companyId,
      revenueSplitPercent: settings.revenueSplitPercent,
      splitLabel: `${settings.revenueSplitPercent}/${100 - settings.revenueSplitPercent}`,
      splitParties: `${PARTNER_NAME} | ${company.name}`,
      billingModel: settings.billingModel,
      billingRatePerHour: settings.billingRatePerHour,
      brandName: settings.brandName,
      logoUrl: settings.logoUrl,
      reportRecipients: recipients,
      outlookMailbox: settings.outlookMailbox || DEFAULT_OUTLOOK_MAILBOX,
      graphConnected: isGraphConnectionUsable({
        graphAccessTokenEncrypted: settings.graphAccessTokenEncrypted,
        graphTokenExpiresAt: settings.graphTokenExpiresAt,
      }),
      graphConnectedEmail: settings.graphConnectedEmail,
      graphTokenExpiresAt: settings.graphTokenExpiresAt,
      graphConnectedAt: settings.graphConnectedAt,
      currency: settings.currency,
    });
  } catch (error) {
    if ((error as Error).message === "UNAUTHORISED_ADMIN") {
      return jsonError("Admin sign-in is required", 401);
    }

    return jsonError("Unable to update company settings", 400);
  }
}
