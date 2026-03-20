ALTER TABLE "Candidate"
ADD COLUMN "cvFileName" TEXT,
ADD COLUMN "cvMimeType" TEXT,
ADD COLUMN "cvFileData" BLOB,
ADD COLUMN "cvUploadedAt" DATETIME;
