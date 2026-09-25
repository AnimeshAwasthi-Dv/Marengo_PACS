import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Response } from 'express'
import yazl from 'yazl'
import { resolveArchivePath } from './viewer/archivePaths'
import { bridgeStudyS3KeyCandidates, studyViewerStorageKind } from './lib/studyStorage'
import { findStoredStudyObject, openStoredObject, type StorageKind } from './reportStorage'

type StoredReference = { bucket: string; key: string }
export type BundleStudySource = {
  id: string
  publicStudyId: string
  studyInstanceUid: string
  modalities: string[]
  archivePath?: string | null
  archiveName?: string | null
  processingJob?: { id: string; uploadName: string; uploadPath?: string | null; upstreamStatus: unknown } | null
}
export class StudyArchiveError extends Error {
  constructor(message: string, public status: number) { super(message) }
}
type Archive = { stream: Readable; name: string; size?: number }
type Dependencies = {
  local: (candidate: string | null | undefined) => Promise<string | null>
  openLocal: (file: string) => Readable
  openStored: (reference: StoredReference, signal?: AbortSignal) => Promise<{ stream: Readable; size?: number } | null>
  findStored: (input: { kinds: StorageKind[]; keys: string[] }) => Promise<StoredReference | null>
}
function storedReference(value: unknown): StoredReference | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const container = record.storage && typeof record.storage === 'object' ? record.storage as Record<string, unknown> : record
  const original = container.originalStudy as Record<string, unknown> | undefined
  return original && typeof original.bucket === 'string' && original.bucket && typeof original.key === 'string' && original.key
    ? { bucket: original.bucket, key: original.key } : null
}
function s3Path(value?: string | null): StoredReference | null {
  const match = value?.match(/^s3:\/\/([^/]+)\/(.+)$/)
  return match ? { bucket: match[1], key: match[2] } : null
}
export function bundleFileName(value: string) {
  return value.replaceAll('\\', '/').split('/').at(-1)!.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '') || 'study.zip'
}

/** Call only after study authorization. Never accept a bucket/key from request parameters. */
export async function openStudyArchive(study: BundleStudySource, dependencies: Dependencies, signal?: AbortSignal): Promise<Archive> {
  const recorded = storedReference(study.processingJob?.upstreamStatus) ?? s3Path(study.archivePath)
  const name = bundleFileName(study.archiveName || study.processingJob?.uploadName || `${study.studyInstanceUid || study.id}.zip`)
  const open = async (reference: StoredReference) => {
    signal?.throwIfAborted()
    try {
      const file = await dependencies.openStored(reference, signal)
      return file ? { ...file, name } : null
    } catch (error) {
      if (signal?.aborted) throw error
      throw new StudyArchiveError('Unable to read the study archive from object storage. Please try again or contact support.', 502)
    }
  }
  // Use the exact recorded S3 object before any broad legacy bucket search.
  if (recorded) {
    const file = await open(recorded)
    if (file) return file
  }
  for (const candidate of [study.archivePath, study.processingJob?.uploadPath]) {
    const local = await dependencies.local(candidate)
    if (local) return { stream: dependencies.openLocal(local), name }
  }
  signal?.throwIfAborted()
  const found = await dependencies.findStored({
    kinds: [studyViewerStorageKind(study.modalities), 'original-studies', 'cleaned-dicoms'],
    keys: bridgeStudyS3KeyCandidates({ ...study, archivePath: study.archivePath ?? null, archiveName: study.archiveName ?? null, processingJob: study.processingJob ?? null }),
  }).catch(() => { throw new StudyArchiveError('Unable to locate the study archive in object storage. Please try again or contact support.', 502) })
  if (found && (!recorded || found.bucket !== recorded.bucket || found.key !== recorded.key)) {
    const file = await open(found)
    if (file) return file
  }
  throw new StudyArchiveError('The original study archive is unavailable in local or object storage. Restore or re-upload the study before downloading.', 404)
}

/** Stream the archive inside the ZIP; do not buffer multi-GB studies or recompress ZIP data. */
export async function sendStudyBundle(res: Response, input: {
  source: BundleStudySource
  metadata: Record<string, unknown>
  clinicalIndication?: string | null
  attachments: Array<{ filePath: string; originalName: string }>
}, dependencies?: Dependencies) {
  const roots = [path.resolve('uploads'), ...(process.env.LEGACY_UPLOAD_ROOTS || '').split(';').filter(Boolean)]
  const deps = dependencies ?? {
    local: (candidate: string | null | undefined) => resolveArchivePath(candidate, roots),
    openLocal: (file: string) => fs.createReadStream(file),
    openStored: openStoredObject,
    findStored: findStoredStudyObject,
  }
  const controller = new AbortController()
  let archive: Archive | undefined
  let zip: InstanceType<typeof yazl.ZipFile> | undefined
  const cancel = () => { controller.abort(); archive?.stream.destroy(); zip?.outputStream.destroy() }
  res.once('close', cancel)
  try {
    const attachments = (await Promise.all(input.attachments.map(async item => ({ ...item, path: await deps.local(item.filePath) })))).filter(item => item.path)
    archive = await openStudyArchive(input.source, deps, controller.signal)
    controller.signal.throwIfAborted()
    zip = new yazl.ZipFile()
    const output = zip.outputStream
    zip.on('error', (error: Error) => output.destroy(error))
    archive.stream.on('error', (error: Error) => output.destroy(error))
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${bundleFileName(input.source.publicStudyId)}-bundle.zip"`)
    res.setHeader('Cache-Control', 'private, no-store')
    const done = pipeline(output, res)
    try {
      const metadata = { ...input.metadata, bundle: { generatedAt: new Date().toISOString(), archiveIncluded: true, attachmentsIncluded: attachments.length, attachmentsOmitted: input.attachments.length - attachments.length } }
      zip.addBuffer(Buffer.from(JSON.stringify(metadata, (_key, value) => typeof value === 'bigint' ? String(value) : value, 2)), 'metadata.json')
      zip.addBuffer(Buffer.from(input.clinicalIndication?.trim() || 'No clinical indication was supplied.'), 'clinical-indication.txt')
      zip.addReadStream(archive.stream, `study/${archive.name}`, { compress: false, ...(archive.size === undefined ? {} : { size: archive.size }) })
      attachments.forEach((item, index) => zip!.addFile(item.path!, `attachments/${String(index + 1).padStart(3, '0')}-${bundleFileName(item.originalName)}`))
      zip.end()
      await done
    } catch (error) {
      output.destroy(error as Error)
      await done.catch(() => undefined)
      throw error
    }
  } finally {
    res.off('close', cancel)
    cancel()
  }
}
