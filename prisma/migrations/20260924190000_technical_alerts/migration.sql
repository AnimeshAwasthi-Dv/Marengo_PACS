CREATE TABLE "technical_incidents" (
  "id" TEXT PRIMARY KEY,
  "probeId" TEXT NOT NULL,
  "service" TEXT NOT NULL,
  "center" TEXT NOT NULL,
  "detail" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN' CHECK ("status" IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
  "observedStatus" TEXT NOT NULL,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastObservedAt" TIMESTAMP(3) NOT NULL,
  "acknowledgedAt" TIMESTAMP(3),
  "acknowledgedBy" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "resolvedBy" TEXT,
  "resolution" TEXT,
  "nextReminderAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reminderCount" INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX "technical_incidents_active_probe" ON "technical_incidents" ("probeId") WHERE "status" <> 'RESOLVED';
CREATE INDEX "technical_incidents_reminders" ON "technical_incidents" ("status", "nextReminderAt");
CREATE TABLE "technical_alert_events" (
  "id" TEXT PRIMARY KEY,
  "incidentId" TEXT NOT NULL REFERENCES "technical_incidents"("id"),
  "event" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "detail" TEXT NOT NULL,
  "chatId" TEXT,
  "messageId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "technical_alert_events_incident" ON "technical_alert_events" ("incidentId", "createdAt");
CREATE UNIQUE INDEX "technical_alert_events_message" ON "technical_alert_events" ("chatId", "messageId", "incidentId") WHERE "messageId" IS NOT NULL;
CREATE TABLE "technical_monitor_state" (
  "id" TEXT PRIMARY KEY,
  "lastCheckAt" TIMESTAMP(3),
  "lastTickAt" TIMESTAMP(3),
  "updateOffset" BIGINT NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "checks" JSONB NOT NULL DEFAULT '[]'
);
INSERT INTO "technical_monitor_state" ("id") VALUES ('primary');
