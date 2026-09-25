-- Fetch-key index: admin and provider audit lists (ORDER BY createdAt DESC)
-- CONCURRENTLY avoids locking this hot table; it must be the only statement in the migration.
-- If it fails, drop the INVALID index before retrying: DROP INDEX CONCURRENTLY IF EXISTS "audit_logs_createdAt_idx";
CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");
