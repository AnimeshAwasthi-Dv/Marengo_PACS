CREATE TABLE "report_public_shares" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_public_shares_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "report_public_shares_token_key" ON "report_public_shares"("token");
CREATE UNIQUE INDEX "report_public_shares_reportId_key" ON "report_public_shares"("reportId");

ALTER TABLE "report_public_shares"
  ADD CONSTRAINT "report_public_shares_reportId_fkey"
  FOREIGN KEY ("reportId") REFERENCES "report_reviews"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
