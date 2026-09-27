import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { storeObject, type StoredObject } from '../reportStorage'
import { studyStorageKind } from '../lib/studyStorage'
import { nonOverlapping } from '../runtime/tasks'
import * as queries from '../queries/studyArchive.queries'
import type { ArchiveJob } from '../queries/studyArchive.queries'

// Local study ZIPs are a short-lived buffer: S3 holds the permanent copy. A failed S3 upload is retried
// with backoff while the local ZIP still exists; once stored, the local ZIP is removed after the retention window.

const uploadsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'uploads')
const UPLOAD_TIMEOUT_MS = 15 * 60 * 1000
const FIRST_RETRY_MS = 5 * 60 * 1000
const MAX_RETRY_MS = 6 * 60 * 60 * 1000
const RETRY_BATCH = 10
const CLEANUP_BATCH = 200

export function localRetentionMs() {
  const days = Number(process.env.STUDY_LOCAL_RETENTION_DAYS ?? 3)
  return (Number.isFinite(days) && days > 0 ? days : 3) * 24 * 60 * 60 * 1000
}

/** 5 min, 10, 20, 40 ... capped at 6 h, so an S3 outage is retried without hammering it. */
export function nextUploadAttemptAt(attempts: number, now: Date) {
  const delay = Math.min(FIRST_RETRY_MS * 2 ** Math.max(0, attempts - 1), MAX_RETRY_MS)
  return new Date(now.getTime() + delay)
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function safeLocalFile(candidate: string | null | undefined) {
  if (!candidate) return null
  const [root, real] = await Promise.all([
    fsp.realpath(uploadsRoot).catch(() => uploadsRoot),
    fsp.realpath(path.resolve(candidate)).catch(() => null),
  ])
  if (!real) return null
  const relative = path.relative(root, real)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null
  return (await fsp.stat(real).catch(() => null))?.isFile() ? real : null
}

function uploadArchive(job: ArchiveJob, localPath: string) {
  return storeObject({
    kind: studyStorageKind(job.serviceType),
    keyParts: ['studies', job.id, job.uploadName],
    body: fs.createReadStream(localPath),
    contentType: 'application/zip',
    localPath,
    abortSignal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  })
}

function storedReference(stored: StoredObject) {
  return { bucket: stored.bucket, key: stored.key, url: stored.url }
}

/**
 * Uploads a job's original study ZIP to S3 and records the outcome. Returns null when S3 is not
 * configured or the upload failed; a failure is queued for retry, so callers can carry on.
 */
export async function storeOriginalStudy(job: ArchiveJob, now = new Date()): Promise<StoredObject | null> {
  try {
    const stored = await uploadArchive(job, job.uploadPath)
    if (stored) await queries.markArchiveStored(job.id, storedReference(stored), now)
    return stored
  } catch (error) {
    console.warn(`Unable to upload study ${job.id} to S3; will retry:`, errorMessage(error))
    await queries.markArchiveUploadFailed(job.id, errorMessage(error), nextUploadAttemptAt(job.archiveUploadAttempts + 1, now))
      .catch((markError) => console.error(`Unable to queue S3 upload retry for study ${job.id}:`, errorMessage(markError)))
    return null
  }
}

export async function retryFailedUploads(now = new Date()) {
  const jobs = await queries.findUploadRetriesDue(now, RETRY_BATCH)
  for (const job of jobs) {
    const localPath = await safeLocalFile(job.uploadPath)
    if (!localPath) {
      console.error(`Study ${job.id} was never stored in S3 and its local ZIP is gone (${job.uploadPath}); it must be re-sent from the hospital.`)
      await queries.markArchiveLocalGone(job.id, queries.ARCHIVE_LOCAL_MISSING, 'Local study ZIP missing before the S3 upload succeeded')
      continue
    }
    try {
      const stored = await uploadArchive(job, localPath)
      if (!stored) return console.warn('S3 study upload retry skipped: S3 storage is not configured')
      await queries.markArchiveStored(job.id, storedReference(stored), new Date())
      console.log(`Study ${job.id} stored in S3 on attempt ${job.archiveUploadAttempts + 1}`)
    } catch (error) {
      const attempts = job.archiveUploadAttempts + 1
      console.error(`S3 upload retry ${attempts} failed for study ${job.id}:`, errorMessage(error))
      await queries.markArchiveUploadFailed(job.id, errorMessage(error), nextUploadAttemptAt(attempts, new Date()))
    }
  }
}

export async function removeExpiredLocalArchives(now = new Date()) {
  const jobs = await queries.findExpiredLocalArchives(new Date(now.getTime() - localRetentionMs()), CLEANUP_BATCH)
  let removed = 0
  for (const job of jobs) {
    const localPath = await safeLocalFile(job.uploadPath)
    if (localPath) {
      try {
        await fsp.rm(localPath, { force: true })
        // Drops the study folder only when nothing else (e.g. clinical attachments) is left in it.
        await fsp.rmdir(path.dirname(localPath)).catch(() => undefined)
        removed++
      } catch (error) {
        console.warn(`Unable to remove local study ZIP for ${job.id}:`, errorMessage(error))
        continue
      }
    }
    await queries.markArchiveLocalGone(job.id, queries.ARCHIVE_LOCAL_REMOVED)
  }
  if (removed) console.log(`Removed ${removed} local study ZIP(s) already stored in S3`)
}

/**
 * In-process timers (single replica, see Harness/memory/constraint-single-replica.md):
 * S3 upload retries every 5 minutes, local retention cleanup every hour.
 */
export function startStudyArchiveMaintenance() {
  const retry = nonOverlapping(() => retryFailedUploads(), (error) => console.error('S3 study upload retry sweep failed', error))
  const cleanup = nonOverlapping(() => removeExpiredLocalArchives(), (error) => console.error('Local study retention sweep failed', error))
  setTimeout(retry, 30_000).unref()
  setTimeout(cleanup, 60_000).unref()
  setInterval(retry, 5 * 60 * 1000).unref()
  setInterval(cleanup, 60 * 60 * 1000).unref()
}
