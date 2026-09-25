-- Fetch-key index: admin overview recent jobs (ORDER BY updatedAt DESC LIMIT 50)
-- CONCURRENTLY avoids locking this hot table; it must be the only statement in the migration.
-- If it fails, drop the INVALID index before retrying: DROP INDEX CONCURRENTLY IF EXISTS "processing_jobs_updatedAt_idx";
CREATE INDEX CONCURRENTLY IF NOT EXISTS "processing_jobs_updatedAt_idx" ON "processing_jobs"("updatedAt");
