# Teleradiology reliability changes — 2026-10-08

Implemented from the user's request and reviewed against PROCESS-GAPS.docx.

## Requested behavior

- A failed Renewist/Radagent submission gets one automatic fallback, due three minutes after failure. The database stores the deadline and retry count. A 10-second worker claims due jobs atomically; queue capacity can delay actual start. A failed fallback remains failed for manual intervention.
- Up to three submissions run concurrently. Each upload has an absolute deadline, response size bound, response-error handling, and an abort signal. The provider receives a stable job idempotency key on a retry.
- The existing technical-failure bot monitors persisted submission, archive, PACS and notification failures, including operational failures that were excluded from health probes. It also receives callback/API failures and unexpected DICOM receiver exits. Existing acknowledgment, reminders and delivery retries remain in effect.
- Super administrators can force-terminate or delete a worklist study regardless of repush eligibility or whether a processing job exists. Reasons and history are recorded. Pending retries, automatic submission, dispatches, notifications and PACS returns are cancelled. Active local uploads are aborted. Cancelled/finalized jobs cannot be restarted by queued submission work or late report callbacks.
- Deletion removes the worklist entry and persists a tombstone that blocks automatic reimport. Reports and audit history are retained. It is not an erase-all-clinical-records action.
- As explicitly requested, additional images trigger **both** an automatic expanded-study submission and a technical alert. A queued job adopts the new archive; otherwise a new job is created while previous reports remain available. Submitted instance counts prevent repeated upload notifications from repeatedly submitting the same expanded study. This detects increases in image count, not replacement of image bytes with an unchanged count.

## Document findings

| Gap | Change |
| --- | --- |
| G1 | Exhausted PACS returns become FAILED and stop occupying pending queue slots; operational monitoring reports failed returns. |
| G2 | Intake catches errors per study and continues the scan. |
| G3 | Absolute request deadline, response-error handling, bounded response, and bounded submission concurrency. |
| G4 | Content-based fallback callback identity and database advisory locking serialize duplicate callbacks. |
| G5 | PACS worker entry points catch rejections; report preparation failures are isolated per return job. |
| G6 | Exact local signed sources survive remote-storage failure; PACS recovery can restore a signed file from its stored S3 reference. |
| G7 | Acceptance upserts previously rejected request records. |
| G8 | Multipart file-size and file-count limits reject truncated or excessive uploads. |
| G9 | Additional images automatically queue the expanded archive and notify the technical bot. |
| G10 | Jobs stay in submitting state until acceptance is recorded; post-acceptance notification failure does not turn acceptance into an upload failure. |
| G11 | Persistent three-minute fallback retry and periodic interrupted-submission recovery. |
| G12 | Report-content-based SOP Instance UIDs preserve identity across resends; amended content gets a different UID. |
| G13 | Receiver supervision runs every minute; unexpected exits create technical incidents. |
| G14 | WhatsApp rows have atomic sending claims, expiry recovery and a Meta request deadline. |
| G15 | Invoice generation locks per client inside the transaction; numbers use a database sequence; provider payment IDs gain a uniqueness constraint. |
| G16 | Persisted operational failures feed the technical incident queue independently of clinical notifications and probe exclusions. |

## Deployment and verification

### Follow-up: buttons failing on the configured staging database

The October 8 migrations were absent from the staging database containing the reported study. Both `20261008090000_submission_fallback_retry` and `20261008091000_billing_idempotency` have now been applied after checking for duplicate provider payment IDs. The actual terminate and delete route handlers were verified against the affected study in transactions that deliberately rolled back. Both returned success, and the original study and processing-job link were verified unchanged. This validates the database actions; it does not claim cancellation at Renewist or test live PACS/Telegram delivery.

Apply both new Prisma migrations before starting the new application, and regenerate the Prisma client during deployment. The billing uniqueness migration deliberately fails if existing duplicate payment IDs need reconciliation; it does not delete historical payments. Configure the existing `TECH_ALERT_ENABLED`, `TECH_ALERT_BOT_TOKEN` and `TECH_ALERT_CHAT_ID` values, and keep clinical workers enabled for automatic retries.

Local checks include the production build and regression tests for upload deadlines, interrupted responses, cancellation, retry timing, callback identity, PACS identity, admin authorization, jobless termination, and deletion retention. The full test suite also contains two unrelated failing local tests: `studyStorage.test.ts` imports the missing `prepareViewerStudyObject` export; `worklistPriority.test.ts` lacks the Telegram database mock needed with the local Telegram configuration.

No production migration, live provider submission, PACS transmission or Telegram test message was performed. Database migrations and cross-process races still require staging verification against PostgreSQL. Renewist has no configured cancellation API: work already accepted remotely or a PACS transmission already sent cannot be recalled by the portal. A total database/application-host outage still requires an external watchdog. Upstream exactly-once behavior depends on Renewist honoring the stable job/idempotency key; late-image submissions intentionally create a distinct job after initial processing starts.
