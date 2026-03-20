export type VossToggles = {
  accusations_audit: boolean;
  tactical_empathy: boolean;
  labelling: boolean;
  mirroring: boolean;
  calibrated_questions: boolean;
  no_oriented_closing: boolean;
};

export const DEFAULT_VOSS_TOGGLES: VossToggles = {
  accusations_audit: true,
  tactical_empathy: true,
  labelling: true,
  mirroring: true,
  calibrated_questions: true,
  no_oriented_closing: true,
};
