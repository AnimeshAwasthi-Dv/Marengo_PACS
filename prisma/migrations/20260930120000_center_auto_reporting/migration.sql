ALTER TABLE "clients" ADD COLUMN "autoReportingModalities" TEXT[] NOT NULL DEFAULT ARRAY['XR']::TEXT[];
ALTER TABLE "available_bridge_studies" ADD COLUMN "autoSubmitAt" TIMESTAMP(3);
CREATE INDEX "available_bridge_studies_autoSubmitAt_processingJobId_idx" ON "available_bridge_studies"("autoSubmitAt", "processingJobId");
