ALTER TABLE "pacs_config"
ADD COLUMN IF NOT EXISTS "extraEndpoints" JSONB NOT NULL DEFAULT '[]'::jsonb;
