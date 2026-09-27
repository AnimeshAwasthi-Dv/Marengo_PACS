# Referring physician report notifications

Provider: WATI. Template: notification_to_physician. Its approved body must have parameters in this order: name (patient name), age (recorded patient age), study (study description, falling back to service name), study_link (the report-only share link). Missing demographic values display Not available. DICOM ages such as 034Y display as 34 years.

The Connect to Radiologist quick-reply button is part of the WATI template. Outbound requests use named parameters in body order; see [WATI template API](https://docs.wati.io/reference/sendtemplatemessage).

## Setup

WATI_API_URL, WATI_API_TOKEN, WHATSAPP_PROVIDER=wati, WATI_ENABLED=true and WHATSAPP_REPORT_READY_TEMPLATE_NAME=notification_to_physician are configured in the local ignored .env. Credentials are never committed. The live template lookup on 2026-09-27 returned PENDING. The worker checks approval, caches the result for one minute, and leaves notifications pending until approval instead of attempting sends.

For callbacks, copy WATI_WEBHOOK_URL from .env into WATI Connectors > Webhooks. Subscribe to Template Message Sent and Message Received. The URL contains a generated secret; do not publish it. This app strips the secret before access/audit logging. Headers x-wati-webhook-secret or Authorization: Bearer with the same secret are also accepted. If an external proxy logs full URLs, redact this query parameter there as well. See [WATI webhook setup](https://support.wati.io/en/articles/14111740-how-to-set-up-and-use-webhooks-in-wati).

The webhook binds the exact sent report link to WATI message IDs. Case-discussion clicks must include the original message context and the mapped physician phone. It never guesses the study from the most recent message. Repeated clicks reuse the existing Telegram callback event. Generic chat messages are ignored; STOP disables that physician's mapping. Telegram callback delivery still requires its configured bot and group chat ID.

## Workflow isolation

Only an active, verified, opted-in physician with a valid mapped phone and an unambiguous DICOM name/center match is eligible. With no configured contact, no message or report share is created. Missing, removed, opted-out, invalid or no-longer-matching recipients are silently skipped. Previously queued entries become SKIPPED, not FAILED, and are not retried. A WATI rejection identifying a missing/invalid contact is also skipped. Other provider/network failures retry only in the background; they do not fail report processing.

WATI acceptance is recorded as SENT in the existing outbox; it is not a claim of confirmed handset delivery. No live patient messages are sent during local validation. Restart/deploy the app after setup; webhook registration and template approval must be completed in WATI.
