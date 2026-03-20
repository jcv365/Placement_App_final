-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Application" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "jobId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "currentStage" TEXT NOT NULL DEFAULT 'NEW',
    "c2cPartner" TEXT NOT NULL,
    "placedAt" DATETIME,
    "agreedHourlyRate" REAL,
    "agreedRateLockedAt" DATETIME,
    "signedContractFileName" TEXT,
    "signedContractMimeType" TEXT,
    "signedContractData" BLOB,
    "signedContractUploadedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Application_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Application_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Application" ("agreedHourlyRate", "agreedRateLockedAt", "c2cPartner", "candidateId", "createdAt", "currentStage", "id", "jobId", "opportunityId", "placedAt", "signedContractData", "signedContractFileName", "signedContractMimeType", "signedContractUploadedAt", "updatedAt") SELECT "agreedHourlyRate", "agreedRateLockedAt", "c2cPartner", "candidateId", "createdAt", "currentStage", "id", "jobId", "opportunityId", "placedAt", "signedContractData", "signedContractFileName", "signedContractMimeType", "signedContractUploadedAt", "updatedAt" FROM "Application";
DROP TABLE "Application";
ALTER TABLE "new_Application" RENAME TO "Application";
CREATE INDEX "Application_tenantId_updatedAt_idx" ON "Application"("tenantId", "updatedAt");
CREATE INDEX "Application_currentStage_opportunityId_idx" ON "Application"("currentStage", "opportunityId");
CREATE UNIQUE INDEX "Application_opportunityId_key" ON "Application"("opportunityId");
CREATE TABLE "new_ApplicationStageHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "applicationId" TEXT NOT NULL,
    "fromStage" TEXT,
    "toStage" TEXT NOT NULL,
    "changedBy" TEXT,
    "changedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApplicationStageHistory_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ApplicationStageHistory" ("applicationId", "changedAt", "changedBy", "fromStage", "id", "toStage") SELECT "applicationId", "changedAt", "changedBy", "fromStage", "id", "toStage" FROM "ApplicationStageHistory";
DROP TABLE "ApplicationStageHistory";
ALTER TABLE "new_ApplicationStageHistory" RENAME TO "ApplicationStageHistory";
CREATE INDEX "ApplicationStageHistory_tenantId_changedAt_idx" ON "ApplicationStageHistory"("tenantId", "changedAt");
CREATE TABLE "new_AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "actor" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_AuditLog" ("action", "actor", "afterJson", "beforeJson", "createdAt", "entityId", "entityType", "id") SELECT "action", "actor", "afterJson", "beforeJson", "createdAt", "entityId", "entityType", "id" FROM "AuditLog";
DROP TABLE "AuditLog";
ALTER TABLE "new_AuditLog" RENAME TO "AuditLog";
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");
CREATE TABLE "new_Candidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "fullName" TEXT NOT NULL,
    "rawCV" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "vettingStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "vettedAt" DATETIME,
    "vettingNotes" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "skillsCsv" TEXT NOT NULL DEFAULT '',
    "certificationsCsv" TEXT NOT NULL DEFAULT '',
    "suggestedRolesCsv" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Candidate" ("certificationsCsv", "createdAt", "email", "fullName", "id", "isActive", "phone", "rawCV", "skillsCsv", "suggestedRolesCsv", "updatedAt", "vettedAt", "vettingNotes", "vettingStatus") SELECT "certificationsCsv", "createdAt", "email", "fullName", "id", "isActive", "phone", "rawCV", "skillsCsv", "suggestedRolesCsv", "updatedAt", "vettedAt", "vettingNotes", "vettingStatus" FROM "Candidate";
DROP TABLE "Candidate";
ALTER TABLE "new_Candidate" RENAME TO "Candidate";
CREATE INDEX "Candidate_tenantId_createdAt_idx" ON "Candidate"("tenantId", "createdAt");
CREATE TABLE "new_CandidateAgreement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "candidateId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_SENT',
    "envelopeId" TEXT,
    "externalStatus" TEXT,
    "sentAt" DATETIME,
    "signedAt" DATETIME,
    "lastWebhookAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CandidateAgreement_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_CandidateAgreement" ("candidateId", "createdAt", "envelopeId", "externalStatus", "id", "lastWebhookAt", "sentAt", "signedAt", "status", "type", "updatedAt") SELECT "candidateId", "createdAt", "envelopeId", "externalStatus", "id", "lastWebhookAt", "sentAt", "signedAt", "status", "type", "updatedAt" FROM "CandidateAgreement";
DROP TABLE "CandidateAgreement";
ALTER TABLE "new_CandidateAgreement" RENAME TO "CandidateAgreement";
CREATE UNIQUE INDEX "CandidateAgreement_envelopeId_key" ON "CandidateAgreement"("envelopeId");
CREATE INDEX "CandidateAgreement_tenantId_createdAt_idx" ON "CandidateAgreement"("tenantId", "createdAt");
CREATE INDEX "CandidateAgreement_candidateId_status_idx" ON "CandidateAgreement"("candidateId", "status");
CREATE UNIQUE INDEX "CandidateAgreement_candidateId_type_key" ON "CandidateAgreement"("candidateId", "type");
CREATE TABLE "new_ClientAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "contractTerms" TEXT,
    "billingNotes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ClientAccount" ("billingNotes", "contractTerms", "createdAt", "domain", "id", "isActive", "name", "updatedAt") SELECT "billingNotes", "contractTerms", "createdAt", "domain", "id", "isActive", "name", "updatedAt" FROM "ClientAccount";
DROP TABLE "ClientAccount";
ALTER TABLE "new_ClientAccount" RENAME TO "ClientAccount";
CREATE INDEX "ClientAccount_tenantId_createdAt_idx" ON "ClientAccount"("tenantId", "createdAt");
CREATE TABLE "new_ClientContact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "clientAccountId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "role" TEXT NOT NULL DEFAULT 'OTHER',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ClientContact_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ClientContact" ("clientAccountId", "createdAt", "email", "fullName", "id", "notes", "phone", "role", "updatedAt") SELECT "clientAccountId", "createdAt", "email", "fullName", "id", "notes", "phone", "role", "updatedAt" FROM "ClientContact";
DROP TABLE "ClientContact";
ALTER TABLE "new_ClientContact" RENAME TO "ClientContact";
CREATE INDEX "ClientContact_tenantId_createdAt_idx" ON "ClientContact"("tenantId", "createdAt");
CREATE INDEX "ClientContact_clientAccountId_idx" ON "ClientContact"("clientAccountId");
CREATE TABLE "new_Company" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Company" ("createdAt", "domain", "id", "name", "updatedAt") SELECT "createdAt", "domain", "id", "name", "updatedAt" FROM "Company";
DROP TABLE "Company";
ALTER TABLE "new_Company" RENAME TO "Company";
CREATE INDEX "Company_tenantId_name_idx" ON "Company"("tenantId", "name");
CREATE TABLE "new_CompanySettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "revenueSplitPercent" REAL NOT NULL DEFAULT 50,
    "brandName" TEXT,
    "logoUrl" TEXT,
    "reportRecipientsCsv" TEXT NOT NULL DEFAULT 'charl.venter@dotcloud.africa',
    "currency" TEXT NOT NULL DEFAULT 'ZAR',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CompanySettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_CompanySettings" ("brandName", "companyId", "createdAt", "currency", "id", "logoUrl", "reportRecipientsCsv", "revenueSplitPercent", "updatedAt") SELECT "brandName", "companyId", "createdAt", "currency", "id", "logoUrl", "reportRecipientsCsv", "revenueSplitPercent", "updatedAt" FROM "CompanySettings";
DROP TABLE "CompanySettings";
ALTER TABLE "new_CompanySettings" RENAME TO "CompanySettings";
CREATE UNIQUE INDEX "CompanySettings_companyId_key" ON "CompanySettings"("companyId");
CREATE TABLE "new_EmailDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "applicationId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "htmlBody" TEXT NOT NULL,
    "generatedFrom" TEXT NOT NULL,
    "preferredForLearning" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EmailDraft_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_EmailDraft" ("applicationId", "createdAt", "generatedFrom", "htmlBody", "id", "preferredForLearning", "subject", "updatedAt") SELECT "applicationId", "createdAt", "generatedFrom", "htmlBody", "id", "preferredForLearning", "subject", "updatedAt" FROM "EmailDraft";
DROP TABLE "EmailDraft";
ALTER TABLE "new_EmailDraft" RENAME TO "EmailDraft";
CREATE INDEX "EmailDraft_tenantId_createdAt_idx" ON "EmailDraft"("tenantId", "createdAt");
CREATE TABLE "new_Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "timesheetId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ZAR',
    "dueDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "issuedAt" DATETIME,
    "paidAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Invoice_timesheetId_fkey" FOREIGN KEY ("timesheetId") REFERENCES "Timesheet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Invoice" ("amount", "createdAt", "currency", "dueDate", "id", "invoiceNumber", "issuedAt", "paidAt", "status", "timesheetId", "updatedAt") SELECT "amount", "createdAt", "currency", "dueDate", "id", "invoiceNumber", "issuedAt", "paidAt", "status", "timesheetId", "updatedAt" FROM "Invoice";
DROP TABLE "Invoice";
ALTER TABLE "new_Invoice" RENAME TO "Invoice";
CREATE UNIQUE INDEX "Invoice_timesheetId_key" ON "Invoice"("timesheetId");
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");
CREATE INDEX "Invoice_tenantId_createdAt_idx" ON "Invoice"("tenantId", "createdAt");
CREATE INDEX "Invoice_status_dueDate_idx" ON "Invoice"("status", "dueDate");
CREATE TABLE "new_Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "title" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "opportunityEmail" TEXT,
    "opportunityUrl" TEXT,
    "companyId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Job_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Job" ("companyId", "createdAt", "id", "opportunityEmail", "opportunityUrl", "rawText", "title", "updatedAt") SELECT "companyId", "createdAt", "id", "opportunityEmail", "opportunityUrl", "rawText", "title", "updatedAt" FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
CREATE INDEX "Job_tenantId_createdAt_idx" ON "Job"("tenantId", "createdAt");
CREATE TABLE "new_Note" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "applicationId" TEXT NOT NULL,
    "author" TEXT,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Note_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Note" ("applicationId", "author", "content", "createdAt", "id") SELECT "applicationId", "author", "content", "createdAt", "id" FROM "Note";
DROP TABLE "Note";
ALTER TABLE "new_Note" RENAME TO "Note";
CREATE INDEX "Note_tenantId_createdAt_idx" ON "Note"("tenantId", "createdAt");
CREATE TABLE "new_PlacementAlert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "applicationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlacementAlert_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_PlacementAlert" ("applicationId", "createdAt", "dueDate", "id", "notes", "status", "title", "updatedAt") SELECT "applicationId", "createdAt", "dueDate", "id", "notes", "status", "title", "updatedAt" FROM "PlacementAlert";
DROP TABLE "PlacementAlert";
ALTER TABLE "new_PlacementAlert" RENAME TO "PlacementAlert";
CREATE INDEX "PlacementAlert_tenantId_createdAt_idx" ON "PlacementAlert"("tenantId", "createdAt");
CREATE INDEX "PlacementAlert_status_dueDate_idx" ON "PlacementAlert"("status", "dueDate");
CREATE INDEX "PlacementAlert_applicationId_idx" ON "PlacementAlert"("applicationId");
CREATE TABLE "new_RuleSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "rulesJson" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_RuleSet" ("createdAt", "id", "isDefault", "name", "rulesJson", "updatedAt") SELECT "createdAt", "id", "isDefault", "name", "rulesJson", "updatedAt" FROM "RuleSet";
DROP TABLE "RuleSet";
ALTER TABLE "new_RuleSet" RENAME TO "RuleSet";
CREATE UNIQUE INDEX "RuleSet_name_key" ON "RuleSet"("name");
CREATE INDEX "RuleSet_tenantId_createdAt_idx" ON "RuleSet"("tenantId", "createdAt");
CREATE TABLE "new_Timesheet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "applicationId" TEXT NOT NULL,
    "weekStartDate" DATETIME NOT NULL,
    "weekEndDate" DATETIME NOT NULL,
    "hoursWorked" REAL NOT NULL,
    "ratePerHour" REAL NOT NULL,
    "engineerRatePerHour" REAL NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'ZAR',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "submittedAt" DATETIME,
    "approvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Timesheet_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Timesheet" ("applicationId", "approvedAt", "createdAt", "currency", "engineerRatePerHour", "hoursWorked", "id", "ratePerHour", "status", "submittedAt", "updatedAt", "weekEndDate", "weekStartDate") SELECT "applicationId", "approvedAt", "createdAt", "currency", "engineerRatePerHour", "hoursWorked", "id", "ratePerHour", "status", "submittedAt", "updatedAt", "weekEndDate", "weekStartDate" FROM "Timesheet";
DROP TABLE "Timesheet";
ALTER TABLE "new_Timesheet" RENAME TO "Timesheet";
CREATE INDEX "Timesheet_tenantId_createdAt_idx" ON "Timesheet"("tenantId", "createdAt");
CREATE INDEX "Timesheet_applicationId_weekStartDate_idx" ON "Timesheet"("applicationId", "weekStartDate");
CREATE TABLE "new_Vacancy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "clientAccountId" TEXT NOT NULL,
    "hiringManagerId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'OPEN',
    "slaDate" DATETIME,
    "interviewFeedback" TEXT,
    "offerStatus" TEXT,
    "reasonCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Vacancy_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Vacancy_hiringManagerId_fkey" FOREIGN KEY ("hiringManagerId") REFERENCES "ClientContact" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Vacancy" ("clientAccountId", "createdAt", "description", "hiringManagerId", "id", "interviewFeedback", "offerStatus", "reasonCode", "slaDate", "stage", "title", "updatedAt") SELECT "clientAccountId", "createdAt", "description", "hiringManagerId", "id", "interviewFeedback", "offerStatus", "reasonCode", "slaDate", "stage", "title", "updatedAt" FROM "Vacancy";
DROP TABLE "Vacancy";
ALTER TABLE "new_Vacancy" RENAME TO "Vacancy";
CREATE INDEX "Vacancy_tenantId_createdAt_idx" ON "Vacancy"("tenantId", "createdAt");
CREATE INDEX "Vacancy_clientAccountId_stage_idx" ON "Vacancy"("clientAccountId", "stage");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
