ALTER TABLE "SupportTicket" ADD COLUMN "slaResponseDueAt" DATETIME;
ALTER TABLE "SupportTicket" ADD COLUMN "slaResolutionDueAt" DATETIME;
ALTER TABLE "SupportTicket" ADD COLUMN "firstResponseAt" DATETIME;

CREATE TABLE "SupportTicketComment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "ticketId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL DEFAULT 'default',
  "author" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportTicketComment_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "SupportTicket" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "SupportTicketComment_ticketId_createdAt_idx"
  ON "SupportTicketComment" ("ticketId", "createdAt");

CREATE INDEX "SupportTicketComment_tenantId_createdAt_idx"
  ON "SupportTicketComment" ("tenantId", "createdAt");
