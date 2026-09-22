ALTER TABLE "clients"
ADD COLUMN IF NOT EXISTS "hospitalSlug" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "clients_hospitalSlug_key"
ON "clients"("hospitalSlug")
WHERE "hospitalSlug" IS NOT NULL;

ALTER TABLE "pacs_config"
ADD COLUMN IF NOT EXISTS "urgentReceivingPort" INTEGER,
ADD COLUMN IF NOT EXISTS "urgentAeTitle" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "pacs_config_urgentReceivingPort_key"
ON "pacs_config"("urgentReceivingPort")
WHERE "urgentReceivingPort" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "pacs_config_urgentAeTitle_key"
ON "pacs_config"("urgentAeTitle")
WHERE "urgentAeTitle" IS NOT NULL;
