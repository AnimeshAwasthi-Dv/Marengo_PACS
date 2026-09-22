ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "portalRole" TEXT;

UPDATE "users"
SET "portalRole" = CASE
  WHEN "role" = 'CLIENT_USER' AND "portalRole" IS NULL THEN 'IT_TEAM'
  ELSE "portalRole"
END;

CREATE INDEX IF NOT EXISTS "users_clientId_portalRole_idx"
  ON "users"("clientId", "portalRole");
