-- Fetch-key index: worklist incremental refresh finds reports changed since the last poll
-- CONCURRENTLY avoids locking this hot table; it must be the only statement in the migration.
-- If it fails, drop the INVALID index before retrying: DROP INDEX CONCURRENTLY IF EXISTS "report_reviews_updatedAt_idx";
CREATE INDEX CONCURRENTLY IF NOT EXISTS "report_reviews_updatedAt_idx" ON "report_reviews"("updatedAt");
