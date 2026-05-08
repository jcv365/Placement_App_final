import { ATS_MIN_SAFE_EMAIL_SCORE, matchCvAgainstAts } from "@/lib/atsMatcher";
import { describe, expect, it } from "vitest";

describe("matchCvAgainstAts", () => {
  it("returns PASS for strong cv-to-job alignment", () => {
    const result = matchCvAgainstAts({
      cvText: `
      Professional Summary
      Senior .NET Engineer with strong Azure cloud delivery experience.
      Skills
      C#, .NET, Azure, Kubernetes, Docker, SQL, CI/CD, Terraform
      Experience
      Led migration projects, built APIs, improved platform reliability and security.
      Education
      BSc Computer Science
      Contact
      sam.engineer@example.com
      +44 7700 900123
      `,
      jobText: `
      Senior C# Developer required.
      Must have hands-on .NET and Azure experience.
      Strong knowledge of Kubernetes, Docker, SQL and CI/CD is essential.
      `,
    });

    expect(result.decision).toBe("PASS");
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(
      result.flags.some((flag) => flag.code === "LOW_KEYWORD_COVERAGE"),
    ).toBe(false);
  });

  it("returns FLAGGED when cv misses most requirements", () => {
    const result = matchCvAgainstAts({
      cvText: "Junior assistant with basic office administration background.",
      jobText: `
      Platform engineer required.
      Must have Terraform, Kubernetes, Azure, Python, and observability tooling.
      Essential: cloud architecture and production incident response.
      `,
    });

    expect(result.decision).toBe("FLAGGED");
    expect(
      result.flags.some((flag) => flag.code === "LOW_KEYWORD_COVERAGE"),
    ).toBe(true);
    expect(result.flags.some((flag) => flag.code === "VERY_SHORT_CV")).toBe(
      true,
    );
  });

  it("normalises ATS tokens like c# and .net", () => {
    const result = matchCvAgainstAts({
      cvText: `
      Skills: C#, .NET, Node.js
      Experience: built distributed services and APIs.
      jane@example.com
      +44 7700 900456
      `,
      jobText: `
      Required skills: c#, .net, node.js
      Must have API engineering experience.
      `,
    });

    expect(result.matchedKeywords).toEqual(
      expect.arrayContaining(["csharp", "dotnet", "nodejs"]),
    );
  });

  it("returns fix guidance for missing contact and structure", () => {
    const result = matchCvAgainstAts({
      cvText:
        "Engineer with cloud exposure and infrastructure support delivery across enterprise environments.",
      jobText:
        "Cloud engineer required with Azure, Terraform and incident response experience.",
      candidateEmail: null,
      candidatePhone: null,
    });

    expect(result.fixes.length).toBeGreaterThan(0);
    expect(result.fixes.map((fix) => fix.id)).toEqual(
      expect.arrayContaining(["ADD_EMAIL", "ADD_PHONE"]),
    );
  });

  it("uses candidate profile terms as ATS evidence", () => {
    const withoutProfile = matchCvAgainstAts({
      cvText:
        "Experienced engineer with delivery background and strong stakeholder collaboration.",
      jobText:
        "Role requires Kubernetes, Terraform, Azure and CI/CD experience.",
      candidateEmail: "eng@example.com",
      candidatePhone: "+44 7700 900321",
    });

    const withProfile = matchCvAgainstAts({
      cvText:
        "Experienced engineer with delivery background and strong stakeholder collaboration.",
      jobText:
        "Role requires Kubernetes, Terraform, Azure and CI/CD experience.",
      candidateEmail: "eng@example.com",
      candidatePhone: "+44 7700 900321",
      skillsCsv: "Kubernetes, Terraform, Azure, CI/CD",
    });

    expect(withProfile.score).toBeGreaterThan(withoutProfile.score);
  });

  it("flags role-family mismatch for cross-discipline profiles", () => {
    const result = matchCvAgainstAts({
      cvText: `
      Network Architect with enterprise routing, switching and SD-WAN delivery.
      Skills: Cisco, firewall design, WAN optimisation, LAN architecture.
      `,
      suggestedRolesCsv: "Network Architect, Infrastructure Network Lead",
      jobText: `
      DevOps Engineer required.
      Must have Kubernetes, Terraform, CI/CD pipelines and platform SRE operations.
      `,
      candidateEmail: "role.test@example.com",
      candidatePhone: "+44 7700 900111",
    });

    expect(result.flags.some((flag) => flag.code === "ROLE_MISMATCH")).toBe(
      true,
    );
    expect(result.score).toBeLessThan(ATS_MIN_SAFE_EMAIL_SCORE);
    expect(result.decision).not.toBe("PASS");
  });
});
