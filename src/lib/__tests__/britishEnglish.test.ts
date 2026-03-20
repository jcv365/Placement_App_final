import { normaliseBritishEnglish } from "@/lib/britishEnglish";
import { describe, expect, it } from "vitest";

describe("normaliseBritishEnglish", () => {
  it("converts common US spellings", () => {
    const input = "The organization will prioritize the program color.";
    const output = normaliseBritishEnglish(input);
    expect(output).toContain("organisation");
    expect(output).toContain("prioritise");
    expect(output).toContain("programme");
    expect(output).toContain("colour");
  });

  it("preserves casing", () => {
    const input = "ORGANIZATION and Organization";
    const output = normaliseBritishEnglish(input);
    expect(output).toContain("ORGANISATION");
    expect(output).toContain("Organisation");
  });
});
