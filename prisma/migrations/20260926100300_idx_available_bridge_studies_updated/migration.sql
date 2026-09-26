-- Fetch-key index: worklist incremental refresh for unscoped (super admin) workspaces
-- CONCURRENTLY avoids locking this hot table; it must be the only statement in the migration.
-- If it fails, drop the INVALID index before retrying: DROP INDEX CONCURRENTLY IF EXISTS "available_bridge_studies_updatedAt_idx";
CREATE INDEX CONCURRENTLY IF NOT EXISTS "available_bridge_studies_updatedAt_idx" ON "available_bridge_studies"("updatedAt");
