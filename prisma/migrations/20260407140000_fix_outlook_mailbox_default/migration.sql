-- Fix: Update CompanySettings.outlookMailbox rows that were set to the incorrect
-- historical default ('charl.venter@dotcloud.africa') from the original migration.
-- All such rows should use the shared placements mailbox instead.
UPDATE "CompanySettings"
SET "outlookMailbox" = 'placements@dotcloud.africa'
WHERE "outlookMailbox" = 'charl.venter@dotcloud.africa';
