/** Default Outlook mailbox used when no company-level override is configured. */
export const DEFAULT_OUTLOOK_MAILBOX =
  process.env.DEFAULT_OUTLOOK_MAILBOX?.trim() ||
  process.env.OUTLOOK_SHARED_MAILBOX?.trim() ||
  "";

/** Platform operator company name shown in emails, reports and split labels. */
export const PLATFORM_PARTNER_NAME =
  process.env.PLATFORM_PARTNER_NAME?.trim() || "";

/** Default accounts / finance recipient email. */
export const DEFAULT_ACCOUNTS_EMAIL =
  process.env.DEFAULT_ACCOUNTS_EMAIL?.trim() || "";

/** NDA document filename (must exist under data/Documents/). */
export const NDA_DOCUMENT_FILENAME =
  process.env.NDA_DOCUMENT_FILENAME?.trim() || "";

/** Teaming agreement document filename (must exist under data/Documents/). */
export const TEAMING_DOCUMENT_FILENAME =
  process.env.TEAMING_DOCUMENT_FILENAME?.trim() || "";
