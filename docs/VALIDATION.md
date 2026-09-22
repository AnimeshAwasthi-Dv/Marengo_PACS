# Validation record

Validated locally during deployment preparation:

- Frontend and backend TypeScript checks pass.
- Vite production build passes.
- All 94 automated tests pass, including external URL validation, viewer authorization/share scope, bounded concurrency and portable BMP rendering.
- All 38 migrations apply to a fresh isolated PostgreSQL 18 database; Prisma reports no difference between the migrated database and the schema.
- Administrator/service seed succeeds; a second run preserves the password and does not add duplicate users or patients.
- API smoke checks pass for health, static frontend, external-viewer CSP, administrator login/listing, unauthorized viewer requests, invalid public shares, and removal of the local manifest endpoint.
- Dependency lockfile passes `npm ci --dry-run --ignore-scripts --offline` in a separate empty validation folder.

The initial application JavaScript bundle decreased from **1,181 kB / 351 kB gzip** after viewer removal to **632 kB / 170 kB gzip** after deferring charts, administration, QR generation and upload parsing. This compares two builds of this deployment copy, not a measured server throughput improvement. Vite still reports the main legacy application chunk above its 500 kB advisory threshold.

Not verified here:

- Docker image build/container startup: Docker is not installed in the Windows workspace. Compose targets PostgreSQL 16; migrations were exercised locally on PostgreSQL 18.
- Ubuntu Chromium/DCMTK/LibreOffice binary execution and real DICOM receive/return.
- Live provider submissions, production callbacks or storage credentials.
- External viewer embedding, authentication and study retrieval: URL/interface is still pending.
- Load testing against representative study sizes, concurrent users and provider response times.

Before production traffic, deploy to the target Ubuntu instance, verify health/login and one end-to-end study/report/PACS return, connect the external viewer, then observe resource use and queue latency under representative load. The resource limits are a conservative starting configuration for 4 vCPUs and 16 GB RAM.
