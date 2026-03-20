import { DEFAULT_RULES, mergeRules } from "@/lib/rules";
import { describe, expect, it } from "vitest";

describe("mergeRules", () => {
  it("merges toggles and preserves defaults", () => {
    const merged = mergeRules(DEFAULT_RULES, {
      include_sections: { mirroring: false },
    });

    expect(merged.include_sections.mirroring).toBe(false);
    expect(merged.include_sections.tactical_empathy).toBe(true);
  });
});
