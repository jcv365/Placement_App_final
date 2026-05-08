const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  const tenantId = "dotcloudconsulting";
  const jobId = "cmmxp4bcr0003v6q84xo61u8u";
  
  // Get job title
  const job = await p.job.findFirst({ where: { id: jobId }, select: { title: true } });
  console.log("Job title:", job.title);
  
  // Count active candidates
  const activeCount = await p.candidate.count({ where: { tenantId, isActive: true } });
  console.log("Active candidates:", activeCount);
  
  // Count existing applications for this job
  const existingApps = await p.application.findMany({ where: { tenantId, jobId }, select: { candidateId: true } });
  console.log("Existing applications:", existingApps.length);
  const appliedIds = new Set(existingApps.map(a => a.candidateId));
  
  // Get candidates with roles
  const candidates = await p.candidate.findMany({
    where: { tenantId, isActive: true },
    select: { id: true, fullName: true, suggestedRolesCsv: true, preferredRolesCsv: true },
    take: 20
  });
  
  // Check how many have roles
  const withRoles = candidates.filter(c => {
    const rolesCsv = c.preferredRolesCsv?.trim() || c.suggestedRolesCsv;
    return rolesCsv && rolesCsv.trim().length > 0;
  });
  console.log("Candidates with roles (first 20):", withRoles.length);
  
  // Show some role examples
  console.log("\nSample candidate roles:");
  candidates.slice(0, 10).forEach(c => {
    const roles = c.preferredRolesCsv || c.suggestedRolesCsv || "(none)";
    const applied = appliedIds.has(c.id) ? " [APPLIED]" : "";
    console.log(`  ${c.fullName}: "${roles.slice(0, 80)}"${applied}`);
  });
  
  // Try the guard function manually - import it
  // Since we can't import TS, let's check what the guard does
  // The guard checks if candidate roles share a "family word" with the job title
  // Job title: "Network Security Architect Lead"
  // Family words in title: "architect"
  // So candidates need "architect" in their roles
  
  const architectCandidates = candidates.filter(c => {
    const roles = (c.preferredRolesCsv || c.suggestedRolesCsv || "").toLowerCase();
    return roles.includes("architect");
  });
  console.log("\nCandidates with 'architect' in roles:", architectCandidates.length);
  architectCandidates.forEach(c => console.log(`  - ${c.fullName}: "${(c.preferredRolesCsv || c.suggestedRolesCsv).slice(0, 80)}"`));
  
  await p.$disconnect();
}
main().catch(e => console.error(e));
