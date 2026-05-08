-- AlterTable: add ATS-formatted CV storage fields to Candidate
ALTER TABLE "Candidate" ADD COLUMN "formattedCvText" TEXT;
ALTER TABLE "Candidate" ADD COLUMN "formattedCvPdfData" BLOB;
ALTER TABLE "Candidate" ADD COLUMN "formattedCvFileName" TEXT;
ALTER TABLE "Candidate" ADD COLUMN "formattedCvGeneratedAt" DATETIME;
