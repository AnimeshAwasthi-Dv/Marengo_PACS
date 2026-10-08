CREATE SEQUENCE "invoice_number_sequence";
SELECT setval('invoice_number_sequence', GREATEST(1, COALESCE((SELECT MAX(substring("invoiceNumber" from '[0-9]+$')::bigint) FROM invoices), 0) + 1), false);
-- Fail visibly if historical duplicate provider payment IDs need reconciliation.
-- Never silently delete payment records to make a uniqueness migration pass.
CREATE UNIQUE INDEX "payments_provider_providerPaymentId_key" ON "payments"("provider", "providerPaymentId");
DROP INDEX IF EXISTS "payments_provider_providerPaymentId_idx";
