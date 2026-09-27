import { findExecutable } from './platform/tools';
import { classifyBreastXrayModalities } from '../src/mammography';
import { isSpecialXrayStudy } from '../src/specialXray';
import Busboy from 'busboy'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import crypto from 'node:crypto'

import path from 'node:path'
import { execFile } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import dicomParser from 'dicom-parser'
import type { Request } from 'express'

import yauzl from 'yauzl'
import yazl from 'yazl'




export type ServiceType = string

export type SavedUpload = {
  filePath: string
  uploadName: string
}

function positiveIntegerEnv(name: string, fallback: number) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

const portalMaxUploadBytes = positiveIntegerEnv('PORTAL_MAX_UPLOAD_BYTES', 4 * 1024 * 1024 * 1024)

export type DicomStudyMetadata = {
  referringPhysician?: string
  patientName?: string
  patientId?: string
  accession?: string
  patientSex?: string
  patientAge?: string
  patientBirthDate?: string
  studyInstanceUid?: string
  seriesInstanceUid?: string
  sopInstanceUid?: string
  studyDate?: string
  studyTime?: string
  modality?: string
  studyDescription?: string
  seriesDescription?: string
  protocolName?: string
  bodyPartExamined?: string
}

export type ModalityServiceCatalogEntry = {
  slug: string
  name: string
  code: string
  aiServiceType?: string
  regular: number
  night: number
  urgent: number
}

export const modalityServices: ReadonlyArray<ModalityServiceCatalogEntry> = [
  { slug: 'xray', name: 'X-ray Suite', code: 'PAC01', aiServiceType: 'xray', regular: 100, night: 150, urgent: 200 },
  { slug: 'ct', name: 'CT Suite', code: 'CT00', aiServiceType: 'ct', regular: 300, night: 350, urgent: 400 },
  { slug: 'mri', name: 'MRI Suite', code: 'MR00', aiServiceType: 'mri', regular: 330, night: 380, urgent: 430 },
  { slug: 'mri-brain', name: 'MRI Brain', code: 'MRI01', aiServiceType: 'mri', regular: 330, night: 380, urgent: 430 },
  { slug: 'mri-brain-contrast-epilepsy', name: 'MRI Brain w/ Contrast - Epilepsy', code: 'MRI02', aiServiceType: 'mri', regular: 385, night: 435, urgent: 485 },
  { slug: 'mri-spine', name: 'MRI Spine', code: 'MRI03', aiServiceType: 'mri', regular: 330, night: 380, urgent: 430 },
  { slug: 'mri-body-head-neck-upper-lower-abdomen-pelvis', name: 'MRI Body - Head-Neck, Upper/Lower Abdomen, Pelvis', code: 'MRI04', aiServiceType: 'mri', regular: 385, night: 435, urgent: 485 },
  { slug: 'mrcp', name: 'MRCP', code: 'MRI05', aiServiceType: 'mri', regular: 385, night: 435, urgent: 485 },
  { slug: 'mri-whole-abdomen', name: 'MRI Whole Abdomen', code: 'MRI06', aiServiceType: 'mri', regular: 410, night: 460, urgent: 510 },
  { slug: 'mri-joints-limbs', name: 'MRI Joints / Limbs', code: 'MRI07', aiServiceType: 'mri', regular: 470, night: 520, urgent: 570 },
  { slug: 'mri-prostate-breast-pituitary', name: 'MRI Prostate / Breast / Pituitary', code: 'MRI08', aiServiceType: 'mri', regular: 580, night: 630, urgent: 680 },
  { slug: 'mri-screening', name: 'MRI Screening', code: 'MRI09', aiServiceType: 'mri', regular: 220, night: 270, urgent: 320 },
  { slug: 'mra-mrv-mrs', name: 'MRA / MRV / MRS', code: 'MRI10', aiServiceType: 'mri', regular: 275, night: 325, urgent: 375 },
  { slug: 'ct-brain-pns-orbit', name: 'CT Brain / PNS / Orbit', code: 'CT01', aiServiceType: 'ct', regular: 220, night: 270, urgent: 320 },
  { slug: 'ct-face', name: 'CT Face', code: 'CT02', aiServiceType: 'ct', regular: 300, night: 350, urgent: 400 },
  { slug: 'ct-head-contrast', name: 'CT Head with Contrast', code: 'CT03', aiServiceType: 'ct', regular: 230, night: 280, urgent: 330 },
  { slug: 'hrct-temporal-bone', name: 'HRCT Temporal Bone', code: 'CT04', aiServiceType: 'ct', regular: 275, night: 325, urgent: 375 },
  { slug: 'ct-body-with-or-without-contrast', name: 'CT Body - with or without Contrast', code: 'CT05', aiServiceType: 'ct', regular: 360, night: 410, urgent: 460 },
  { slug: 'ct-thorax', name: 'CT Thorax', code: 'CT06', aiServiceType: 'ct-thorax', regular: 300, night: 350, urgent: 400 },
  { slug: 'triple-phase-ct', name: 'Triple Phase CT', code: 'CT07', aiServiceType: 'ct', regular: 385, night: 435, urgent: 485 },
  { slug: 'ct-angio-all-studies', name: 'CT Angio - all studies', code: 'CT08', aiServiceType: 'ct', regular: 550, night: 600, urgent: 650 },
  { slug: 'xray-chest', name: 'X-Ray Chest', code: 'XR01', aiServiceType: 'xray', regular: 55, night: 105, urgent: 155 },
  { slug: 'xray-other-additional-view', name: 'X-Ray Other - per additional view', code: 'XR02', regular: 55, night: 105, urgent: 155 },
  { slug: 'special-xray-contrast-media', name: 'Special X-ray (contrast media)', code: 'XR03', regular: 145, night: 195, urgent: 245 },
  { slug: 'mammography', name: 'Mammography', code: 'XR04', aiServiceType: 'mammography', regular: 330, night: 380, urgent: 430 },
  { slug: 'ultrasound', name: 'Ultrasound', code: 'US01', regular: 220, night: 270, urgent: 320 },
  { slug: 'pet-ct', name: 'PET-CT', code: 'PET01', regular: 580, night: 630, urgent: 680 },
]

export const serviceNames = Object.fromEntries(modalityServices.map((service) => [service.slug, service.name])) as Record<string, string>

const serviceNameAliases: Record<string, string> = {
  'DecXpert X-ray Suite': 'X-ray Suite',
  'DecXpert CT Suite': 'CT Suite',
  'DecXpert CT Thorax': 'CT Thorax',
}

export function serviceNameForType(serviceType: string) {
  return serviceNames[serviceType] ?? serviceType
}

export function aiServiceTypeForServiceName(serviceName: string) {
  const normalized = serviceNameAliases[serviceName] ?? serviceName
  return modalityServices.find((service) => service.name === normalized)?.aiServiceType
}

export function aiServiceTypeForServiceType(serviceType: string) {
  return modalityServices.find((service) => service.slug === serviceType)?.aiServiceType
}

export function inferBridgeServiceType(study: { modalities: string[]; studyDescription?: string | null; bodyPartExamined?: string | null }) {
  study = { ...study, modalities: classifyBreastXrayModalities(study.modalities, study.bodyPartExamined) }
  if (isSpecialXrayStudy(study)) return 'special-xray-contrast-media'
  const modalities = new Set(study.modalities.map((value) => value.toUpperCase()))
  if (modalities.has('MG') && !['CT', 'MR', 'US', 'PT'].some(modality => modalities.has(modality))) return 'mammography'
  const text = `${study.modalities.join(' ')} ${study.studyDescription ?? ''}`.toLowerCase()
  if (modalities.has('US') || /\b(usg|ultrasound|sonography)\b/i.test(text)) return 'ultrasound'
  if (modalities.has('PT') || /\b(pet[\s-]?ct|pet|positron)\b/i.test(text)) return 'pet-ct'
  if (modalities.has('MR') || /\bmri?\b/i.test(text)) return 'mri'
  if (modalities.has('CT') || /\bct\b/i.test(text)) {
    if (/\b(angio|angiography|cta)\b/i.test(text) || /\bang\b/i.test(text)) return 'ct-angio-all-studies'
    if (/\btriple(?:\s+phase)?\b/i.test(text)) return 'triple-phase-ct'
    if (/\btemporal(?:\s+bone)?\b/i.test(text)) return 'hrct-temporal-bone'
    if (/\b(face|facial)\b/i.test(text)) return 'ct-face'
    if (/\b(head|brain)\b/i.test(text) && /\b(contrast|c\+)\b/i.test(text)) return 'ct-head-contrast'
    if (/\b(thorax|chest|lung|lungs|hrct)\b/i.test(text)) return 'ct-thorax'
    if (/\b(head|brain|pns|orbit)\b/i.test(text)) return 'ct-brain-pns-orbit'
    if (/\b(body|abdomen|abdominal|pelvis)\b/i.test(text)) return 'ct-body-with-or-without-contrast'
    return 'ct'
  }
  if (modalities.has('MG') || /\b(mg|mammo|mammography|breast)\b/i.test(text)) return 'mammography'
  if (modalities.has('DX') || modalities.has('CR') || /\b(dx|cr|xr|xray|x-ray)\b/i.test(text)) return 'xray'
  return null
}

export function serviceMatchesBridgeInference(serviceType: string, inferredServiceType: string) {
  if (inferredServiceType === 'mri') return serviceType === 'mri'
  if (inferredServiceType === 'ct') return serviceType === 'ct'
  if (inferredServiceType === 'xray') return serviceType === 'xray'
  if (inferredServiceType === 'ultrasound') return serviceType === 'ultrasound'
  if (inferredServiceType === 'pet-ct') return serviceType === 'pet-ct'
  return serviceType === inferredServiceType
}

export function serviceTypeForServiceName(serviceName: string) {
  const normalized = serviceNameAliases[serviceName] ?? serviceName
  return modalityServices.find((service) => service.name === normalized)?.slug ?? slugifyServiceName(normalized)
}

export async function saveIncomingUpload(req: Request, uploadRoot: string): Promise<SavedUpload> {
  await fsp.mkdir(uploadRoot, { recursive: true })
  const contentType = req.headers['content-type'] ?? ''
  if (contentType.includes('multipart/form-data')) return saveMultipartUpload(req, uploadRoot)

  const uploadName = sanitizeFileName(String(req.headers['x-upload-name'] ?? req.query.filename ?? `upload-${Date.now()}.bin`))
  const filePath = path.join(uploadRoot, `${crypto.randomUUID()}-${uploadName}`)
  await pipeline(req, fs.createWriteStream(filePath))
  return { filePath, uploadName }
}

export async function zipDirectory(sourceDir: string, destinationPath: string, options: { flatten?: boolean; dicomOnly?: boolean } = {}) {
  await fsp.mkdir(path.dirname(destinationPath), { recursive: true })
  const zip = new yazl.ZipFile()
  const outputDone = pipeline(zip.outputStream, fs.createWriteStream(destinationPath))
  const flatten = options.flatten ?? true
  const dicomOnly = options.dicomOnly ?? true
  const files = (await listFiles(sourceDir)).filter((filePath) => {
    const baseName = path.basename(filePath)
    return !baseName.startsWith('.decxpert-') && !baseName.toLowerCase().endsWith('.log')
  })
  const usedEntryNames = new Set<string>()

  for (const filePath of files) {
    const relativeName = path.relative(sourceDir, filePath).replaceAll('\\', '/')
    const entryName = dicomOnly
      ? await normalizeStudyZipEntryName(filePath, relativeName, { flatten })
      : sanitizeZipPath(relativeName)
    if (!entryName) continue
    const uniqueEntryName = uniqueZipEntryName(entryName, usedEntryNames)
    zip.addFile(filePath, uniqueEntryName)
  }

  zip.end()
  await outputDone
  return { fileCount: usedEntryNames.size, zipPath: destinationPath }
}

export async function extractDicomStudyMetadata(sourcePath: string): Promise<DicomStudyMetadata> {
  const stat = await fsp.stat(sourcePath)
  if (stat.isDirectory()) {
    const sample = await findFirstDicomFile(sourcePath)
    return sample ? extractDicomFileMetadata(sample) : {}
  }
  if (path.extname(sourcePath).toLowerCase() === '.zip') {
    const sampleDir = path.join(path.dirname(sourcePath), `dicom-metadata-${crypto.randomUUID()}`)
    try {
      await fsp.mkdir(sampleDir, { recursive: true })
      const samples = await extractZipSampleFiles(sourcePath, sampleDir, 0, 5)
      for (const sample of samples) {
        const metadata = await extractDicomFileMetadata(sample)
        if (Object.values(metadata).some(Boolean)) return metadata
      }
      return {}
    } finally {
      await fsp.rm(sampleDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
  if (isDicomExtension(sourcePath) || await isDicomFile(sourcePath).catch(() => false)) return extractDicomFileMetadata(sourcePath)
  return {}
}

async function findFirstDicomFile(sourceDir: string) {
  const files = await listFiles(sourceDir)
  for (const file of files) {
    if (isDicomExtension(file) || await isDicomFile(file).catch(() => false)) return file
  }
  return null
}

async function extractDicomFileMetadata(filePath: string): Promise<DicomStudyMetadata> {
  const tags = ['0008,0090', '0010,0010', '0010,0020', '0008,0050', '0010,0040', '0010,1010', '0010,0030', '0020,000D', '0020,000E', '0008,0018', '0008,0020', '0008,0030', '0008,0060', '0008,1030', '0008,103E', '0018,1030', '0018,0015']
  const dcmdump = await findTool('dcmdump.exe')
  if (dcmdump) {
    const output = await new Promise<string>((resolve) => {
      execFile(dcmdump, tags.flatMap((tag) => ['+P', tag]).concat(filePath), { windowsHide: true }, (_error, stdout) => resolve(stdout || ''))
    })
    return dicomMetadataFromReader((tag) => readDicomDumpValue(output, tag))
  }

  try {
    const dataset = dicomParser.parseDicom(await fsp.readFile(filePath))
    return dicomMetadataFromReader((tag) => dataset.string(`x${tag.replace(',', '')}`))
  } catch {
    return {}
  }
}

function dicomMetadataFromReader(read: (tag: string) => string | undefined): DicomStudyMetadata {
  return {
    patientName: cleanDicomText(read('0010,0010')),
    patientId: cleanDicomText(read('0010,0020')),
    accession: cleanDicomText(read('0008,0050')),
    patientSex: cleanDicomText(read('0010,0040')),
    patientAge: cleanDicomText(read('0010,1010')),
    patientBirthDate: cleanDicomText(read('0010,0030')),
    studyInstanceUid: cleanDicomText(read('0020,000D')),
    seriesInstanceUid: cleanDicomText(read('0020,000E')),
    sopInstanceUid: cleanDicomText(read('0008,0018')),
    studyDate: cleanDicomText(read('0008,0020')),
    studyTime: cleanDicomText(read('0008,0030')),
    modality: cleanDicomText(read('0008,0060'))?.toUpperCase(),
    studyDescription: cleanDicomText(read('0008,1030')),
    referringPhysician: cleanDicomText(read('0008,0090')),
    seriesDescription: cleanDicomText(read('0008,103E')),
    protocolName: cleanDicomText(read('0018,1030')),
    bodyPartExamined: cleanDicomText(read('0018,0015')),
  }
}

export async function prepareRenewistStudyZip(sourcePath: string, _metadata: Record<string, string | null | undefined> = {}) {
  void _metadata
  const stat = await fsp.stat(sourcePath)
  const destinationPath = path.join(path.dirname(sourcePath), `${safeBaseName(path.basename(sourcePath))}-renewist.zip`)
  if (stat.isDirectory()) {
    return zipRenewistAllowedStudyFiles(sourcePath, destinationPath)
  }
  if (path.extname(sourcePath).toLowerCase() === '.zip') {
    const workDir = path.join(path.dirname(sourcePath), `renewist-source-${crypto.randomUUID()}`)
    try {
      await extractZipToDirectory(sourcePath, workDir)
      return await zipRenewistAllowedStudyFiles(workDir, destinationPath)
    } finally {
      await fsp.rm(workDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
  if (!(await isDicomFile(sourcePath))) throw new Error('Renewist study submission requires a DICOM file, DICOM folder, or DICOM ZIP')
  await fsp.mkdir(path.dirname(destinationPath), { recursive: true })
  const zip = new yazl.ZipFile()
  const outputDone = pipeline(zip.outputStream, fs.createWriteStream(destinationPath))
  const baseName = path.basename(sourcePath)
  const entryName = path.extname(baseName) ? baseName : `${baseName}.dcm`
  zip.addFile(sourcePath, sanitizeZipPath(entryName) || `${crypto.randomUUID()}.dcm`)
  zip.end()
  await outputDone
  return { fileCount: 1, zipPath: destinationPath }
}

async function zipRenewistAllowedStudyFiles(sourceDir: string, destinationPath: string) {
  await fsp.mkdir(path.dirname(destinationPath), { recursive: true })
  const zip = new yazl.ZipFile()
  const outputDone = pipeline(zip.outputStream, fs.createWriteStream(destinationPath))
  const usedEntryNames = new Set<string>()
  let fileCount = 0
  const files = await listFiles(sourceDir)
  for (const filePath of files) {
    const relativeName = path.relative(sourceDir, filePath).replaceAll('\\', '/')
    const baseName = path.basename(filePath)
    if (baseName.startsWith('.decxpert-') || baseName.toLowerCase().endsWith('.log')) continue
    const lower = baseName.toLowerCase()
    const imageAllowed = /\.(jpe?g|png)$/i.test(lower)
    const dicomAllowed = isDicomExtension(filePath) || await isDicomFile(filePath).catch(() => false)
    if (!imageAllowed && !dicomAllowed) continue
    const entryName = sanitizeZipPath(relativeName) || `${crypto.randomUUID()}${imageAllowed ? path.extname(baseName) : '.dcm'}`
    zip.addFile(filePath, uniqueZipEntryName(entryName, usedEntryNames))
    fileCount += 1
  }
  zip.end()
  await outputDone
  if (!fileCount) throw new Error('Renewist study ZIP does not contain DICOM, JPEG, or PNG files')
  return { fileCount, zipPath: destinationPath }
}

async function extractZipToDirectory(zipPath: string, destinationDir: string) {
  await fsp.mkdir(destinationDir, { recursive: true })
  const zipFile = await openZip(zipPath)
  try {
    await new Promise<void>((resolve, reject) => {
      zipFile.readEntry()
      zipFile.on('entry', (entry) => {
        const name = sanitizeZipPath(entry.fileName)
        if (!name || /\/$/.test(entry.fileName)) {
          zipFile.readEntry()
          return
        }
        zipFile.openReadStream(entry, async (error, readStream) => {
          if (error || !readStream) {
            reject(error)
            return
          }
          try {
            const outputPath = path.join(destinationDir, name)
            await fsp.mkdir(path.dirname(outputPath), { recursive: true })
            await pipeline(readStream, fs.createWriteStream(outputPath))
            zipFile.readEntry()
          } catch (streamError) {
            reject(streamError)
          }
        })
      })
      zipFile.on('end', resolve)
      zipFile.on('error', reject)
    })
  } finally {
    zipFile.close()
  }
}

async function normalizeStudyZipEntryName(filePath: string, relativeName: string, options: { flatten?: boolean } = {}) {
  const normalizedName = options.flatten ? path.basename(relativeName) : relativeName
  const extension = path.extname(normalizedName)
  if (extension) return sanitizeZipPath(normalizedName)
  return await isDicomFile(filePath) ? sanitizeZipPath(`${normalizedName}.dcm`) : null
}

function uniqueZipEntryName(entryName: string, usedEntryNames: Set<string>) {
  let candidate = entryName
  let index = 2
  while (usedEntryNames.has(candidate)) {
    const extension = path.extname(entryName)
    const base = extension ? entryName.slice(0, -extension.length) : entryName
    candidate = `${base}-${index}${extension}`
    index += 1
  }
  usedEntryNames.add(candidate)
  return candidate
}

export async function cleanDicomZip(sourcePath: string, destinationPath: string) {
  await fsp.mkdir(path.dirname(destinationPath), { recursive: true })
  const zipFile = await openZip(sourcePath)
  const outZip = new yazl.ZipFile()
  const outputDone = pipeline(outZip.outputStream, fs.createWriteStream(destinationPath))
  let dicomCount = 0
  const usedEntryNames = new Set<string>()

  try {
    await new Promise<void>((resolve, reject) => {
      zipFile.readEntry()
      zipFile.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) {
          zipFile.readEntry()
          return
        }

        zipFile.openReadStream(entry, async (error, readStream) => {
          if (error || !readStream) {
            reject(error)
            return
          }

          try {
            const name = sanitizeZipPath(path.basename(entry.fileName))
            if (isDicomExtension(name)) {
              dicomCount += 1
              outZip.addReadStream(readStream, uniqueZipEntryName(name, usedEntryNames))
              readStream.on('end', () => zipFile.readEntry())
              return
            }

            if (hasKnownNonDicomExtension(name)) {
              readStream.resume()
              readStream.on('end', () => zipFile.readEntry())
              return
            }

            const { isDicom, stream } = await streamWithDicomProbe(readStream)
            if (isDicom) {
              dicomCount += 1
              outZip.addReadStream(stream, uniqueZipEntryName(`${name || crypto.randomUUID()}.dcm`, usedEntryNames))
              stream.on('end', () => zipFile.readEntry())
            } else {
              stream.resume()
              stream.on('end', () => zipFile.readEntry())
            }
          } catch (streamError) {
            reject(streamError)
          }
        })
      })
      zipFile.on('end', resolve)
      zipFile.on('error', reject)
    })
  } finally {
    zipFile.close()
    outZip.end()
  }

  await outputDone
  return { dicomCount, cleanedPath: destinationPath }
}

async function listFiles(folder: string): Promise<string[]> {
  const entries = await fsp.readdir(folder, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(folder, entry.name)
    if (entry.isDirectory()) return listFiles(entryPath)
    return [entryPath]
  }))
  return nested.flat()
}

async function saveMultipartUpload(req: Request, uploadRoot: string): Promise<SavedUpload> {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers, limits: { files: 1, fileSize: portalMaxUploadBytes } })
    let saved: SavedUpload | null = null
    let writeDone: Promise<void> | null = null

    busboy.on('file', (_field, file, info) => {
      const uploadName = sanitizeFileName(info.filename || `upload-${Date.now()}.bin`)
      const filePath = path.join(uploadRoot, `${crypto.randomUUID()}-${uploadName}`)
      saved = { filePath, uploadName }
      writeDone = pipeline(file, fs.createWriteStream(filePath))
    })
    busboy.on('error', reject)
    busboy.on('finish', async () => {
      try {
        if (!saved || !writeDone) throw new Error('No upload file was provided')
        await writeDone
        resolve(saved)
      } catch (error) {
        reject(error)
      }
    })
    req.pipe(busboy)
  })
}

async function findTool(fileName: string) { return findExecutable(fileName); }

function readDicomDumpValue(output: string, tag: string) {
  const match = output.match(new RegExp(`\\(${tag}\\)\\s+\\w+\\s+\\[([^\\]]*)\\]`, 'i'))
  return match?.[1]
}

function cleanDicomText(value: string | undefined) {
  return value?.replaceAll('^', ' ').replace(/\s+/g, ' ').trim() || ''
}

function streamWithDicomProbe(source: NodeJS.ReadableStream): Promise<{ isDicom: boolean; stream: PassThrough }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0

    function onData(chunk: Buffer) {
      chunks.push(chunk)
      total += chunk.length
      if (total >= 132) {
        source.pause()
        cleanup()
        const prefix = Buffer.concat(chunks)
        const stream = new PassThrough()
        stream.write(prefix)
        source.pipe(stream)
        source.resume()
        resolve({ isDicom: prefix.subarray(128, 132).toString('ascii') === 'DICM', stream })
      }
    }

    function onEnd() {
      cleanup()
      const stream = new PassThrough()
      stream.end(Buffer.concat(chunks))
      resolve({ isDicom: false, stream })
    }

    function onError(error: Error) {
      cleanup()
      reject(error)
    }

    function cleanup() {
      source.off('data', onData)
      source.off('end', onEnd)
      source.off('error', onError)
    }

    source.on('data', onData)
    source.on('end', onEnd)
    source.on('error', onError)
  })
}

function openZip(filePath: string) {
  return new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (error, zipFile) => {
      if (error || !zipFile) reject(error)
      else resolve(zipFile)
    })
  })
}

function isDicomExtension(fileName: string) {
  return ['.dcm', '.dicom'].includes(path.extname(fileName).toLowerCase())
}

function hasKnownNonDicomExtension(fileName: string) {
  const extension = path.extname(fileName).toLowerCase()
  if (!extension) return false
  if (/^\.\d+$/.test(extension)) return false
  return [
    '.jpg',
    '.jpeg',
    '.png',
    '.bmp',
    '.webp',
    '.gif',
    '.txt',
    '.pdf',
    '.doc',
    '.docx',
    '.xml',
    '.json',
    '.csv',
    '.zip',
    '.rar',
    '.7z',
  ].includes(extension)
}

async function isDicomFile(filePath: string) {
  const handle = await fsp.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(132)
    const { bytesRead } = await handle.read(buffer, 0, 132, 0)
    return bytesRead >= 132 && buffer.subarray(128, 132).toString('ascii') === 'DICM'
  } finally {
    await handle.close()
  }
}

async function extractZipSampleFiles(zipPath: string, outputDir: string, skipDicomCount: number, takeCount: number) {
  const zipFile = await openZip(zipPath)
  const samples: string[] = []
  let seenDicom = 0
  try {
    await new Promise<void>((resolve, reject) => {
      zipFile.readEntry()
      zipFile.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName) || hasKnownNonDicomExtension(entry.fileName)) {
          zipFile.readEntry()
          return
        }
        seenDicom += 1
        if (seenDicom <= skipDicomCount || samples.length >= takeCount) {
          zipFile.readEntry()
          return
        }
        zipFile.openReadStream(entry, async (error, readStream) => {
          if (error || !readStream) {
            reject(error)
            return
          }
          try {
            const outputPath = path.join(outputDir, `${String(samples.length + 1).padStart(2, '0')}-${sanitizeFileName(path.basename(entry.fileName) || 'sample.dcm')}`)
            await pipeline(readStream, fs.createWriteStream(outputPath))
            samples.push(outputPath)
            if (samples.length >= takeCount) resolve()
            else zipFile.readEntry()
          } catch (streamError) {
            reject(streamError)
          }
        })
      })
      zipFile.on('end', resolve)
      zipFile.on('error', reject)
    })
  } finally {
    zipFile.close()
  }
  return samples
}

function safeBaseName(fileName: string) {
  return sanitizeFileName(path.basename(fileName, path.extname(fileName)) || 'xray')
}

function slugifyServiceName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'service'
}

function sanitizeFileName(fileName: string) {
  return path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_') || `upload-${Date.now()}.bin`
}

function sanitizeZipPath(fileName: string) {
  return fileName
    .replaceAll('\\', '/')
    .split('/')
    .filter((part) => part && part !== '..')
    .map((part) => part.replace(/[^a-zA-Z0-9._-]/g, '_'))
    .join('/')
}
