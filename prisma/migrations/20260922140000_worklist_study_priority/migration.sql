ALTER TABLE "available_bridge_studies" ADD COLUMN "priority" TEXT NOT NULL DEFAULT 'REGULAR';

UPDATE "available_bridge_studies" AS study
SET "priority" = 'URGENT'
FROM "processing_jobs" AS job
WHERE study."processingJobId" = job."id" AND job."priority" = 'URGENT';
