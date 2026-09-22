CREATE TABLE IF NOT EXISTS "pricing_rules" (
  "id" TEXT NOT NULL,
  "serviceName" TEXT NOT NULL,
  "workflowType" TEXT NOT NULL DEFAULT 'ANY',
  "priority" TEXT NOT NULL DEFAULT 'REGULAR',
  "category" TEXT NOT NULL DEFAULT 'REGULAR',
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "unitPriceMinor" INTEGER NOT NULL DEFAULT 0,
  "providerPayableMinor" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "validUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pricing_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "pricing_rules_serviceName_workflowType_priority_category_validFrom_key"
ON "pricing_rules"("serviceName", "workflowType", "priority", "category", "validFrom");

CREATE TABLE IF NOT EXISTS "invoices" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "invoiceNumber" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "subtotalMinor" INTEGER NOT NULL DEFAULT 0,
  "taxMinor" INTEGER NOT NULL DEFAULT 0,
  "totalMinor" INTEGER NOT NULL DEFAULT 0,
  "razorpayPaymentLinkId" TEXT,
  "paymentUrl" TEXT,
  "issuedAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "invoices_invoiceNumber_key" ON "invoices"("invoiceNumber");

CREATE TABLE IF NOT EXISTS "study_billing_transactions" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "processingJobId" TEXT,
  "studyId" TEXT,
  "serviceName" TEXT NOT NULL,
  "workflowType" TEXT NOT NULL DEFAULT 'AI_ONLY',
  "priority" TEXT NOT NULL DEFAULT 'REGULAR',
  "category" TEXT NOT NULL DEFAULT 'REGULAR',
  "units" INTEGER NOT NULL DEFAULT 1,
  "unitPriceMinor" INTEGER NOT NULL DEFAULT 0,
  "amountMinor" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "status" TEXT NOT NULL DEFAULT 'UNINVOICED',
  "invoiceId" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "study_billing_transactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "study_billing_transactions_processingJobId_serviceName_key"
ON "study_billing_transactions"("processingJobId", "serviceName");

CREATE TABLE IF NOT EXISTS "invoice_line_items" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "serviceName" TEXT NOT NULL,
  "units" INTEGER NOT NULL,
  "unitPriceMinor" INTEGER NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "invoice_line_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "payment_links" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'RAZORPAY',
  "providerLinkId" TEXT,
  "shortUrl" TEXT,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "status" TEXT NOT NULL DEFAULT 'CREATED',
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "payments" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'OFFLINE',
  "providerPaymentId" TEXT,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "status" TEXT NOT NULL DEFAULT 'CAPTURED',
  "method" TEXT,
  "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "provider_settlements" (
  "id" TEXT NOT NULL,
  "providerCode" TEXT NOT NULL,
  "settlementNumber" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "subtotalMinor" INTEGER NOT NULL DEFAULT 0,
  "paidAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "provider_settlements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "provider_settlements_settlementNumber_key" ON "provider_settlements"("settlementNumber");

CREATE TABLE IF NOT EXISTS "provider_payable_transactions" (
  "id" TEXT NOT NULL,
  "providerCode" TEXT NOT NULL,
  "dectrocelJobId" TEXT NOT NULL,
  "processingJobId" TEXT,
  "serviceName" TEXT NOT NULL,
  "workflowType" TEXT NOT NULL,
  "priority" TEXT NOT NULL DEFAULT 'REGULAR',
  "category" TEXT NOT NULL DEFAULT 'REGULAR',
  "units" INTEGER NOT NULL DEFAULT 1,
  "unitPayableMinor" INTEGER NOT NULL DEFAULT 0,
  "amountMinor" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "status" TEXT NOT NULL DEFAULT 'UNSETTLED',
  "settlementId" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "provider_payable_transactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "provider_payable_transactions_dectrocelJobId_providerCode_key"
ON "provider_payable_transactions"("dectrocelJobId", "providerCode");

CREATE TABLE IF NOT EXISTS "billing_disputes" (
  "id" TEXT NOT NULL,
  "clientId" TEXT,
  "invoiceId" TEXT,
  "settlementId" TEXT,
  "dectrocelJobId" TEXT,
  "type" TEXT NOT NULL,
  "expectedAmountMinor" INTEGER,
  "appliedAmountMinor" INTEGER,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "resolution" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "billing_disputes_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_clientId_fkey"
FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "study_billing_transactions" ADD CONSTRAINT "study_billing_transactions_clientId_fkey"
FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "study_billing_transactions" ADD CONSTRAINT "study_billing_transactions_invoiceId_fkey"
FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoiceId_fkey"
FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_invoiceId_fkey"
FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payments" ADD CONSTRAINT "payments_clientId_fkey"
FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payments" ADD CONSTRAINT "payments_invoiceId_fkey"
FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "provider_payable_transactions" ADD CONSTRAINT "provider_payable_transactions_settlementId_fkey"
FOREIGN KEY ("settlementId") REFERENCES "provider_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "billing_disputes" ADD CONSTRAINT "billing_disputes_clientId_fkey"
FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
