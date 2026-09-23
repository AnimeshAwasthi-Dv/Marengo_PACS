# Referring physician WhatsApp configuration

Superadmin → **WhatsApp Configuration** manages name, phone number, role and optional center scope. Choose **Referring physician**, record consent and mark the number **Verified** after checking it. Physician entries receive only their matched reports, not general status broadcasts.

Names are matched against the Referring Physician’s Name DICOM tag `(0008,0090)`. Titles, capitalization, punctuation, spacing and family/given-name ordering are normalized. Initials are not expanded. Missing names, conflicting metadata, or multiple matching active verified recipients prevent delivery. Use center scope to distinguish physicians with the same name. Original DICOM files are unchanged.

Only approved/pushed reports approved after the physician entry was created are eligible. A five-day report-only share link is sent once per report through a durable outbox. It does not grant access to the DICOM viewer. Existing expired links are not renewed automatically; revoked links invalidate queued delivery. Deactivating or opting out a physician prevents queued delivery. Failed sends retry with backoff; requests that exhaust retries remain visible in the outbox. Delivery is at-least-once if a network connection fails after Meta accepts a message.

## Create the Meta utility template

In WhatsApp Manager, create and submit a **Utility** template with:

- Suggested name: `marengo_referring_report_ready`
- Language: English (`en`), or use the exact approved language code in the environment.
- Body: `The report for your referred study is ready. View it here: {{1}}. To request a discussion with the radiologist, use the button below. Reply STOP to opt out.`
- One **Quick reply** button, at index 0, labeled **Call radiologist**.
- A sample value for `{{1}}` using a non-patient demonstration link, such as `https://portal.example.com/shared/demo`.

Do not use a “Call phone number” button: the quick reply records a callback request rather than dialing immediately. Wait for Meta approval. This implementation sends the report URL as body parameter 1 and a report-specific opaque callback identifier as the button payload. See Meta’s [template component reference](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/types/component_object/) and [interactive template example](https://www.postman.com/meta/whatsapp-business-platform/request/lwtlz1k/send-message-template-interactive).

## Configure the server

Keep the existing Cloud API token and phone number ID in the private `.env`. Add the app secret from the Meta app’s Basic settings and set:

```dotenv
FEATURE_WHATSAPP_ENABLED=true
FEATURE_NOTIFICATIONS_ENABLED=true
WHATSAPP_CLOUD_API_ENABLED=true
WHATSAPP_APP_SECRET=<Meta app secret>
WHATSAPP_REPORT_READY_TEMPLATE_NAME=marengo_referring_report_ready
WHATSAPP_REPORT_READY_TEMPLATE_LANGUAGE=en
PORTAL_BASE_URL=https://your-portal-domain
```

Configure the public HTTPS webhook shown in the configuration tab (`/api/v1/whatsapp/webhook`), using `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, and subscribe to **messages**. The app secret validates incoming webhook signatures. The portal domain must be reachable by physicians; localhost is not a usable report-sharing domain.

Restart with `docker compose up -d --force-recreate app`. Ensure `DISABLE_STARTUP_WORKERS` is unset or `false`; the local development server has workers paused. The polling worker checks approved reports and sends queued notifications. No report messages are queued/sent until the Cloud API credentials, app secret, public base URL and template name are configured. An approved template is still required at Meta: a configured name alone does not prove approval.

## Call requests

Tapping **Call radiologist** validates the sender against the original recipient, the report match and the current share-link validity. Superadmin and the currently assigned radiologist receive in-app notifications. If no radiologist is assigned, Superadmin still receives the request. Repeated taps create one request and do not reopen a handled request.

Superadmin can see requests in **WhatsApp Configuration → Radiologist call requests**, and select **Mark handled**. Both recipients can see the portal notification bell/history. This requests a callback; it does not book a time slot or place a telephone call.

Test first with a verified physician test number and a non-patient test study whose referring-physician tag matches the configured name. Approve its report, verify the link, tap the button, and confirm both portal notifications. No live messages were sent as part of development validation.
