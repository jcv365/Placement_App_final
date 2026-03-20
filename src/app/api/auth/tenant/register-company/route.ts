import { jsonError, jsonOk } from "@/lib/apiResponses";
import { hashPassword, normaliseTenantId } from "@/lib/appAuth";
import { sendMail } from "@/lib/mailer";
import { prisma } from "@/lib/prisma";
import { companyRegistrationSchema } from "@/lib/validation";
import crypto from "node:crypto";

export const runtime = "nodejs";

function resolveVerificationBaseUrl(request: Request): string {
  const configured = process.env.APP_BASE_URL?.trim();
  const fallback = new URL(request.url).origin;
  const source = configured && configured.length > 0 ? configured : fallback;

  try {
    const parsed = new URL(source);
    // Localhost can resolve to an unexpected listener (for example IPv6). Use IPv4 loopback for local links.
    if (parsed.hostname === "localhost" || parsed.hostname === "::1") {
      parsed.hostname = "127.0.0.1";
    }
    return parsed.origin;
  } catch {
    return fallback;
  }
}

function toTenantIdBase(displayName: string): string {
  const normalised = normaliseTenantId(displayName)
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!normalised) {
    return `tenant-${crypto.randomBytes(3).toString("hex")}`;
  }

  return normalised.slice(0, 55);
}

async function generateUniqueTenantId(displayName: string): Promise<string> {
  const base = toTenantIdBase(displayName);

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
    const availableLength = 63 - suffix.length;
    const candidate = `${base.slice(0, availableLength)}${suffix}`;

    const existingTenant = await prisma.tenant.findUnique({
      where: { tenantId: candidate },
      select: { id: true },
    });

    if (!existingTenant) {
      return candidate;
    }
  }

  return `tenant-${crypto.randomBytes(6).toString("hex")}`;
}

export async function POST(request: Request) {
  try {
    const body = companyRegistrationSchema.parse(await request.json());
    const tenantId = await generateUniqueTenantId(body.displayName);

    const passwordHash = await hashPassword(body.password);
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const verificationTokenHash = crypto
      .createHash("sha256")
      .update(verificationToken)
      .digest("hex");
    const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          tenantId,
          displayName: body.displayName,
        },
      });

      // Seed a default company profile tied to this tenant for admin finance/settings screens.
      await tx.company.create({
        data: {
          tenantId,
          name: body.displayName,
        },
      });

      const adminUser = await tx.tenantUser.create({
        data: {
          tenantId,
          fullName: body.adminName,
          email: body.adminEmail.toLowerCase(),
          passwordHash,
          role: "ADMIN",
          isActive: false,
          verifyTokenHash: verificationTokenHash,
          verifyTokenExpiry: verificationExpiry,
        },
      });

      return { tenant, adminUser };
    });

    const baseUrl = resolveVerificationBaseUrl(request);
    const verificationLink = `${baseUrl}/api/auth/tenant/verify-email?token=${verificationToken}`;

    const mailResult = await sendMail({
      to: [result.adminUser.email],
      subject: `Confirm your ${body.displayName} administrator account`,
      text:
        `Hello ${body.adminName},\n\n` +
        `Welcome to Contract Placements. Please confirm your email address to activate your company administrator account.\n\n` +
        `Open this verification link:\n<${verificationLink}>\n\n` +
        `If the link does not open directly, copy and paste it into your browser.\n\n` +
        `This link expires in 24 hours.`,
    });

    if (!mailResult.sent) {
      await prisma.$transaction(async (tx) => {
        await tx.tenantUser.deleteMany({ where: { tenantId } });
        await tx.company.deleteMany({ where: { tenantId } });
        await tx.tenant.deleteMany({ where: { tenantId } });
      });

      return jsonError("Unable to send verification email", 502, {
        message: mailResult.message,
        hint: "Try again shortly or contact support.",
      });
    }

    const response = jsonOk(
      {
        registered: true,
        tenantId,
        verificationSent: true,
        verificationRequired: true,
        user: {
          id: result.adminUser.id,
          fullName: result.adminUser.fullName,
          email: result.adminUser.email,
          role: result.adminUser.role,
        },
      },
      { status: 201 },
    );

    return response;
  } catch (error) {
    return jsonError("Unable to register company", 400, {
      message: (error as Error).message,
    });
  }
}
