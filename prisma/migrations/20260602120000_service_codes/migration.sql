ALTER TABLE "services" ADD COLUMN "code" TEXT;

UPDATE "services"
SET "code" = CASE
  WHEN "name" = 'DecXpert X-ray Suite' THEN 'PAC01'
  WHEN "name" = 'DecXpert CT Thorax' THEN 'PAC02'
  ELSE upper(substr(replace("id", '-', ''), 1, 5))
END
WHERE "code" IS NULL;

ALTER TABLE "services" ALTER COLUMN "code" SET NOT NULL;
CREATE UNIQUE INDEX "services_code_key" ON "services"("code");
