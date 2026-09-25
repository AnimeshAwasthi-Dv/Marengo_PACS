-- Fetch-key index: study -> report lookup, repush guard
-- CONCURRENTLY avoids locking this hot table; it must be the only statement in the migration.
-- If it fails, drop the INVALID index before retrying: DROP INDEX CONCURRENTLY IF EXISTS "report_reviews_clientId_studyUid_status_idx";
CREATE INDEX CONCURRENTLY IF NOT EXISTS "report_reviews_clientId_studyUid_status_idx" ON "report_reviews"("clientId", "studyUid", "status");
