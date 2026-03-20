import { EMAIL_USER_PROMPT, resolvePreferredWordRange } from "@/lib/prompts";
import { describe, expect, it } from "vitest";

describe("EMAIL_USER_PROMPT", () => {
  it("includes required sections", () => {
    const prompt = EMAIL_USER_PROMPT({
      jobDescription: "Role details",
      candidateSummary: "Candidate details",
      cvToJdAlignment: "Aligned on core role requirements.",
      c2cPartnerName: "C2C Partner Ltd",
      rulesJson: { tone: "calm" },
    });

    expect(prompt).toContain("JOB/CONTRACT");
    expect(prompt).toContain("CANDIDATE");
    expect(prompt).toContain("RULES");
  });
});

describe("resolvePreferredWordRange", () => {
  it("supports 1000-word targets without capping to 800", () => {
    const range = resolvePreferredWordRange("1000 words");

    expect(range.min).toBe(820);
    expect(range.max).toBe(1180);
    expect(range.label).toContain("target 1000");
  });

  it("supports explicit ranges above 800 words", () => {
    const range = resolvePreferredWordRange("900-1100 words");

    expect(range.min).toBe(900);
    expect(range.max).toBe(1100);
    expect(range.label).toBe("900-1100 words");
  });
});
