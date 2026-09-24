# Technical Alerts

Super Admin → Technical Alerts shows persistent incidents and their acknowledgment, delivery, health-change, and resolution logs.

## Operation

- Check configured health dependencies every 15 minutes, with an initial check on first activation. The worker ticks every 10 seconds; alerts are sent as soon as a failed check is recorded. This is periodic detection, not continuous outage detection.
- Unacknowledged incidents receive reminders every 2 minutes. Telegram rate limits and delivery failures can delay delivery; failures are logged and retried.
- Tap **Noted — acknowledge** below an alert, or reply **Noted** directly to it. A digest button/reply acknowledges all incidents named in that message. A standalone Noted, when forwarded by Telegram, acknowledges previously delivered open alerts in the configured group. Other chats, bot messages, and anonymous sender identities cannot acknowledge incidents. Buttons work without disabling Telegram's group privacy setting.
- Acknowledgment records the Telegram identity and time and stops reminders. Recovery alone does not acknowledge or resolve an incident.
- A Super Admin resolves an acknowledged incident with a required resolution note. If the probe still fails on the next check, a new incident opens.
- **Check services now** requests an additional check. Refresh only reloads stored results.
- State, update offsets, and logs survive process restarts. A PostgreSQL advisory lock prevents simultaneous monitor cycles across replicas. Telegram delivery is at least once: a process crash after sending but before database commit can produce a duplicate message.

WhatsApp/outbox and the 19 requested PACS endpoint exclusions are defined in `server/technicalAlertPolicy.ts`. They remain visible in Healthcheck but do not create alerts. Other configured PACS endpoints remain monitored.

Database-backed features, Redis, object storage, the viewer, and Renewist reporting are probed. Marengo uses direct Renewist reporting; AI endpoints are not integrated and are excluded from health checks and alerts. The three incorrectly opened AI incidents were withdrawn with configuration-exclusion log entries. Endpoint health probes use read-only HTTP health paths; they do not submit studies. A missing default health path is reported as reachable rather than healthy. Set the corresponding `*_HEALTH_URL` to the service's actual readiness endpoint where necessary. Enabled catalog entries and synchronization history are configuration/activity observations, not readiness checks.

## Configuration

Store these in an ignored environment file or deployment secrets, never in source control:

```
TECH_ALERT_ENABLED=true
TECH_ALERT_BOT_TOKEN=<bot token>
TECH_ALERT_CHAT_ID=<numeric group ID>
```

The existing environment loader reads `.env.telegram.local`. This monitor has its own enable flag and is independent of `DISABLE_STARTUP_WORKERS`, which controls clinical workers. `DATABASE_READ_ONLY=true` disables technical monitoring mutations too.

Run `npx prisma migrate deploy` before enabling the worker. Keep one or more API processes running on the intended server network. Local development monitoring stops when the local API stops; local connectivity can differ from deployment connectivity.

This in-process monitor depends on its database for incident persistence and coordination. A total database or application-host outage needs an independent external watchdog; it cannot be reliably reported by the failed process itself. Technical Alerts displays the last worker heartbeat to expose stale monitoring.

Telegram replies are polled using [getUpdates](https://core.telegram.org/bots/api#getupdates); do not configure a webhook or another consumer for this dedicated bot.

## Verification

`npm test` covers exclusions, cadence, navigation, and acknowledgment identity/message rules. `node --import tsx scripts/check-technical-alerts.ts` verifies incident deduplication, recovery without auto-resolution, message correlation, idempotent acknowledgment, and reminder suppression in a rolled-back database transaction. It sends no Telegram messages.

`node --import tsx scripts/technical-alert-status.ts` reads runtime status and verifies the local API returns 200 for Super Admin and 403 for a center user. It does not print tokens.
