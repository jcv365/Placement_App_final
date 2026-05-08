-- Backfill: mark candidates whose rawCV text contains redaction markers
UPDATE "Candidate" SET "cvStorageMode" = 'REDACTED'
  WHERE "rawCV" LIKE '%[redacted-email]%'
     OR "rawCV" LIKE '%[redacted-phone]%'
     OR "rawCV" LIKE '%[redacted-linkedin]%';

UPDATE "Candidate" SET "cvStorageMode" = 'UNKNOWN'
  WHERE "rawCV" IS NULL OR TRIM("rawCV") = '';

-- Performance indexes: FK columns that were missing indexes
CREATE INDEX IF NOT EXISTS "Candidate_email_idx" ON "Candidate"("email");
CREATE INDEX IF NOT EXISTS "Application_candidateId_idx" ON "Application"("candidateId");
CREATE INDEX IF NOT EXISTS "Application_jobId_idx" ON "Application"("jobId");
CREATE INDEX IF NOT EXISTS "Job_companyId_idx" ON "Job"("companyId");
