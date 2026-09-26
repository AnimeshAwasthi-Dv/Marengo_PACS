import { isSpecialXrayStudy } from '../../src/specialXray'

// Response shapes for available (bridge) studies, shared by index.ts and the worklist layers.

type StatusInput = { workflowStatus: string; availabilityStatus: string; processingJob?: { status: string } | null }

function bridgeStudyStatus(study: StatusInput) {
  return study.processingJob
    ? study.processingJob.status === 'queued' ? 'Queued'
      : study.processingJob.status === 'processing' ? 'Processing'
        : study.workflowStatus
    : study.availabilityStatus
}

function bridgeStudyCategory(study: { modalities: string[]; studyDescription?: string | null }) {
  return study.modalities.includes('MG') ? 'Mammogram' : isSpecialXrayStudy(study) ? 'Special X-ray' : null
}

export function formatBridgeStudyForClient(study: {
  id: string
  publicStudyId: string
  agentId: string
  agentName?: string | null
  studyInstanceUid: string
  patientId?: string | null
  patientName?: string | null
  patientSex?: string | null
  patientAge?: string | null
  accessionNumber?: string | null
  studyDate?: string | null
  studyTime?: string | null
  studyDescription?: string | null
  modalities: string[]
  seriesCount: number
  instanceCount: number
  totalSizeBytes?: bigint | number
  localIp?: string | null
  localPort?: number | null
  localAeTitle?: string | null
  archiveName?: string | null
  clinicalIndication?: string | null
  processingJobId?: string | null
  priority?: string | null
  availabilityStatus: string
  workflowStatus: string
  lastSyncedAt: Date
  firstDetectedAt?: Date | null
  createdAt?: Date
  referringPhysician?: string | null
  selectedAt?: Date | null
  submittedAt?: Date | null
  attachments?: Array<{ id: string; originalName: string; mimeType?: string | null; sizeBytes: bigint | number; createdAt: Date }>
  processingJob?: { id: string; status: string; clinicalStatus?: string | null; completedAt?: Date | null; priority?: string | null } | null
  dispatchRequests?: Array<{ requestId: string; status: string; progressPercentage: number; createdAt: Date; lastErrorMessage?: string | null }>
}) {
  const latestDispatch = study.dispatchRequests?.[0] ?? null
  const status = bridgeStudyStatus(study)
  return {
    id: study.id,
    publicStudyId: study.publicStudyId,
    agentId: study.agentId,
    agentName: study.agentName,
    studyInstanceUid: study.studyInstanceUid,
    patientId: study.patientId,
    patientName: study.patientName,
    patientSex: study.patientSex,
    patientAge: study.patientAge,
    accessionNumber: study.accessionNumber,
    studyDate: study.studyDate,
    studyTime: study.studyTime,
    studyDescription: study.studyDescription,
    modalities: study.modalities,
    studyCategory: bridgeStudyCategory(study),
    seriesCount: study.seriesCount,
    instanceCount: study.instanceCount,
    totalSizeBytes: study.totalSizeBytes ? String(study.totalSizeBytes) : '0',
    localIp: study.localIp ?? null,
    localPort: study.localPort ?? null,
    localAeTitle: study.localAeTitle ?? null,
    archiveName: study.archiveName ?? null,
    clinicalIndication: study.clinicalIndication ?? null,
    processingJobId: study.processingJobId ?? null,
    priority: study.processingJob?.priority ?? study.priority ?? 'REGULAR',
    status,
    availabilityStatus: study.availabilityStatus,
    workflowStatus: study.workflowStatus,
    lastSyncedAt: study.lastSyncedAt,
    receivedAt: study.firstDetectedAt ?? study.createdAt ?? study.lastSyncedAt,
    referringPhysician: study.referringPhysician ?? null,
    selectedAt: study.selectedAt,
    submittedAt: study.submittedAt ?? null,
    attachments: (study.attachments ?? []).map((attachment) => ({
      id: attachment.id,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType ?? null,
      sizeBytes: String(attachment.sizeBytes),
      createdAt: attachment.createdAt,
    })),
    processingJob: study.processingJob ?? null,
    latestDispatch,
  }
}

export function formatBridgeStudyForAdmin(study: Parameters<typeof formatBridgeStudyForClient>[0] & {
  client?: { id: string; code: string; name: string } | null
  createdAt?: Date
  updatedAt?: Date
  dispatchRequests?: Array<{ requestId: string; status: string; progressPercentage: number; createdAt: Date; lastErrorMessage?: string | null }>
}) {
  return {
    ...formatBridgeStudyForClient(study),
    client: study.client ? { id: study.client.id, code: study.client.code, name: study.client.name } : null,
    createdAt: study.createdAt,
    updatedAt: study.updatedAt,
    dispatchRequests: study.dispatchRequests ?? [],
  }
}

export type WorklistReport = {
  id: string
  clientId: string
  studyUid: string | null
  status: string
  patientName: string | null
  patientId: string | null
  accession: string | null
  serviceName: string
  modality: string | null
  generatedAt: Date
  approvedAt: Date | null
  reviewedAt: Date | null
  pushedAt: Date | null
  updatedAt: Date
}

/** Worklist row: only what the table, filters, counts and TAT need. The drawer loads the rest on click. */
export function formatWorklistRow(study: StatusInput & {
  id: string
  clientId: string
  publicStudyId: string
  studyInstanceUid: string
  patientId: string | null
  patientName: string | null
  accessionNumber: string | null
  studyDescription: string | null
  modalities: string[]
  referringPhysician: string | null
  processingJobId: string | null
  priority: string
  lastSyncedAt: Date
  firstDetectedAt: Date | null
  createdAt: Date
  submittedAt: Date | null
  updatedAt: Date
  processingJob: { id: string; status: string; completedAt: Date | null; priority: string | null } | null
  _count: { attachments: number }
}, report: WorklistReport | null) {
  return {
    id: study.id,
    clientId: study.clientId,
    publicStudyId: study.publicStudyId,
    studyInstanceUid: study.studyInstanceUid,
    patientId: study.patientId,
    patientName: study.patientName,
    accessionNumber: study.accessionNumber,
    studyDescription: study.studyDescription,
    modalities: study.modalities,
    studyCategory: bridgeStudyCategory(study),
    referringPhysician: study.referringPhysician,
    processingJobId: study.processingJobId,
    priority: study.processingJob?.priority ?? study.priority ?? 'REGULAR',
    status: bridgeStudyStatus(study),
    availabilityStatus: study.availabilityStatus,
    workflowStatus: study.workflowStatus,
    lastSyncedAt: study.lastSyncedAt,
    receivedAt: study.firstDetectedAt ?? study.createdAt ?? study.lastSyncedAt,
    submittedAt: study.submittedAt,
    updatedAt: study.updatedAt,
    processingJob: study.processingJob,
    attachmentCount: study._count.attachments,
    report,
  }
}
