# Local verification — 21 October 2026

The local `.env` explicitly sets `TELEGRAM_ENABLED`, `TELEGRAM_ALERT_ENABLED`, `TELEGRAM_URGENT_ENABLED`, `TELEGRAM_CALLBACK_ENABLED`, and `TECH_ALERT_ENABLED` to `false`. The API was restarted with this environment. The shared application environment in `compose.yaml` also sets all five flags to `false`, overriding deployment environment files for API, ingest and worker containers when this version is deployed. Existing remote containers are unchanged until deployment.

## Results

- Portal: `npm test` — **222 passed, 0 failed**. Output: `verification-tests.log`.
- Build/type checking: `npm run build` — **passed**. Output: `verification-build.log`.
- Restarted local API: health endpoint passed through Vite; database-backed login returned the expected 401 for a nonexistent diagnostic account.
- Lint: **100 errors, 15 warnings** across the existing repository. Output: `verification-lint.log`. This is not a clean lint baseline.
- Bridge after updating to `origin/staging` commit `324756a`: full solution build passed with **0 warnings, 0 errors**; full test suite — **157 passed, 3 failed**. Failures are missing synthetic codec fixtures: `part2-92-3.dcm`, `part2-93-1.dcm`, `part2-93-3.dcm`. The existing generator also fails on Windows cleanup and aborts inside GDCM when encoding RGB. No fixtures were substituted or tests skipped. All **22 per-image upload tests** passed separately.

## Telegram checks

`server/telegramDisabled.test.ts` verifies all five flags in local `.env` when present and the shared Compose environment, prevents any real network transport, and checks that disabled study, urgent, TAT, physician-callback and technical-monitor paths do not send messages. Disabled outbox paths do not query the database or enqueue new study notifications. The low-level study-message sender and technical-alert transport now also reject disabled configuration before contacting Telegram.

## Bridge upload simulation

`server/bridgeStreaming.test.ts` starts a temporary HTTP server using the portal's real per-image upload router and store. It uploads two generated, non-patient DICOM images in streamed raw and gzip batches, assembles a study ZIP, checks byte-exact contents and DICOM identifiers, and verifies duplicate commits register only once.

Additional checks cover authorization, unsupported compression, invalid/truncated image batches, image checksums, missing images, missing ZIP parts, malformed upload IDs, part checksums, interrupted part streams, out-of-order/retried parts, restart recovery, whole-archive checksum rejection, temporary-file cleanup and saved completion acknowledgements.

The simulation exposed and fixed an HTTP connection reset on invalid image batches: stream iteration now preserves the request socket so the portal can return a structured validation response.

The tests isolate registration from the database and downstream services. They do **not** upload into the connected staging database, run the installed Windows bridge against that database, or exercise live PACS/S3/viewer/reporting services. Bridge's own suite exercises its .NET upload client, retry and progress behavior separately. Real infrastructure integration remains unverified; Redis and startup workers are disabled in the local runtime.

## Other fixes

- Restored S3 storage-reference, viewer copy and bounded archive-download helpers required by storage regression tests. Explicit S3 archive URIs take precedence over stale metadata; cross-bucket viewer archives copy into the modality bucket.
- Made `dev:api` invoke the `tsx` CLI through Node so Windows can resolve the command.

## Production bridge package

Built `MarengoAsiaBridge-Production-3.0.11-win-x64-Setup.exe` using the bridge's Release installer script. Both Windows x64 payloads (Service and Desktop) include the self-contained .NET runtime and GDCM decoder. The Service configuration targets `https://marengo.pacsdectrocel.online`. SHA-256: `1e3125a7ae18c8f9356a31d320a28c3daee03c2e786f7e39e5a5b44696bec259` (verified against the generated sidecar).

The installer was built, not installed or published. Per-image upload remains controlled by the bridge setting "Upload images individually while the study is arriving"; the build does not change an installed bridge's saved settings.

Passing checks cannot establish that the entire project has no bugs. The bridge fixture failures, lint findings and live infrastructure checks remain outstanding.
