ALTER TABLE "Candidate"
ADD COLUMN "criminalRecordFileName" TEXT;

ALTER TABLE "Candidate"
ADD COLUMN "criminalRecordMimeType" TEXT;

ALTER TABLE "Candidate"
ADD COLUMN "criminalRecordFileData" BLOB;

ALTER TABLE "Candidate"
ADD COLUMN "criminalRecordUploadedAt" DATETIME;
