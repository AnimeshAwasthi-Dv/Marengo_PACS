-- Fetch-key index: Renewist callback lookup by study UID, newest first
-- CONCURRENTLY avoids locking this hot table; it must be the only statement in the migration.
-- If it fails, drop the INVALID index before retrying: DROP INDEX CONCURRENTLY IF EXISTS "report_reviews_studyUid_createdAt_idx";
CREATE INDEX CONCURRENTLY IF NOT EXISTS "report_reviews_studyUid_createdAt_idx" ON "report_reviews"("studyUid", "createdAt");
