import { requiresExternalViewer } from '../services/viewerPolicy.service'

export type PreimportCandidate = { id: string; modalities: string[] }
/** 'started': the viewer has the study (queued, importing or done). 'unavailable': no archive to import yet. */
export type PreimportOutcome = 'started' | 'unavailable'

export type ViewerPreimportDependencies = {
  /** Recently changed bridge studies, newest first, with a bounded page size. */
  findRecent(since: Date): Promise<PreimportCandidate[]>
  /** Hands the study's archive to the viewer's import queue without waiting for it to finish. */
  startImport(studyId: string): Promise<PreimportOutcome>
  now?(): number
}

// How far back each sweep looks. Longer than the sweep interval, so a slow sweep or a short restart misses nothing.
export const PREIMPORT_LOOKBACK_MS = 15 * 60 * 1000
// A study whose archive wasn't there yet (or whose import failed to start) is tried again after this.
const RETRY_MS = 5 * 60 * 1000
// Studies are remembered this long so each is handed to the viewer once.
const REMEMBER_MS = 24 * 60 * 60 * 1000

/**
 * Starts the external viewer's ZIP import for new CT, MR, PET and NM studies before anyone opens them, so a
 * radiologist opening a study gets a session straight away instead of waiting for the viewer to index it.
 * Imports are idempotent on the viewer side (same archive → same import), so a repeat after a restart is cheap.
 *
 * In-process state: `attempts` lives in this process and the sweep runs on an in-process timer. The app runs as one
 * replica (see Harness/memory/constraint-single-replica.md); a second replica would only repeat idempotent requests.
 */
export function createViewerPreimporter(deps: ViewerPreimportDependencies) {
  const now = deps.now ?? Date.now
  const attempts = new Map<string, { at: number; outcome: PreimportOutcome | 'failed' }>()
  let running = false

  async function sweep() {
    if (running) return
    running = true
    try {
      const started = now()
      for (const [id, attempt] of attempts) if (started - attempt.at > REMEMBER_MS) attempts.delete(id)
      const candidates = await deps.findRecent(new Date(started - PREIMPORT_LOOKBACK_MS))
      // One at a time: the viewer imports serially anyway, and this keeps S3 and viewer API load low.
      for (const study of candidates) {
        if (!requiresExternalViewer(study.modalities)) continue
        const previous = attempts.get(study.id)
        if (previous?.outcome === 'started') continue
        if (previous && now() - previous.at < RETRY_MS) continue
        try {
          attempts.set(study.id, { at: now(), outcome: await deps.startImport(study.id) })
        } catch (error) {
          attempts.set(study.id, { at: now(), outcome: 'failed' })
          console.warn(`Viewer pre-import for bridge study ${study.id} failed:`, error instanceof Error ? error.message : error)
        }
      }
    } finally {
      running = false
    }
  }

  return { sweep }
}
