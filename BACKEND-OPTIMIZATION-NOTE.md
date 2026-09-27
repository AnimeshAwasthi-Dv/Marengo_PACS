# Internal note for the senior developer

Reviewer assessment: The current Marengo PACS stack exhibits significant backend bottlenecks. Prioritize focused profiling, query tuning, and concurrency improvements. Roll out changes gradually; do not make immediate large-scale changes.

## Baseline and staged rollout

1. Record API p50/p95/p99 latency, event-loop delay, CPU/RSS, database pool wait time, slow query plans, upload duration, provider submission latency, report return latency, and queue age under representative load. Separate portal delay from Renewist and PACS delays.
2. Tune the measured expensive queries with EXPLAIN (ANALYZE, BUFFERS) on a staging copy. Check existing indexes before adding more. Preserve center authorization, pagination, and worklist counts.
3. Bound concurrency for independent I/O and rendering only after measuring resource headroom. Retain single-replica processing and its serialized study submission until distributed claims/idempotency are proven.
4. Deploy to staging first, then a small operational cohort. Compare metrics and error rates, verify rollback, and expand gradually.

## This change

Removed unused local AI inference functions and mock AI reception, radiologist account creation endpoints/forms, and WhatsApp chatbot/demo/management/general-broadcast flows. Retained existing radiologists, report approval/access, signed-report rendering, Renewist submission/callbacks, uploads, PACS receive/return, and the database schema. Historical AI-named report fields remain because current report adapters use them.

Telegram destinations are separate outbox event types with retry and conditional claims. WhatsApp processes only physician-report events. No production throughput improvement is claimed without profiling. No schema migration or concurrency increase is included.

## Telegram activation

Configure TELEGRAM_URGENT_ENABLED, TELEGRAM_URGENT_CHAT_ID and optionally TELEGRAM_URGENT_BOT_TOKEN for urgent submission/status updates. Configure TELEGRAM_CALLBACK_ENABLED, TELEGRAM_CALLBACK_CHAT_ID and optionally TELEGRAM_CALLBACK_BOT_TOKEN for verified physician callback button requests. Tokens otherwise use TELEGRAM_BOT_TOKEN. Both inherit TELEGRAM_CLIENT_IDS or TELEGRAM_CLIENT_GROUP_CODE and TELEGRAM_PORTAL_URL. Missing configuration pauses delivery. Invitation links cannot replace numeric chat IDs.

Create/add the bot to the intended groups, configure the IDs in .env, and restart the app. Validate one urgent submission, a signed-report return, and a physician callback in staging before enabling production delivery. Events use idempotency keys; an ambiguous network failure after Telegram accepts a message can still cause a duplicate on retry.

WhatsApp retains verified, consented referring-physician name/center/phone mappings, report-ready templates, callback buttons and STOP handling. Existing generic outbox records are left untouched and are no longer delivered by this worker. Existing data and historical accounts are not deleted.
