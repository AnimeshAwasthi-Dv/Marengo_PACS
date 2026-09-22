# Module boundaries

| Path | Responsibility |
| --- | --- |
| `src/types/portal.ts` | Shared portal contracts extracted from App |
| `src/lib/api.ts` | Authenticated JSON API client |
| `src/features/viewer/ExternalViewerPane.tsx` | Remote viewer loading, error state, iframe and new-tab link |
| `src/features/analytics/Charts.tsx` | Lazy-loaded chart components |
| `src/pacsWorklist.ts` | Worklist statuses, filters, counts and time formatting |
| `src/liveRefresh.ts`, `src/useLiveRefresh.ts` | Visibility-aware polling and retry/backoff |
| `server/viewer/externalViewer.ts` | Validated configurable study URL construction |
| `server/viewer/routes.ts` | Six authorized study/report viewer entry points |
| `server/platform/tools.ts` | Cached executable discovery using Linux PATH/DCMTK_BIN |
| `server/platform/reportImages.ts` | Portable report bitmap generation, independent of DICOM viewing |
| `server/runtime/tasks.ts` | Non-overlapping scheduled work and bounded rendering concurrency |
| Existing server routers | Worklist, administration, billing, notifications and provider integration |
| `deployment/`, `Dockerfile`, `compose*.yaml` | Linux runtime, HTTPS, storage and resource limits |

The migration preserves business workflows while removing bundled viewer assets, viewer session memory maps, manifest/image endpoints, image extraction and pixel rendering/prewarming. Viewer session endpoints now return an external link after the existing authorization checks.

`App.tsx` and `server/index.ts` still coordinate substantial legacy workflows. Shared types, API access, charts, external viewing, platform tools and runtime controls have been separated; this is not a complete rewrite of every legacy page/router. Further extraction should proceed by business feature with integration tests.

The database remains the durable record of processing jobs. Startup recovery is retained. Running several API replicas is not supported by the existing local receiver/queue design; adding replicas requires distributed job claiming and separating DICOM receivers from web processes.
