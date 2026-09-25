-- Fetch-key indexes on smaller tables (plain CREATE INDEX is fine here).

-- CreateIndex
CREATE INDEX "radiologist_profiles_providerCode_idx" ON "radiologist_profiles"("providerCode");

-- CreateIndex
CREATE INDEX "radiologist_profiles_clientId_idx" ON "radiologist_profiles"("clientId");

-- CreateIndex
CREATE INDEX "report_audit_logs_reportId_idx" ON "report_audit_logs"("reportId");

-- CreateIndex
CREATE INDEX "study_billing_transactions_clientId_createdAt_idx" ON "study_billing_transactions"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "invoices_clientId_createdAt_idx" ON "invoices"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "payments_provider_providerPaymentId_idx" ON "payments"("provider", "providerPaymentId");

-- CreateIndex
CREATE INDEX "payments_invoiceId_status_idx" ON "payments"("invoiceId", "status");

-- CreateIndex
CREATE INDEX "payments_clientId_createdAt_idx" ON "payments"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "provider_payable_transactions_providerCode_status_createdAt_idx" ON "provider_payable_transactions"("providerCode", "status", "createdAt");

-- CreateIndex
CREATE INDEX "provider_settlements_providerCode_idx" ON "provider_settlements"("providerCode");

-- CreateIndex
CREATE INDEX "billing_disputes_settlementId_idx" ON "billing_disputes"("settlementId");

-- CreateIndex
CREATE INDEX "billing_disputes_clientId_createdAt_idx" ON "billing_disputes"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "bridge_study_attachments_bridgeStudyId_idx" ON "bridge_study_attachments"("bridgeStudyId");

-- CreateIndex
CREATE INDEX "provider_job_mapping_processingJobId_idx" ON "provider_job_mapping"("processingJobId");

-- CreateIndex
CREATE INDEX "provider_job_mapping_reportReviewId_idx" ON "provider_job_mapping"("reportReviewId");

-- CreateIndex
CREATE INDEX "provider_job_mapping_studyInstanceUid_idx" ON "provider_job_mapping"("studyInstanceUid");

-- CreateIndex
CREATE INDEX "provider_api_requests_direction_status_createdAt_idx" ON "provider_api_requests"("direction", "status", "createdAt");

-- CreateIndex
CREATE INDEX "provider_api_requests_providerId_createdAt_idx" ON "provider_api_requests"("providerId", "createdAt");

-- CreateIndex
CREATE INDEX "pacs_return_jobs_status_createdAt_idx" ON "pacs_return_jobs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "pacs_return_jobs_reportReviewId_updatedAt_idx" ON "pacs_return_jobs"("reportReviewId", "updatedAt");

-- CreateIndex
CREATE INDEX "job_status_history_processingJobId_createdAt_idx" ON "job_status_history"("processingJobId", "createdAt");

-- CreateIndex
CREATE INDEX "job_status_history_reportReviewId_createdAt_idx" ON "job_status_history"("reportReviewId", "createdAt");
