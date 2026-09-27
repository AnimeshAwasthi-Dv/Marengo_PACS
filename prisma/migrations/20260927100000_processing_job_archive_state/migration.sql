-- Local study ZIP lifecycle: S3 upload retries and local retention. Nullable columns and a constant default are metadata-only on Postgres 11+.
ALTER TABLE "processing_jobs"
  ADD COLUMN "archiveState" TEXT,
  ADD COLUMN "archiveStoredAt" TIMESTAMP(3),
  ADD COLUMN "archiveUploadAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "archiveNextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "archiveError" TEXT;
