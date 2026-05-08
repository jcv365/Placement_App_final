-- Rename weekly timesheet columns to monthly period columns
ALTER TABLE "Timesheet" RENAME COLUMN "weekStartDate" TO "periodStartDate";
ALTER TABLE "Timesheet" RENAME COLUMN "weekEndDate" TO "periodEndDate";

-- Recreate index with new column name
DROP INDEX IF EXISTS "Timesheet_applicationId_weekStartDate_idx";
CREATE INDEX "Timesheet_applicationId_periodStartDate_idx" ON "Timesheet"("applicationId", "periodStartDate");
