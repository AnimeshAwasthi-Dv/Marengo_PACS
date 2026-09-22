CREATE TABLE IF NOT EXISTS "available_bridge_studies" (
  "id" TEXT NOT NULL,
  "publicStudyId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "agentName" TEXT,
  "studyInstanceUid" TEXT NOT NULL,
  "patientId" TEXT,
  "patientName" TEXT,
  "patientSex" TEXT,
  "patientAge" TEXT,
  "accessionNumber" TEXT,
  "studyDate" TEXT,
  "studyTime" TEXT,
  "studyDescription" TEXT,
  "modalities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "institutionName" TEXT,
  "referringPhysician" TEXT,
  "seriesCount" INTEGER NOT NULL DEFAULT 0,
  "instanceCount" INTEGER NOT NULL DEFAULT 0,
  "totalSizeBytes" BIGINT NOT NULL DEFAULT 0,
  "studyFingerprint" TEXT,
  "availabilityStatus" TEXT NOT NULL DEFAULT 'Available',
  "workflowStatus" TEXT NOT NULL DEFAULT 'Available',
  "firstDetectedAt" TIMESTAMP(3),
  "readyAt" TIMESTAMP(3),
  "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "selectedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "available_bridge_studies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "available_bridge_studies_publicStudyId_key"
ON "available_bridge_studies"("publicStudyId");

CREATE UNIQUE INDEX IF NOT EXISTS "available_bridge_studies_clientId_agentId_studyInstanceUid_key"
ON "available_bridge_studies"("clientId", "agentId", "studyInstanceUid");

CREATE INDEX IF NOT EXISTS "available_bridge_studies_clientId_workflowStatus_availabilityStatus_idx"
ON "available_bridge_studies"("clientId", "workflowStatus", "availabilityStatus");

CREATE INDEX IF NOT EXISTS "available_bridge_studies_clientId_agentId_idx"
ON "available_bridge_studies"("clientId", "agentId");

ALTER TABLE "available_bridge_studies"
DROP CONSTRAINT IF EXISTS "available_bridge_studies_clientId_fkey",
ADD CONSTRAINT "available_bridge_studies_clientId_fkey"
FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "bridge_dispatch_requests" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "availableStudyId" TEXT NOT NULL,
  "serviceType" TEXT NOT NULL,
  "priority" TEXT NOT NULL DEFAULT 'REGULAR',
  "status" TEXT NOT NULL DEFAULT 'Pending',
  "destinationJson" JSONB NOT NULL,
  "totalInstances" INTEGER NOT NULL DEFAULT 0,
  "sentInstances" INTEGER NOT NULL DEFAULT 0,
  "failedInstances" INTEGER NOT NULL DEFAULT 0,
  "progressPercentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "requestedBy" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "agentAcknowledgedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "lastErrorMessage" TEXT,
  "idempotencyKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bridge_dispatch_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "bridge_dispatch_requests_requestId_key"
ON "bridge_dispatch_requests"("requestId");

CREATE INDEX IF NOT EXISTS "bridge_dispatch_requests_clientId_agentId_status_idx"
ON "bridge_dispatch_requests"("clientId", "agentId", "status");

CREATE INDEX IF NOT EXISTS "bridge_dispatch_requests_availableStudyId_status_idx"
ON "bridge_dispatch_requests"("availableStudyId", "status");

ALTER TABLE "bridge_dispatch_requests"
DROP CONSTRAINT IF EXISTS "bridge_dispatch_requests_clientId_fkey",
ADD CONSTRAINT "bridge_dispatch_requests_clientId_fkey"
FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bridge_dispatch_requests"
DROP CONSTRAINT IF EXISTS "bridge_dispatch_requests_availableStudyId_fkey",
ADD CONSTRAINT "bridge_dispatch_requests_availableStudyId_fkey"
FOREIGN KEY ("availableStudyId") REFERENCES "available_bridge_studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
