ALTER TABLE "CompanySettings" ADD COLUMN "graphAccessTokenEncrypted" TEXT;
ALTER TABLE "CompanySettings" ADD COLUMN "graphConnectedEmail" TEXT;
ALTER TABLE "CompanySettings" ADD COLUMN "graphTokenExpiresAt" DATETIME;
ALTER TABLE "CompanySettings" ADD COLUMN "graphConnectedAt" DATETIME;
