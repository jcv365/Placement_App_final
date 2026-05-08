import { requireSuperAdminFromRequest } from "@/lib/adminAuth";
import { jsonError, jsonOk } from "@/lib/apiResponses";

export const runtime = "nodejs";

function isSet(name: string): boolean {
  const value = process.env[name]?.trim();
  return Boolean(value);
}

/**
 * Instance-level environment status — super-admin only.
 * Returns set/unset flags for deployment-specific variables.
 */
export async function GET(request: Request) {
  try {
    requireSuperAdminFromRequest(request);
  } catch {
    return jsonError("Super-admin access required", 403);
  }

  return jsonOk({
    groups: [
      {
        label: "Infrastructure",
        vars: [
          {
            key: "DATA_MOUNT_ROOT",
            set: isSet("DATA_MOUNT_ROOT"),
            hint: "Root path where the project data volume is mounted inside the container (e.g. /app/data).",
          },
          {
            key: "DATABASE_URL",
            set: isSet("DATABASE_URL"),
            hint: "Prisma database connection string (e.g. file:./prisma/prod.db).",
          },
          {
            key: "APP_BASE_URL",
            set: isSet("APP_BASE_URL"),
            hint: "Public base URL of the application, used for CORS, redirects and cookie domain.",
          },
          {
            key: "APP_SESSION_SECRET",
            set: isSet("APP_SESSION_SECRET"),
            hint: "Secret key used to sign tenant session tokens. Must be set in production.",
          },
          {
            key: "NODE_ENV",
            set: isSet("NODE_ENV"),
            hint: "Runtime environment — 'production' or 'development'.",
          },
          {
            key: "COOKIE_SECURE",
            set: isSet("COOKIE_SECURE"),
            hint: "Set to 'true' for HTTPS deployments to mark cookies as Secure.",
            optional: true,
          },
          {
            key: "COOKIE_SAMESITE",
            set: isSet("COOKIE_SAMESITE"),
            hint: "Cookie SameSite policy — 'lax', 'strict', or 'none'.",
            optional: true,
          },
          {
            key: "DEMO_MODE",
            set: isSet("DEMO_MODE"),
            hint: "Set to 'true' to enable demo/sandbox mode.",
            optional: true,
          },
        ],
      },
      {
        label: "Authentication",
        vars: [
          {
            key: "ADMIN_PASSWORD_HASH",
            set: isSet("ADMIN_PASSWORD_HASH"),
            hint: "Scrypt hash of the admin portal password.",
          },
          {
            key: "ADMIN_SESSION_SECRET",
            set: isSet("ADMIN_SESSION_SECRET"),
            hint: "Secret used to encrypt admin-level session data.",
            optional: true,
          },
          {
            key: "MASTER_TENANT_ID",
            set: isSet("MASTER_TENANT_ID"),
            hint: "Tenant ID that owns the platform (super-admin tenant).",
            optional: true,
          },
        ],
      },
    ],
  });
}
