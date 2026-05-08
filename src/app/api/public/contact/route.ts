import { jsonError, jsonOk } from "@/lib/apiResponses";
import { DEFAULT_OUTLOOK_MAILBOX } from "@/lib/constants";
import { sendMail } from "@/lib/mailer";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, getClientIp } from "@/lib/rateLimiter";

export const runtime = "nodejs";

const MAX_SUBMISSIONS_PER_WINDOW = 3;
const SUBMISSION_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

const MAX_FIELD_LENGTH = 500;
const MAX_MESSAGE_LENGTH = 5000;

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const limited = checkRateLimit(
    `contact:${ip}`,
    MAX_SUBMISSIONS_PER_WINDOW,
    SUBMISSION_WINDOW_MS,
  );
  if (!limited.allowed) {
    return jsonError("Too many enquiries. Please try again later.", 429);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid request body", 400);
  }

  if (!body || typeof body !== "object") {
    return jsonError("Invalid request body", 400);
  }

  const { fullName, email, company, phone, message } = body as Record<
    string,
    unknown
  >;

  // Validate required fields
  if (!fullName || typeof fullName !== "string" || !fullName.trim()) {
    return jsonError("Full name is required", 400);
  }
  if (!email || typeof email !== "string" || !email.trim()) {
    return jsonError("Email address is required", 400);
  }
  if (!message || typeof message !== "string" || !message.trim()) {
    return jsonError("Message is required", 400);
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    return jsonError("Please provide a valid email address", 400);
  }

  // Length checks
  const safeName = String(fullName).slice(0, MAX_FIELD_LENGTH).trim();
  const safeEmail = String(email)
    .slice(0, MAX_FIELD_LENGTH)
    .trim()
    .toLowerCase();
  const safeCompany = company
    ? String(company).slice(0, MAX_FIELD_LENGTH).trim()
    : null;
  const safePhone = phone
    ? String(phone).slice(0, MAX_FIELD_LENGTH).trim()
    : null;
  const safeMessage = String(message).slice(0, MAX_MESSAGE_LENGTH).trim();

  try {
    const inquiry = await prisma.contactInquiry.create({
      data: {
        fullName: safeName,
        email: safeEmail,
        company: safeCompany,
        phone: safePhone,
        message: safeMessage,
      },
    });

    // Best-effort notification email to admin
    sendMail({
      to: DEFAULT_OUTLOOK_MAILBOX ? [DEFAULT_OUTLOOK_MAILBOX] : [],
      subject: `New enquiry from ${safeName}`,
      text: [
        `New contact enquiry received:`,
        ``,
        `Name: ${safeName}`,
        `Email: ${safeEmail}`,
        safeCompany ? `Company: ${safeCompany}` : null,
        safePhone ? `Phone: ${safePhone}` : null,
        ``,
        `Message:`,
        safeMessage,
        ``,
        `Inquiry ID: ${inquiry.id}`,
      ]
        .filter(Boolean)
        .join("\n"),
    }).catch(() => {
      /* notification is best-effort */
    });

    return jsonOk({ id: inquiry.id });
  } catch (err) {
    console.error("[contact] Failed to save enquiry:", err);
    return jsonError("Failed to send enquiry. Please try again.", 500);
  }
}
