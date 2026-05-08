-- Add placement billing model fields to Application
ALTER TABLE "Application" ADD COLUMN "placementBillingModel" TEXT;
ALTER TABLE "Application" ADD COLUMN "placementFeePercent" REAL;
ALTER TABLE "Application" ADD COLUMN "annualCtc" REAL;
ALTER TABLE "Application" ADD COLUMN "contractValue" REAL;
