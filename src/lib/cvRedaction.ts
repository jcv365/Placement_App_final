function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactCvContactDetails(params: {
  cvText: string;
  email?: string | null;
  phone?: string | null;
}): string {
  let redacted = params.cvText;

  if (params.email?.trim()) {
    const emailPattern = new RegExp(escapeRegExp(params.email.trim()), "gi");
    redacted = redacted.replace(emailPattern, "[redacted-email]");
  }

  if (params.phone?.trim()) {
    const phonePattern = new RegExp(escapeRegExp(params.phone.trim()), "gi");
    redacted = redacted.replace(phonePattern, "[redacted-phone]");
  }

  redacted = redacted.replace(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
    "[redacted-email]",
  );

  redacted = redacted.replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, (match) => {
    const digits = match.replace(/\D/g, "");
    return digits.length >= 8 && digits.length <= 15
      ? "[redacted-phone]"
      : match;
  });

  redacted = redacted.replace(
    /https?:\/\/(?:www\.)?linkedin\.com\/[A-Za-z0-9\-_/?.=&%]+/gi,
    "[redacted-linkedin]",
  );

  return redacted;
}
