import type { Prisma } from '@prisma/client'
import { prisma } from '../db'

/** Output of `workspaceStudyScope`: every query here must spread it into its `where`. */
export type StudyScope = { clientId?: { in: string[] } }

// Legacy row shape, kept for callers that do not ask for `view=worklist`.
const fullRowSelect = {
  client: { select: { id: true, name: true, code: true } },
  id: true, publicStudyId: true, agentId: true, agentName: true, studyInstanceUid: true,
  patientId: true, patientName: true, patientSex: true, patientAge: true, accessionNumber: true,
  studyDate: true, studyTime: true, studyDescription: true, modalities: true, seriesCount: true,
  instanceCount: true, totalSizeBytes: true, localIp: true, localPort: true, localAeTitle: true,
  archiveName: true, clinicalIndication: true, processingJobId: true, availabilityStatus: true,
  workflowStatus: true, lastSyncedAt: true, selectedAt: true, submittedAt: true,
  referringPhysician: true, firstDetectedAt: true, createdAt: true, priority: true,
  processingJob: { select: { id: true, status: true, clinicalStatus: true, completedAt: true, priority: true } },
  dispatchRequests: {
    select: { requestId: true, status: true, progressPercentage: true, createdAt: true, lastErrorMessage: true },
    orderBy: { createdAt: 'desc' },
    take: 1,
  },
  attachments: {
    select: { id: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  },
} satisfies Prisma.AvailableBridgeStudySelect

// Worklist row: the columns the table, filters, counts and TAT read. No attachments,
// dispatch history, agent/network fields or clinical history (those load on click).
const worklistRowSelect = {
  id: true, clientId: true, publicStudyId: true, studyInstanceUid: true,
  patientId: true, patientName: true, accessionNumber: true, studyDescription: true, modalities: true,
  referringPhysician: true, processingJobId: true, priority: true, availabilityStatus: true,
  workflowStatus: true, lastSyncedAt: true, firstDetectedAt: true, createdAt: true, submittedAt: true, updatedAt: true,
  processingJob: { select: { id: true, status: true, completedAt: true, priority: true } },
  _count: { select: { attachments: true } },
} satisfies Prisma.AvailableBridgeStudySelect

// Report fields the worklist needs for status, TAT and the share/call/preview actions.
const worklistReportSelect = {
  id: true, clientId: true, studyUid: true, status: true, patientName: true, patientId: true, accession: true,
  serviceName: true, modality: true, generatedAt: true, approvedAt: true, reviewedAt: true, pushedAt: true, updatedAt: true,
} satisfies Prisma.ReportReviewSelect

const pageArgs = (cursor: string | undefined, take: number) => ({
  orderBy: [{ lastSyncedAt: 'desc' }, { id: 'desc' }] satisfies Prisma.AvailableBridgeStudyOrderByWithRelationInput[],
  ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  take: take + 1,
})

// DATABASE_READ_ONLY deployments predate the priority column.
const readOnly = process.env.DATABASE_READ_ONLY === 'true'

export function findFullStudyPage(where: Prisma.AvailableBridgeStudyWhereInput, cursor: string | undefined, take: number) {
  return prisma.availableBridgeStudy.findMany({ where, select: { ...fullRowSelect, priority: !readOnly }, ...pageArgs(cursor, take) })
}

export function findWorklistStudyPage(where: Prisma.AvailableBridgeStudyWhereInput, cursor: string | undefined, take: number) {
  return prisma.availableBridgeStudy.findMany({ where, select: { ...worklistRowSelect, priority: !readOnly }, ...pageArgs(cursor, take) })
}

/** One batched lookup per page (never per row); uses report_reviews(clientId, studyUid, status). */
export function findReportsForStudies(scope: StudyScope, studyUids: string[]) {
  if (!studyUids.length) return Promise.resolve([])
  return prisma.reportReview.findMany({
    where: { ...scope, studyUid: { in: studyUids } },
    select: worklistReportSelect,
    orderBy: { updatedAt: 'desc' },
  })
}

/**
 * Ids of studies whose row, processing job or report changed after `since`.
 * Returns null when more than `limit` changed; the caller should then reload in full.
 */
export async function findChangedStudyIds(scope: StudyScope, since: Date, limit: number) {
  // Sequential, not Promise.all: this runs on every poll and should not take several pool connections.
  const studies = await prisma.availableBridgeStudy.findMany({ where: { ...scope, updatedAt: { gt: since } }, select: { id: true }, take: limit + 1 })
  const jobs = await prisma.processingJob.findMany({
    where: { ...scope, updatedAt: { gt: since }, bridgeStudy: { isNot: null } },
    select: { bridgeStudy: { select: { id: true } } },
    take: limit + 1,
  })
  const reports = await prisma.reportReview.findMany({
    where: { ...scope, updatedAt: { gt: since }, studyUid: { not: null } },
    select: { studyUid: true },
    distinct: ['studyUid'],
    take: limit + 1,
  })
  if (studies.length > limit || jobs.length > limit || reports.length > limit) return null
  const reportedStudies = reports.length
    ? await prisma.availableBridgeStudy.findMany({
      where: { ...scope, studyInstanceUid: { in: reports.map(report => report.studyUid!) } },
      select: { id: true },
      take: limit + 1,
    })
    : []
  const ids = new Set([...studies, ...reportedStudies].map(study => study.id))
  for (const job of jobs) if (job.bridgeStudy) ids.add(job.bridgeStudy.id)
  return ids.size > limit ? null : [...ids]
}

/** Everything the study drawer and its dialogs need, for one study inside the caller's scope. */
export function findStudyDetail(scope: StudyScope, studyId: string) {
  return prisma.availableBridgeStudy.findFirst({
    where: { id: studyId, ...scope },
    select: {
      ...fullRowSelect,
      priority: !readOnly,
      updatedAt: true,
      processingJob: { select: { id: true, status: true, clinicalStatus: true, completedAt: true, priority: true, error: true } },
    },
  })
}
