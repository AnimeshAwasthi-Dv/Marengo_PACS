import type { StorageKind } from '../reportStorage'

// Shared by the external viewer import and QuickView so both find a study ZIP in S3 the same way.

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
