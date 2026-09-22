-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'CLIENT_USER');

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('ACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ServiceCategory" AS ENUM ('PACS');

-- CreateEnum
CREATE TYPE "ServiceStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "ReturnFormat" AS ENUM ('DICOM_ENCAPSULATED_PDF', 'DICOM_SECONDARY_CAPTURE', 'HL7');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "clientId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "facilityType" TEXT NOT NULL,
    "primaryContact" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "ClientStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ServiceCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_services" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "status" "ServiceStatus" NOT NULL DEFAULT 'ACTIVE',
    "credits" INTEGER NOT NULL DEFAULT 0,
    "usedCredits" INTEGER NOT NULL DEFAULT 0,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_credits" (
    "id" TEXT NOT NULL,
    "clientServiceId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_credits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pacs_config" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientServiceId" TEXT NOT NULL,
    "ec2PublicIp" TEXT NOT NULL,
    "receivingPort" INTEGER NOT NULL,
    "aeTitle" TEXT NOT NULL,
    "clientPacsIp" TEXT NOT NULL,
    "clientPacsPort" INTEGER NOT NULL,
    "clientPacsAeTitle" TEXT NOT NULL,
    "returnFormat" "ReturnFormat" NOT NULL DEFAULT 'DICOM_ENCAPSULATED_PDF',

    CONSTRAINT "pacs_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "modality" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_format_settings" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "dicomReturnFormat" "ReturnFormat" NOT NULL DEFAULT 'DICOM_ENCAPSULATED_PDF',
    "reportMode" TEXT NOT NULL DEFAULT 'Comprehensive',
    "enabledSections" TEXT[],
    "structuredHeaderJson" JSONB NOT NULL,

    CONSTRAINT "report_format_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studies" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "studyUid" TEXT NOT NULL,
    "accession" TEXT,
    "modality" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL,
    "aiResponse" JSONB,
    "reportJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "studies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "studyId" TEXT,
    "serviceName" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_logs" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "studyUid" TEXT,
    "creditsUsed" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dicom_ports" (
    "id" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "aeTitle" TEXT NOT NULL,
    "allocated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dicom_ports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hl7_config" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "inboundEndpoint" TEXT NOT NULL,
    "outboundHost" TEXT NOT NULL,
    "outboundPort" INTEGER NOT NULL,
    "sendingApp" TEXT NOT NULL,
    "receivingApp" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "hl7_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "clients_code_key" ON "clients"("code");

-- CreateIndex
CREATE UNIQUE INDEX "services_name_key" ON "services"("name");

-- CreateIndex
CREATE UNIQUE INDEX "client_services_clientId_serviceId_key" ON "client_services"("clientId", "serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "pacs_config_clientServiceId_key" ON "pacs_config"("clientServiceId");

-- CreateIndex
CREATE UNIQUE INDEX "pacs_config_receivingPort_key" ON "pacs_config"("receivingPort");

-- CreateIndex
CREATE UNIQUE INDEX "pacs_config_aeTitle_key" ON "pacs_config"("aeTitle");

-- CreateIndex
CREATE UNIQUE INDEX "studies_studyUid_key" ON "studies"("studyUid");

-- CreateIndex
CREATE UNIQUE INDEX "dicom_ports_port_key" ON "dicom_ports"("port");

-- CreateIndex
CREATE UNIQUE INDEX "dicom_ports_aeTitle_key" ON "dicom_ports"("aeTitle");

-- CreateIndex
CREATE UNIQUE INDEX "hl7_config_clientId_key" ON "hl7_config"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_key_key" ON "system_settings"("key");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_services" ADD CONSTRAINT "client_services_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_services" ADD CONSTRAINT "client_services_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_credits" ADD CONSTRAINT "service_credits_clientServiceId_fkey" FOREIGN KEY ("clientServiceId") REFERENCES "client_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pacs_config" ADD CONSTRAINT "pacs_config_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pacs_config" ADD CONSTRAINT "pacs_config_clientServiceId_fkey" FOREIGN KEY ("clientServiceId") REFERENCES "client_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_format_settings" ADD CONSTRAINT "report_format_settings_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studies" ADD CONSTRAINT "studies_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "studies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hl7_config" ADD CONSTRAINT "hl7_config_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

