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
const DATA_ROOT = process.env.DATA_MOUNT_ROOT ?? process.cwd();
const DOCS_DIR = path.join(DATA_ROOT, "data", "Documents");

const NDA_FILENAME = NDA_DOCUMENT_FILENAME;
const TEAMING_FILENAME = TEAMING_DOCUMENT_FILENAME;

function loadNdaTeamingAttachments() {
  const files = [NDA_FILENAME, TEAMING_FILENAME].filter(Boolean);
  return files
    .map((filename) => {
      const filePath = path.join(DOCS_DIR, filename);
      if (!fs.existsSync(filePath)) return null;
      return {
        filename,
        contentBase64: fs.readFileSync(filePath).toString("base64"),
        contentType: "application/pdf",
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildNdaTeamingEmailHtml(
  candidateName: string,
  senderName: string,
  senderEmail: string,
  brandName: string,
): string {
  const firstName = candidateName.trim().split(/\s+/)[0] ?? candidateName;
  return `<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"UTF-8\" />\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />\n</head>\n<body style=\"font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#222;line-height:1.6;max-width:640px;margin:0 auto;padding:20px;\">\n\n  <p>Good day ${escapeHtml(firstName)},</p>\n\n  <p>Thank you for joining ${escapeHtml(brandName)}'s specialist engineering bench. We are a professional services company that deploys vetted engineers to clients across Europe and the United Kingdom for contracting engagements, and we are pleased to have you as part of our team.</p>\n\n  <p>To formalise your engagement with us and enable us to present you to our clients as part of our engineering bench, we require you to review, sign, and return the following two documents:</p>\n\n  <ol style=\"padding-left:20px;margin:12px 0;\">\n    <li style=\"margin:8px 0;\"><strong>Non-Disclosure Agreement (NDA)</strong> — Protects both parties and ensures that any confidential information shared during the engagement process remains strictly private.</li>\n    <li style=\"margin:8px 0;\"><strong>Teaming Agreement</strong> — Formalises your engagement with ${escapeHtml(brandName)} as a professional services partner, setting out the terms under which we will deploy you to our clients as part of our engineering bench.</li>\n  </ol>\n\n  <p>Please print, sign, and scan each document, then <strong>reply to this email</strong> with the signed copies attached. Alternatively, you are welcome to use a digital signature tool such as DocuSign or Adobe Sign.</p>\n\n  <p>Should you have any questions about the contents of either document, please do not hesitate to reach out — we are happy to clarify anything before you sign.</p>\n\n  <p>We look forward to receiving your completed documents.</p>\n\n  <p>Kind regards,<br />\n    <strong>${escapeHtml(senderName)}</strong><br />\n    <a href=\"mailto:${escapeHtml(senderEmail)}\">${escapeHtml(senderEmail)}</a>\n  </p>\n\n</body>\n</html>`;
}

export async function sendNdaTeamingDraft(params: {
  candidateId: string;
  candidateName: string;
  email: string;
}): Promise<{ id?: string } | void> {
  if (!isGraphMailConfigured()) {
    console.warn(
      "[NDA_TEAMING] Graph not configured — skipping NDA/Teaming draft",
      { candidateId: params.candidateId },
    );
    return;
  }
  const mailbox = DEFAULT_MAILBOX;
  const senderName = DEFAULT_SENDER_NAME;
  const brandName = PLATFORM_PARTNER_NAME || senderName;
  const subject = `${brandName} — NDA & Teaming Agreement: Action Required`;
  const htmlBody = buildNdaTeamingEmailHtml(
    params.candidateName,
    senderName,
    mailbox,
    brandName,
  );
  const attachments = loadNdaTeamingAttachments();
  const draft = await createOutlookDraftForMailbox({
    mailbox,
    subject,
    htmlBody,
    to: [params.email],
    attachments,
  });
  console.info("[NDA_TEAMING] Draft created", {
    candidateId: params.candidateId,
    email: params.email,
    id: draft?.id,
  });
  return draft;
}
