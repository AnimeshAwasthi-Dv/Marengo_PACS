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
docker compose run --rm app npm run db:seed
docker compose ps
curl -fsS http://127.0.0.1:4000/api/health
```

Set `POSTGRES_PASSWORD`, `JWT_SECRET`, `PORTAL_DOMAIN`, `PORTAL_BASE_URL`, `CORS_ORIGIN`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`. Use a hexadecimal database password so the generated database URL is valid. `ADMIN_PASSWORD` requires at least 12 characters. Sign in using `ADMIN_USER_ID` (default `admin`). Seeding creates only the administrator and service catalog; it does not create demo patients/accounts or reset existing passwords. Configure centers, services, provider credentials and tariffs in the portal.

Caddy obtains HTTPS certificates automatically when the configured domain resolves correctly and ports 80/443 are reachable. Do not set `PORTAL_DOMAIN` to a URL; use a hostname. `PORTAL_BASE_URL` and `CORS_ORIGIN` are full HTTPS URLs. For local Docker testing, use `PORTAL_DOMAIN=http://localhost` and matching HTTP base/origin URLs.

The migration container completes before the app starts. Database files, uploads and HTTPS certificate state use persistent named volumes. Do not run `docker compose down -v` against a deployment you want to keep.

## External DICOM viewer

Leave `EXTERNAL_VIEWER_URL_TEMPLATE` blank until its URL contract is known. Viewer buttons then display an explicit unconfigured message.

Example configuration, **only if supported by your viewer**:

```dotenv
EXTERNAL_VIEWER_URL_TEMPLATE=https://viewer.example.com/viewer?StudyInstanceUIDs={studyInstanceUid}
```

`{studyInstanceUid}` is required; `{reportId}` is optional and only available for reports. The API authorizes each portal request and URL-encodes the selected study identifiers. It does **not** pass portal JWTs, patient names or local file paths to the viewer.

The external viewer must independently authenticate users and already be able to retrieve the study, for example from its own DICOMweb/PACS source. This URL adapter does not upload studies, proxy a manifest, implement remote SSO or configure DICOMweb. Those details must be connected once the viewer's interface is provided. Public report sharing does not grant anonymous access to the remote viewer. The viewer must allow the portal origin in its `frame-ancestors` policy for embedding; a new-tab link is also provided. The portal's CSP automatically allows the configured viewer origin.

After configuration changes:

```bash
docker compose up -d --force-recreate app
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

The remaining RAM covers Ubuntu, filesystem cache and deployment builds. The API uses a 4 GB Node heap and a 10-connection database pool. Report rendering is limited to two concurrent operations. Inbound scans cannot overlap. Study processing retains its existing serialized queue to avoid duplicate submission. Most browser refreshes use 30 seconds and pause in hidden/offline tabs; selected operational screens refresh every 15 seconds. Static assets have immutable caching and HTTP compression. Charts, PDF tooling, QR generation and DICOM upload parsing load on demand.

Use **one app replica**: existing DICOM listeners and processing coordination are process-local. Measure `docker stats`, response times, upload sizes and queue latency under your actual workload before increasing concurrency. These settings are a conservative starting point, not a throughput guarantee.

Chromium runs as the non-root app user; its internal sandbox is disabled inside this container for compatibility. Docker isolation remains in place. Only report generation uses Chromium; there is no local DICOM image renderer.

## Updates and backups

Before updates, back up **both** PostgreSQL and the uploads volume. Stored file paths inside the container remain `/app/uploads`.

```bash
mkdir -p backups
# Pause processing while taking a consistent database/files backup.
docker compose stop app
docker compose exec -T db pg_dump -U marengo -d marengo -Fc > backups/marengo.dump
docker compose run --rm --no-deps -T app tar -C /app/uploads -czf - . > backups/uploads.tar.gz
docker compose start app

git pull --ff-only
docker compose build
docker compose up -d --force-recreate migrate
docker compose up -d app web
docker compose logs --tail=100 app
```

Keep backups off-instance and periodically test restoring them to a separate deployment. Do not assume reverting the application also reverses a database migration. For an existing Windows database, plan a separate restore/migration: existing absolute Windows file paths must be remapped to `/app/uploads`. This release does not automatically import current credentials, patients or uploads.

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
