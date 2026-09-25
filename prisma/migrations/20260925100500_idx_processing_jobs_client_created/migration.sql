-- Fetch-key index: client dashboard jobs (clientId IN ... ORDER BY createdAt DESC)
-- CONCURRENTLY avoids locking this hot table; it must be the only statement in the migration.
-- If it fails, drop the INVALID index before retrying: DROP INDEX CONCURRENTLY IF EXISTS "processing_jobs_clientId_createdAt_idx";
CREATE INDEX CONCURRENTLY IF NOT EXISTS "processing_jobs_clientId_createdAt_idx" ON "processing_jobs"("clientId", "createdAt");
