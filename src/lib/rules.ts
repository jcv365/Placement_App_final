import { DEFAULT_VOSS_TOGGLES } from "./voss";

export const DEFAULT_RULES = {
  tone: "human, calm, professional",
  dialect: "British English",
  perspective: "placement company acting as C2C partner",
  c2c_partner_name: process.env.DEFAULT_C2C_PARTNER_NAME ?? "C2C Partner Ltd",
  c2c_partner_positioning: "",
  company_type: "placement" as const,
  include_sections: { ...DEFAULT_VOSS_TOGGLES },
  length: "250-400 words",
  structure: [
    "subject",
    "greeting",
    "opening",
    "value_match",
    "evidence",
    "calibrated_question",
    "no_oriented_close",
    "signoff",
  ],
  avoid: ["hype adjectives", "US spellings", "generic cliches"],
  privacy: "no sensitive data beyond what is necessary",
};

type Rules = typeof DEFAULT_RULES;

type RulesOverrides = Omit<Partial<Rules>, "include_sections"> & {
  include_sections?: Partial<Rules["include_sections"]>;
};

export function mergeRules(base: Rules, overrides: RulesOverrides): Rules {
  return {
    ...base,
    ...overrides,
    include_sections: {
      ...base.include_sections,
      ...(overrides.include_sections ?? {}),
    },
    structure: overrides.structure ?? base.structure,
    avoid: overrides.avoid ?? base.avoid,
  };
}
