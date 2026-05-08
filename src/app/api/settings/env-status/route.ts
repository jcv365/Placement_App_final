import { jsonError, jsonOk } from "@/lib/apiResponses";
import { requireTenantAdminFromRequest } from "@/lib/appAuth";

export const runtime = "nodejs";

/** Whether a variable is set (non-empty) — never exposes the actual value. */
function isSet(name: string): boolean {
  const value = process.env[name]?.trim();
  return Boolean(value);
}

/**
 * Returns the set/unset status of every environment variable the platform
 * depends on, grouped by feature area.  Values are never leaked — only a
 * boolean flag is returned for each variable.
 */
export async function GET(request: Request) {
  try {
    requireTenantAdminFromRequest(request);
  } catch {
    return jsonError("Authentication required", 401);
  }

  return jsonOk({
    groups: [
      {
        label: "Microsoft Graph (email)",
        vars: [
          {
            key: "GRAPH_TENANT_ID",
            set: isSet("GRAPH_TENANT_ID"),
            hint: "Azure AD tenant ID for Graph API authentication.",
          },
          {
            key: "GRAPH_CLIENT_ID",
            set: isSet("GRAPH_CLIENT_ID"),
            hint: "App registration client ID for Graph API.",
          },
          {
            key: "GRAPH_CLIENT_SECRET",
            set: isSet("GRAPH_CLIENT_SECRET"),
            hint: "Client secret for the Graph app registration.",
          },
          {
            key: "GRAPH_SENDER_USER",
            set: isSet("GRAPH_SENDER_USER"),
            hint: "Email address used as the From/sender mailbox (e.g. placements@dotcloud.africa).",
          },
        ],
      },
      {
        label: "Email & outlook",
        vars: [
          {
            key: "OUTLOOK_SHARED_MAILBOX",
            set: isSet("OUTLOOK_SHARED_MAILBOX"),
            hint: "Shared mailbox override. Falls back to GRAPH_SENDER_USER if unset.",
            optional: true,
          },
          {
            key: "SENDER_DISPLAY_NAME",
            set: isSet("SENDER_DISPLAY_NAME"),
            hint: "Display name shown in the From field of outgoing emails.",
          },
          {
            key: "EMAIL_GENERATION_DISABLED",
            set: isSet("EMAIL_GENERATION_DISABLED"),
            hint: "Set to 'true' to disable AI email generation globally.",
            optional: true,
          },
        ],
      },
      {
        label: "Branding & documents",
        vars: [
          {
            key: "PLATFORM_PARTNER_NAME",
            set: isSet("PLATFORM_PARTNER_NAME"),
            hint: "Company name used in email templates, reports and branding (e.g. DotCloud Consulting).",
          },
          {
            key: "NDA_DOCUMENT_FILENAME",
            set: isSet("NDA_DOCUMENT_FILENAME"),
            hint: "Filename of the NDA PDF in the data/Documents/ folder. Attached to candidate emails.",
          },
          {
            key: "TEAMING_DOCUMENT_FILENAME",
            set: isSet("TEAMING_DOCUMENT_FILENAME"),
            hint: "Filename of the Teaming Agreement PDF in data/Documents/. Attached to candidate emails.",
          },
          {
            key: "DEFAULT_C2C_PARTNER_NAME",
            set: isSet("DEFAULT_C2C_PARTNER_NAME"),
            hint: "Partner company name used in C2C email templates.",
            optional: true,
          },
          {
            key: "DEFAULT_ACCOUNTS_EMAIL",
            set: isSet("DEFAULT_ACCOUNTS_EMAIL"),
            hint: "Accounts/finance recipient email for payment and invoice queries.",
            optional: true,
          },
        ],
      },
      {
        label: "AI / LLM gateway",
        vars: [
          {
            key: "LITELLM_API_BASE",
            set: isSet("LITELLM_API_BASE") || isSet("OPENAI_API_BASE"),
            hint: "Base URL for the LLM API. Also accepts OPENAI_API_BASE as a fallback.",
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
            hint: "Timeout in milliseconds for AI requests. Defaults to 60 000 ms.",
            optional: true,
          },
        ],
      },
      {
        label: "DocuSign",
        vars: [
          {
            key: "DOCUSIGN_ACCOUNT_ID",
            set: isSet("DOCUSIGN_ACCOUNT_ID"),
            hint: "DocuSign account ID for e-signature workflows.",
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
            hint: "HMAC secret used to verify DocuSign webhook callbacks.",
            optional: true,
          },
        ],
      },
      {
        label: "Schedulers",
        vars: [
          {
            key: "ENABLE_FINANCE_SCHEDULER",
            set: isSet("ENABLE_FINANCE_SCHEDULER"),
            hint: "Set to 'true' to enable the monthly finance report scheduler.",
            optional: true,
          },
          {
            key: "ENABLE_TIMESHEET_REMINDER_SCHEDULER",
            set: isSet("ENABLE_TIMESHEET_REMINDER_SCHEDULER"),
            hint: "Set to 'true' to enable automated timesheet reminder emails.",
            optional: true,
          },
        ],
      },
    ],
  });
}
