-- Fetch-key index: Renewist callback OR lookup by providerJobId
-- CONCURRENTLY avoids locking this hot table; it must be the only statement in the migration.
-- If it fails, drop the INVALID index before retrying: DROP INDEX CONCURRENTLY IF EXISTS "processing_jobs_providerJobId_idx";
CREATE INDEX CONCURRENTLY IF NOT EXISTS "processing_jobs_providerJobId_idx" ON "processing_jobs"("providerJobId");
