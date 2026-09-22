CREATE TYPE "ClientKind" AS ENUM ('GROUP', 'CENTER');

ALTER TABLE "clients"
  ADD COLUMN "kind" "ClientKind" NOT NULL DEFAULT 'CENTER',
  ADD COLUMN "parentClientId" TEXT;

ALTER TABLE "clients"
  ADD CONSTRAINT "clients_parentClientId_fkey"
  FOREIGN KEY ("parentClientId") REFERENCES "clients"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "clients_kind_parentClientId_idx" ON "clients"("kind", "parentClientId");

UPDATE "clients" SET "kind" = 'GROUP', "studySyncEnabled" = false WHERE "code" = 'MARENGO';
UPDATE "clients" AS child
SET "kind" = 'CENTER', "parentClientId" = parent."id"
FROM "clients" AS parent
WHERE parent."code" = 'MARENGO'
  AND child."code" LIKE 'MARENGO\_%' ESCAPE '\';
