import { ApplicationStage } from "@prisma/client";

const KNOWN_STAGES = new Set<ApplicationStage>([
  "NEW",
  "SHORTLISTED",
  "EMAIL_DRAFTED",
  "SENT_TO_CLIENT",
  "INTERVIEW_1",
  "INTERVIEW_2",
  "OFFER",
  "PLACED",
  "REJECTED",
  "ON_HOLD",
]);

export function canTransition(
  from: ApplicationStage,
  to: ApplicationStage,
  _hasNote = false,
): { allowed: boolean; requiresNote: boolean } {
  if (from === to) {
    return { allowed: true, requiresNote: false };
  }

  if (!KNOWN_STAGES.has(from) || !KNOWN_STAGES.has(to)) {
    return { allowed: false, requiresNote: false };
  }

  return { allowed: true, requiresNote: false };
}
