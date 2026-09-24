# Portal changes — 24 September 2026

These changes are in `marengo-deploy`. They have not been deployed.

## Implemented

- Reporting TAT chart with minutes on the Y axis, measured from submission to final reporting. Modality selection filters statistics and exports.
- Centers retain account creation/management, with manual service allocation removed. New Marengo centers receive enabled services automatically; submission also provisions missing service assignments for existing centers.
- Follow-up creation, patient search, status updates, loading/error states, and overdue filtering.
- Processing details contrast fixes and terminate/repush controls using the existing audited endpoints and final-report protections.
- Renewist and Services removed from super-admin navigation.
- Collapsible WhatsApp configuration/recipient sections and wrapping in details/history views.
- Audit browsing paginates identifiers in PostgreSQL before fetching large event payloads. Large exports retain their existing safety limit.
- Independent health observations for database-backed features, cache, outbox, storage, reporting/viewer services, center synchronization, and PACS TCP endpoints. Configuration and observed activity are distinguished from readiness.
- Share responses include an absolute scoped URL and server-generated QR image.
- Call scheduling uses preferred time windows independent of radiologist availability. Phone requests normalize the entered number; screen requests include a Jitsi room. Notifications include the contact information and target the assigned radiologist and eligible administrators.
- Estimated call charges removed from scheduling; authenticated JSON charge fields are hidden below group-admin level.
- Smaller WebP branding, no remote Google Fonts request, memoized worklist operations, incremental study loading, and corrected refresh timing.

## DICOM investigation and remaining dependency

The staging database references archives beneath the original Windows server's `C:\dectrocel-pacs-source-20260814-012324\uploads` directory. Those files were not found in the accessible workspace. Storage checks found some matching archives, but do not establish recovery for every affected study.

The viewer now resolves legacy paths within configured upload roots, searches configured object storage using the exact study UID, and carries the bucket and study UID through the import request. Authorization and public-share scope checks remain in place. Missing archives still require restoration or re-upload; these code changes cannot reconstruct them.

If the original uploads backup is mounted on the application server, set `LEGACY_UPLOAD_ROOTS` to its uploads root (semicolon-separated for multiple roots). The process must be able to read that directory. Restoring to the configured uploads root also supports the legacy relative paths.

Optional `DICOM_VIEWER_HEALTH_URL` and `RENEWIST_HEALTH_URL` configure explicit readiness probes. A reachable service without a health path is labeled reachable, not healthy.

## Validation and rollout checks

- 120 automated tests pass, including archive path containment, viewer/share authorization, preferred windows, phone validation, charge redaction, follow-up status filtering, and existing workflow tests.
- Client/server TypeScript checks and production build pass.
- Read-only staging audit checks returned two pages of 50 records without duplicates.
- Read-only health probes exposed Redis/outbox issues and PACS endpoints unreachable from the development machine. Verify those from the deployed application network.
- No real studies were terminated/repushed, no call notifications were sent, and no live shares were created during validation. Check those workflows with designated test records after rollout.
- Browser/mobile interaction testing and a new Lighthouse measurement remain to be done against the running build. No new Lighthouse score is claimed.
