ALTER TABLE "report_format_settings"
  ADD COLUMN "includeRadiologistSignature" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "signatureDetailFields" TEXT[] NOT NULL DEFAULT ARRAY['fullName', 'qualification', 'medicalRegistrationNumber', 'organisationName']::TEXT[];

ALTER TABLE "radiologist_profiles"
  ADD COLUMN "documentUrl" TEXT,
  ADD COLUMN "documentName" TEXT;
