ALTER TABLE "notification_events" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'SYSTEM';
CREATE INDEX "notification_events_category_occurredAt_idx" ON "notification_events"("category", "occurredAt");
