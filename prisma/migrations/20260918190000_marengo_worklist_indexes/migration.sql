-- Keep Marengo Available Studies full and incremental worklist reads index-backed.
CREATE INDEX "abs_client_pending_sync_idx"
ON "available_bridge_studies"("clientId", "processingJobId", "lastSyncedAt", "id");

CREATE INDEX "abs_client_updated_idx"
ON "available_bridge_studies"("clientId", "updatedAt", "id");
