import crypto from "crypto";

type OpportunityIdInput = {
  candidateName: string;
  roleTitle: string;
  companyName?: string | null;
};

function normaliseOpportunityPart(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function computeOpportunityId(input: OpportunityIdInput): string {
  const candidate = normaliseOpportunityPart(input.candidateName);
  const role = normaliseOpportunityPart(input.roleTitle);
  const company = normaliseOpportunityPart(input.companyName);

  const fingerprintSource = [candidate, role, company].join("|");
  const hash = crypto
    .createHash("sha256")
    .update(fingerprintSource)
    .digest("hex")
    .slice(0, 24);

  return `opp_${hash}`;
}
