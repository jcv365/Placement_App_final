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

/**
 * Allowed forward/lateral transitions for each stage.
 * REJECTED and ON_HOLD are reachable from every active stage.
 * Backward moves require a note.
 */
const FORWARD_TRANSITIONS: Record<
  ApplicationStage,
  readonly ApplicationStage[]
> = {
  NEW: [
    "SHORTLISTED",
    "EMAIL_DRAFTED",
    "SENT_TO_CLIENT",
    "REJECTED",
    "ON_HOLD",
  ],
  SHORTLISTED: ["EMAIL_DRAFTED", "SENT_TO_CLIENT", "REJECTED", "ON_HOLD"],
  EMAIL_DRAFTED: ["SENT_TO_CLIENT", "REJECTED", "ON_HOLD"],
  SENT_TO_CLIENT: ["INTERVIEW_1", "OFFER", "REJECTED", "ON_HOLD"],
  INTERVIEW_1: ["INTERVIEW_2", "OFFER", "REJECTED", "ON_HOLD"],
  INTERVIEW_2: ["OFFER", "REJECTED", "ON_HOLD"],
  OFFER: ["PLACED", "REJECTED", "ON_HOLD"],
  PLACED: ["ON_HOLD"],
  REJECTED: ["NEW", "PLACED"],
  ON_HOLD: [
    "NEW",
    "SHORTLISTED",
    "EMAIL_DRAFTED",
    "SENT_TO_CLIENT",
    "INTERVIEW_1",
    "INTERVIEW_2",
    "OFFER",
    "PLACED",
  ],
};

/**
 * Stages that may move backward (to an earlier pipeline stage) only with a note.
 */
const STAGE_ORDER: Record<ApplicationStage, number> = {
  NEW: 0,
  SHORTLISTED: 1,
  EMAIL_DRAFTED: 2,
  SENT_TO_CLIENT: 3,
  INTERVIEW_1: 4,
  INTERVIEW_2: 5,
  OFFER: 6,
  PLACED: 7,
  REJECTED: -1,
  ON_HOLD: -1,
};

export function canTransition(
  from: ApplicationStage,
  to: ApplicationStage,
  hasNote = false,
): { allowed: boolean; requiresNote: boolean } {
  if (from === to) {
    return { allowed: true, requiresNote: false };
  }

  if (!KNOWN_STAGES.has(from) || !KNOWN_STAGES.has(to)) {
    return { allowed: false, requiresNote: false };
  }

  const forward = FORWARD_TRANSITIONS[from];
  if (forward.includes(to)) {
    return { allowed: true, requiresNote: false };
  }

  // Backward move: allowed only with a note
  const fromOrder = STAGE_ORDER[from];
  const toOrder = STAGE_ORDER[to];
  if (
    fromOrder > 0 &&
    toOrder >= 0 &&
    toOrder < fromOrder &&
    to !== "REJECTED" &&
    to !== "ON_HOLD"
  ) {
    return { allowed: hasNote, requiresNote: true };
  }

  return { allowed: false, requiresNote: false };
}
