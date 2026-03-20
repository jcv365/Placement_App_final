import { requireAdminContextFromRequest } from "@/lib/adminAuth";
import { jsonError, jsonOk } from "@/lib/apiResponses";
import {
    encryptGraphAccessToken,
    isGraphConnectionUsable,
} from "@/lib/graphConnectionStore";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const runtime = "nodejs";

const connectSchema = z.object({
  companyId: z.string().min(1),
  accessToken: z.string().min(10),
  connectedEmail: z.string().trim().email().optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
});

const disconnectSchema = z.object({
  companyId: z.string().min(1),
});

function getConnectionSummary(settings: {
  graphAccessTokenEncrypted?: string | null;
  graphConnectedEmail?: string | null;
  graphTokenExpiresAt?: Date | null;
  graphConnectedAt?: Date | null;
}) {
  return {
    graphConnected: isGraphConnectionUsable(settings),
    graphConnectedEmail: settings.graphConnectedEmail ?? null,
    graphTokenExpiresAt: settings.graphTokenExpiresAt ?? null,
    graphConnectedAt: settings.graphConnectedAt ?? null,
  };
}

export async function POST(request: Request) {
  try {
    const { tenantId, username } = requireAdminContextFromRequest(request);
    const body = connectSchema.parse(await request.json());

    const company = await prisma.company.findFirst({
      where: { id: body.companyId, tenantId },
      select: { id: true },
    });

    if (!company) {
      return jsonError("Company not found", 404);
    }

    const tokenExpiresAt = body.expiresAt ? new Date(body.expiresAt) : null;

    const settings = await prisma.companySettings.upsert({
      where: { companyId: body.companyId },
      create: {
        companyId: body.companyId,
        graphAccessTokenEncrypted: encryptGraphAccessToken(body.accessToken),
        graphConnectedEmail: body.connectedEmail?.trim().toLowerCase() || null,
        graphTokenExpiresAt: tokenExpiresAt,
        graphConnectedAt: new Date(),
      },
      update: {
        graphAccessTokenEncrypted: encryptGraphAccessToken(body.accessToken),
        graphConnectedEmail: body.connectedEmail?.trim().toLowerCase() || null,
        graphTokenExpiresAt: tokenExpiresAt,
        graphConnectedAt: new Date(),
      },
      select: {
        id: true,
        graphAccessTokenEncrypted: true,
        graphConnectedEmail: true,
        graphTokenExpiresAt: true,
        graphConnectedAt: true,
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId,
        actor: username,
        entityType: "company_graph_connection",
        entityId: settings.id,
        action: "connected",
        afterJson: {
          companyId: body.companyId,
          graphConnectedEmail: settings.graphConnectedEmail,
          graphTokenExpiresAt: settings.graphTokenExpiresAt,
          graphConnectedAt: settings.graphConnectedAt,
        },
      },
    });

    return jsonOk(getConnectionSummary(settings));
  } catch (error) {
    if ((error as Error).message === "UNAUTHORISED_ADMIN") {
      return jsonError("Admin sign-in is required", 401);
    }

    return jsonError("Unable to connect company Graph account", 400, {
      message: (error as Error).message,
    });
  }
}

export async function DELETE(request: Request) {
  try {
    const { tenantId, username } = requireAdminContextFromRequest(request);
    const body = disconnectSchema.parse(await request.json());

    const company = await prisma.company.findFirst({
      where: { id: body.companyId, tenantId },
      include: { settings: true },
    });

    if (!company) {
      return jsonError("Company not found", 404);
    }

    const settings =
      company.settings ??
      (await prisma.companySettings.create({
        data: { companyId: body.companyId },
      }));

    await prisma.companySettings.update({
      where: { companyId: body.companyId },
      data: {
        graphAccessTokenEncrypted: null,
        graphConnectedEmail: null,
        graphTokenExpiresAt: null,
        graphConnectedAt: null,
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId,
        actor: username,
        entityType: "company_graph_connection",
        entityId: settings.id,
        action: "disconnected",
        beforeJson: {
          companyId: body.companyId,
          graphConnectedEmail: settings.graphConnectedEmail,
          graphTokenExpiresAt: settings.graphTokenExpiresAt,
          graphConnectedAt: settings.graphConnectedAt,
        },
      },
    });

    return jsonOk({ graphConnected: false });
  } catch (error) {
    if ((error as Error).message === "UNAUTHORISED_ADMIN") {
      return jsonError("Admin sign-in is required", 401);
    }

    return jsonError("Unable to disconnect company Graph account", 400, {
      message: (error as Error).message,
    });
  }
}
