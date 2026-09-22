UPDATE "users"
SET "lastGeneratedPassword" = NULL
WHERE "lastGeneratedPassword" IS NOT NULL;

