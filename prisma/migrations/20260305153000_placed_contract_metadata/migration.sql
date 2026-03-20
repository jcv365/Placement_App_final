ALTER TABLE "Application" ADD COLUMN "placedAt" DATETIME;
ALTER TABLE "Application" ADD COLUMN "agreedHourlyRate" REAL;
ALTER TABLE "Application" ADD COLUMN "agreedRateLockedAt" DATETIME;
ALTER TABLE "Application" ADD COLUMN "signedContractFileName" TEXT;
ALTER TABLE "Application" ADD COLUMN "signedContractMimeType" TEXT;
ALTER TABLE "Application" ADD COLUMN "signedContractData" BLOB;
ALTER TABLE "Application" ADD COLUMN "signedContractUploadedAt" DATETIME;
