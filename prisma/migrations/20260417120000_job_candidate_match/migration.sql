-- CreateTable: JobCandidateMatch — stores AI-scored match results so they are
-- served from the database on subsequent requests instead of re-running the AI.
CREATE TABLE "JobCandidateMatch" (
    "id"          TEXT     NOT NULL PRIMARY KEY,
    "tenantId"    TEXT     NOT NULL DEFAULT 'default',
    "jobId"       TEXT     NOT NULL,
    "candidateId" TEXT     NOT NULL,
    "aiScore"     INTEGER  NOT NULL,
    "rationale"   TEXT     NOT NULL,
    "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Unique: one cached result per (tenant, job, candidate) triplet
CREATE UNIQUE INDEX "JobCandidateMatch_tenantId_jobId_candidateId_key"
    ON "JobCandidateMatch"("tenantId", "jobId", "candidateId");

-- Index used by the lookup query (tenant + job → ordered by score)
CREATE INDEX "JobCandidateMatch_tenantId_jobId_createdAt_idx"
    ON "JobCandidateMatch"("tenantId", "jobId", "createdAt");
