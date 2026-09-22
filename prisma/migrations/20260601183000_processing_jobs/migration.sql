CREATE TABLE "processing_jobs" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "serviceType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "upstreamStatus" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "imageCount" INTEGER NOT NULL DEFAULT 0,
  "uploadName" TEXT NOT NULL,
  "uploadPath" TEXT NOT NULL,
  "cleanedPath" TEXT,
  "reportHtml" TEXT,
  "error" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "processing_jobs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "processing_jobs"
  ADD CONSTRAINT "processing_jobs_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "processing_jobs_clientId_idx" ON "processing_jobs"("clientId");
CREATE INDEX "processing_jobs_status_idx" ON "processing_jobs"("status");
