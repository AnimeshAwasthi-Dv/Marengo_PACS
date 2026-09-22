UPDATE "available_bridge_studies" AS bridge
SET "patientProfileId" = patient.id
FROM "patients" AS patient
WHERE bridge."patientProfileId" IS NULL
  AND bridge."patientId" IS NOT NULL
  AND patient."clientId" = bridge."clientId"
  AND LOWER(BTRIM(patient."patientIdentifier")) = LOWER(BTRIM(bridge."patientId"));

UPDATE "processing_jobs" AS processing
SET "patientId" = bridge."patientProfileId"
FROM "available_bridge_studies" AS bridge
WHERE processing."patientId" IS NULL
  AND bridge."processingJobId" = processing.id
  AND bridge."patientProfileId" IS NOT NULL;

UPDATE "report_reviews" AS report
SET "patientProfileId" = patient.id
FROM "patients" AS patient
WHERE report."patientProfileId" IS NULL
  AND report."patientId" IS NOT NULL
  AND patient."clientId" = report."clientId"
  AND LOWER(BTRIM(patient."patientIdentifier")) = LOWER(BTRIM(report."patientId"));

UPDATE "studies" AS study
SET "patientId" = report."patientProfileId"
FROM "report_reviews" AS report
WHERE study."patientId" IS NULL
  AND report."studyId" = study.id
  AND report."patientProfileId" IS NOT NULL;

UPDATE "patients" AS patient
SET "clinicalHistory" = indication."clinicalIndication"
FROM (
  SELECT DISTINCT ON (bridge."patientProfileId") bridge."patientProfileId", bridge."clinicalIndication"
  FROM "available_bridge_studies" AS bridge
  WHERE bridge."patientProfileId" IS NOT NULL
    AND bridge."clinicalIndication" IS NOT NULL
    AND BTRIM(bridge."clinicalIndication") <> ''
  ORDER BY bridge."patientProfileId", bridge."updatedAt" DESC
) AS indication
WHERE patient.id = indication."patientProfileId"
  AND (patient."clinicalHistory" IS NULL OR BTRIM(patient."clinicalHistory") = '');
