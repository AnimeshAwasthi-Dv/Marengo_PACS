-- AlterTable
ALTER TABLE "available_bridge_studies" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "bridge_dispatch_requests" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "notification_events" ALTER COLUMN "category" DROP DEFAULT;

-- AlterTable
ALTER TABLE "notification_recipients" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "pacs_return_jobs" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "provider_job_mapping" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "support_tickets" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "teleradiology_providers" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex
-- Earlier migrations created equivalent partial indexes. Prisma's @unique
-- expects full indexes (PostgreSQL still permits multiple NULL values).
DROP INDEX "clients_hospitalSlug_key";
CREATE UNIQUE INDEX "clients_hospitalSlug_key" ON "clients"("hospitalSlug");

-- CreateIndex
DROP INDEX "pacs_config_urgentReceivingPort_key";
CREATE UNIQUE INDEX "pacs_config_urgentReceivingPort_key" ON "pacs_config"("urgentReceivingPort");

-- CreateIndex
DROP INDEX "pacs_config_urgentAeTitle_key";
CREATE UNIQUE INDEX "pacs_config_urgentAeTitle_key" ON "pacs_config"("urgentAeTitle");

-- RenameIndex
ALTER INDEX "available_bridge_studies_clientId_workflowStatus_availabilitySt" RENAME TO "available_bridge_studies_clientId_workflowStatus_availabili_idx";

-- RenameIndex
ALTER INDEX "notification_deliveries_recipientOrganization_status_createdAt_" RENAME TO "notification_deliveries_recipientOrganization_status_create_idx";

-- RenameIndex
ALTER INDEX "pricing_rules_serviceName_workflowType_priority_category_validF" RENAME TO "pricing_rules_serviceName_workflowType_priority_category_va_key";

-- RenameIndex
ALTER INDEX "provider_report_submissions_dectrocelJobId_renewistJobId_report" RENAME TO "provider_report_submissions_dectrocelJobId_renewistJobId_re_key";

-- RenameIndex
ALTER INDEX "radiologist_feedback_reportId_radiologistUserId_submissionVersi" RENAME TO "radiologist_feedback_reportId_radiologistUserId_submissionV_key";
