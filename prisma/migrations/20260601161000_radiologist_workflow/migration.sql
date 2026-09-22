ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'RADIOLOGIST';
ALTER TYPE "ReturnFormat" ADD VALUE IF NOT EXISTS 'HTML';
ALTER TYPE "ReturnFormat" ADD VALUE IF NOT EXISTS 'PDF';
ALTER TYPE "ReturnFormat" ADD VALUE IF NOT EXISTS 'DOCX';

DO $$
BEGIN
  CREATE TYPE "ReportReviewStatus" AS ENUM ('PENDING', 'IN_REVIEW', 'SAVED', 'APPROVED', 'PUSHED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "report_format_settings"
ADD COLUMN IF NOT EXISTS "outputFormat" "ReturnFormat" NOT NULL DEFAULT 'DICOM_ENCAPSULATED_PDF',
ADD COLUMN IF NOT EXISTS "radiologistReviewEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "radiologist_profiles" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT,
  "qualification" TEXT NOT NULL,
  "medicalRegistrationNumber" TEXT NOT NULL,
  "organisationName" TEXT NOT NULL,
  "signatureImageUrl" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "radiologist_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "radiologist_profiles_userId_key" ON "radiologist_profiles"("userId");

ALTER TABLE "radiologist_profiles"
DROP CONSTRAINT IF EXISTS "radiologist_profiles_clientId_fkey",
ADD CONSTRAINT "radiologist_profiles_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "radiologist_profiles"
DROP CONSTRAINT IF EXISTS "radiologist_profiles_userId_fkey",
ADD CONSTRAINT "radiologist_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "report_reviews" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "studyId" TEXT,
  "radiologistId" TEXT,
  "serviceName" TEXT NOT NULL,
  "patientName" TEXT,
  "patientId" TEXT,
  "studyUid" TEXT,
  "accession" TEXT,
  "modality" TEXT,
  "status" "ReportReviewStatus" NOT NULL DEFAULT 'PENDING',
  "outputFormat" "ReturnFormat" NOT NULL DEFAULT 'DICOM_ENCAPSULATED_PDF',
  "aiReportJson" JSONB NOT NULL,
  "editedReportJson" JSONB NOT NULL,
  "locked" BOOLEAN NOT NULL DEFAULT false,
  "pushedAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "report_reviews_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "report_reviews"
DROP CONSTRAINT IF EXISTS "report_reviews_clientId_fkey",
ADD CONSTRAINT "report_reviews_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "report_reviews"
DROP CONSTRAINT IF EXISTS "report_reviews_studyId_fkey",
ADD CONSTRAINT "report_reviews_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "studies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "report_reviews"
DROP CONSTRAINT IF EXISTS "report_reviews_radiologistId_fkey",
ADD CONSTRAINT "report_reviews_radiologistId_fkey" FOREIGN KEY ("radiologistId") REFERENCES "radiologist_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "report_audit_logs" (
  "id" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "action" TEXT NOT NULL,
  "metadata" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "report_audit_logs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "report_audit_logs"
DROP CONSTRAINT IF EXISTS "report_audit_logs_reportId_fkey",
ADD CONSTRAINT "report_audit_logs_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "report_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "report_audit_logs"
DROP CONSTRAINT IF EXISTS "report_audit_logs_actorUserId_fkey",
ADD CONSTRAINT "report_audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
