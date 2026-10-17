# Marengo portal — Ubuntu deployment

Standalone deployment source for a **4 vCPU / 16 GB RAM Ubuntu server**. The bundled DICOM viewer is removed. DICOM upload, PACS receive/return, reporting, and viewer buttons remain; image viewing is delegated to a separately hosted viewer.

## Deploy a new installation

Install Docker Engine and the Compose plugin using the [official Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/). Point the portal domain's DNS to this instance. Allow TCP 80/443 and UDP 443 for HTTPS. PostgreSQL is private; the API's diagnostic port is bound to localhost.

```bash
git clone <your-repository-url> marengo-portal
cd marengo-portal
cp .env.example .env
chmod 600 .env
openssl rand -hex 32  # generate POSTGRES_PASSWORD
openssl rand -hex 32  # generate a separate JWT_SECRET
nano .env
docker compose config --quiet
docker compose up -d --build
docker compose run --rm api npm run db:seed
docker compose ps
curl -fsS http://127.0.0.1:4000/api/health
```

Set `POSTGRES_PASSWORD`, `JWT_SECRET`, `PORTAL_DOMAIN`, `PORTAL_BASE_URL`, `CORS_ORIGIN`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`. Use a hexadecimal database password so the generated database URL is valid. `ADMIN_PASSWORD` requires at least 12 characters. Sign in using `ADMIN_USER_ID` (default `admin`). Seeding creates only the administrator and service catalog; it does not create demo patients/accounts or reset existing passwords. Configure centers, services, provider credentials and tariffs in the portal.

Caddy obtains HTTPS certificates automatically when the configured domain resolves correctly and ports 80/443 are reachable. Do not set `PORTAL_DOMAIN` to a URL; use a hostname. `PORTAL_BASE_URL` and `CORS_ORIGIN` are full HTTPS URLs. For local Docker testing, use `PORTAL_DOMAIN=http://localhost` and matching HTTP base/origin URLs.

The migration container completes before the app starts. Database files, uploads and HTTPS certificate state use persistent named volumes. Do not run `docker compose down -v` against a deployment you want to keep.

## External DICOM viewer

For referring-physician report links and radiologist callback requests, see [WhatsApp configuration](docs/WHATSAPP_REFERRING_PHYSICIAN.md).

Leave `EXTERNAL_VIEWER_URL_TEMPLATE` blank until its URL contract is known. Viewer buttons then display an explicit unconfigured message.

Example configuration, **only if supported by your viewer**:

```dotenv
EXTERNAL_VIEWER_URL_TEMPLATE=https://viewer.example.com/viewer?StudyInstanceUIDs={studyInstanceUid}
```

`{studyInstanceUid}` is required; `{reportId}` is optional and only available for reports. The API authorizes each portal request and URL-encodes the selected study identifiers. It does **not** pass portal JWTs, patient names or local file paths to the viewer.

The external viewer must independently authenticate users and already be able to retrieve the study, for example from its own DICOMweb/PACS source. This URL adapter does not upload studies, proxy a manifest, implement remote SSO or configure DICOMweb. Those details must be connected once the viewer's interface is provided. Public report sharing does not grant anonymous access to the remote viewer. The viewer must allow the portal origin in its `frame-ancestors` policy for embedding; a new-tab link is also provided. The portal's CSP automatically allows the configured viewer origin.

### QuickView (in-app viewer for small 2D studies)

With `QUICKVIEW_ENABLED=true`, X-ray (CR/DX/DR), mammography (MG), ultrasound (US), XA and secondary-capture studies up to `QUICKVIEW_MAX_BYTES` (default 150 MB) open inside the portal instead of the external viewer. **CT, MR, PET and NM studies, and studies with an unknown modality or size, always open in the external viewer.** If QuickView cannot load a study, it switches to the full viewer automatically.

- The server reads only DICOM headers to build the image list, and then streams single images out of the stored study ZIP (local `uploads/`, or S3 found the same way as the external viewer import). It uses the same authorization as each viewer entry point.
- A ~1024 px JPEG preview of each image (rendered in a `worker_threads` thread) is shown first, then full resolution replaces it. Big uncompressed images get a lossless JPEG copy (DCMTK `dcmcjpeg`, started as soon as the study is indexed); image requests wait up to 4 s for it, which cuts real X-ray downloads 2–4×. S3 downloads, previews and lossless copies are cached under `uploads/quickview-cache/` for 24 hours.
- The browser decodes images in a Web Worker (`dcmjs-imaging`, WebAssembly codecs: uncompressed, JPEG baseline/extended/lossless, JPEG-LS, JPEG 2000, RLE). Window/level, zoom, pan, invert, rotate and flip run locally.
- Tools: Window/Level, Pan, Zoom, Length, Note, Angle, Rectangle/Ellipse ROI (area, mean, SD, min, max from real pixel values), Probe, Invert, Rotate, Flip, Undo, Cine, Export study (ZIP of the original DICOM) and DICOM tags. MPR is for CT/MR, which always open in the full viewer.
- "Open viewer in a new tab" opens `/viewer?session=…`, which applies the same choice: QuickView studies open there full-screen, and all others redirect to the external viewer.
- The CSP allows `'wasm-unsafe-eval'` so the worker can compile its WebAssembly decoders. JavaScript `eval` stays blocked.

After configuration changes:

```bash
docker compose up -d --force-recreate api ingest worker
```

## PACS connectivity

Bridge-based uploads use the HTTPS portal API. For direct DICOM receive, enable the optional port mapping:

```bash
docker compose -f compose.yaml -f compose.pacs.yaml up -d --build
```

The default range is `5000–5099`. Keep `PACS_PORT_START`, `PACS_PORT_END`, and `compose.pacs.yaml` synchronized. Set `EC2_PUBLIC_IP` to the receiving address reachable by the centers. Restrict DICOM ports to approved center IPs in the instance security group/firewall. Configure return PACS destinations in the portal and ensure outbound network access to them. No application code edits are needed for Linux DCMTK paths.

## Resource settings

| Service | CPU limit | Memory limit |
| --- | ---: | ---: |
| Portal, DICOM tools and report rendering | 2.5 | 6 GB |
| PostgreSQL | 1.25 | 4 GB |
| HTTPS proxy | 0.25 | 512 MB |

The remaining RAM covers Ubuntu, filesystem cache and deployment builds. The API uses a 4 GB Node heap and a 10-connection database pool. Report rendering is limited to two concurrent operations. Inbound scans cannot overlap. The worker submits up to three studies at a time; each job is claimed in the database before it is sent, so a study is not submitted twice. Most browser refreshes use 30 seconds and pause in hidden/offline tabs; selected operational screens refresh every 15 seconds. Static assets have immutable caching and HTTP compression. Charts, PDF tooling, QR generation and DICOM upload parsing load on demand.

The app runs as three services from one image, chosen by `PROCESS_ROLE` (`server/processRole.ts`):

- **api**: portal and integration HTTP, including the Renewist webhook, which only stores the report. No background work; it can run more than one copy.
- **ingest**: DICOM receivers (kept in step with the PACS configs every 30 s), the inbound scan and every Bridge endpoint. Caddy sends `/api/v1/bridge`, `/api/v1/study-bridge` and `/api/v1/study-agents` here. Run **one** copy.
- **worker**: study submission, auto-submit, PACS return, recovery and retries, messaging, invoices, viewer pre-import and archive maintenance. Run **one** copy.

They exchange work as messages through Redis (BullMQ, `server/queue/index.ts`, the `queue-redis` service): study intake, DICOM metadata extraction and auto-submit scheduling, Renewist submission, PACS delivery, cancellation and receiver changes. The database stays the record: every handler re-checks its row, failures are retried with backoff, and each service re-sends messages for pending work every 60 s, so a lost message or a Redis restart delays work but never loses it. `QUEUE_REDIS_URL` is required for ingest and worker; Redis must use `maxmemory-policy noeviction`.

All three mount the same `uploads` volume, so they must run on the same host. Each process has its own database pool, so the database sees up to three pools. Leaving `PROCESS_ROLE` unset runs everything in one process, as before. Measure `docker stats`, response times, upload sizes and queue latency under your actual workload before increasing concurrency. These settings are a conservative starting point, not a throughput guarantee.

Chromium runs as the non-root app user; its internal sandbox is disabled inside this container for compatibility. Docker isolation remains in place. Only report generation uses Chromium; there is no local DICOM image renderer.

## Updates and backups

Before updates, back up **both** PostgreSQL and the uploads volume. Stored file paths inside the container remain `/app/uploads`.

```bash
mkdir -p backups
# Pause processing while taking a consistent database/files backup.
docker compose stop api ingest worker
docker compose exec -T db pg_dump -U marengo -d marengo -Fc > backups/marengo.dump
docker compose run --rm --no-deps -T api tar -C /app/uploads -czf - . > backups/uploads.tar.gz
docker compose start api ingest worker

git pull --ff-only
docker compose build
docker compose up -d --force-recreate migrate
docker compose up -d api ingest worker web
docker compose logs --tail=100 api ingest worker
```

Keep backups off-instance and periodically test restoring them to a separate deployment. Do not assume reverting the application also reverses a database migration. For an existing Windows database, plan a separate restore/migration: existing absolute Windows file paths must be remapped to `/app/uploads`. This release does not automatically import current credentials, patients or uploads.

## Center study-analysis export

Center users with Analytics access can use **Analytics → Modality summary → Download summary Excel**. The export uses the From/To dates above the summary, includes both full days in IST, and allows any combination of X-Ray, CT, and MRI. It contains only the **Study Analysis** sheet, with the nine comparison metrics from `ana.py`; patient-detail and separate modality sheets are omitted.

The authenticated center is enforced by the API; other center IDs and group accounts cannot use this export. The reporting window selects received bridge studies, and final report status is evaluated at download time. TAT runs from submission to approval. Duplicate accessions count once, preferring finalized records. SLA follows the supplied script: on-duty receipts are 09:00–18:00 IST, thresholds are 70/120/180 minutes for X-Ray/CT/MRI, and breach eligibility starts on 2026-09-28. Off-duty and missing/invalid TAT cases count as achieved. The script's technical exemption for accession 3275071 applies only to Ahmedabad centers. The sheet includes these calculation notes.

Requests are limited to 366 days and 50,000 candidate studies; larger exports require a shorter period and are never silently truncated. No database migration is needed for this feature.

## Development and checks

```bash
npm ci
npm run prisma:generate
npm run typecheck
npm test
npm run build
```

Node 24 is used in Docker. `tsx` is retained in the runtime because the existing backend uses TypeScript with extensionless module imports. The image builds its own Prisma client for Linux. No Windows `node_modules` should be copied to the server.

See [architecture](docs/ARCHITECTURE.md) and [validation](docs/VALIDATION.md). Docker services and limits follow the [Compose service reference](https://docs.docker.com/reference/compose-file/services/); the runtime follows the [Node.js release schedule](https://nodejs.org/en/about/previous-releases).

## Publish this folder to Git

Create an empty repository with your Git provider, then run from this folder:

```bash
git init -b main
git add .
git commit -m "Prepare Marengo portal for Ubuntu deployment"
git remote add origin <your-repository-url>
git push -u origin main
```

`.gitignore` and `.dockerignore` exclude credentials, uploads, dependencies and generated artifacts. Review the staged files before committing. No remote repository has been created or pushed by this preparation.
