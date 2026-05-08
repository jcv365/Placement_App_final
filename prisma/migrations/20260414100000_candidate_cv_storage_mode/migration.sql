-- AlterTable: add cvStorageMode field to Candidate (defaults to FULL for existing rows)
ALTER TABLE "Candidate" ADD COLUMN "cvStorageMode" TEXT NOT NULL DEFAULT 'FULL';
