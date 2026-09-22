ALTER TABLE "pacs_config"
  ADD COLUMN IF NOT EXISTS "outsourceTeleradiology" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "processing_jobs"
  ADD COLUMN IF NOT EXISTS "demoMode" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "radiologist_profiles"
  ADD COLUMN IF NOT EXISTS "managerUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "providerCode" TEXT,
  ALTER COLUMN "clientId" DROP NOT NULL;

CREATE TABLE IF NOT EXISTS "notification_outbox" (
  "id" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "aggregateType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "report_call_bookings" (
  "id" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "radiologistId" TEXT,
  "slotStart" TIMESTAMP(3) NOT NULL,
  "slotEnd" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'BOOKED',
  "requestedDurationMinutes" INTEGER NOT NULL DEFAULT 15,
  "actualDurationMinutes" INTEGER,
  "communicationMode" TEXT NOT NULL DEFAULT 'BUILT_IN_MEETING',
  "phoneNumber" TEXT,
  "pricePerMinuteMinor" INTEGER NOT NULL DEFAULT 1000,
  "estimatedAmountMinor" INTEGER NOT NULL DEFAULT 15000,
  "finalAmountMinor" INTEGER,
  "managerAcceptedAt" TIMESTAMP(3),
  "managerAcceptedByUserId" TEXT,
  "radiologistAcceptedAt" TIMESTAMP(3),
  "radiologistAcceptedByUserId" TEXT,
  "completedAt" TIMESTAMP(3),
  "billedTransactionId" TEXT,
  "meetingRoom" TEXT NOT NULL,
  "meetingUrl" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "report_call_bookings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "radiologist_availability" (
  "id" TEXT NOT NULL,
  "providerCode" TEXT NOT NULL,
  "radiologistId" TEXT NOT NULL,
  "slotStart" TIMESTAMP(3) NOT NULL,
  "slotEnd" TIMESTAMP(3) NOT NULL,
  "durationMinutes" INTEGER NOT NULL DEFAULT 15,
  "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "radiologist_availability_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "notification_outbox_idempotencyKey_key" ON "notification_outbox"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "notification_outbox_status_nextAttemptAt_idx" ON "notification_outbox"("status", "nextAttemptAt");
CREATE UNIQUE INDEX IF NOT EXISTS "report_call_bookings_meetingRoom_key" ON "report_call_bookings"("meetingRoom");
CREATE INDEX IF NOT EXISTS "radiologist_availability_providerCode_slotStart_idx" ON "radiologist_availability"("providerCode", "slotStart");
CREATE INDEX IF NOT EXISTS "radiologist_availability_radiologistId_slotStart_idx" ON "radiologist_availability"("radiologistId", "slotStart");
CREATE UNIQUE INDEX IF NOT EXISTS "clients_hospitalSlug_key" ON "clients"("hospitalSlug");
CREATE UNIQUE INDEX IF NOT EXISTS "pacs_config_urgentReceivingPort_key" ON "pacs_config"("urgentReceivingPort");
CREATE UNIQUE INDEX IF NOT EXISTS "pacs_config_urgentAeTitle_key" ON "pacs_config"("urgentAeTitle");

ALTER TABLE "radiologist_profiles"
  DROP CONSTRAINT IF EXISTS "radiologist_profiles_clientId_fkey",
  ADD CONSTRAINT "radiologist_profiles_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "radiologist_profiles"
  DROP CONSTRAINT IF EXISTS "radiologist_profiles_managerUserId_fkey",
  ADD CONSTRAINT "radiologist_profiles_managerUserId_fkey"
  FOREIGN KEY ("managerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "report_call_bookings"
  DROP CONSTRAINT IF EXISTS "report_call_bookings_reportId_fkey",
  ADD CONSTRAINT "report_call_bookings_reportId_fkey"
  FOREIGN KEY ("reportId") REFERENCES "report_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "report_call_bookings"
  DROP CONSTRAINT IF EXISTS "report_call_bookings_clientId_fkey",
  ADD CONSTRAINT "report_call_bookings_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "report_call_bookings"
  DROP CONSTRAINT IF EXISTS "report_call_bookings_radiologistId_fkey",
  ADD CONSTRAINT "report_call_bookings_radiologistId_fkey"
  FOREIGN KEY ("radiologistId") REFERENCES "radiologist_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "report_call_bookings"
  DROP CONSTRAINT IF EXISTS "report_call_bookings_managerAcceptedByUserId_fkey",
  ADD CONSTRAINT "report_call_bookings_managerAcceptedByUserId_fkey"
  FOREIGN KEY ("managerAcceptedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "report_call_bookings"
  DROP CONSTRAINT IF EXISTS "report_call_bookings_radiologistAcceptedByUserId_fkey",
  ADD CONSTRAINT "report_call_bookings_radiologistAcceptedByUserId_fkey"
  FOREIGN KEY ("radiologistAcceptedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "radiologist_availability"
  DROP CONSTRAINT IF EXISTS "radiologist_availability_radiologistId_fkey",
  ADD CONSTRAINT "radiologist_availability_radiologistId_fkey"
  FOREIGN KEY ("radiologistId") REFERENCES "radiologist_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "radiologist_availability"
  DROP CONSTRAINT IF EXISTS "radiologist_availability_createdByUserId_fkey",
  ADD CONSTRAINT "radiologist_availability_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
