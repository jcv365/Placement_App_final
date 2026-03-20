import { canTransition } from "@/lib/stages";
import { describe, expect, it } from "vitest";

describe("canTransition", () => {
  it("allows forward transitions", () => {
    expect(canTransition("NEW", "SHORTLISTED").allowed).toBe(true);
  });

  it("allows skipping stages", () => {
    expect(canTransition("NEW", "EMAIL_DRAFTED").allowed).toBe(true);
  });

  it("allows rejection from any stage", () => {
    expect(canTransition("INTERVIEW_1", "REJECTED").allowed).toBe(true);
  });

  it("allows backwards transitions without a note", () => {
    const result = canTransition("EMAIL_DRAFTED", "SHORTLISTED", false);
    expect(result.allowed).toBe(true);
    expect(result.requiresNote).toBe(false);
  });
});
