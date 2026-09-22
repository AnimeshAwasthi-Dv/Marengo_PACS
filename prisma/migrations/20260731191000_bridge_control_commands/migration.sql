CREATE TABLE "bridge_control_commands" (
  "id" TEXT NOT NULL,
  "commandId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Pending',
  "payloadJson" JSONB NOT NULL DEFAULT '{}',
  "resultJson" JSONB,
  "requestedBy" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "lastErrorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "bridge_control_commands_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bridge_control_commands_commandId_key" ON "bridge_control_commands"("commandId");
CREATE INDEX "bridge_control_commands_clientId_agentId_status_idx" ON "bridge_control_commands"("clientId", "agentId", "status");
CREATE INDEX "bridge_control_commands_type_status_idx" ON "bridge_control_commands"("type", "status");

ALTER TABLE "bridge_control_commands"
  ADD CONSTRAINT "bridge_control_commands_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
