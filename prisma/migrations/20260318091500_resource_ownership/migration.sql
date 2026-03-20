ALTER TABLE "Candidate" ADD COLUMN "ownerUserId" TEXT;
ALTER TABLE "Job" ADD COLUMN "ownerUserId" TEXT;
ALTER TABLE "Application" ADD COLUMN "ownerUserId" TEXT;

CREATE INDEX "Candidate_tenantId_ownerUserId_createdAt_idx"
  ON "Candidate"("tenantId", "ownerUserId", "createdAt");

CREATE INDEX "Job_tenantId_ownerUserId_createdAt_idx"
  ON "Job"("tenantId", "ownerUserId", "createdAt");

CREATE INDEX "Application_tenantId_ownerUserId_updatedAt_idx"
  ON "Application"("tenantId", "ownerUserId", "updatedAt");
