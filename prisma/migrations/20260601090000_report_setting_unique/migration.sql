CREATE UNIQUE INDEX IF NOT EXISTS "report_format_settings_clientId_serviceName_key"
ON "report_format_settings"("clientId", "serviceName");
