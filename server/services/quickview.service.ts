import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { setTimeout } from 'node:timers'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import yazl from 'yazl'
import { findExecutable } from '../platform/tools'
import { previewPool } from '../lib/previewPool'
import { listDicomInstances, openInstanceStream, type DicomInstanceHeader, type StudyFileSource } from '../lib/dicomArchive'
import { downloadStoredObjectToFile, findStoredStudyObject } from '../reportStorage'
import { bridgeStudyS3KeyCandidates, studyViewerStorageKind } from '../lib/studyStorage'
import * as queries from '../queries/quickview.queries'
import type { QuickViewManifest, QuickViewSeries, ViewerTarget } from '../models/quickview.model'
import { chooseViewerMode, quickViewConfig, type ViewerDecision } from './viewerPolicy.service'

const uploadsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'uploads')
const cacheRoot = path.join(uploadsRoot, 'quickview-cache')
const MAX_INSTANCES = 500
const MAX_WALK_FILES = 2000
const INDEX_TTL_MS = 10 * 60 * 1000
const INDEX_CACHE_LIMIT = 100
const CACHE_FILE_MAX_AGE_MS = 24 * 60 * 60 * 1000
const previewsRoot = path.join(cacheRoot, 'previews')
const compactRoot = path.join(cacheRoot, 'compact')
const PREVIEW_MAX_SIZE = 1024
// Uncompressed images above this size get a lossless JPEG copy (about half the download) for later opens.
// JPEG lossless (process 14, SV1) rather than JPEG-LS: nearly the same size, but it decodes ~2.4x faster in the browser.
const COMPACT_MIN_BYTES = 4 * 1024 * 1024
// How long an image request waits for its lossless copy before sending the original instead.
const COMPACT_WAIT_MS = 4000
const UNCOMPRESSED_SYNTAXES = new Set(['1.2.840.10008.1.2', '1.2.840.10008.1.2.1', '1.2.840.10008.1.2.2'])
const execFileAsync = promisify(execFile)

type S3Reference = { bucket: string; key: string }
type StudyLocation = { local: StudyFileSource[] } | { s3: S3Reference }
/** Cheap facts first (modality, size, local files); the S3 search only runs when QuickView actually applies. */
type StudyDescription = { modalities: string[]; sizeBytes: number; local: StudyFileSource[]; findS3: () => Promise<S3Reference | null> }
export type StudyIndex = { sources: StudyFileSource[]; instances: DicomInstanceHeader[]; manifest: QuickViewManifest; expiresAt: number }

// Process-local cache of indexed studies. Safe because the app runs as a single replica
// (DICOM receivers and job chains are in-process too); a second replica would simply re-index.
const indexCache = new Map<string, StudyIndex>()
const indexing = new Map<string, Promise<StudyIndex | null>>()

async function safeUploadsPath(candidate: string | null | undefined) {
  if (!candidate) return null
  const [root, real] = await Promise.all([
    fsp.realpath(uploadsRoot).catch(() => uploadsRoot),
    fsp.realpath(path.resolve(candidate)).catch(() => null),
  ])
  if (!real) return null
  const relative = path.relative(root, real)
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? real : null
}

async function walkFiles(directory: string) {
  const files: string[] = []
  const pending = [directory]
  while (pending.length && files.length < MAX_WALK_FILES) {
    const current = pending.pop()!
    for (const entry of await fsp.readdir(current, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) pending.push(full)
      else if (entry.isFile()) files.push(full)
    }
  }
  return files.sort()
}

/** Turns a stored path (ZIP, single file or folder) into readable sources, only inside uploads/. */
async function localSources(candidate: string | null | undefined): Promise<StudyFileSource[]> {
  const safe = await safeUploadsPath(candidate)
  if (!safe) return []
  const stat = await fsp.stat(safe).catch(() => null)
  if (!stat) return []
  if (stat.isDirectory()) return (await walkFiles(safe)).map(file => file.toLowerCase().endsWith('.zip') ? { kind: 'zip', path: file } : { kind: 'file', path: file })
  return [safe.toLowerCase().endsWith('.zip') ? { kind: 'zip', path: safe } : { kind: 'file', path: safe }]
}

async function totalSize(sources: StudyFileSource[]) {
  let total = 0
  for (const source of sources) total += (await fsp.stat(source.path).catch(() => null))?.size ?? 0
  return total
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/** Same shape the upload pipeline writes: upstreamStatus.storage.originalStudy = { bucket, key }. */
function originalStudyReference(upstreamStatus: unknown): S3Reference | null {
  const status = record(upstreamStatus)
  const storage = record(status?.storage) ?? status
  const original = record(storage?.originalStudy)
  return typeof original?.bucket === 'string' && typeof original.key === 'string' && original.bucket && original.key
    ? { bucket: original.bucket, key: original.key }
    : null
}

type BridgeStudyKeys = Parameters<typeof bridgeStudyS3KeyCandidates>[0]

/** Recorded S3 reference first, then the same bucket/key search the external viewer import uses. */
async function findStudyInS3(upstreamStatus: unknown, bridge: BridgeStudyKeys | null, modalities: string[]): Promise<S3Reference | null> {
  const recorded = originalStudyReference(upstreamStatus)
  if (recorded) return recorded
  if (!bridge) return null
  const found = await findStoredStudyObject({
    kinds: [studyViewerStorageKind(modalities), 'original-studies', 'cleaned-dicoms'],
    keys: bridgeStudyS3KeyCandidates(bridge),
  }).catch(() => null)
  return found?.key ? { bucket: found.bucket, key: found.key } : null
}

// S3 search results per study, so repeated opens don't repeat dozens of HEAD requests.
const s3Lookups = new Map<string, { value: Promise<S3Reference | null>; expiresAt: number }>()

function rememberS3(key: string, lookup: () => Promise<S3Reference | null>) {
  return () => {
    const cached = s3Lookups.get(key)
    if (cached && cached.expiresAt > Date.now()) return cached.value
    const value = lookup()
    s3Lookups.set(key, { value, expiresAt: Date.now() + INDEX_TTL_MS })
    while (s3Lookups.size > INDEX_CACHE_LIMIT) s3Lookups.delete(s3Lookups.keys().next().value!)
    return value
  }
}

async function describeJob(jobId: string, extraModalities: Array<string | null>): Promise<StudyDescription | null> {
  const job = await queries.findProcessingJobSource(jobId)
  if (!job) return null
  const bridge = job.bridgeStudy
  const modalities = [...(bridge?.modalities ?? []), ...extraModalities, job.serviceType].filter((value): value is string => Boolean(value))
  const local = [...await localSources(bridge?.archivePath)]
  if (!local.length) local.push(...await localSources(job.uploadPath))
  const knownSize = Number(bridge?.totalSizeBytes ?? 0)
  const bridgeKeys = bridge ? { ...bridge, processingJob: { id: job.id, uploadName: job.uploadName, upstreamStatus: job.upstreamStatus } } : null
  return {
    modalities,
    sizeBytes: knownSize || await totalSize(local),
    local,
    findS3: rememberS3(`job:${job.id}`, () => findStudyInS3(job.upstreamStatus, bridgeKeys, modalities)),
  }
}

async function describeStudy(target: ViewerTarget): Promise<StudyDescription | null> {
  if (target.type === 'bridge-study') {
    const study = await queries.findBridgeStudySource(target.id)
    if (!study) return null
    const local = [...await localSources(study.archivePath)]
    if (!local.length && study.processingJob) local.push(...await localSources(study.processingJob.uploadPath))
    return {
      modalities: study.modalities,
      sizeBytes: Number(study.totalSizeBytes) || await totalSize(local),
      local,
      // Study ZIPs reach S3 when a study is submitted for processing; a study still waiting on the bridge
      // agent ("Available", no processing job) can't be there, so skip the multi-bucket search.
      findS3: study.processingJobId
        ? rememberS3(`bridge:${study.id}`, () => findStudyInS3(study.processingJob?.upstreamStatus, study, study.modalities))
        : async () => null,
    }
  }
  if (target.type === 'job') return describeJob(target.id, [target.modality])
  if (target.type === 'report') {
    const jobId = target.processingJobId ?? await queries.findProcessingJobIdForReport(target.id)
    if (jobId) return describeJob(jobId, [target.modality])
    const bridge = target.studyInstanceUid ? await queries.findBridgeStudyByUid(target.clientId, target.studyInstanceUid) : null
    return bridge ? describeStudy({ type: 'bridge-study', id: bridge.id, clientId: target.clientId, studyInstanceUid: bridge.studyInstanceUid }) : null
  }
  const files = await queries.findArchiveStudyFiles(target.id)
  const local = (await Promise.all(files.map(file => localSources(file.filePath)))).flat()
  return { modalities: [target.modality], sizeBytes: files.reduce((sum, file) => sum + Number(file.sizeBytes), 0) || await totalSize(local), local, findS3: async () => null }
}

/** Only for studies that pass the policy: local files, otherwise the study ZIP in S3. */
async function locate(study: StudyDescription): Promise<StudyLocation | null> {
  if (study.local.length) return { local: study.local }
  const s3 = await study.findS3()
  return s3 ? { s3 } : null
}

/** The viewer-session decision: QuickView only for small 2D studies whose files we can reach. */
export async function decideViewerMode(target: ViewerTarget, forceExternal = false): Promise<ViewerDecision> {
  const config = quickViewConfig()
  if (!config.enabled || forceExternal) return chooseViewerMode({ modalities: [], sizeBytes: 0, forceExternal }, config)
  const study = await describeStudy(target).catch(() => null)
  if (!study) return { mode: 'external', reason: 'Study was not found' }
  // Policy first: CT/MR and oversized studies never trigger any file or S3 lookups.
  const decision = chooseViewerMode({ modalities: study.modalities, sizeBytes: study.sizeBytes }, config)
  if (decision.mode !== 'quick') return decision
  return await locate(study).catch(() => null) ? decision : { mode: 'external', reason: 'Study files are not available to QuickView' }
}

async function pruneDownloadCache() {
  const now = Date.now()
  for (const folder of [cacheRoot, previewsRoot, compactRoot]) {
    for (const name of await fsp.readdir(folder).catch(() => [])) {
      const file = path.join(folder, name)
      const stat = await fsp.stat(file).catch(() => null)
      if (stat?.isFile() && now - stat.mtimeMs > CACHE_FILE_MAX_AGE_MS) await fsp.rm(file, { force: true }).catch(() => undefined)
    }
  }
}

async function materialize(location: StudyLocation, maxBytes: number): Promise<StudyFileSource[]> {
  if ('local' in location) return location.local
  const name = `${crypto.createHash('sha256').update(`${location.s3.bucket}/${location.s3.key}`).digest('hex')}.zip`
  const destination = path.join(cacheRoot, name)
  if (!await fsp.stat(destination).catch(() => null)) {
    void pruneDownloadCache()
    await downloadStoredObjectToFile(location.s3, destination, maxBytes)
  }
  return [{ kind: 'zip', path: destination }]
}

export function buildManifest(instances: DicomInstanceHeader[]): QuickViewManifest {
  const bySeries = new Map<string, QuickViewSeries>()
  instances.forEach((instance, index) => {
    let series = bySeries.get(instance.seriesInstanceUid)
    if (!series) {
      series = { seriesInstanceUid: instance.seriesInstanceUid, seriesNumber: instance.seriesNumber, description: instance.seriesDescription, modality: instance.modality, instances: [] }
      bySeries.set(instance.seriesInstanceUid, series)
    }
    series.instances.push({
      index, sopInstanceUid: instance.sopInstanceUid, instanceNumber: instance.instanceNumber, rows: instance.rows, columns: instance.columns,
      frames: instance.frames, windowCenter: instance.windowCenter, windowWidth: instance.windowWidth,
      photometricInterpretation: instance.photometricInterpretation, transferSyntaxUid: instance.transferSyntaxUid, sizeBytes: instance.sizeBytes,
      pixelSpacing: instance.pixelSpacing, patientOrientation: instance.patientOrientation, sliceThickness: instance.sliceThickness,
    })
  })
  const series = [...bySeries.values()].sort((a, b) => (a.seriesNumber ?? Infinity) - (b.seriesNumber ?? Infinity))
  for (const item of series) item.instances.sort((a, b) => (a.instanceNumber ?? Infinity) - (b.instanceNumber ?? Infinity) || a.index - b.index)
  const first = instances[0]
  return {
    studyInstanceUid: first?.studyInstanceUid ?? null,
    patientName: first?.patientName ?? null,
    patientId: first?.patientId ?? null,
    studyDate: first?.studyDate ?? null,
    studyDescription: first?.studyDescription ?? null,
    patientSex: first?.patientSex ?? null,
    patientAge: first?.patientAge ?? null,
    modalities: [...new Set(instances.map(instance => instance.modality).filter((value): value is string => Boolean(value)))],
    instanceCount: instances.length,
    series,
  }
}

function cacheKey(target: ViewerTarget) {
  return `${target.type}:${target.id}`
}

async function buildIndex(target: ViewerTarget): Promise<StudyIndex | null> {
  const config = quickViewConfig()
  const study = await describeStudy(target)
  if (!study) return null
  // Re-check the policy here so a crafted request can't use QuickView for CT/MR or oversized studies.
  if (chooseViewerMode({ modalities: study.modalities, sizeBytes: study.sizeBytes }, config).mode !== 'quick') return null
  const location = await locate(study)
  if (!location) return null
  return indexStudyFiles(await materialize(location, config.maxBytes))
}

/**
 * Indexes a study's files (headers only) and starts making lossless copies of big uncompressed images
 * straight away, so they are usually ready by the time the browser asks for them (it fetches previews first).
 */
export async function indexStudyFiles(sources: StudyFileSource[]): Promise<StudyIndex | null> {
  const instances = await listDicomInstances(sources, MAX_INSTANCES)
  if (!instances.length) return null
  const index: StudyIndex = { sources, instances, manifest: buildManifest(instances), expiresAt: Date.now() + INDEX_TTL_MS }
  // The first image of each series is what the viewer opens first, so compact those before the rest.
  const firsts = new Set(index.manifest.series.map(series => series.instances[0]?.index))
  const order = [...instances.keys()].sort((a, b) => Number(!firsts.has(a)) - Number(!firsts.has(b)))
  for (const position of order) if (needsCompaction(instances[position])) void ensureCompact(index, instances[position]).catch(() => null)
  return index
}

async function getIndex(target: ViewerTarget) {
  const key = cacheKey(target)
  const cached = indexCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached
  // Concurrent requests for the same study share one indexing pass.
  let pending = indexing.get(key)
  if (!pending) {
    pending = buildIndex(target).finally(() => indexing.delete(key))
    indexing.set(key, pending)
  }
  const index = await pending
  if (index) {
    indexCache.delete(key)
    indexCache.set(key, index)
    while (indexCache.size > INDEX_CACHE_LIMIT) indexCache.delete(indexCache.keys().next().value!)
  }
  return index
}

export async function getQuickViewManifest(target: ViewerTarget) {
  return (await getIndex(target))?.manifest ?? null
}

function instanceCacheName(study: StudyIndex, instance: DicomInstanceHeader) {
  const source = study.sources[instance.locator.source]
  return crypto.createHash('sha256').update(`${source?.path}|${instance.locator.entry ?? ''}|${instance.sizeBytes}|${instance.sopInstanceUid}`).digest('hex')
}

async function readInstance(study: StudyIndex, instance: DicomInstanceHeader) {
  const opened = await openInstanceStream(study.sources, instance.locator)
  if (!opened) return null
  const chunks: Buffer[] = []
  for await (const chunk of opened.stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}

function needsCompaction(instance: DicomInstanceHeader) {
  return instance.sizeBytes >= COMPACT_MIN_BYTES && UNCOMPRESSED_SYNTAXES.has(instance.transferSyntaxUid ?? '')
}

// Lossless copies are made one at a time in a DCMTK child process, never on the event loop.
const compactions = new Map<string, Promise<string | null>>()
let compactQueue: Promise<unknown> = Promise.resolve()

async function compactInstance(study: StudyIndex, instance: DicomInstanceHeader, output: string) {
  const tool = await findExecutable('dcmcjpeg')
  if (!tool) return null
  await fsp.mkdir(compactRoot, { recursive: true })
  const input = `${output}.in.dcm`
  const partial = `${output}.part`
  const opened = await openInstanceStream(study.sources, instance.locator)
  if (!opened) return null
  try {
    await pipeline(opened.stream, fs.createWriteStream(input))
    await execFileAsync(tool, ['+e1', input, partial], { timeout: 120_000, windowsHide: true })
    const [before, after] = await Promise.all([fsp.stat(input), fsp.stat(partial)])
    // Keep the copy only when it is clearly smaller; otherwise the original is served.
    if (after.size >= before.size * 0.9) return null
    await fsp.rename(partial, output)
    return output
  } finally {
    await Promise.all([fsp.rm(input, { force: true }), fsp.rm(partial, { force: true })])
  }
}

/** The lossless copy's path: existing, made now (queued), or null when it isn't worth making. */
function ensureCompact(study: StudyIndex, instance: DicomInstanceHeader): Promise<string | null> {
  const output = path.join(compactRoot, `${instanceCacheName(study, instance)}.jll.dcm`)
  let pending = compactions.get(output)
  if (!pending) {
    pending = fsp.stat(output).then(stat => stat.isFile() ? output : null, () => null).then(existing => {
      if (existing || !needsCompaction(instance)) return existing
      const job = compactQueue.then(() => compactInstance(study, instance, output))
      compactQueue = job.catch(() => undefined)
      return job
    }).catch(error => {
      console.warn('QuickView lossless copy skipped:', error instanceof Error ? error.message : error)
      return null
    })
    compactions.set(output, pending)
    // Forget failures and finished work after a while so the map doesn't grow without bound.
    void pending.finally(() => setTimeout(() => compactions.delete(output), INDEX_TTL_MS).unref())
  }
  return pending
}

/**
 * Streams one image. Big uncompressed images are sent as their lossless JPEG copy (2-4x smaller on real
 * X-rays), waiting briefly for it when it is still being made; otherwise the original is sent unchanged.
 */
export async function openIndexedInstance(study: StudyIndex, index: number) {
  const instance = study.instances[index]
  if (!instance) return null
  if (needsCompaction(instance)) {
    const compact = await Promise.race([ensureCompact(study, instance), new Promise<null>(resolve => setTimeout(() => resolve(null), COMPACT_WAIT_MS).unref())])
    const stat = compact ? await fsp.stat(compact).catch(() => null) : null
    if (compact && stat?.isFile()) return { stream: fs.createReadStream(compact), sizeBytes: stat.size, sopInstanceUid: instance.sopInstanceUid }
  }
  const opened = await openInstanceStream(study.sources, instance.locator)
  return opened ? { ...opened, sopInstanceUid: instance.sopInstanceUid } : null
}

export async function openQuickViewInstance(target: ViewerTarget, index: number) {
  const study = await getIndex(target)
  return study ? openIndexedInstance(study, index) : null
}

const previewsInFlight = new Map<string, Promise<Buffer | null>>()

/** A small JPEG of the default rendering, shown instantly while the full image downloads. Cached on disk. */
export async function renderIndexedPreview(study: StudyIndex, index: number) {
  const instance = study.instances[index]
  if (!instance) return null
  const name = instanceCacheName(study, instance)
  const file = path.join(previewsRoot, `${name}.jpg`)
  const cached = await fsp.readFile(file).catch(() => null)
  if (cached) return { jpeg: cached, sopInstanceUid: instance.sopInstanceUid }
  let pending = previewsInFlight.get(name)
  if (!pending) {
    pending = (async () => {
      const bytes = await readInstance(study, instance)
      if (!bytes) return null
      const jpeg = await previewPool.render(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, PREVIEW_MAX_SIZE)
      await fsp.mkdir(previewsRoot, { recursive: true })
      await fsp.writeFile(file, jpeg)
      return jpeg
    })().finally(() => previewsInFlight.delete(name))
    previewsInFlight.set(name, pending)
  }
  const jpeg = await pending
  return jpeg ? { jpeg, sopInstanceUid: instance.sopInstanceUid } : null
}

export async function getQuickViewPreview(target: ViewerTarget, index: number) {
  const study = await getIndex(target)
  return study ? renderIndexedPreview(study, index) : null
}

function safeName(value: string | number | null | undefined, fallback: string) {
  const text = String(value ?? '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
  return text || fallback
}

/**
 * "Export study": the original DICOM files as a ZIP, one folder per series. Files are opened lazily, one at
 * a time, so large studies never hold many file handles open at once.
 */
export function exportIndexedStudy(study: StudyIndex) {
  const zip = new yazl.ZipFile()
  study.manifest.series.forEach((series, seriesPosition) => {
    const folder = `DICOM/${String(seriesPosition + 1).padStart(3, '0')}_${safeName(series.seriesNumber ?? series.description, 'series')}`
    series.instances.forEach((item, position) => {
      const instance = study.instances[item.index]
      zip.addReadStreamLazy(`${folder}/IM${String(position + 1).padStart(4, '0')}.dcm`, { compress: false, size: instance.sizeBytes }, callback => {
        openInstanceStream(study.sources, instance.locator)
          .then(opened => opened ? callback(null, opened.stream) : callback(new Error('Image is no longer available')))
          .catch(error => callback(error instanceof Error ? error : new Error(String(error))))
      })
    })
  })
  zip.end()
  return { stream: zip.outputStream, fileName: `${safeName(study.manifest.studyInstanceUid, 'study')}.zip` }
}

export async function exportQuickViewStudy(target: ViewerTarget) {
  const study = await getIndex(target)
  return study ? exportIndexedStudy(study) : null
}
