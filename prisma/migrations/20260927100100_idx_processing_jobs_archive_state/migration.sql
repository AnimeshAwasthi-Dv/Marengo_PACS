-- Fetch-key index: S3 upload retry and local archive retention sweeps (archiveState, then archiveStoredAt age).
-- CONCURRENTLY avoids locking this hot table; it must be the only statement in the migration.
-- If it fails, drop the INVALID index before retrying: DROP INDEX CONCURRENTLY IF EXISTS "processing_jobs_archiveState_archiveStoredAt_idx";
CREATE INDEX CONCURRENTLY IF NOT EXISTS "processing_jobs_archiveState_archiveStoredAt_idx" ON "processing_jobs"("archiveState", "archiveStoredAt");
