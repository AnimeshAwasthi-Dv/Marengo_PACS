ALTER TABLE "notification_recipients"
  ADD COLUMN "consentAt" TIMESTAMP(3),
  ADD COLUMN "consentSource" TEXT,
  ADD COLUMN "consentText" TEXT,
  ADD COLUMN "optOutAt" TIMESTAMP(3);

-- Legacy rows did not capture evidence of consent. Fail closed until each
-- recipient is re-verified through the new explicit consent workflow.
UPDATE "notification_recipients"
SET "active" = FALSE,
    "consentStatus" = 'PENDING',
    "verificationStatus" = 'PENDING',
    "verifiedAt" = NULL
WHERE "consentStatus" IN ('OPTED_IN', 'APPROVED', 'ACTIVE');
