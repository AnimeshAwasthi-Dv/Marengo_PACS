CREATE TABLE IF NOT EXISTS "support_tickets" (
  "id" TEXT PRIMARY KEY,
  "ticketNumber" TEXT NOT NULL UNIQUE,
  "clientId" TEXT,
  "relatedStudyId" TEXT,
  "category" TEXT NOT NULL,
  "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
  "subject" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "assignedTeam" TEXT,
  "assignedAgentId" TEXT,
  "createdByUserId" TEXT,
  "firstResponseAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "whatsappDemo" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_tickets_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "support_tickets_clientId_status_priority_idx" ON "support_tickets"("clientId", "status", "priority");
CREATE INDEX IF NOT EXISTS "support_tickets_createdAt_idx" ON "support_tickets"("createdAt");

CREATE TABLE IF NOT EXISTS "support_ticket_messages" (
  "id" TEXT PRIMARY KEY,
  "ticketId" TEXT NOT NULL,
  "authorUserId" TEXT,
  "authorRole" TEXT,
  "visibility" TEXT NOT NULL DEFAULT 'PUBLIC',
  "channel" TEXT NOT NULL DEFAULT 'PORTAL',
  "body" TEXT NOT NULL,
  "attachmentRefs" JSONB NOT NULL DEFAULT '[]',
  "whatsappDemo" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_ticket_messages_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "support_ticket_messages_ticketId_createdAt_idx" ON "support_ticket_messages"("ticketId", "createdAt");

CREATE TABLE IF NOT EXISTS "notification_recipients" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "organization" TEXT NOT NULL,
  "clientId" TEXT,
  "phoneE164" TEXT,
  "notificationCategories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "active" BOOLEAN NOT NULL DEFAULT true,
  "consentStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "quietHours" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_recipients_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "notification_recipients_organization_role_active_idx" ON "notification_recipients"("organization", "role", "active");

