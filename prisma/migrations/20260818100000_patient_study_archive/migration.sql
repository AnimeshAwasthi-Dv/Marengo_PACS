CREATE TABLE "patient_study_archives" (
  "id" TEXT NOT NULL, "clientId" TEXT NOT NULL, "patientId" TEXT NOT NULL,
  "studyInstanceUid" TEXT, "accessionNumber" TEXT, "studyDate" TIMESTAMP(3), "modality" TEXT,
  "studyDescription" TEXT NOT NULL, "bodyRegion" TEXT, "clinicalIndication" TEXT,
  "institutionName" TEXT, "referringPhysician" TEXT, "seriesCount" INTEGER, "instanceCount" INTEGER,
  "createdByUserId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "patient_study_archives_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "patient_study_archives_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "patient_study_archives_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "patient_study_archives_clientId_patientId_studyDate_idx" ON "patient_study_archives"("clientId", "patientId", "studyDate");
CREATE INDEX "patient_study_archives_studyInstanceUid_idx" ON "patient_study_archives"("studyInstanceUid");

CREATE TABLE "patient_study_archive_files" (
  "id" TEXT NOT NULL, "archiveId" TEXT NOT NULL, "role" TEXT NOT NULL, "originalName" TEXT NOT NULL,
  "storedName" TEXT NOT NULL, "filePath" TEXT NOT NULL, "mimeType" TEXT, "sizeBytes" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "patient_study_archive_files_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "patient_study_archive_files_archiveId_fkey" FOREIGN KEY ("archiveId") REFERENCES "patient_study_archives"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "patient_study_archive_files_archiveId_role_idx" ON "patient_study_archive_files"("archiveId", "role");
