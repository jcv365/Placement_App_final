/*
  Warnings:

  - A unique constraint covering the columns `[tenantId,opportunityId]` on the table `Application` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[tenantId,candidateId,type]` on the table `CandidateAgreement` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[tenantId,envelopeId]` on the table `CandidateAgreement` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[tenantId,invoiceNumber]` on the table `Invoice` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[tenantId,name]` on the table `RuleSet` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Application_opportunityId_key";

-- DropIndex
DROP INDEX "CandidateAgreement_candidateId_type_key";

-- DropIndex
DROP INDEX "CandidateAgreement_envelopeId_key";

-- DropIndex
DROP INDEX "Invoice_invoiceNumber_key";

-- DropIndex
DROP INDEX "RuleSet_name_key";

-- AlterTable
ALTER TABLE "Job" ADD COLUMN "isRemote" BOOLEAN;
ALTER TABLE "Job" ADD COLUMN "requiresUkWorkAuth" BOOLEAN;
ALTER TABLE "Job" ADD COLUMN "requiresUsWorkAuth" BOOLEAN;

-- AlterTable
ALTER TABLE "TenantUser" ADD COLUMN "emailVerifiedAt" DATETIME;
ALTER TABLE "TenantUser" ADD COLUMN "verifyTokenExpiry" DATETIME;
ALTER TABLE "TenantUser" ADD COLUMN "verifyTokenHash" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CompanySettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "billingModel" TEXT NOT NULL DEFAULT 'PERCENTAGE',
    "billingRatePerHour" REAL NOT NULL DEFAULT 0,
    "revenueSplitPercent" REAL NOT NULL DEFAULT 50,
    "brandName" TEXT,
    "logoUrl" TEXT,
    "reportRecipientsCsv" TEXT NOT NULL DEFAULT '',
    "outlookMailbox" TEXT NOT NULL DEFAULT '',
    "graphAccessTokenEncrypted" TEXT,
    "graphConnectedEmail" TEXT,
    "graphTokenExpiresAt" DATETIME,
    "graphConnectedAt" DATETIME,
    "currency" TEXT NOT NULL DEFAULT 'ZAR',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CompanySettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_CompanySettings" ("billingModel", "billingRatePerHour", "brandName", "companyId", "createdAt", "currency", "graphAccessTokenEncrypted", "graphConnectedAt", "graphConnectedEmail", "graphTokenExpiresAt", "id", "logoUrl", "outlookMailbox", "reportRecipientsCsv", "revenueSplitPercent", "updatedAt") SELECT "billingModel", "billingRatePerHour", "brandName", "companyId", "createdAt", "currency", "graphAccessTokenEncrypted", "graphConnectedAt", "graphConnectedEmail", "graphTokenExpiresAt", "id", "logoUrl", "outlookMailbox", "reportRecipientsCsv", "revenueSplitPercent", "updatedAt" FROM "CompanySettings";
DROP TABLE "CompanySettings";
ALTER TABLE "new_CompanySettings" RENAME TO "CompanySettings";
CREATE UNIQUE INDEX "CompanySettings_companyId_key" ON "CompanySettings"("companyId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Application_tenantId_opportunityId_key" ON "Application"("tenantId", "opportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateAgreement_tenantId_candidateId_type_key" ON "CandidateAgreement"("tenantId", "candidateId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateAgreement_tenantId_envelopeId_key" ON "CandidateAgreement"("tenantId", "envelopeId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_tenantId_invoiceNumber_key" ON "Invoice"("tenantId", "invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "RuleSet_tenantId_name_key" ON "RuleSet"("tenantId", "name");
