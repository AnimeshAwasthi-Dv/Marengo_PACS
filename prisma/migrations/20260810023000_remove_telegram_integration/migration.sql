DROP TABLE IF EXISTS "telegram_notification_logs";
DROP TABLE IF EXISTS "telegram_processed_updates";
DROP TABLE IF EXISTS "telegram_group_settings";
DROP TABLE IF EXISTS "telegram_group_registration_codes";
DROP TABLE IF EXISTS "telegram_connection_codes";

ALTER TABLE "radiologist_profiles"
  DROP COLUMN IF EXISTS "telegramUserId",
  DROP COLUMN IF EXISTS "telegramChatId",
  DROP COLUMN IF EXISTS "telegramUsername",
  DROP COLUMN IF EXISTS "telegramConnected",
  DROP COLUMN IF EXISTS "telegramNotificationsEnabled",
  DROP COLUMN IF EXISTS "telegramConnectedAt";

