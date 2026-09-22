ALTER TABLE "users" ADD COLUMN "user_id" TEXT;
UPDATE "users" SET "user_id" = lower(split_part("email", '@', 1)) || '-' || substr(md5("id"), 1, 6) WHERE "user_id" IS NULL;
CREATE UNIQUE INDEX "users_user_id_key" ON "users"("user_id");

CREATE TABLE "patients" (
  "id" TEXT NOT NULL, "clientId" TEXT NOT NULL, "patientIdentifier" TEXT NOT NULL, "name" TEXT NOT NULL,
  "dateOfBirth" TIMESTAMP(3), "age" TEXT, "gender" TEXT, "sex" TEXT, "phone" TEXT, "email" TEXT, "address" TEXT,
  "clinicalHistory" TEXT, "medicalHistory" TEXT, "followUpInfo" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "patients_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "patients_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "patients_clientId_patientIdentifier_key" ON "patients"("clientId", "patientIdentifier");
CREATE INDEX "patients_clientId_name_idx" ON "patients"("clientId", "name");
CREATE INDEX "patients_clientId_dateOfBirth_idx" ON "patients"("clientId", "dateOfBirth");

ALTER TABLE "studies" ADD COLUMN "patientId" TEXT;
ALTER TABLE "processing_jobs" ADD COLUMN "patientId" TEXT;
ALTER TABLE "available_bridge_studies" ADD COLUMN "patientProfileId" TEXT;
ALTER TABLE "report_reviews" ADD COLUMN "patientProfileId" TEXT;
ALTER TABLE "studies" ADD CONSTRAINT "studies_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "available_bridge_studies" ADD CONSTRAINT "available_bridge_studies_patientProfileId_fkey" FOREIGN KEY ("patientProfileId") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "report_reviews" ADD CONSTRAINT "report_reviews_patientProfileId_fkey" FOREIGN KEY ("patientProfileId") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "studies_clientId_patientId_idx" ON "studies"("clientId", "patientId");
CREATE INDEX "processing_jobs_clientId_patientId_idx" ON "processing_jobs"("clientId", "patientId");
CREATE INDEX "available_bridge_studies_clientId_patientProfileId_idx" ON "available_bridge_studies"("clientId", "patientProfileId");
CREATE INDEX "report_reviews_clientId_patientProfileId_idx" ON "report_reviews"("clientId", "patientProfileId");

-- Backfill only on the stable center + DICOM Patient ID key; names alone are never merged.
INSERT INTO "patients" ("id", "clientId", "patientIdentifier", "name", "createdAt", "updatedAt")
SELECT 'pat_' || md5(r."clientId" || ':' || r."patientId"), r."clientId", r."patientId", COALESCE(NULLIF(max(r."patientName"), ''), 'Unknown patient'), min(r."createdAt"), now()
FROM "report_reviews" r
WHERE r."patientId" IS NOT NULL AND btrim(r."patientId") <> ''
GROUP BY r."clientId", r."patientId"
ON CONFLICT ("clientId", "patientIdentifier") DO NOTHING;
UPDATE "report_reviews" r SET "patientProfileId" = p."id" FROM "patients" p WHERE p."clientId" = r."clientId" AND p."patientIdentifier" = r."patientId" AND r."patientProfileId" IS NULL;
UPDATE "studies" s SET "patientId" = r."patientProfileId" FROM "report_reviews" r WHERE r."studyId" = s."id" AND r."patientProfileId" IS NOT NULL AND s."patientId" IS NULL;

CREATE TABLE "patient_follow_ups" (
  "id" TEXT NOT NULL, "clientId" TEXT NOT NULL, "patientId" TEXT NOT NULL, "reportId" TEXT, "required" BOOLEAN NOT NULL DEFAULT true,
  "followUpDate" TIMESTAMP(3) NOT NULL, "reason" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING', "notes" TEXT,
  "assignedUserId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "patient_follow_ups_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "patient_follow_ups_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "patient_follow_ups_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "patient_follow_ups_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "report_reviews"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "patient_follow_ups_clientId_status_followUpDate_idx" ON "patient_follow_ups"("clientId", "status", "followUpDate");
CREATE INDEX "patient_follow_ups_patientId_followUpDate_idx" ON "patient_follow_ups"("patientId", "followUpDate");

CREATE TABLE "radiologist_feedback" (
  "id" TEXT NOT NULL, "clientId" TEXT NOT NULL, "patientId" TEXT, "studyId" TEXT, "reportId" TEXT NOT NULL,
  "radiologistUserId" TEXT NOT NULL, "feedbackType" TEXT NOT NULL, "comment" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'NEW',
  "internalNotes" TEXT, "reviewedById" TEXT, "reviewedAt" TIMESTAMP(3), "renewistStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "renewistSyncedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "radiologist_feedback_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "radiologist_feedback_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "radiologist_feedback_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "radiologist_feedback_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "studies"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "radiologist_feedback_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "report_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "radiologist_feedback_radiologistUserId_fkey" FOREIGN KEY ("radiologistUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "radiologist_feedback_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "radiologist_feedback_clientId_status_createdAt_idx" ON "radiologist_feedback"("clientId", "status", "createdAt");
CREATE INDEX "radiologist_feedback_radiologistUserId_createdAt_idx" ON "radiologist_feedback"("radiologistUserId", "createdAt");
CREATE INDEX "radiologist_feedback_reportId_idx" ON "radiologist_feedback"("reportId");
CREATE INDEX "radiologist_feedback_renewistStatus_idx" ON "radiologist_feedback"("renewistStatus");
