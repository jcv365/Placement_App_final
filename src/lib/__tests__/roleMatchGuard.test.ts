import { describe, expect, it } from "vitest";
import {
    guardCandidateForOpportunity,
    guardRoleMatch,
} from "../roleMatchGuard";

// ─────────────────────────────────────────────────────────────────────────────
// guardRoleMatch – role-family mismatch (Engineer ≠ Architect)
// ─────────────────────────────────────────────────────────────────────────────

describe("guardRoleMatch – role-family mismatch", () => {
  it("blocks Network Engineer for Network Architect", () => {
    const result = guardRoleMatch("Network Architect", "Network Engineer");
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.failureType).toBe("family_mismatch");
    }
  });

  it("blocks Software Engineer for Data Analyst", () => {
    const result = guardRoleMatch("Data Analyst", "Software Engineer");
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.failureType).toBe("family_mismatch");
    }
  });

  it("blocks IT Manager for Enterprise Architect", () => {
    const result = guardRoleMatch("Enterprise Architect", "IT Manager");
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.failureType).toBe("family_mismatch");
    }
  });

  it("blocks Infrastructure Engineer for Infrastructure Architect", () => {
    const result = guardRoleMatch(
      "Infrastructure Architect",
      "Infrastructure Engineer",
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.failureType).toBe("family_mismatch");
    }
  });

  it("blocks Security Specialist for Security Analyst", () => {
    const result = guardRoleMatch("Security Analyst", "Security Specialist");
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.failureType).toBe("family_mismatch");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// guardRoleMatch – specialisation gap (same family, missing domain)
// ─────────────────────────────────────────────────────────────────────────────

describe("guardRoleMatch – specialisation gap", () => {
  it("blocks Enterprise Architect for Enterprise Infrastructure Architect", () => {
    // The 'infrastructure' domain token is required but missing.
    const result = guardRoleMatch(
      "Enterprise Infrastructure Architect",
      "Enterprise Architect",
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.failureType).toBe("specialisation_gap");
      expect(result.reason).toMatch(/infrastructure/i);
    }
  });

  it("blocks Solutions Architect for Network Solutions Architect", () => {
    const result = guardRoleMatch(
      "Network Solutions Architect",
      "Solutions Architect",
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.failureType).toBe("specialisation_gap");
    }
  });

  it("blocks Cloud Architect for Cloud Security Architect", () => {
    const result = guardRoleMatch(
      "Cloud Security Architect",
      "Cloud Architect",
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.failureType).toBe("specialisation_gap");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// guardRoleMatch – valid matches (should be allowed)
// ─────────────────────────────────────────────────────────────────────────────

describe("guardRoleMatch – valid matches", () => {
  it("allows exact match", () => {
    const result = guardRoleMatch(
      "Enterprise Infrastructure Architect",
      "Enterprise Infrastructure Architect",
    );
    expect(result.allowed).toBe(true);
  });

  it("allows seniority-only difference (Senior prefix in candidate)", () => {
    const result = guardRoleMatch(
      "Enterprise Infrastructure Architect",
      "Senior Enterprise Infrastructure Architect",
    );
    expect(result.allowed).toBe(true);
  });

  it("allows seniority-only difference (Lead prefix in opportunity)", () => {
    const result = guardRoleMatch(
      "Lead Infrastructure Architect",
      "Infrastructure Architect",
    );
    expect(result.allowed).toBe(true);
  });

  it("allows Solutions Architect for Solutions Architect", () => {
    const result = guardRoleMatch("Solutions Architect", "Solutions Architect");
    expect(result.allowed).toBe(true);
  });

  it("allows Network Engineer for Network Engineer", () => {
    const result = guardRoleMatch("Network Engineer", "Network Engineer");
    expect(result.allowed).toBe(true);
  });

  it("allows Cloud Infrastructure Engineer for Infrastructure Engineer", () => {
    // The opportunity only requires 'infrastructure', which candidate has.
    const result = guardRoleMatch(
      "Infrastructure Engineer",
      "Cloud Infrastructure Engineer",
    );
    expect(result.allowed).toBe(true);
  });

  it("allows Data Analyst for Senior Data Analyst", () => {
    const result = guardRoleMatch("Data Analyst", "Senior Data Analyst");
    expect(result.allowed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// guardCandidateForOpportunity – multi-role candidate
// ─────────────────────────────────────────────────────────────────────────────

describe("guardCandidateForOpportunity – multi-role candidate", () => {
  it("passes when at least one suggested role matches", () => {
    const result = guardCandidateForOpportunity(
      ["Network Engineer", "Enterprise Infrastructure Architect"],
      "Enterprise Infrastructure Architect",
    );
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.matchedRole).toBe("Enterprise Infrastructure Architect");
    }
  });

  it("fails Thumelo scenario: Enterprise Architect for Enterprise Infrastructure Architect", () => {
    // Reproduces the reported Thumelo false-positive.
    const result = guardCandidateForOpportunity(
      ["Enterprise Architect"],
      "Enterprise Infrastructure Architect",
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.failedRoles[0]?.failureType).toBe("specialisation_gap");
    }
  });

  it("fails Network Engineer recommended for Architect position", () => {
    // Reproduces the reported Network Engineer / Architect false-positive.
    const result = guardCandidateForOpportunity(
      ["Network Engineer", "Senior Network Engineer"],
      "Network Architect",
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(
        result.failedRoles.every((r) => r.failureType === "family_mismatch"),
      ).toBe(true);
    }
  });

  it("fails when candidate has no suggested roles", () => {
    const result = guardCandidateForOpportunity([], "Solutions Architect");
    expect(result.allowed).toBe(false);
  });

  it("passes when candidate has superset of required specialisation", () => {
    const result = guardCandidateForOpportunity(
      ["Cloud and Network Solutions Architect"],
      "Solutions Architect",
    );
    expect(result.allowed).toBe(true);
  });
});
