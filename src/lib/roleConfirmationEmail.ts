import * as fs from "fs";
import * as path from "path";

import {
  createOutlookDraftForMailbox,
  isGraphMailConfigured,
} from "@/lib/graph";
import {
  DEFAULT_OUTLOOK_MAILBOX,
  NDA_DOCUMENT_FILENAME,
  PLATFORM_PARTNER_NAME,
  TEAMING_DOCUMENT_FILENAME,
} from "@/lib/constants";

const DEFAULT_MAILBOX =
  process.env.OUTLOOK_SHARED_MAILBOX?.trim() ||
  process.env.GRAPH_SENDER_USER?.trim() ||
  DEFAULT_OUTLOOK_MAILBOX;

const DEFAULT_SENDER_NAME =
  process.env.SENDER_DISPLAY_NAME?.trim() || PLATFORM_PARTNER_NAME;

// In the Docker container the host project root is mounted at DATA_MOUNT_ROOT
// (e.g. /app/data); locally it is the process working directory.
const DATA_ROOT = process.env.DATA_MOUNT_ROOT ?? process.cwd();
const DOCS_DIR = path.join(DATA_ROOT, "data", "Documents");

const DOCUMENT_FILES = [
  NDA_DOCUMENT_FILENAME,
  TEAMING_DOCUMENT_FILENAME,
].filter(Boolean);

function loadDocumentAttachments(): {
  filename: string;
  contentBase64: string;
  contentType: string;
}[] {
  const attachments: {
    filename: string;
    contentBase64: string;
    contentType: string;
  }[] = [];
  for (const filename of DOCUMENT_FILES) {
    const filePath = path.join(DOCS_DIR, filename);
    if (fs.existsSync(filePath)) {
      attachments.push({
        filename,
        contentBase64: fs.readFileSync(filePath).toString("base64"),
        contentType: "application/pdf",
      });
    } else {
      console.warn(`[ROLE_CONFIRM] Document not found, skipping: ${filePath}`);
    }
  }
  return attachments;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildRoleConfirmationEmailHtml(
  candidateName: string,
  suggestedRoles: string[],
  senderName: string,
  senderEmail: string,
  brandName: string,
): string {
  const firstName = candidateName.trim().split(/\s+/)[0] ?? candidateName;
  const rolesHtml = suggestedRoles
    .map((role) => `<li style="margin:4px 0;">${escapeHtml(role)}</li>`)
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#222;line-height:1.6;max-width:640px;margin:0 auto;padding:20px;">

  <p>Good day ${escapeHtml(firstName)},</p>

  <p>
    Thank you for joining ${escapeHtml(brandName)}'s active bench of specialist engineers. We
    are a professional services company that deploys our engineers directly to clients
    across Europe and the United Kingdom for contracting engagements, and we take direct
    accountability for the quality and fit of every engineer we represent.
  </p>

  <p>
    In order for us to put you forward effectively, we would kindly ask that you take a
    moment to confirm the following:
  </p>

  <p><strong>1. Roles you are comfortable being considered for</strong></p>

  <p>
    Based on your profile and experience, we have identified the following roles as
    potential fits for you. Please could you review this list and let us know which
    ones you are happy for us to actively pursue on your behalf — and feel free to
    suggest any additional roles you feel we may have missed:
  </p>

  <ul style="padding-left:20px;margin:12px 0;">
    ${rolesHtml}
  </ul>

  <p><strong>2. Your hourly rate</strong></p>

  <p>
    Could you please confirm your expected hourly rate for contract engagements in Europe
    and the UK? Please note that all engagements we facilitate are fully remote. If your
    rate varies depending on the role or region, please do let us know — that level of
    detail is very helpful when we are negotiating on your behalf.
  </p>

  <p><strong>3. Required documentation</strong></p>

  <p>
    We have attached two documents that we require all contractors to complete before we
    can formally represent them:
  </p>

  <ul style="padding-left:20px;margin:12px 0;">
    <li style="margin:4px 0;"><strong>Non-Disclosure Agreement (NDA)</strong> — protects both parties' confidential information throughout our engagement.</li>
    <li style="margin:4px 0;"><strong>Teaming Agreement</strong> — formalises your engagement with ${escapeHtml(brandName)} as a professional services partner, setting out the terms under which we will deploy you to our clients as part of our engineering bench.</li>
  </ul>

  <p>
    Please print, sign, and scan (or photograph clearly) both documents, then reply to
    this email with the signed copies attached. Alternatively, if you have a digital
    signature tool, you are welcome to use that.
  </p>

  <p>
    Please reply to this email at your earliest convenience with your confirmation and
    all signed documents. Should you wish to discuss anything further, or if your
    circumstances have changed since we last spoke, please do not hesitate to reach out
    — we are always happy to assist.
  </p>

  <p>We look forward to hearing from you.</p>

  <p>
    Kind regards,<br />
    <strong>${escapeHtml(senderName)}</strong><br />
    <a href="mailto:${escapeHtml(senderEmail)}">${escapeHtml(senderEmail)}</a>
  </p>

</body>
</html>`;
}

/**
 * Creates an Outlook draft in the shared mailbox for the role & rate
 * confirmation email. Intended to be called fire-and-forget after CV upload.
 */
export async function sendRoleConfirmationDraft(params: {
  candidateId: string;
  candidateName: string;
  email: string;
  suggestedRoles: string[];
}): Promise<{ id?: string } | void> {
  if (!isGraphMailConfigured()) {
    console.warn(
      "[ROLE_CONFIRM] Graph not configured — skipping confirmation draft",
      { candidateId: params.candidateId },
    );
    return;
  }

  if (params.suggestedRoles.length === 0) {
    console.warn(
      "[ROLE_CONFIRM] No suggested roles — skipping confirmation draft",
      { candidateId: params.candidateId },
    );
    return;
  }

  const mailbox = DEFAULT_MAILBOX;
  const senderName = DEFAULT_SENDER_NAME;
  const brandName = PLATFORM_PARTNER_NAME || senderName;
  const subject =
    "Contracting Opportunities in Europe & UK — Role Confirmation and Rate";

  const htmlBody = buildRoleConfirmationEmailHtml(
    params.candidateName,
    params.suggestedRoles,
    senderName,
    mailbox,
    brandName,
  );

  const attachments = loadDocumentAttachments();

  const draft = await createOutlookDraftForMailbox({
    mailbox,
    subject,
    htmlBody,
    to: [params.email],
    attachments,
  });

  console.info("[ROLE_CONFIRM] Draft created", {
    candidateId: params.candidateId,
    to: params.email,
    roles: params.suggestedRoles,
    id: draft?.id,
  });
  return draft;
}
