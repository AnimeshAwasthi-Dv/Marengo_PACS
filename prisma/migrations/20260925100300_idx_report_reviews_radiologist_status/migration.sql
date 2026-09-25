-- Fetch-key index: radiologist dashboard: assigned OR unassigned-and-open reports
-- CONCURRENTLY avoids locking this hot table; it must be the only statement in the migration.
-- If it fails, drop the INVALID index before retrying: DROP INDEX CONCURRENTLY IF EXISTS "report_reviews_radiologistId_status_idx";
CREATE INDEX CONCURRENTLY IF NOT EXISTS "report_reviews_radiologistId_status_idx" ON "report_reviews"("radiologistId", "status");
