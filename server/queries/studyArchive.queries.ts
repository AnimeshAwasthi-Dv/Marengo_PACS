import { Prisma } from '@prisma/client'
import { prisma } from '../db'

export const ARCHIVE_UPLOAD_FAILED = 'UPLOAD_FAILED'
export const ARCHIVE_STORED = 'STORED'
export const ARCHIVE_LOCAL_REMOVED = 'LOCAL_REMOVED'
export const ARCHIVE_LOCAL_MISSING = 'LOCAL_MISSING'

// Jobs whose local ZIP may still be needed: in-flight, or waiting on a RadAgent/Renewist retry that reads it.
export const localArchiveNeededStatuses = ['queued', 'processing', 'submitting_to_renewist', 'outbound_submission_failed', 'failed']

const archiveJobSelect = { id: true, serviceType: true, uploadName: true, uploadPath: true, archiveUploadAttempts: true } as const
export type ArchiveJob = Prisma.ProcessingJobGetPayload<{ select: typeof archiveJobSelect }>

export function findUploadRetriesDue(now: Date, take: number) {
  return prisma.processingJob.findMany({
    where: { archiveState: ARCHIVE_UPLOAD_FAILED, archiveNextAttemptAt: { lte: now } },
    select: archiveJobSelect,
    orderBy: { archiveNextAttemptAt: 'asc' },
    take,
  })
}

export function findExpiredLocalArchives(storedBefore: Date, take: number) {
  return prisma.processingJob.findMany({
    where: { archiveState: ARCHIVE_STORED, archiveStoredAt: { lt: storedBefore }, status: { notIn: localArchiveNeededStatuses } },
    select: { id: true, uploadPath: true },
    orderBy: { archiveStoredAt: 'asc' },
    take,
  })
}

/**
 * Marks the study as safely in S3 and records the object on upstreamStatus.storage.originalStudy
 * (where QuickView, downloads and the viewer import look first). jsonb merge in Postgres so a
 * concurrent status write is not overwritten with a stale copy of the JSON.
 */
export async function markArchiveStored(jobId: string, stored: { bucket: string; key: string; url: string }, storedAt: Date) {
  await prisma.$executeRaw`
    UPDATE "processing_jobs"
    SET "archiveState" = ${ARCHIVE_STORED},
        "archiveStoredAt" = ${storedAt},
        "archiveNextAttemptAt" = NULL,
        "archiveError" = NULL,
        "archiveUploadAttempts" = "archiveUploadAttempts" + 1,
        "upstreamStatus" = jsonb_set(
          COALESCE("upstreamStatus", '{}'::jsonb),
          '{storage}',
          COALESCE("upstreamStatus"->'storage', '{}'::jsonb) || jsonb_build_object('originalStudy', ${JSON.stringify(stored)}::jsonb)
        ),
        "updatedAt" = NOW()
    WHERE "id" = ${jobId}`
}

export function markArchiveUploadFailed(jobId: string, error: string, nextAttemptAt: Date) {
  return prisma.processingJob.update({
    where: { id: jobId },
    data: { archiveState: ARCHIVE_UPLOAD_FAILED, archiveError: error.slice(0, 1000), archiveNextAttemptAt: nextAttemptAt, archiveUploadAttempts: { increment: 1 } },
    select: { archiveUploadAttempts: true },
  })
}

export function markArchiveLocalGone(jobId: string, state: typeof ARCHIVE_LOCAL_REMOVED | typeof ARCHIVE_LOCAL_MISSING, error: string | null = null) {
  return prisma.processingJob.update({
    where: { id: jobId },
    data: { archiveState: state, archiveNextAttemptAt: null, archiveError: error },
    select: { id: true },
  })
}
