ALTER TABLE "report_public_shares"
  ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);

UPDATE "report_public_shares"
SET "expiresAt" = "updatedAt" + INTERVAL '5 days'
WHERE "expiresAt" IS NULL;

ALTER TABLE "report_public_shares"
  ALTER COLUMN "expiresAt" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "report_public_shares_expiresAt_idx"
  ON "report_public_shares"("expiresAt");
