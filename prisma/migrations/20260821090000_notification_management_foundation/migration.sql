ALTER TABLE "radiologist_feedback"
  ADD COLUMN "overallRating" INTEGER,
  ADD COLUMN "accuracyAssessment" TEXT,
  ADD COLUMN "falsePositive" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "falseNegative" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "missedFinding" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "incorrectFinding" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "severity" TEXT,
  ADD COLUMN "categories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "submissionVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "report_call_bookings"
  ADD COLUMN "reason" TEXT,
  ADD COLUMN "requestMessage" TEXT,
  ADD COLUMN "urgency" TEXT NOT NULL DEFAULT 'ROUTINE',
  ADD COLUMN "confirmedAt" TIMESTAMP(3),
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "rescheduledAt" TIMESTAMP(3);

ALTER TABLE "notification_recipients"
  ADD COLUMN "userId" TEXT,
  ADD COLUMN "verificationStatus" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "verifiedAt" TIMESTAMP(3),
  ADD COLUMN "lastNotificationAt" TIMESTAMP(3),
  ADD COLUMN "accessCategories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "notification_recipients"
SET "verificationStatus" = 'VERIFIED', "verifiedAt" = COALESCE("updatedAt", NOW())
WHERE "consentStatus" IN ('OPTED_IN', 'APPROVED', 'ACTIVE');

CREATE TABLE "notification_events" (
  "id" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "aggregateType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "clientId" TEXT,
  "patientRef" TEXT,
  "stage" TEXT,
  "status" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "idempotencyKey" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notification_deliveries" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "clientId" TEXT,
  "recipientUserId" TEXT,
  "recipientOrganization" TEXT NOT NULL,
  "recipientKey" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "sentAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "demo_requests" (
  "id" TEXT NOT NULL,
  "requestNumber" TEXT NOT NULL,
  "clientId" TEXT,
  "name" TEXT NOT NULL,
  "organization" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "source" TEXT NOT NULL,
  "requestedProduct" TEXT,
  "purpose" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'NEW',
  "assignedUserId" TEXT,
  "notes" TEXT,
  "contactedAt" TIMESTAMP(3),
  "scheduledAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "demo_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_events_idempotencyKey_key" ON "notification_events"("idempotencyKey");
CREATE INDEX "notification_events_clientId_eventType_occurredAt_idx" ON "notification_events"("clientId", "eventType", "occurredAt");
CREATE INDEX "notification_events_aggregateType_aggregateId_idx" ON "notification_events"("aggregateType", "aggregateId");
CREATE INDEX "notification_events_status_occurredAt_idx" ON "notification_events"("status", "occurredAt");
CREATE UNIQUE INDEX "notification_deliveries_eventId_recipientKey_channel_key" ON "notification_deliveries"("eventId", "recipientKey", "channel");
CREATE INDEX "notification_deliveries_recipientUserId_readAt_createdAt_idx" ON "notification_deliveries"("recipientUserId", "readAt", "createdAt");
CREATE INDEX "notification_deliveries_recipientOrganization_status_createdAt_idx" ON "notification_deliveries"("recipientOrganization", "status", "createdAt");
CREATE INDEX "notification_deliveries_clientId_createdAt_idx" ON "notification_deliveries"("clientId", "createdAt");
CREATE UNIQUE INDEX "demo_requests_requestNumber_key" ON "demo_requests"("requestNumber");
CREATE INDEX "demo_requests_clientId_status_createdAt_idx" ON "demo_requests"("clientId", "status", "createdAt");
CREATE INDEX "demo_requests_status_createdAt_idx" ON "demo_requests"("status", "createdAt");
CREATE INDEX "demo_requests_email_idx" ON "demo_requests"("email");
CREATE UNIQUE INDEX "radiologist_feedback_reportId_radiologistUserId_submissionVersion_key" ON "radiologist_feedback"("reportId", "radiologistUserId", "submissionVersion");
CREATE UNIQUE INDEX "notification_recipients_phoneE164_key" ON "notification_recipients"("phoneE164");
CREATE INDEX "notification_recipients_userId_active_idx" ON "notification_recipients"("userId", "active");

ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "notification_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "demo_requests" ADD CONSTRAINT "demo_requests_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
