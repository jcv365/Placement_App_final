import { jsonError, jsonOk } from "@/lib/apiResponses";
import { prisma } from "@/lib/prisma";
import { resolveTenantIdFromRequest } from "@/lib/tenant";
import { z } from "zod";

export const runtime = "nodejs";

const resourceTypeSchema = z.enum([
  "job",
  "vacancy",
  "candidate",
  "clientAccount",
  "clientContact",
  "application",
  "placementAlert",
  "timesheet",
  "ruleSet",
]);

const createDeletionRequestSchema = z.object({
  resourceType: resourceTypeSchema,
  resourceId: z.string().min(1),
  reason: z.string().trim().max(500).optional(),
});

type ResourceType = z.infer<typeof resourceTypeSchema>;

const listDeletionRequestsSchema = z.object({
  resourceType: resourceTypeSchema.optional(),
  resourceId: z.string().min(1).optional(),
});

function getResourceTypeFromAudit(
  beforeJson: unknown,
): ResourceType | undefined {
  if (!beforeJson || typeof beforeJson !== "object") {
    return undefined;
  }

  const candidate = (beforeJson as Record<string, unknown>).resourceType;
  const parsed = resourceTypeSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

async function resourceExists(
  tenantId: string,
  resourceType: ResourceType,
  resourceId: string,
) {
  if (resourceType === "job") {
    return prisma.job.findFirst({
      where: { id: resourceId, tenantId },
      select: { id: true },
    });
  }

  if (resourceType === "vacancy") {
    return prisma.vacancy.findFirst({
      where: { id: resourceId, tenantId },
      select: { id: true },
    });
  }

  if (resourceType === "candidate") {
    return prisma.candidate.findFirst({
      where: { id: resourceId, tenantId },
      select: { id: true },
    });
  }

  if (resourceType === "clientAccount") {
    return prisma.clientAccount.findFirst({
      where: { id: resourceId, tenantId },
      select: { id: true },
    });
  }

  if (resourceType === "clientContact") {
    return prisma.clientContact.findFirst({
      where: { id: resourceId, tenantId },
      select: { id: true },
    });
  }

  if (resourceType === "application") {
    return prisma.application.findFirst({
      where: { id: resourceId, tenantId },
      select: { id: true },
    });
  }

  if (resourceType === "placementAlert") {
    return prisma.placementAlert.findFirst({
      where: { id: resourceId, tenantId },
      select: { id: true },
    });
  }

  if (resourceType === "timesheet") {
    return prisma.timesheet.findFirst({
      where: { id: resourceId, tenantId },
      select: { id: true },
    });
  }

  return prisma.ruleSet.findFirst({
    where: { id: resourceId, tenantId },
    select: { id: true },
  });
}

export async function POST(request: Request) {
  try {
    const tenantId = resolveTenantIdFromRequest(request);
    const body = createDeletionRequestSchema.parse(await request.json());

    const existingResource = await resourceExists(
      tenantId,
      body.resourceType,
      body.resourceId,
    );

    if (!existingResource) {
      return jsonError("Resource not found", 404);
    }

    const existingPending = await prisma.auditLog.findFirst({
      where: {
        tenantId,
        entityType: "deletion_request",
        entityId: body.resourceId,
        action: "pending",
      },
      select: {
        id: true,
        beforeJson: true,
      },
    });

    const pendingType = getResourceTypeFromAudit(existingPending?.beforeJson);

    if (existingPending && pendingType === body.resourceType) {
      return jsonError(
        "A deletion request is already pending for this record",
        409,
      );
    }

    const created = await prisma.auditLog.create({
      data: {
        tenantId,
        actor: "user",
        entityType: "deletion_request",
        entityId: body.resourceId,
        action: "pending",
        beforeJson: {
          resourceType: body.resourceType,
          resourceId: body.resourceId,
          reason: body.reason?.trim() || null,
          status: "PENDING",
          requestedAt: new Date().toISOString(),
        },
      },
      select: {
        id: true,
        entityId: true,
        action: true,
        createdAt: true,
      },
    });

    return jsonOk(created, { status: 201 });
  } catch (error) {
    return jsonError("Unable to create deletion request", 400, {
      message: (error as Error).message,
    });
  }
}

export async function GET(request: Request) {
  try {
    const tenantId = resolveTenantIdFromRequest(request);
    const url = new URL(request.url);
    const query = listDeletionRequestsSchema.parse({
      resourceType: url.searchParams.get("resourceType") ?? undefined,
      resourceId: url.searchParams.get("resourceId") ?? undefined,
    });

    const pending = await prisma.auditLog.findMany({
      where: {
        tenantId,
        entityType: "deletion_request",
        action: "pending",
        ...(query.resourceId ? { entityId: query.resourceId } : {}),
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        entityId: true,
        action: true,
        createdAt: true,
        beforeJson: true,
      },
      take: 200,
    });

    const filtered = query.resourceType
      ? pending.filter(
          (item) =>
            getResourceTypeFromAudit(item.beforeJson) === query.resourceType,
        )
      : pending;

    return jsonOk(
      filtered.map((item) => ({
        id: item.id,
        entityId: item.entityId,
        action: item.action,
        createdAt: item.createdAt,
        resourceType: getResourceTypeFromAudit(item.beforeJson) ?? null,
      })),
    );
  } catch (error) {
    return jsonError("Unable to load deletion requests", 400, {
      message: (error as Error).message,
    });
  }
}
