ALTER TABLE "Candidate" ADD COLUMN "cvFileName" TEXT;
ALTER TABLE "Candidate" ADD COLUMN "cvMimeType" TEXT;
ALTER TABLE "Candidate" ADD COLUMN "cvFileData" BLOB;
ALTER TABLE "Candidate" ADD COLUMN "cvUploadedAt" DATETIME;
