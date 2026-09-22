ALTER TABLE "processing_jobs"
ADD COLUMN IF NOT EXISTS "internalJobId" TEXT,
ADD COLUMN IF NOT EXISTS "workflowType" TEXT,
ADD COLUMN IF NOT EXISTS "clinicalStatus" TEXT,
ADD COLUMN IF NOT EXISTS "priority" TEXT,
ADD COLUMN IF NOT EXISTS "providerJobId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "processing_jobs_internalJobId_key" ON "processing_jobs"("internalJobId");

CREATE TABLE IF NOT EXISTS "teleradiology_providers" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "apiBaseUrl" TEXT,
  "authType" TEXT NOT NULL DEFAULT 'HMAC',
  "credentialReference" TEXT,
  "studySubmissionEndpoint" TEXT,
  "statusEndpoint" TEXT,
  "reportCallbackEndpoint" TEXT,
  "reportRetrievalEndpoint" TEXT,
  "supportedModalities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "supportedBodyParts" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "supportedStudyFormats" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "supportedReportFormats" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "expectedTatMinutes" INTEGER,
  "emergencyTatMinutes" INTEGER,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "webhookSecretHash" TEXT,
  "allowedSourceIps" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "fieldMappings" JSONB NOT NULL DEFAULT '{}',
  "statusMappings" JSONB NOT NULL DEFAULT '{}',
  "reportMappings" JSONB NOT NULL DEFAULT '{}',
  "retryPolicy" JSONB NOT NULL DEFAULT '{}',
  "timeoutSeconds" INTEGER NOT NULL DEFAULT 60,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "teleradiology_providers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "teleradiology_providers_code_key" ON "teleradiology_providers"("code");

CREATE TABLE IF NOT EXISTS "provider_job_mapping" (
  "id" TEXT NOT NULL,
  "providerId" TEXT,
  "processingJobId" TEXT,
  "reportReviewId" TEXT,
  "dectrocelJobId" TEXT NOT NULL,
  "providerJobId" TEXT,
  "studyInstanceUid" TEXT,
  "accessionNumber" TEXT,
  "status" TEXT NOT NULL DEFAULT 'CREATED',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_job_mapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "provider_job_mapping_dectrocelJobId_key" ON "provider_job_mapping"("dectrocelJobId");
CREATE UNIQUE INDEX IF NOT EXISTS "provider_job_mapping_providerId_providerJobId_key" ON "provider_job_mapping"("providerId", "providerJobId");

CREATE TABLE IF NOT EXISTS "provider_api_requests" (
  "id" TEXT NOT NULL,
  "providerId" TEXT,
  "requestId" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "authenticated" BOOLEAN NOT NULL DEFAULT false,
  "idempotencyKey" TEXT,
  "requestHash" TEXT,
  "responseCode" INTEGER,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_api_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "provider_api_requests_requestId_key" ON "provider_api_requests"("requestId");

CREATE TABLE IF NOT EXISTS "provider_report_submissions" (
  "id" TEXT NOT NULL,
  "providerId" TEXT,
  "requestId" TEXT NOT NULL,
  "dectrocelJobId" TEXT NOT NULL,
  "renewistJobId" TEXT NOT NULL,
  "reportStatus" TEXT NOT NULL,
  "reportType" TEXT NOT NULL,
  "reportFormat" TEXT NOT NULL,
  "reportVersion" INTEGER NOT NULL DEFAULT 1,
  "reportFilePath" TEXT,
  "reportChecksum" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "reportReviewId" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "processingError" TEXT,
  CONSTRAINT "provider_report_submissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "provider_report_submissions_requestId_key" ON "provider_report_submissions"("requestId");
CREATE UNIQUE INDEX IF NOT EXISTS "provider_report_submissions_dectrocelJobId_renewistJobId_reportVersion_key" ON "provider_report_submissions"("dectrocelJobId", "renewistJobId", "reportVersion");

CREATE TABLE IF NOT EXISTS "report_versions" (
  "id" TEXT NOT NULL,
  "reportReviewId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "htmlReport" TEXT,
  "filePath" TEXT,
  "checksum" TEXT,
  "immutable" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "report_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "report_versions_reportReviewId_version_key" ON "report_versions"("reportReviewId", "version");

CREATE TABLE IF NOT EXISTS "pacs_return_jobs" (
  "id" TEXT NOT NULL,
  "reportReviewId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "returnFormat" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "nextAttemptAt" TIMESTAMP(3),
  "lastAttemptAt" TIMESTAMP(3),
  "acknowledgedAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "deliveryResult" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pacs_return_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "job_status_history" (
  "id" TEXT NOT NULL,
  "processingJobId" TEXT,
  "reportReviewId" TEXT,
  "previousStatus" TEXT,
  "newStatus" TEXT NOT NULL,
  "actorUserId" TEXT,
  "sourceSystem" TEXT NOT NULL,
  "reason" TEXT,
  "relatedRequestId" TEXT,
  "relatedProviderStatus" TEXT,
  "technicalDetails" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "job_status_history_pkey" PRIMARY KEY ("id")
);
