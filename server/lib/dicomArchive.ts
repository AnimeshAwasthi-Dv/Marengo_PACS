import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { Readable } from 'node:stream'
import dicomParser from 'dicom-parser'
import yauzl from 'yauzl'

/** Where the DICOM files of one study live: inside a ZIP, or as loose files on disk. */
export type StudyFileSource = { kind: 'zip'; path: string } | { kind: 'file'; path: string }

/** Points at one instance: the source it came from plus the ZIP entry name (for ZIP sources). */
export type InstanceLocator = { source: number; entry?: string }

export type DicomInstanceHeader = {
  locator: InstanceLocator
  sizeBytes: number
  studyInstanceUid: string | null
  seriesInstanceUid: string
  seriesNumber: number | null
  seriesDescription: string | null
  sopInstanceUid: string
  instanceNumber: number | null
  modality: string | null
  rows: number
  columns: number
  frames: number
  windowCenter: number | null
  windowWidth: number | null
  photometricInterpretation: string | null
  transferSyntaxUid: string | null
  patientName: string | null
  patientId: string | null
  studyDate: string | null
  studyDescription: string | null
  patientSex: string | null
  patientAge: string | null
  /** Row and column spacing in mm (PixelSpacing, else ImagerPixelSpacing). */
  pixelSpacing: [number, number] | null
  /** PatientOrientation (0020,0020), e.g. ["L", "F"]: direction of the rows and of the columns. */
  patientOrientation: [string, string] | null
  sliceThickness: number | null
}

// Headers are read from the first bytes of each file; pixel data is never loaded while indexing.
const HEADER_BYTES = 1024 * 1024
const SKIPPED_EXTENSIONS = new Set(['.pdf', '.txt', '.xml', '.json', '.html', '.htm', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.csv', '.ini', '.exe', '.dll'])

function openZip(zipPath: string) {
  return new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (error, zipFile) => error || !zipFile ? reject(error ?? new Error('Unable to open ZIP')) : resolve(zipFile))
  })
}

function openEntryStream(zipFile: yauzl.ZipFile, entry: yauzl.Entry) {
  return new Promise<Readable>((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => error || !stream ? reject(error ?? new Error('Unable to read ZIP entry')) : resolve(stream))
  })
}

async function readPrefix(stream: Readable, limit: number) {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    chunks.push(buffer)
    total += buffer.length
    if (total >= limit) break
  }
  stream.destroy()
  return Buffer.concat(chunks).subarray(0, limit)
}

function isCandidateName(name: string) {
  if (name.endsWith('/') || name.startsWith('__MACOSX/') || path.basename(name).startsWith('.')) return false
  return !SKIPPED_EXTENSIONS.has(path.extname(name).toLowerCase())
}

function firstNumber(value: string | undefined) {
  if (!value) return null
  const parsed = Number.parseFloat(value.split('\\')[0])
  return Number.isFinite(parsed) ? parsed : null
}

function spacing(dataset: dicomParser.DataSet): [number, number] | null {
  const value = dataset.string('x00280030') ?? dataset.string('x00181164')
  const parts = value?.split('\\').map(Number.parseFloat)
  return parts && parts.length === 2 && parts.every(part => Number.isFinite(part) && part > 0) ? [parts[0], parts[1]] : null
}

function orientation(dataset: dicomParser.DataSet): [string, string] | null {
  const parts = dataset.string('x00200020')?.split('\\').map(part => part.trim().toUpperCase())
  return parts && parts.length === 2 && parts.every(part => /^[ALPRHF]+$/.test(part)) ? [parts[0], parts[1]] : null
}

function text(dataset: dicomParser.DataSet, tag: string) {
  const value = dataset.string(tag)?.replace(/\0/g, '').trim()
  return value || null
}

/** Parses the header of one DICOM file. Returns null for non-DICOM bytes or objects without an image. */
export function parseDicomHeader(bytes: Buffer, locator: InstanceLocator, sizeBytes: number): DicomInstanceHeader | null {
  if (bytes.length < 132 || bytes.toString('ascii', 128, 132) !== 'DICM') return null
  let dataset: dicomParser.DataSet
  try {
    dataset = dicomParser.parseDicom(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), { untilTag: 'x7fe00010' })
  } catch {
    return null
  }
  const rows = dataset.uint16('x00280010') ?? 0
  const columns = dataset.uint16('x00280011') ?? 0
  const sopInstanceUid = text(dataset, 'x00080018')
  if (!rows || !columns || !sopInstanceUid) return null
  return {
    locator,
    sizeBytes,
    studyInstanceUid: text(dataset, 'x0020000d'),
    seriesInstanceUid: text(dataset, 'x0020000e') ?? 'unknown-series',
    seriesNumber: firstNumber(dataset.string('x00200011')),
    seriesDescription: text(dataset, 'x0008103e'),
    sopInstanceUid,
    instanceNumber: firstNumber(dataset.string('x00200013')),
    modality: text(dataset, 'x00080060'),
    rows,
    columns,
    frames: Math.max(1, Math.trunc(firstNumber(dataset.string('x00280008')) ?? 1)),
    windowCenter: firstNumber(dataset.string('x00281050')),
    windowWidth: firstNumber(dataset.string('x00281051')),
    photometricInterpretation: text(dataset, 'x00280004'),
    transferSyntaxUid: text(dataset, 'x00020010'),
    patientName: text(dataset, 'x00100010')?.replace(/\^+/g, ' ').trim() || null,
    patientId: text(dataset, 'x00100020'),
    studyDate: text(dataset, 'x00080020'),
    studyDescription: text(dataset, 'x00081030'),
    patientSex: text(dataset, 'x00100040'),
    patientAge: text(dataset, 'x00101010'),
    pixelSpacing: spacing(dataset),
    patientOrientation: orientation(dataset),
    sliceThickness: firstNumber(dataset.string('x00180050')),
  }
}

async function listZipInstances(zipPath: string, sourceIndex: number, maxInstances: number) {
  const zipFile = await openZip(zipPath)
  const found: DicomInstanceHeader[] = []
  try {
    await new Promise<void>((resolve, reject) => {
      zipFile.on('error', reject)
      zipFile.on('end', () => resolve())
      zipFile.on('entry', (entry: yauzl.Entry) => {
        if (found.length >= maxInstances || !isCandidateName(entry.fileName) || entry.uncompressedSize < 132) return zipFile.readEntry()
        openEntryStream(zipFile, entry)
          .then(stream => readPrefix(stream, HEADER_BYTES))
          .then(bytes => {
            const header = parseDicomHeader(bytes, { source: sourceIndex, entry: entry.fileName }, entry.uncompressedSize)
            if (header) found.push(header)
            zipFile.readEntry()
          })
          .catch(reject)
      })
      zipFile.readEntry()
    })
  } finally {
    zipFile.close()
  }
  return found
}

async function readFileHeader(filePath: string, sourceIndex: number) {
  const stat = await fsp.stat(filePath)
  const handle = await fsp.open(filePath, 'r')
  try {
    const length = Math.min(stat.size, HEADER_BYTES)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, 0)
    return parseDicomHeader(buffer, { source: sourceIndex }, stat.size)
  } finally {
    await handle.close()
  }
}

/** Indexes every image instance in the given sources, reading headers only. */
export async function listDicomInstances(sources: StudyFileSource[], maxInstances = 500) {
  const instances: DicomInstanceHeader[] = []
  for (const [index, source] of sources.entries()) {
    if (instances.length >= maxInstances) break
    if (source.kind === 'zip') instances.push(...await listZipInstances(source.path, index, maxInstances - instances.length))
    else {
      const header = await readFileHeader(source.path, index).catch(() => null)
      if (header) instances.push(header)
    }
  }
  return instances
}

/** Opens one instance for streaming. The caller must consume or destroy the stream. */
export async function openInstanceStream(sources: StudyFileSource[], locator: InstanceLocator): Promise<{ stream: Readable; sizeBytes: number } | null> {
  const source = sources[locator.source]
  if (!source) return null
  if (source.kind === 'file') {
    const stat = await fsp.stat(source.path).catch(() => null)
    return stat?.isFile() ? { stream: fs.createReadStream(source.path), sizeBytes: stat.size } : null
  }
  if (!locator.entry) return null
  const zipFile = await openZip(source.path)
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (value: { stream: Readable; sizeBytes: number } | null, error?: unknown) => {
      if (settled) return
      settled = true
      if (error) { zipFile.close(); reject(error) } else resolve(value)
    }
    zipFile.on('error', error => finish(null, error))
    zipFile.on('end', () => { zipFile.close(); finish(null) })
    zipFile.on('entry', (entry: yauzl.Entry) => {
      if (entry.fileName !== locator.entry) return zipFile.readEntry()
      openEntryStream(zipFile, entry).then(stream => {
        stream.once('close', () => zipFile.close())
        finish({ stream, sizeBytes: entry.uncompressedSize })
      }, error => finish(null, error))
    })
    zipFile.readEntry()
  })
}
