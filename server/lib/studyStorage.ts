import type { StorageKind } from '../reportStorage'

/** An explicit archive URI is authoritative; retain encoded S3 key bytes verbatim. */
export function studyObjectReference(value: unknown, archivePath?: string | null): { bucket: string; key: string } | null {
  const match = archivePath?.match(/^s3:\/\/([^/]+)\/(.+)$/i)
  if (match) return { bucket: match[1], key: match[2] }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const container = record.storage && typeof record.storage === 'object' && !Array.isArray(record.storage) ? record.storage as Record<string, unknown> : record
  const original = container.originalStudy as Record<string, unknown> | undefined
  return original && typeof original.bucket === 'string' && original.bucket && typeof original.key === 'string' && original.key
    ? { bucket: original.bucket, key: original.key } : null
}

// Shared by the external viewer import and QuickView so both find a study ZIP in S3 the same way.

/** Bucket kind an original study ZIP is stored under, by processing service type. */
export function studyStorageKind(serviceType: string): StorageKind {
  if (serviceType.startsWith('ct')) return 'ct-studies'
  if (serviceType.startsWith('mri') || serviceType === 'mrcp' || serviceType.startsWith('mra')) return 'mri-studies'
  if (serviceType === 'mammography') return 'mammography-studies'
  if (serviceType.includes('xray')) return 'xray-studies'
  return 'original-studies'
}

export function studyViewerStorageKind(modalities: string[] | null | undefined): Extract<StorageKind, 'ct-studies' | 'mri-studies' | 'xray-studies' | 'mammography-studies'> {
  const values = new Set((modalities ?? []).map(value => value.toUpperCase()))
  if (values.has('CT')) return 'ct-studies'
  if (values.has('MRI') || values.has('MR')) return 'mri-studies'
  if (values.has('MG') || values.has('MAMMOGRAPHY')) return 'mammography-studies'
  return 'xray-studies'
}

export function bridgeStudyS3KeyCandidates(study: {
  id: string
  publicStudyId: string
  studyInstanceUid: string
  archivePath: string | null
  archiveName: string | null
  processingJob: { id: string; uploadName: string; upstreamStatus: unknown } | null
}) {
  const names = [
    study.archiveName,
    study.processingJob?.uploadName,
    `${study.studyInstanceUid}.zip`,
    `${study.publicStudyId}.zip`,
    `${study.id}.zip`,
  ].filter((value): value is string => Boolean(value))
  const archivePath = study.archivePath?.trim()
  const pathKey = archivePath
    ? archivePath.match(/^s3:\/\/[^/]+\/(.+)$/i)?.[1] ?? archivePath.replace(/\\/g, '/').replace(/^[A-Za-z]:\//, '').replace(/^\/+/, '')
    : ''
  return [
    pathKey,
    ...names,
    ...names.flatMap(name => [
      `studies/${study.processingJob?.id ?? study.id}/${name}`,
      `studies/${study.id}/${name}`,
      `studies/${study.publicStudyId}/${name}`,
      `viewer-imports/${study.id}/${name}`,
    ]),
  ]
}
