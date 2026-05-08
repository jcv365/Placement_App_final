import { requireAdminFromRequest } from "@/lib/adminAuth";
import { jsonError, jsonOk } from "@/lib/apiResponses";

export const runtime = "nodejs";

/** Whether a variable is set (non-empty) — never exposes the actual value. */
function isSet(name: string): boolean {
  const value = process.env[name]?.trim();
  return Boolean(value);
}

/**
 * Returns the set/unset status of every environment variable the instance
 * automations depend on, grouped by automation feature.  Values are never
 * leaked — only a boolean flag is returned for each variable.
 *
 * Accessible by any admin (not super-admin only).
 */
export async function GET(request: Request) {
  try {
    requireAdminFromRequest(request);
  } catch {
    return jsonError("Authentication required", 401);
  }

  return jsonOk({
    groups: [
      /* ── Email sending (Microsoft Graph) ─────────────────────────── */
      {
        label: "Email sending (Microsoft Graph)",
        description:
          "Required for all automated emails — role confirmations, NDA/teaming, drafts and scheduled reminders.",
        vars: [
          {
            key: "GRAPH_TENANT_ID",
            set: isSet("GRAPH_TENANT_ID"),
            hint: "Azure AD tenant ID for the Graph API app registration.",
          },
          {
            key: "GRAPH_CLIENT_ID",
            set: isSet("GRAPH_CLIENT_ID"),
            hint: "Application (client) ID of the Graph API app registration.",
          },
          {
            key: "GRAPH_CLIENT_SECRET",
            set: isSet("GRAPH_CLIENT_SECRET"),
            hint: "Client secret for the Graph API app registration.",
          },
          {
            key: "GRAPH_SENDER_USER",
            set: isSet("GRAPH_SENDER_USER"),
            hint: "Primary sender mailbox (e.g. placements@dotcloud.africa). Used as the From address for all outgoing emails.",
          },
          {
            key: "SENDER_DISPLAY_NAME",
            set: isSet("SENDER_DISPLAY_NAME"),
            hint: "Display name shown in the From field of outgoing emails (e.g. DotCloud Consulting).",
          },
          {
            key: "OUTLOOK_SHARED_MAILBOX",
            set: isSet("OUTLOOK_SHARED_MAILBOX"),
            hint: "Optional shared mailbox override. If set, drafts and sends use this mailbox instead of the sender user.",
            optional: true,
          },
        ],
      },

      /* ── AI / LLM gateway ────────────────────────────────────────── */
      {
        label: "AI / LLM gateway",
        description:
          "Powers CV formatting, email generation, candidate-to-role matching and metadata extraction.",
        vars: [
          {
            key: "LITELLM_API_BASE",
            set: isSet("LITELLM_API_BASE") || isSet("OPENAI_API_BASE"),
            hint: "Base URL for the LLM API gateway. Also accepts OPENAI_API_BASE as a fallback.",
          },
          {
            key: "LITELLM_API_KEY",
            set: isSet("LITELLM_API_KEY") || isSet("OPENAI_API_KEY"),
            hint: "API key for the LLM gateway. Also accepts OPENAI_API_KEY as a fallback.",
          },
          {
            key: "LITELLM_MODEL",
            set:
              isSet("LITELLM_MODEL") ||
              isSet("OPENAI_MODEL") ||
              isSet("AZURE_OPENAI_DEPLOYMENT"),
            hint: "Model name or Azure deployment to use. Falls back to OPENAI_MODEL / AZURE_OPENAI_DEPLOYMENT.",
            optional: true,
          },
          {
            key: "AI_REQUEST_TIMEOUT_MS",
            set: isSet("AI_REQUEST_TIMEOUT_MS"),
            hint: "Timeout in milliseconds for AI requests. Defaults to 60 000 ms if unset.",
            optional: true,
          },
          {
            key: "EMAIL_GENERATION_DISABLED",
            set: isSet("EMAIL_GENERATION_DISABLED"),
            hint: "Set to 'true' to disable AI email generation globally. Useful during maintenance.",
            optional: true,
          },
        ],
      },

      /* ── CV upload & formatting ──────────────────────────────────── */
      {
        label: "CV upload & formatting",
        description:
          "Handles CV file storage and AI-powered reformatting when a candidate uploads their CV.",
        vars: [
          {
            key: "DATA_MOUNT_ROOT",
            set: isSet("DATA_MOUNT_ROOT"),
            hint: "Root path where the project data volume is mounted inside the container (e.g. /app/data). CVs are stored here.",
          },
        ],
      },

      /* ── Branding & company identity ─────────────────────────────── */
      {
        label: "Branding & company identity",
        description:
          "Company name and branding used across email templates, reports and candidate-facing communications.",
        vars: [
          {
            key: "PLATFORM_PARTNER_NAME",
            set: isSet("PLATFORM_PARTNER_NAME"),
            hint: "Company name used in email subject lines, templates and branding (e.g. DotCloud Consulting).",
          },
          {
            key: "DEFAULT_C2C_PARTNER_NAME",
            set: isSet("DEFAULT_C2C_PARTNER_NAME"),
            hint: "Default partner company name used in corp-to-corp email templates.",
            optional: true,
          },
          {
            key: "DEFAULT_ACCOUNTS_EMAIL",
            set: isSet("DEFAULT_ACCOUNTS_EMAIL"),
            hint: "Accounts/finance e-mail address included in invoicing and payment communications.",
            optional: true,
          },
        ],
      },

      /* ── Candidate onboarding documents ──────────────────────────── */
      {
        label: "Candidate onboarding documents",
        description:
          "NDA and Teaming Agreement PDFs attached to candidate welcome emails. Files must exist in the data/Documents/ folder.",
        vars: [
          {
            key: "NDA_DOCUMENT_FILENAME",
            set: isSet("NDA_DOCUMENT_FILENAME"),
            hint: "Filename of the NDA PDF in data/Documents/ (e.g. DotCloud_NDA_RevB_FULL_SA_Courts.pdf).",
          },
          {
            key: "TEAMING_DOCUMENT_FILENAME",
            set: isSet("TEAMING_DOCUMENT_FILENAME"),
            hint: "Filename of the Teaming Agreement PDF in data/Documents/.",
          },
        ],
      },

      /* ── DocuSign e-signatures ───────────────────────────────────── */
      {
        label: "DocuSign e-signatures",
        description:
          "Enables electronic document signing via the DocuSign API. Only required if e-signatures are in use.",
        vars: [
          {
            key: "DOCUSIGN_ACCOUNT_ID",
            set: isSet("DOCUSIGN_ACCOUNT_ID"),
            hint: "DocuSign account ID used for e-signature envelopes.",
            optional: true,
          },
          {
            key: "DOCUSIGN_BASE_URI",
            set: isSet("DOCUSIGN_BASE_URI"),
            hint: "DocuSign API base URI (e.g. https://demo.docusign.net/restapi).",
            optional: true,
          },
          {
            key: "DOCUSIGN_HMAC_SECRET",
            set: isSet("DOCUSIGN_HMAC_SECRET"),
            hint: "HMAC secret used to verify incoming DocuSign webhook callbacks.",
            optional: true,
          },
        ],
      },

      /* ── Scheduled automations ───────────────────────────────────── */
      {
        label: "Scheduled automations",
        description:
          "Toggle cron-based background jobs for finance reports and timesheet reminders.",
        vars: [
          {
            key: "ENABLE_FINANCE_SCHEDULER",
            set: isSet("ENABLE_FINANCE_SCHEDULER"),
            hint: "Set to 'true' to enable the monthly finance report scheduler. Defaults to 'true'.",
            optional: true,
          },
          {
            key: "ENABLE_TIMESHEET_REMINDER_SCHEDULER",
            set: isSet("ENABLE_TIMESHEET_REMINDER_SCHEDULER"),
            hint: "Set to 'true' to enable automated timesheet reminder emails. Defaults to 'true'.",
            optional: true,
          },
        ],
      },
    ],
  });
}
