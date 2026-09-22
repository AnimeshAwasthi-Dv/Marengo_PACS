ALTER TABLE "available_bridge_studies"
  ADD COLUMN IF NOT EXISTS "localIp" TEXT,
  ADD COLUMN IF NOT EXISTS "localPort" INTEGER,
  ADD COLUMN IF NOT EXISTS "localAeTitle" TEXT,
  ADD COLUMN IF NOT EXISTS "archiveName" TEXT,
  ADD COLUMN IF NOT EXISTS "archivePath" TEXT,
  ADD COLUMN IF NOT EXISTS "clinicalIndication" TEXT,
  ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "processingJobId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "available_bridge_studies_processingJobId_key"
  ON "available_bridge_studies"("processingJobId");

ALTER TABLE "available_bridge_studies"
  DROP CONSTRAINT IF EXISTS "available_bridge_studies_processingJobId_fkey",
  ADD CONSTRAINT "available_bridge_studies_processingJobId_fkey"
  FOREIGN KEY ("processingJobId") REFERENCES "processing_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "bridge_study_attachments" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "bridgeStudyId" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "storedName" TEXT NOT NULL,
  "filePath" TEXT NOT NULL,
  "mimeType" TEXT,
  "sizeBytes" BIGINT NOT NULL DEFAULT 0,
  "uploadedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "bridge_study_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "bridge_study_attachments_clientId_bridgeStudyId_idx"
  ON "bridge_study_attachments"("clientId", "bridgeStudyId");

ALTER TABLE "bridge_study_attachments"
  DROP CONSTRAINT IF EXISTS "bridge_study_attachments_clientId_fkey",
  ADD CONSTRAINT "bridge_study_attachments_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bridge_study_attachments"
  DROP CONSTRAINT IF EXISTS "bridge_study_attachments_bridgeStudyId_fkey",
  ADD CONSTRAINT "bridge_study_attachments_bridgeStudyId_fkey"
  FOREIGN KEY ("bridgeStudyId") REFERENCES "available_bridge_studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
