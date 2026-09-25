import { prisma } from '../db'

// Only the columns QuickView needs to find a study's files; never report bodies.
const bridgeStudySourceSelect = {
  id: true,
  publicStudyId: true,
  studyInstanceUid: true,
  archiveName: true,
  modalities: true,
  totalSizeBytes: true,
  archivePath: true,
  processingJobId: true,
} as const

const processingJobSourceSelect = {
  id: true,
  clientId: true,
  serviceType: true,
  uploadName: true,
  uploadPath: true,
  upstreamStatus: true,
  bridgeStudy: { select: bridgeStudySourceSelect },
} as const

export function findBridgeStudySource(bridgeStudyId: string) {
  return prisma.availableBridgeStudy.findUnique({
    where: { id: bridgeStudyId },
    select: { ...bridgeStudySourceSelect, processingJob: { select: { id: true, uploadName: true, uploadPath: true, upstreamStatus: true } } },
  })
}

export function findProcessingJobSource(jobId: string) {
  return prisma.processingJob.findUnique({ where: { id: jobId }, select: processingJobSourceSelect })
}

export async function findProcessingJobIdForReport(reportId: string) {
  const mapping = await prisma.providerJobMapping.findFirst({
    where: { reportReviewId: reportId, processingJobId: { not: null } },
    orderBy: { updatedAt: 'desc' },
    select: { processingJobId: true },
  })
  return mapping?.processingJobId ?? null
}

export function findBridgeStudyByUid(clientId: string, studyInstanceUid: string) {
  return prisma.availableBridgeStudy.findFirst({
    where: { clientId, studyInstanceUid },
    orderBy: { lastSyncedAt: 'desc' },
    select: bridgeStudySourceSelect,
  })
}

export function findArchiveStudyFiles(archiveId: string) {
  return prisma.patientStudyArchiveFile.findMany({
    where: { archiveId, role: 'STUDY' },
    orderBy: { createdAt: 'asc' },
    select: { filePath: true, originalName: true, sizeBytes: true },
  })
}
