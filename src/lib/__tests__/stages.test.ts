import { canTransition } from "@/lib/stages";
import { describe, expect, it } from "vitest";

describe("canTransition", () => {
  it("allows forward transitions", () => {
    expect(canTransition("NEW", "SHORTLISTED").allowed).toBe(true);
  });

  it("allows skipping stages forward", () => {
    expect(canTransition("NEW", "EMAIL_DRAFTED").allowed).toBe(true);
  });

  it("allows rejection from any active stage", () => {
    expect(canTransition("INTERVIEW_1", "REJECTED").allowed).toBe(true);
    expect(canTransition("NEW", "REJECTED").allowed).toBe(true);
    expect(canTransition("OFFER", "REJECTED").allowed).toBe(true);
  });

  it("blocks backward transitions without a note", () => {
    const result = canTransition("EMAIL_DRAFTED", "SHORTLISTED", false);
    expect(result.allowed).toBe(false);
    expect(result.requiresNote).toBe(true);
  });

  it("allows backward transitions with a note", () => {
    const result = canTransition("EMAIL_DRAFTED", "SHORTLISTED", true);
    expect(result.allowed).toBe(true);
    expect(result.requiresNote).toBe(true);
  });

  it("blocks transitions from PLACED", () => {
    expect(canTransition("PLACED", "NEW").allowed).toBe(false);
    expect(canTransition("PLACED", "REJECTED").allowed).toBe(false);
  });

  it("allows REJECTED back to NEW", () => {
    expect(canTransition("REJECTED", "NEW").allowed).toBe(true);
  });

  it("allows ON_HOLD to resume at any active stage", () => {
    expect(canTransition("ON_HOLD", "SHORTLISTED").allowed).toBe(true);
    expect(canTransition("ON_HOLD", "INTERVIEW_1").allowed).toBe(true);
  });
});
