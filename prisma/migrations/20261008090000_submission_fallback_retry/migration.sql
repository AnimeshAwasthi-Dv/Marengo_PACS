ALTER TABLE "processing_jobs" ADD COLUMN "submissionRetryAt" TIMESTAMP(3);
ALTER TABLE "processing_jobs" ADD COLUMN "submissionRetryCount" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "processing_jobs_status_submissionRetryAt_idx" ON "processing_jobs"("status", "submissionRetryAt");
CREATE TABLE "deleted_portal_studies" ("clientId" TEXT NOT NULL, "studyInstanceUid" TEXT NOT NULL, "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY ("clientId", "studyInstanceUid"));
ALTER TABLE "available_bridge_studies" ADD COLUMN "autoSubmitBlocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "available_bridge_studies" ADD COLUMN "submittedInstanceCount" INTEGER NOT NULL DEFAULT 0;

CREATE FUNCTION reject_deleted_portal_study() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('study-delete:' || NEW."clientId" || ':' || NEW."studyInstanceUid"));
  IF EXISTS (SELECT 1 FROM deleted_portal_studies WHERE "clientId"=NEW."clientId" AND "studyInstanceUid"=NEW."studyInstanceUid") THEN
    RAISE EXCEPTION 'Study was deleted by an administrator';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER available_study_deletion_guard BEFORE INSERT ON available_bridge_studies FOR EACH ROW EXECUTE FUNCTION reject_deleted_portal_study();
