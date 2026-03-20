CREATE TABLE "SupportTicket" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL DEFAULT 'default',
  "companyId" TEXT,
  "category" TEXT NOT NULL DEFAULT 'SUPPORT',
  "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
  "subject" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "createdBy" TEXT NOT NULL,
  "assignedTo" TEXT,
  "resolutionNotes" TEXT,
  "resolvedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "SupportTicket_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "SupportTicket_tenantId_status_createdAt_idx"
  ON "SupportTicket" ("tenantId", "status", "createdAt");

CREATE INDEX "SupportTicket_companyId_createdAt_idx"
  ON "SupportTicket" ("companyId", "createdAt");
