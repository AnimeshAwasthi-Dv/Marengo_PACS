import { findExecutable } from './platform/tools';
import { classifyBreastXrayModalities } from '../src/mammography';
import { isSpecialXrayStudy, hasSpecialXrayDescription } from '../src/specialXray';
import Busboy from 'busboy'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import crypto from 'node:crypto'
import https from 'node:https'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import axios from 'axios'
import dicomParser from 'dicom-parser'
import type { Request } from 'express'
import FormData from 'form-data'
import yauzl from 'yauzl'
import yazl from 'yazl'
import dcmjsCodecs from 'dcmjs-codecs'
import { buildRadiologyReport, type ReportSource } from './reportBuilder'
import { storeObject, type StoredObject } from './reportStorage'

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

type PreparedXrayFile = SavedUpload & {
  sourceName: string
}

export type UpstreamResult = {
  name: string
  sourceName?: string
  uploadName?: string
  ok: boolean
  status?: number
  latencyMs?: number
  json?: ReportSource
  raw?: unknown
  error?: string
}

type MammographyProgress = {
  resumeJobId?: string
  onPrepared?: (info: { cleanedPath: string; imageCount: number }) => Promise<void> | void
  onSubmitted?: (info: { jobId: string; response: unknown; endpointId: string; submittedAt: string }) => Promise<void> | void
  onPolled?: (info: { jobId: string; response: unknown; endpointId: string; polledAt: string; status: string }) => Promise<void> | void
  onStored?: (info: { cleanedPath: string; storage: StoredObject | null }) => Promise<void> | void
}

export class XrayProcessingError extends Error {
  constructor(message: string, public upstreamResults: UpstreamResult[], public imageCount: number) {
    super(message)
    this.name = 'XrayProcessingError'
  }
}

export class AiProcessingError extends Error {
  constructor(message: string, public upstreamResults: UpstreamResult[], public imageCount: number) {
    super(message)
    this.name = 'AiProcessingError'
  }
}

export class AiUnavailableError extends Error {
  constructor(
    message: string,
    public modality: string,
    public imageCount: number,
    public upstreamResults: UpstreamResult[] = [],
  ) {
    super(message)
    this.name = 'AiUnavailableError'
  }
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

const defaultXraySkeletalApiUrl = 'https://decxpert-skeletal.com/analyze-xray'
const defaultXrayChestApiUrl = 'https://chest-decxpert-api.com/interpret'
const defaultCtThoraxApiUrl = 'https://ankitshukla0611--decxpert-ct-api-decxpertengine-infer.modal.run'

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

export async function processXrayUpload(filePath: string, uploadName: string, reportId?: string, options: {
  serviceType?: string
  dicomMetadata?: Record<string, string | undefined>
} = {}) {
  const timeoutMs = Number(process.env.XRAY_UPSTREAM_TIMEOUT_MS ?? 900_000)
  const upstreamFiles = await prepareXrayUpstreamFiles(filePath, uploadName)
  if (!upstreamFiles.length) throw new Error('No X-Ray image or DICOM files were found in the upload')
  const xrayRoute = classifyXrayStudy(uploadName, options)
  if (xrayRoute === 'mammography') {
    throw new AiUnavailableError('Mammography uploads must use the Mammography service so the dedicated study endpoint can process the full study', 'Mammography', upstreamFiles.length)
  }
  if (options.serviceType === 'special-xray-contrast-media' || xrayRoute === 'special-xray') {
    const special = await callSpecialXrayUpstream(filePath, uploadName, timeoutMs)
    if (!special.ok || !special.json) {
      throw new XrayProcessingError(special.error ?? `Special X-ray upstream failed with status ${special.status}`, [special], upstreamFiles.length)
    }
    const report = buildRadiologyReport('Special X-ray AI report', [{
      ...special.json,
      __reportTitle: 'Special X-ray',
    }], { reportId })
    return {
      imageCount: upstreamFiles.length,
      upstreamResults: [special],
      html: report.html,
      sections: report.sections,
    }
  }
  const chestUpload = await prepareChestUpstreamUpload(upstreamFiles, filePath, uploadName)
  let chestResult: UpstreamResult | null = null
  let chestSuccessAdded = false
  const upstreamResults: UpstreamResult[] = []
  const successful: Array<UpstreamResult & { json: ReportSource }> = []

  for (const upstreamFile of upstreamFiles) {
    const skeletal = await callBinaryUpstream('skeletal', process.env.XRAY_SKELETAL_API_URL?.trim() || defaultXraySkeletalApiUrl, upstreamFile.filePath, upstreamFile.uploadName, timeoutMs, upstreamFile.sourceName)
    upstreamResults.push(skeletal)
    if (skeletal.ok && skeletal.json) {
      successful.push(skeletal as UpstreamResult & { json: ReportSource })
      continue
    }

    const shouldUseChestEndpoint = isChestXrayRejection(skeletal) || isLikelyChestXray(upstreamFile.uploadName, upstreamFile.sourceName)
    if (shouldUseChestEndpoint) {
      const chest = chestResult ?? await callBinaryUpstream('chest', process.env.XRAY_CHEST_API_URL?.trim() || defaultXrayChestApiUrl, chestUpload.filePath, chestUpload.uploadName, timeoutMs, chestUpload.sourceName)
      chestResult = chest
      upstreamResults.push(chest)
      if (chest.ok && chest.json && !chestSuccessAdded) {
        successful.push(chest as UpstreamResult & { json: ReportSource })
        chestSuccessAdded = true
      }
    }
  }

  if (!successful.length) {
    throw new XrayProcessingError(
      upstreamResults.map((result) => `${result.sourceName ?? result.name} / ${result.name}: ${result.error ?? result.status ?? 'failed'}`).join('; '),
      upstreamResults,
      upstreamFiles.length,
    )
  }

  const title = successful.every((result) => result.name === 'chest') ? 'Chest X-Ray AI report' : 'X-Ray AI report'
  const report = buildRadiologyReport(title, successful.map((result) => ({
    ...result.json,
    __reportTitle: result.sourceName ? `${result.sourceName} (${result.name})` : result.name,
  })), { reportId })
  return {
    imageCount: upstreamFiles.length,
    upstreamResults,
    html: report.html,
    sections: report.sections,
  }
}

async function callSpecialXrayUpstream(filePath: string, uploadName: string, timeoutMs: number): Promise<UpstreamResult> {
  return postBinaryUpstream(
    'special-xray',
    process.env.SPECIAL_XRAY_API_URL ?? 'https://decxpert-skeletal.com/special-xray',
    filePath,
    uploadName,
    timeoutMs,
    Date.now(),
    uploadName,
  )
}

function classifyXrayStudy(uploadName: string, options: {
  serviceType?: string
  dicomMetadata?: Record<string, string | undefined>
}) {
  const metadata = options.dicomMetadata ?? {}
  const text = [
    options.serviceType,
    uploadName,
    metadata.modality,
    metadata.bodyPartExamined,
    metadata.studyDescription,
    metadata.seriesDescription,
    metadata.protocolName,
  ].filter(Boolean).join(' ').toLowerCase()
  if (metadata.modality === 'MG' || /\b(mammo|mammography|breast)\b/i.test(text)) return 'mammography'
  if (hasSpecialXrayDescription(text) || /\b(special|contrast|fluoro|fluoroscopy|ivp|hsg|barium|ucg|rgu|mcu)\b/i.test(text)) return 'special-xray'
  return 'general-xray'
}

function isChestXrayRejection(result: UpstreamResult) {
  return !result.ok && /chest[_\s-]*xray[_\s-]*not[_\s-]*supported|isolated chest x-rays are not supported/i.test(result.error ?? '')
}

function isLikelyChestXray(...values: Array<string | undefined>) {
  return values.some((value) => /\b(chest|cxr)\b/i.test(value ?? ''))
}

async function prepareChestUpstreamUpload(upstreamFiles: PreparedXrayFile[], filePath: string, uploadName: string): Promise<PreparedXrayFile> {
  const outputPath = path.join(path.dirname(filePath), 'xray-upstream', `${safeBaseName(uploadName)}-chest-images.zip`)
  const zip = new yazl.ZipFile()
  const outputDone = pipeline(zip.outputStream, fs.createWriteStream(outputPath))
  upstreamFiles.forEach((upstreamFile, index) => {
    const extension = path.extname(upstreamFile.uploadName) || '.jpg'
    const entryName = `${String(index + 1).padStart(3, '0')}-${safeBaseName(upstreamFile.sourceName || upstreamFile.uploadName)}${extension}`
    zip.addFile(upstreamFile.filePath, entryName)
  })
  zip.end()
  await outputDone
  return { filePath: outputPath, uploadName: path.basename(outputPath), sourceName: uploadName }
}

export async function processCtUpload(filePath: string, uploadName: string, jobFolder: string, reportId?: string, options: {
  serviceName?: string
  serviceType?: string
  dicomMetadata?: Record<string, string | undefined>
  clinicalIndication?: string
} = {}) {
  const cleanedPath = path.join(jobFolder, 'cleaned_dicoms.zip')
  const { dicomCount } = await cleanDicomZip(filePath, cleanedPath)
  if (!dicomCount) throw new Error('No DICOM files were found in the uploaded CT ZIP')

  const classification = await classifyCtStudy(cleanedPath, jobFolder, options).catch((error) => ({
    route: 'generic' as const,
    reason: error instanceof Error ? error.message : 'CT classification failed',
    evidence: [],
  }))
  const result = classification.route === 'thorax'
    ? await callCtUpstream(cleanedPath, uploadName)
    : await callGenericCtStudyUpstream(cleanedPath, uploadName, deriveCtClinicalIndication(options, classification))
  if (!result.ok || !result.json) throw new Error(result.error ?? `CT upstream failed with status ${result.status}`)

  const reportTitle = classification.route === 'thorax'
    ? 'CT Thorax AI report'
    : 'CT AI report'
  const report = buildRadiologyReport(reportTitle, [result.json], { reportId })
  return {
    cleanedPath,
    imageCount: dicomCount,
    upstreamResults: [result],
    html: report.html,
    sections: {
      ...report.sections,
      ctClassification: classification,
    },
  }
}

export async function processMriUpload(filePath: string, uploadName: string, jobFolder: string, reportId?: string) {
  const cleanedPath = path.join(jobFolder, 'cleaned_mri_dicoms.zip')
  const { dicomCount } = await cleanDicomZip(filePath, cleanedPath)
  if (!dicomCount) throw new Error('No DICOM files were found in the uploaded MRI ZIP')
  await repairRenewistDicomZipMetadata(cleanedPath, {}, dicomCount)

  const storage = await storeObject({
    kind: 'mri-studies',
    keyParts: [`${path.basename(cleanedPath, '.zip')}-${crypto.randomUUID()}.zip`],
    body: fs.createReadStream(cleanedPath),
    contentType: 'application/zip',
    localPath: cleanedPath,
  }).catch(() => null)

  let result = storage && process.env.MRI_S3_STUDY_API_URL?.trim()
    ? await callMriS3StudyUpstream(storage.key)
    : await callMriStudyUpstream(cleanedPath, uploadName)
  if (!result.ok && /0 diagnostic images|could not be read|no report was produced/i.test(result.error ?? '')) {
    const retry = await callMriStudyUpstream(filePath, uploadName)
    result = {
      ...retry,
      name: retry.name,
      error: retry.ok ? retry.error : `${retry.error ?? 'MRI upstream failed'}; cleaned DICOM ZIP retry also failed: ${result.error}`,
    }
  }
  if (!result.ok || !result.json) throw new AiProcessingError(result.error ?? `MRI upstream failed with status ${result.status}`, [result], dicomCount)

  const report = buildRadiologyReport('MRI AI report', [result.json], { reportId })
  return {
    cleanedPath,
    imageCount: dicomCount,
    upstreamResults: [result],
    html: report.html,
    sections: report.sections,
  }
}

export async function processMammographyUpload(filePath: string, uploadName: string, jobFolder: string, reportId?: string, progress: MammographyProgress = {}) {
  const cleanedPath = path.join(jobFolder, 'cleaned_mammography_dicoms.zip')
  const { dicomCount } = await cleanDicomZip(filePath, cleanedPath)
  if (!dicomCount) throw new Error('No DICOM files were found in the uploaded mammography ZIP')
  await progress.onPrepared?.({ cleanedPath, imageCount: dicomCount })

  const storage = await storeObject({
    kind: 'mammography-studies',
    keyParts: [`${path.basename(cleanedPath, '.zip')}-${crypto.randomUUID()}.zip`],
    body: fs.createReadStream(cleanedPath), contentType: 'application/zip', localPath: cleanedPath,
  }).catch(() => null)
  await progress.onStored?.({ cleanedPath, storage })
  const result = storage && process.env.MAMMOGRAPHY_S3_REPORT_API_URL?.trim()
    ? await callMammographyS3ReportUpstream(storage.key, progress)
    : await callMammographyStudyUpstream(cleanedPath, uploadName, progress)
  if (!result.ok || !result.json) throw new AiProcessingError(result.error ?? `Mammography upstream failed with status ${result.status}`, [result], dicomCount)

  const report = buildRadiologyReport('Mammography AI report', [result.json], { reportId })
  return {
    cleanedPath,
    imageCount: dicomCount,
    upstreamResults: [result],
    html: report.html,
    sections: report.sections,
  }
}

async function callMammographyS3ReportUpstream(objectKey: string, progress: MammographyProgress): Promise<UpstreamResult> {
  const startedAt = Date.now()
  const url = process.env.MAMMOGRAPHY_S3_REPORT_API_URL!.trim()
  const examinationType = process.env.MAMMOGRAPHY_EXAMINATION_TYPE?.trim() || 'diagnostic'
  try {
    const response = await axios.post(url, { object_key: objectKey, examination_type: examinationType }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: Number(process.env.MAMMOGRAPHY_S3_REPORT_TIMEOUT_MS ?? 1_800_000),
      validateStatus: () => true,
    })
    const jobId = extractGenericCtJobId(response.data)
    if (response.status >= 200 && response.status < 300 && looksLikeFinalCtResult(response.data)) {
      return { name: 'mammography-s3-report', ok: true, status: response.status, latencyMs: Date.now() - startedAt, raw: response.data, json: normalizeGenericCtResult(response.data) }
    }
    if (response.status >= 200 && response.status < 300 && jobId) {
      await progress.onSubmitted?.({ jobId, response: response.data, endpointId: 'mammography-s3-report', submittedAt: new Date().toISOString() })
      return { name: 'mammography-s3-report', ok: false, status: response.status, latencyMs: Date.now() - startedAt, raw: response.data, error: 'Mammography S3 endpoint accepted the study but did not return a report; configure an async result endpoint before use.' }
    }
    return { name: 'mammography-s3-report', ok: false, status: response.status, latencyMs: Date.now() - startedAt, raw: response.data, error: formatUpstreamError(response.data, response.statusText) }
  } catch (error) {
    return { name: 'mammography-s3-report', ok: false, latencyMs: Date.now() - startedAt, error: error instanceof Error ? error.message : 'Mammography S3 report request failed' }
  }
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

async function repairRenewistDicomZipMetadata(zipPath: string, metadata: Record<string, string | null | undefined>, fileCount: number) {
  const workDir = path.join(path.dirname(zipPath), `renewist-repair-${crypto.randomUUID()}`)
  const outputPath = path.join(path.dirname(zipPath), `${safeBaseName(path.basename(zipPath, '.zip'))}-repaired.zip`)
  await extractZipToDirectory(zipPath, workDir)
  const files = await listFiles(workDir)
  for (const file of files) {
    await prepareRenewistDicomFile(file, metadata, path.dirname(file)).catch(() => file)
  }
  const repaired = await zipDirectory(workDir, outputPath)
  await fsp.copyFile(outputPath, zipPath)
  await fsp.rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  await fsp.rm(outputPath, { force: true }).catch(() => undefined)
  return { fileCount: repaired.fileCount || fileCount, zipPath }
}

async function prepareRenewistDicomFile(sourcePath: string, metadata: Record<string, string | null | undefined>, workDir: string) {
  await fsp.mkdir(workDir, { recursive: true })
  const workingPath = path.join(workDir, path.basename(sourcePath).endsWith('.dcm') ? path.basename(sourcePath) : `${path.basename(sourcePath)}.dcm`)
  if (path.resolve(sourcePath) !== path.resolve(workingPath)) await fsp.copyFile(sourcePath, workingPath)
  if (!(await isDicomFile(workingPath))) return workingPath
  await transcodeRenewistDicomIfNeeded(workingPath)
  await ensureDicomTags(workingPath, {
    '0010,0020': metadata.patientId,
    '0008,0020': metadata.studyDate,
    '0008,0060': metadata.modality,
  })
  if (metadata.studyInstanceUid && !(await dicomTagValue(workingPath, '0020,000D'))) {
    await generateMissingStudyInstanceUid(workingPath)
  }
  return workingPath
}

const renewistSafeTransferSyntaxes = new Set([
  '1.2.840.10008.1.2',
  '1.2.840.10008.1.2.1',
])
let nativeCodecsInitialization: Promise<void> | null = null

async function transcodeRenewistDicomIfNeeded(filePath: string) {
  const buffer = await fsp.readFile(filePath)
  const transferSyntax = readDicomTransferSyntax(buffer)
  if (!transferSyntax || renewistSafeTransferSyntaxes.has(transferSyntax)) return false

  const { NativeCodecs, Transcoder, constants } = dcmjsCodecs as typeof dcmjsCodecs & {
    constants: { TransferSyntax: { ExplicitVRLittleEndian: string } }
  }
  nativeCodecsInitialization ??= NativeCodecs.initializeAsync()
  await nativeCodecsInitialization

  const source = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  const transcoder = new Transcoder(source)
  transcoder.transcode(constants.TransferSyntax.ExplicitVRLittleEndian)
  await fsp.writeFile(filePath, Buffer.from(transcoder.getDicomPart10()))
  return true
}

function readDicomTransferSyntax(buffer: Buffer) {
  try {
    const dataset = dicomParser.parseDicom(buffer)
    return dataset.string('x00020010') ?? ''
  } catch {
    return ''
  }
}

async function ensureDicomTags(filePath: string, tags: Record<string, string | null | undefined>) {
  const dcmodify = await findTool('dcmodify.exe')
  if (!dcmodify) return
  const args = ['-nb']
  for (const [tag, value] of Object.entries(tags)) {
    const normalized = String(value ?? '').trim()
    if (!normalized) continue
    args.push('-i', `(${tag})=${normalized}`)
  }
  if (args.length === 1) return
  await new Promise<void>((resolve, reject) => {
    execFile(dcmodify, args.concat(filePath), { windowsHide: true }, (error, _stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message))
      else resolve()
    })
  }).catch(() => undefined)
}

async function generateMissingStudyInstanceUid(filePath: string) {
  const dcmodify = await findTool('dcmodify.exe')
  if (!dcmodify) return
  await new Promise<void>((resolve, reject) => {
    execFile(dcmodify, ['-nb', '-gst', filePath], { windowsHide: true }, (error, _stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message))
      else resolve()
    })
  }).catch(() => undefined)
}

async function dicomTagValue(filePath: string, tag: string) {
  const dcmdump = await findTool('dcmdump.exe')
  if (!dcmdump) return ''
  const output = await new Promise<string>((resolve) => {
    execFile(dcmdump, ['+P', tag, filePath], { windowsHide: true }, (_error, stdout) => resolve(stdout || ''))
  })
  return readDicomDumpValue(output, tag) ?? ''
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

async function prepareXrayUpstreamFiles(filePath: string, uploadName: string): Promise<PreparedXrayFile[]> {
  const lowerName = uploadName.toLowerCase()
  if (isImageFileName(lowerName)) return [{ filePath, uploadName, sourceName: uploadName }]

  const workDir = path.join(path.dirname(filePath), 'xray-upstream')
  await fsp.mkdir(workDir, { recursive: true })
  const sourceFiles = lowerName.endsWith('.zip')
    ? await extractXrayZipFiles(filePath, workDir)
    : [{ filePath, uploadName, sourceName: uploadName }]

  const prepared: PreparedXrayFile[] = []
  for (const sourceFile of sourceFiles) {
    if (isImageFileName(sourceFile.uploadName)) {
      prepared.push(sourceFile)
      continue
    }

    if (!isDicomExtension(sourceFile.uploadName) && !(await isDicomFile(sourceFile.filePath))) continue
    const outputPath = path.join(workDir, `${crypto.randomUUID()}-${safeBaseName(sourceFile.sourceName || sourceFile.uploadName)}.jpg`)
    await convertDicomToJpeg(sourceFile.filePath, outputPath)
    prepared.push({ filePath: outputPath, uploadName: path.basename(outputPath), sourceName: sourceFile.sourceName })
  }

  return prepared
}

async function extractXrayZipFiles(zipPath: string, outputDir: string): Promise<PreparedXrayFile[]> {
  const zipFile = await openZip(zipPath)
  const extracted: PreparedXrayFile[] = []
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
        const sourceName = sanitizeZipPath(entry.fileName) || `${crypto.randomUUID()}.dcm`
        const outputPath = path.join(outputDir, `${crypto.randomUUID()}-${sanitizeFileName(path.basename(sourceName))}`)
        try {
          await pipeline(readStream, fs.createWriteStream(outputPath))
          extracted.push({ filePath: outputPath, uploadName: sanitizeFileName(path.basename(sourceName)), sourceName })
          zipFile.readEntry()
        } catch (streamError) {
          reject(streamError)
        }
      })
    })
    zipFile.on('end', resolve)
    zipFile.on('error', reject)
  })
  zipFile.close()
  return extracted
}

async function convertDicomToJpeg(sourcePath: string, outputPath: string) {
  const dcmj2pnm = await findTool('dcmj2pnm.exe')
  if (!dcmj2pnm) throw new Error('dcmj2pnm.exe is required to convert X-Ray DICOM files before AI processing')
  await new Promise<void>((resolve, reject) => {
    execFile(dcmj2pnm, ['+oj', '+Jq', '90', sourcePath, outputPath], { windowsHide: true }, (error, _stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message))
      else resolve()
    })
  })
}

async function findTool(fileName: string) { return findExecutable(fileName); }



async function callBinaryUpstream(name: string, url: string | undefined, filePath: string, uploadName: string, timeoutMs: number, sourceName?: string): Promise<UpstreamResult> {
  if (!url) return { name, sourceName, uploadName, ok: false, error: `${name} upstream URL is not configured` }
  const startedAt = Date.now()
  const urls = upstreamUrlCandidates(url)
  let lastResult: UpstreamResult | null = null

  for (const candidateUrl of urls) {
    const result = await postBinaryUpstream(name, candidateUrl, filePath, uploadName, timeoutMs, startedAt, sourceName)
    if (result.ok) return result
    lastResult = result
    if (!shouldRetryWithAlternateUrl(result)) break
  }

  return lastResult ?? { name, sourceName, uploadName, ok: false, latencyMs: Date.now() - startedAt, error: 'Upstream request failed' }
}

async function postBinaryUpstream(name: string, url: string, filePath: string, uploadName: string, timeoutMs: number, startedAt: number, sourceName?: string): Promise<UpstreamResult> {
  try {
    const form = new FormData()
    form.append('file', fs.createReadStream(filePath), uploadName)
    const response = await axios.post(url, form, {
      headers: form.getHeaders(),
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: timeoutMs,
      validateStatus: () => true,
    })
    const latencyMs = Date.now() - startedAt
    return response.status >= 200 && response.status < 300
      ? { name, sourceName, uploadName, ok: true, status: response.status, latencyMs, json: response.data as ReportSource }
      : { name, sourceName, uploadName, ok: false, status: response.status, latencyMs, error: formatUpstreamError(response.data, response.statusText) }
  } catch (error) {
    return { name, sourceName, uploadName, ok: false, latencyMs: Date.now() - startedAt, error: error instanceof Error ? error.message : 'Upstream request failed' }
  }
}

async function callCtUpstream(filePath: string, uploadName: string): Promise<UpstreamResult> {
  const url = process.env.CT_THORAX_API_URL?.trim() || defaultCtThoraxApiUrl
  const timeoutMs = Number(process.env.CT_UPSTREAM_TIMEOUT_MS ?? 86_400_000)
  const first = await callCtByteStream(url, filePath, uploadName, timeoutMs)
  if (first.ok || !shouldRetryCtAsMultipart(first)) return first
  const second = await callCtMultipart(url, filePath, uploadName, timeoutMs)
  if (second.ok) return second
  return {
    ...second,
    error: `Byte-stream upload failed: ${first.error ?? first.status ?? 'unknown error'}; multipart upload failed: ${second.error ?? second.status ?? 'unknown error'}`,
  }
}

async function callCtByteStream(url: string, filePath: string, uploadName: string, timeoutMs: number): Promise<UpstreamResult> {
  const startedAt = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  timeout.unref()

  try {
    const response = await fetch(url, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Upload-Name': uploadName,
      },
      body: fs.createReadStream(filePath) as unknown as BodyInit,
      duplex: 'half',
      signal: controller.signal,
    } as RequestInit & { duplex: 'half' })

    const finalResponse = response.status === 303 && response.headers.get('location')
      ? await fetch(response.headers.get('location')!, { signal: controller.signal })
      : response
    const body = await readFetchBody(finalResponse)
    return finalResponse.ok
      ? { name: 'ct-thorax', ok: true, status: finalResponse.status, latencyMs: Date.now() - startedAt, json: parseJsonBody(body) as ReportSource }
      : { name: 'ct-thorax', ok: false, status: finalResponse.status, latencyMs: Date.now() - startedAt, error: formatUpstreamError(parseJsonBody(body) ?? body, finalResponse.statusText) }
  } catch (error) {
    return { name: 'ct-thorax', ok: false, latencyMs: Date.now() - startedAt, error: error instanceof Error ? error.message : 'CT upstream request failed' }
  } finally {
    clearTimeout(timeout)
  }
}

async function callCtMultipart(url: string, filePath: string, uploadName: string, timeoutMs: number): Promise<UpstreamResult> {
  const startedAt = Date.now()
  try {
    const form = new FormData()
    form.append('file', fs.createReadStream(filePath), uploadName)
    const response = await axios.post(url, form, {
      headers: form.getHeaders(),
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: timeoutMs,
      validateStatus: () => true,
    })
    const latencyMs = Date.now() - startedAt
    return response.status >= 200 && response.status < 300
      ? { name: 'ct-thorax', ok: true, status: response.status, latencyMs, json: response.data as ReportSource }
      : { name: 'ct-thorax', ok: false, status: response.status, latencyMs, error: formatUpstreamError(response.data, response.statusText) }
  } catch (error) {
    return { name: 'ct-thorax', ok: false, latencyMs: Date.now() - startedAt, error: error instanceof Error ? error.message : 'CT multipart upstream request failed' }
  }
}

type GenericCtEndpoint = {
  id: string
  baseUrl: string
  token: string
  active: number
  queue: Array<() => void>
}

const genericCtEndpointState = new Map<string, GenericCtEndpoint>()
const mriEndpointState = new Map<string, GenericCtEndpoint>()
const mammographyEndpointState = new Map<string, GenericCtEndpoint>()

async function callGenericCtStudyUpstream(filePath: string, uploadName: string, clinicalIndication: string): Promise<UpstreamResult> {
  const endpoint = await acquireGenericCtEndpoint()
  try {
    const result = await callGenericCtStudyEndpoint(filePath, uploadName, endpoint, clinicalIndication)
    return {
      ...result,
      name: `${result.name}:${endpoint.id}`,
    }
  } finally {
    releaseGenericCtEndpoint(endpoint)
  }
}

async function callGenericCtStudyEndpoint(filePath: string, uploadName: string, endpoint: GenericCtEndpoint, clinicalIndication: string): Promise<UpstreamResult> {
  const startedAt = Date.now()
  const baseUrl = endpoint.baseUrl
  const token = endpoint.token
  const timeoutMs = Number(process.env.CT_STUDY_UPSTREAM_TIMEOUT_MS ?? 86_400_000)
  const pollIntervalMs = Number(process.env.CT_STUDY_POLL_INTERVAL_MS ?? 10_000)
  const httpsAgent = new https.Agent({ rejectUnauthorized: process.env.CT_STUDY_TLS_REJECT_UNAUTHORIZED === 'true' })
  const submitUrl = genericCtSubmitUrl(baseUrl)
  const resultUrl = genericCtResultUrl(baseUrl)
  try {
    const form = new FormData()
    form.append('study', fs.createReadStream(filePath), { filename: uploadName, contentType: 'application/zip' })
    form.append('clinical_indication', clinicalIndication)
    const uploadResponse = await axios.post(submitUrl, form, {
      headers: { ...form.getHeaders(), Authorization: `Bearer ${token}` },
      httpsAgent,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: Math.min(timeoutMs, Number(process.env.CT_STUDY_UPLOAD_TIMEOUT_MS ?? 300_000)),
      validateStatus: () => true,
    })
    if (uploadResponse.status < 200 || uploadResponse.status >= 300) {
      return { name: 'ct-study', ok: false, status: uploadResponse.status, latencyMs: Date.now() - startedAt, error: formatUpstreamError(uploadResponse.data, uploadResponse.statusText) }
    }
    const jobId = extractGenericCtJobId(uploadResponse.data)
    if (!jobId) return { name: 'ct-study', ok: false, status: uploadResponse.status, latencyMs: Date.now() - startedAt, error: `CT study API did not return a job id: ${formatUpstreamError(uploadResponse.data)}` }

    const deadline = Date.now() + timeoutMs
    let lastBody: unknown = uploadResponse.data
    while (Date.now() < deadline) {
      await sleep(pollIntervalMs)
      const statusResponse = await axios.get(`${resultUrl}?job_id=${encodeURIComponent(jobId)}`, {
        headers: { Authorization: `Bearer ${token}` },
        httpsAgent,
        timeout: Math.min(pollIntervalMs + 30_000, timeoutMs),
        validateStatus: () => true,
      })
      lastBody = statusResponse.data
      if (statusResponse.status === 422) {
        return { name: 'ct-orchestrator', ok: false, status: statusResponse.status, latencyMs: Date.now() - startedAt, error: formatUpstreamError(statusResponse.data, 'CT orchestrator failed') }
      }
      if (statusResponse.status < 200 || statusResponse.status >= 300) {
        return { name: 'ct-orchestrator', ok: false, status: statusResponse.status, latencyMs: Date.now() - startedAt, error: formatUpstreamError(statusResponse.data, statusResponse.statusText) }
      }
      const status = extractStatus(statusResponse.data)
      if (isCompleteStatus(status) || looksLikeFinalCtResult(statusResponse.data)) {
        return { name: 'ct-study', ok: true, status: statusResponse.status, latencyMs: Date.now() - startedAt, json: normalizeGenericCtResult(statusResponse.data) }
      }
      if (isFailedStatus(status)) {
        return { name: 'ct-study', ok: false, status: statusResponse.status, latencyMs: Date.now() - startedAt, error: formatUpstreamError(statusResponse.data, 'CT study failed') }
      }
      // Both 200 and 202 may be an accepted-but-still-analysing job. Do not
      // turn a progress payload into an empty clinical report.
    }
    return { name: 'ct-orchestrator', ok: false, latencyMs: Date.now() - startedAt, error: `CT orchestrator timed out while polling. Last response: ${formatUpstreamError(lastBody)}` }
  } catch (error) {
    return { name: 'ct-orchestrator', ok: false, latencyMs: Date.now() - startedAt, error: error instanceof Error ? error.message : 'CT orchestrator upstream request failed' }
  }
}

async function callMriStudyUpstream(filePath: string, uploadName: string): Promise<UpstreamResult> {
  const endpoint = await acquireMriEndpoint()
  try {
    const result = await callMriStudyEndpoint(filePath, uploadName, endpoint)
    return {
      ...result,
      name: `${result.name}:${endpoint.id}`,
    }
  } finally {
    releaseMriEndpoint(endpoint)
  }
}

async function callMriS3StudyUpstream(studyS3Key: string): Promise<UpstreamResult> {
  const startedAt = Date.now()
  const baseUrl = (process.env.MRI_S3_STUDY_API_URL ?? 'https://decxpert-mri-two.win').replace(/\/+$/g, '')
  const apiKey = process.env.MRI_S3_STUDY_API_KEY ?? process.env.MRI_STUDY_API_TOKEN ?? ''
  const timeoutMs = Number(process.env.MRI_STUDY_UPSTREAM_TIMEOUT_MS ?? 86_400_000)
  const pollIntervalMs = Number(process.env.MRI_STUDY_POLL_INTERVAL_MS ?? 10_000)
  const clientId = process.env.MRI_S3_STUDY_CLIENT_ID ?? 'dectrocel-portal'
  const examination = process.env.MRI_S3_STUDY_EXAMINATION ?? 'MRI'
  const clinicalIndication = process.env.MRI_S3_STUDY_CLINICAL_INDICATION ?? 'Portal submit'
  const idempotencyKey = `portal-${crypto.createHash('sha256').update(studyS3Key).digest('hex').slice(0, 24)}`
  const headers = { 'X-API-Key': apiKey, Accept: 'application/json', 'User-Agent': 'Dectrocel-PACS-Portal/1.0' }
  try {
    if (!apiKey) return { name: 'mri-s3-study', ok: false, latencyMs: Date.now() - startedAt, error: 'MRI S3 API key is not configured' }
    const uploadResponse = await axios.post(`${baseUrl}/v1/mri/jobs/from-s3`, {
      client_id: clientId,
      idempotency_key: idempotencyKey,
      study_s3_key: studyS3Key,
      clinical_indication: clinicalIndication,
      examination,
    }, {
      headers,
      timeout: Math.min(timeoutMs, Number(process.env.MRI_STUDY_UPLOAD_TIMEOUT_MS ?? 300_000)),
      validateStatus: () => true,
    })
    if (uploadResponse.status < 200 || uploadResponse.status >= 300) {
      return { name: 'mri-s3-study', ok: false, status: uploadResponse.status, latencyMs: Date.now() - startedAt, raw: uploadResponse.data, error: formatUpstreamError(uploadResponse.data, uploadResponse.statusText) }
    }
    const jobId = extractGenericCtJobId(uploadResponse.data)
    if (!jobId) return { name: 'mri-s3-study', ok: false, status: uploadResponse.status, latencyMs: Date.now() - startedAt, raw: uploadResponse.data, error: `MRI S3 API did not return a job id: ${formatUpstreamError(uploadResponse.data)}` }

    const deadline = Date.now() + timeoutMs
    let lastBody: unknown = uploadResponse.data
    while (Date.now() < deadline) {
      await sleep(pollIntervalMs)
      const statusResponse = await axios.get(`${baseUrl}/v1/mri/jobs/${encodeURIComponent(jobId)}`, {
        headers,
        timeout: Math.min(pollIntervalMs + 30_000, timeoutMs),
        validateStatus: () => true,
      })
      lastBody = statusResponse.data
      const status = extractStatus(statusResponse.data)
      const reportPublished = Boolean(statusResponse.data && typeof statusResponse.data === 'object' && (statusResponse.data as Record<string, unknown>).report_published)
      if (statusResponse.status < 200 || statusResponse.status >= 300) {
        return { name: 'mri-s3-study', ok: false, status: statusResponse.status, latencyMs: Date.now() - startedAt, raw: statusResponse.data, error: formatUpstreamError(statusResponse.data, statusResponse.statusText) }
      }
      if (reportPublished || isCompleteStatus(status) || looksLikeFinalCtResult(statusResponse.data)) {
        const reportResponse = await axios.get(`${baseUrl}/v1/mri/jobs/${encodeURIComponent(jobId)}/report`, {
          headers,
          timeout: 60_000,
          validateStatus: () => true,
        })
        const finalBody = reportResponse.status >= 200 && reportResponse.status < 300 ? reportResponse.data : statusResponse.data
        return { name: 'mri-s3-study', ok: true, status: reportResponse.status >= 200 && reportResponse.status < 300 ? reportResponse.status : statusResponse.status, latencyMs: Date.now() - startedAt, raw: finalBody, json: normalizeGenericCtResult(finalBody) }
      }
      if (isFailedStatus(status)) {
        return { name: 'mri-s3-study', ok: false, status: statusResponse.status, latencyMs: Date.now() - startedAt, raw: statusResponse.data, error: formatUpstreamError(statusResponse.data, 'MRI S3 study failed') }
      }
    }
    return { name: 'mri-s3-study', ok: false, latencyMs: Date.now() - startedAt, error: `MRI S3 API timed out while polling. Last response: ${formatUpstreamError(lastBody)}` }
  } catch (error) {
    return { name: 'mri-s3-study', ok: false, latencyMs: Date.now() - startedAt, error: error instanceof Error ? error.message : 'MRI S3 upstream request failed' }
  }
}

async function callMammographyStudyUpstream(filePath: string, uploadName: string, progress: MammographyProgress = {}): Promise<UpstreamResult> {
  const endpoint = await acquireMammographyEndpoint()
  try {
    const result = await callMammographyStudyEndpoint(filePath, uploadName, endpoint, progress)
    return {
      ...result,
      name: `${result.name}:${endpoint.id}`,
    }
  } finally {
    releaseMammographyEndpoint(endpoint)
  }
}

async function callMammographyStudyEndpoint(filePath: string, uploadName: string, endpoint: GenericCtEndpoint, progress: MammographyProgress = {}): Promise<UpstreamResult> {
  const startedAt = Date.now()
  const baseUrl = endpoint.baseUrl.replace(/\/+$/g, '')
  const token = endpoint.token
  const timeoutMs = Number(process.env.MAMMOGRAPHY_STUDY_UPSTREAM_TIMEOUT_MS ?? 86_400_000)
  const pollIntervalMs = Number(process.env.MAMMOGRAPHY_STUDY_POLL_INTERVAL_MS ?? 10_000)
  const httpsAgent = new https.Agent({ rejectUnauthorized: process.env.MAMMOGRAPHY_STUDY_TLS_REJECT_UNAUTHORIZED === 'true' })
  try {
    let jobId = progress.resumeJobId?.trim() ?? ''
    let lastBody: unknown = jobId ? { job_id: jobId, status: 'resuming' } : undefined
    if (!jobId) {
      const form = new FormData()
      form.append('file', fs.createReadStream(filePath), { filename: uploadName, contentType: 'application/zip' })
      const uploadResponse = await axios.post(baseUrl, form, {
        headers: { ...form.getHeaders(), Authorization: `Bearer ${token}` },
        httpsAgent,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: Math.min(timeoutMs, Number(process.env.MAMMOGRAPHY_STUDY_UPLOAD_TIMEOUT_MS ?? 300_000)),
        validateStatus: () => true,
      })
      if (uploadResponse.status < 200 || uploadResponse.status >= 300) {
        return { name: 'mammography-study', ok: false, status: uploadResponse.status, latencyMs: Date.now() - startedAt, raw: uploadResponse.data, error: formatUpstreamError(uploadResponse.data, uploadResponse.statusText) }
      }
      jobId = extractGenericCtJobId(uploadResponse.data)
      if (!jobId) return { name: 'mammography-study', ok: false, status: uploadResponse.status, latencyMs: Date.now() - startedAt, raw: uploadResponse.data, error: `Mammography study API did not return a job id: ${formatUpstreamError(uploadResponse.data)}` }
      lastBody = uploadResponse.data
      await progress.onSubmitted?.({ jobId, response: uploadResponse.data, endpointId: endpoint.id, submittedAt: new Date().toISOString() })
    }

    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await sleep(pollIntervalMs)
      const statusResponse = await axios.get(`${baseUrl}/${encodeURIComponent(jobId)}`, {
        headers: { Authorization: `Bearer ${token}` },
        httpsAgent,
        timeout: Math.min(pollIntervalMs + 30_000, timeoutMs),
        validateStatus: () => true,
      })
      lastBody = statusResponse.data
      const status = extractStatus(statusResponse.data)
      await progress.onPolled?.({ jobId, response: statusResponse.data, endpointId: endpoint.id, polledAt: new Date().toISOString(), status })
      if (statusResponse.status < 200 || statusResponse.status >= 300) {
        return { name: 'mammography-study', ok: false, status: statusResponse.status, latencyMs: Date.now() - startedAt, raw: statusResponse.data, error: formatUpstreamError(statusResponse.data, statusResponse.statusText) }
      }
      if (isCompleteStatus(status) || looksLikeFinalCtResult(statusResponse.data)) {
        return { name: 'mammography-study', ok: true, status: statusResponse.status, latencyMs: Date.now() - startedAt, json: normalizeGenericCtResult(statusResponse.data), raw: statusResponse.data }
      }
      if (isFailedStatus(status)) {
        return { name: 'mammography-study', ok: false, status: statusResponse.status, latencyMs: Date.now() - startedAt, raw: statusResponse.data, error: formatUpstreamError(statusResponse.data, 'Mammography study failed') }
      }
    }
    return { name: 'mammography-study', ok: false, latencyMs: Date.now() - startedAt, error: `Mammography study API timed out while polling. Last response: ${formatUpstreamError(lastBody)}` }
  } catch (error) {
    return { name: 'mammography-study', ok: false, latencyMs: Date.now() - startedAt, error: error instanceof Error ? error.message : 'Mammography study upstream request failed' }
  }
}

async function callMriStudyEndpoint(filePath: string, uploadName: string, endpoint: GenericCtEndpoint): Promise<UpstreamResult> {
  const startedAt = Date.now()
  const baseUrl = endpoint.baseUrl
  const token = endpoint.token
  const timeoutMs = Number(process.env.MRI_STUDY_UPSTREAM_TIMEOUT_MS ?? 86_400_000)
  const pollIntervalMs = Number(process.env.MRI_STUDY_POLL_INTERVAL_MS ?? 10_000)
  const httpsAgent = new https.Agent({ rejectUnauthorized: process.env.MRI_STUDY_TLS_REJECT_UNAUTHORIZED === 'true' })
  try {
    const form = new FormData()
    form.append('file', fs.createReadStream(filePath), { filename: uploadName, contentType: 'application/zip' })
    const uploadResponse = await axios.post(baseUrl, form, {
      headers: { ...form.getHeaders(), Authorization: `Bearer ${token}` },
      httpsAgent,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: Math.min(timeoutMs, Number(process.env.MRI_STUDY_UPLOAD_TIMEOUT_MS ?? 300_000)),
      validateStatus: () => true,
    })
    if (uploadResponse.status < 200 || uploadResponse.status >= 300) {
      return { name: 'mri-study', ok: false, status: uploadResponse.status, latencyMs: Date.now() - startedAt, error: formatUpstreamError(uploadResponse.data, uploadResponse.statusText) }
    }
    const jobId = extractGenericCtJobId(uploadResponse.data)
    if (!jobId) return { name: 'mri-study', ok: false, status: uploadResponse.status, latencyMs: Date.now() - startedAt, error: `MRI study API did not return a job id: ${formatUpstreamError(uploadResponse.data)}` }

    const deadline = Date.now() + timeoutMs
    let lastBody: unknown = uploadResponse.data
    while (Date.now() < deadline) {
      await sleep(pollIntervalMs)
      const statusResponse = await axios.get(`${baseUrl.replace(/\/+$/g, '')}/${encodeURIComponent(jobId)}`, {
        headers: { Authorization: `Bearer ${token}` },
        httpsAgent,
        timeout: Math.min(pollIntervalMs + 30_000, timeoutMs),
        validateStatus: () => true,
      })
      lastBody = statusResponse.data
      if (statusResponse.status < 200 || statusResponse.status >= 300) {
        return { name: 'mri-study', ok: false, status: statusResponse.status, latencyMs: Date.now() - startedAt, error: formatUpstreamError(statusResponse.data, statusResponse.statusText) }
      }
      const status = extractStatus(statusResponse.data)
      if (isCompleteStatus(status) || looksLikeFinalCtResult(statusResponse.data)) {
        return { name: 'mri-study', ok: true, status: statusResponse.status, latencyMs: Date.now() - startedAt, json: normalizeGenericCtResult(statusResponse.data) }
      }
      if (isFailedStatus(status)) {
        return { name: 'mri-study', ok: false, status: statusResponse.status, latencyMs: Date.now() - startedAt, error: formatUpstreamError(statusResponse.data, 'MRI study failed') }
      }
    }
    return { name: 'mri-study', ok: false, latencyMs: Date.now() - startedAt, error: `MRI study API timed out while polling. Last response: ${formatUpstreamError(lastBody)}` }
  } catch (error) {
    return { name: 'mri-study', ok: false, latencyMs: Date.now() - startedAt, error: error instanceof Error ? error.message : 'MRI study upstream request failed' }
  }
}

async function acquireMriEndpoint() {
  const endpoints = getMriEndpoints()
  let endpoint = endpoints.find((candidate) => candidate.active < mriEndpointConcurrencyLimit())
  if (endpoint) {
    endpoint.active += 1
    return endpoint
  }

  endpoint = endpoints.reduce((leastBusy, candidate) => candidate.queue.length < leastBusy.queue.length ? candidate : leastBusy, endpoints[0])
  await new Promise<void>((resolve) => endpoint.queue.push(resolve))
  endpoint.active += 1
  return endpoint
}

function releaseMriEndpoint(endpoint: GenericCtEndpoint) {
  endpoint.active = Math.max(0, endpoint.active - 1)
  const next = endpoint.queue.shift()
  if (next) setImmediate(next)
}

function mriEndpointConcurrencyLimit() {
  return Math.max(1, Number(process.env.MRI_STUDY_ENDPOINT_CONCURRENCY ?? 2))
}

function getMriEndpoints() {
  const specs = parseMriEndpointSpecs()
  return specs.map((spec, index) => {
    const id = spec.id || `mri-${index + 1}`
    const existing = mriEndpointState.get(id)
    if (existing) {
      existing.baseUrl = spec.baseUrl
      existing.token = spec.token
      return existing
    }
    const endpoint: GenericCtEndpoint = { id, baseUrl: spec.baseUrl, token: spec.token, active: 0, queue: [] }
    mriEndpointState.set(id, endpoint)
    return endpoint
  })
}

function parseMriEndpointSpecs() {
  const rawPool = process.env.MRI_STUDY_API_ENDPOINTS
  if (rawPool) {
    const parsed = rawPool.split(',').map((entry, index) => {
      const [baseUrl, token, id] = entry.split('|').map((value) => value.trim())
      return baseUrl && token ? { baseUrl, token, id: id || `mri-${index + 1}` } : null
    }).filter((entry): entry is { baseUrl: string; token: string; id: string } => Boolean(entry))
    if (parsed.length) return parsed
  }

  return [
    {
      id: 'mri-primary',
      baseUrl: process.env.MRI_STUDY_API_URL ?? 'https://52.64.209.106:443/api/mri-study',
      token: process.env.MRI_STUDY_API_TOKEN ?? '',
    },
  ].filter((endpoint) => endpoint.baseUrl && endpoint.token)
}

async function acquireMammographyEndpoint() {
  const endpoints = getMammographyEndpoints()
  let endpoint = endpoints.find((candidate) => candidate.active < mammographyEndpointConcurrencyLimit())
  if (endpoint) {
    endpoint.active += 1
    return endpoint
  }

  endpoint = endpoints.reduce((leastBusy, candidate) => candidate.queue.length < leastBusy.queue.length ? candidate : leastBusy, endpoints[0])
  await new Promise<void>((resolve) => endpoint.queue.push(resolve))
  endpoint.active += 1
  return endpoint
}

function releaseMammographyEndpoint(endpoint: GenericCtEndpoint) {
  endpoint.active = Math.max(0, endpoint.active - 1)
  const next = endpoint.queue.shift()
  if (next) setImmediate(next)
}

function mammographyEndpointConcurrencyLimit() {
  return Math.max(1, Number(process.env.MAMMOGRAPHY_STUDY_ENDPOINT_CONCURRENCY ?? 2))
}

function getMammographyEndpoints() {
  const specs = parseMammographyEndpointSpecs()
  return specs.map((spec, index) => {
    const id = spec.id || `mammography-${index + 1}`
    const existing = mammographyEndpointState.get(id)
    if (existing) {
      existing.baseUrl = spec.baseUrl
      existing.token = spec.token
      return existing
    }
    const endpoint: GenericCtEndpoint = { id, baseUrl: spec.baseUrl, token: spec.token, active: 0, queue: [] }
    mammographyEndpointState.set(id, endpoint)
    return endpoint
  })
}

function parseMammographyEndpointSpecs() {
  const rawPool = process.env.MAMMOGRAPHY_STUDY_API_ENDPOINTS
  if (rawPool) {
    const parsed = rawPool.split(',').map((entry, index) => {
      const [baseUrl, token, id] = entry.split('|').map((value) => value.trim())
      return baseUrl && token ? { baseUrl, token, id: id || `mammography-${index + 1}` } : null
    }).filter((entry): entry is { baseUrl: string; token: string; id: string } => Boolean(entry))
    if (parsed.length) return parsed
  }

  return [
    {
      id: 'mammography-primary',
      baseUrl: process.env.MAMMOGRAPHY_STUDY_API_URL ?? 'https://18.141.57.93:443/api/mammography-study',
      token: process.env.MAMMOGRAPHY_STUDY_API_TOKEN ?? '',
    },
  ].filter((endpoint) => endpoint.baseUrl && endpoint.token)
}

async function acquireGenericCtEndpoint() {
  const endpoints = getGenericCtEndpoints()
  let endpoint = endpoints.find((candidate) => candidate.active < genericCtEndpointConcurrencyLimit())
  if (endpoint) {
    endpoint.active += 1
    return endpoint
  }

  endpoint = endpoints.reduce((leastBusy, candidate) => candidate.queue.length < leastBusy.queue.length ? candidate : leastBusy, endpoints[0])
  await new Promise<void>((resolve) => endpoint.queue.push(resolve))
  endpoint.active += 1
  return endpoint
}

function releaseGenericCtEndpoint(endpoint: GenericCtEndpoint) {
  endpoint.active = Math.max(0, endpoint.active - 1)
  const next = endpoint.queue.shift()
  if (next) setImmediate(next)
}

function genericCtEndpointConcurrencyLimit() {
  return Math.max(1, Number(process.env.CT_STUDY_ENDPOINT_CONCURRENCY ?? 3))
}

function getGenericCtEndpoints() {
  const specs = parseGenericCtEndpointSpecs()
  return specs.map((spec, index) => {
    const id = spec.id || `ct-${index + 1}`
    const existing = genericCtEndpointState.get(id)
    if (existing) {
      existing.baseUrl = spec.baseUrl
      existing.token = spec.token
      return existing
    }
    const endpoint: GenericCtEndpoint = { id, baseUrl: spec.baseUrl, token: spec.token, active: 0, queue: [] }
    genericCtEndpointState.set(id, endpoint)
    return endpoint
  })
}

function parseGenericCtEndpointSpecs() {
  return [
    {
      id: 'ct-orchestrator',
      baseUrl: process.env.CT_ORCHESTRATOR_API_URL ?? 'https://ankitshukla0611--decxpert-ct-orchestrator-web.modal.run',
      token: process.env.CT_ORCHESTRATOR_API_TOKEN ?? '',
    },
  ].filter((endpoint) => endpoint.baseUrl && endpoint.token)
}

function genericCtSubmitUrl(baseUrl: string) {
  const trimmed = baseUrl.replace(/\/+$/g, '')
  return trimmed.endsWith('/submit') ? trimmed : `${trimmed}/submit`
}

function genericCtResultUrl(baseUrl: string) {
  const trimmed = baseUrl.replace(/\/+$/g, '')
  if (trimmed.endsWith('/submit')) return `${trimmed.slice(0, -'/submit'.length)}/result`
  if (trimmed.endsWith('/result')) return trimmed
  return `${trimmed}/result`
}

async function classifyCtStudy(cleanedZipPath: string, jobFolder: string, options: {
  serviceName?: string
  serviceType?: string
  dicomMetadata?: Record<string, string | undefined>
} = {}): Promise<{ route: 'thorax' | 'abdomen' | 'generic'; reason: string; evidence: string[] }> {
  const dcmdump = await findTool('dcmdump.exe')
  const contextEvidence = buildCtContextEvidence(options)
  const contextRoute = classifyCtText(contextEvidence.join(' | '))
  if (contextRoute === 'thorax') return { route: 'thorax', reason: 'Service/DICOM metadata indicate CT thorax', evidence: contextEvidence }
  if (contextRoute === 'abdomen') return { route: 'abdomen', reason: 'Service/DICOM metadata indicate CT abdomen/pelvis', evidence: contextEvidence }
  if (!dcmdump) return { route: 'generic', reason: 'dcmdump.exe unavailable, using generic CT API', evidence: contextEvidence }
  const sampleDir = path.join(jobFolder, 'ct-classification-samples')
  await fsp.mkdir(sampleDir, { recursive: true })
  const samples = await extractZipSampleFiles(cleanedZipPath, sampleDir, 15, 5)
  const evidence: string[] = [...contextEvidence]
  for (const sample of samples) {
    const output = await dumpCtClassificationTags(dcmdump, sample).catch(() => '')
    const values = [
      readDicomDumpValue(output, '0018,0015'),
      readDicomDumpValue(output, '0008,1030'),
      readDicomDumpValue(output, '0008,103E'),
      readDicomDumpValue(output, '0018,1030'),
    ].map(cleanDicomText).filter(Boolean)
    evidence.push(...values)
  }
  const joined = evidence.join(' | ')
  const route = classifyCtText(joined)
  if (route === 'thorax') {
    return { route: 'thorax', reason: 'DICOM body-part/study tags indicate CT thorax', evidence }
  }
  if (route === 'abdomen') {
    return { route: 'abdomen', reason: 'DICOM body-part/study tags indicate CT abdomen/pelvis', evidence }
  }
  return { route: 'generic', reason: 'DICOM tags do not indicate CT thorax', evidence }
}

function buildCtContextEvidence(options: {
  serviceName?: string
  serviceType?: string
  dicomMetadata?: Record<string, string | undefined>
}) {
  const metadata = options.dicomMetadata ?? {}
  return [
    options.serviceName,
    options.serviceType,
    metadata.bodyPartExamined,
    metadata.studyDescription,
    metadata.seriesDescription,
    metadata.protocolName,
    metadata.clinicalHistory,
    metadata.indication,
  ].filter((value): value is string => Boolean(value))
}

function deriveCtClinicalIndication(options: {
  serviceName?: string
  serviceType?: string
  dicomMetadata?: Record<string, string | undefined>
  clinicalIndication?: string
}, classification: { evidence: string[] }) {
  const metadata = options.dicomMetadata ?? {}
  const explicit = [
    options.clinicalIndication,
    metadata.clinicalHistory,
    metadata.indication,
    metadata.protocolName,
    metadata.studyDescription,
    options.serviceName,
    options.serviceType,
    ...classification.evidence,
  ].map((value) => cleanDicomText(value ?? '')).find(Boolean)
  return explicit || process.env.CT_STUDY_DEFAULT_CLINICAL_INDICATION || 'TRAUMA'
}

function classifyCtText(value: string) {
  if (/\b(thorax|chest|lung|lungs|hrct|pulmonary)\b/i.test(value)) return 'thorax'
  if (/\b(abdomen|abdominal|pelvis|pelvic|cervix|uterus|uterine|postmenopausal|pvg|per vaginum|bleeding)\b/i.test(value)) return 'abdomen'
  if (/\bct[-_\s]*body|body[-_\s]*with|body[-_\s]*without\b/i.test(value)) return 'abdomen'
  return 'generic'
}

function upstreamUrlCandidates(url: string) {
  const trimmed = url.replace(/\/+$/g, '')
  return Array.from(new Set([
    url,
    trimmed,
    `${trimmed}/analyze`,
    `${trimmed}/infer`,
    `${trimmed}/predict`,
  ]))
}

function shouldRetryWithAlternateUrl(result: UpstreamResult) {
  const error = result.error ?? ''
  return result.status === 404 && /invalid function call|not found/i.test(error)
}

function shouldRetryCtAsMultipart(result: UpstreamResult) {
  return Boolean(result.status && [400, 404, 415, 422].includes(result.status))
}

async function readFetchBody(response: Response) {
  const text = await response.text().catch(() => '')
  return text.trim()
}

function parseJsonBody(text: string) {
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function extractGenericCtJobId(value: unknown) {
  if (!value || typeof value !== 'object') return ''
  const object = value as Record<string, unknown>
  return String(object.job_id ?? object.jobId ?? object.id ?? object.job ?? object.task_id ?? object.taskId ?? '')
}

function extractStatus(value: unknown) {
  if (!value || typeof value !== 'object') return ''
  const object = value as Record<string, unknown>
  return String(object.status ?? object.state ?? object.job_status ?? object.processing_status ?? '')
}

function isCompleteStatus(status: string) {
  return /^(complete|completed|done|success|succeeded|finished)$/i.test(status)
}

function isFailedStatus(status: string) {
  return /^(failed|failure|error|cancelled|canceled)$/i.test(status)
}

function looksLikeFinalCtResult(value: unknown) {
  if (!value || typeof value !== 'object') return false
  const object = value as Record<string, unknown>
  return Boolean(object.findings || object.impression || object.report_markdown || object.reportMarkdown || object.report || object.result || object.results || object.sections)
}

function normalizeGenericCtResult(value: unknown): ReportSource {
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    const nested = object.result ?? object.report ?? object.response
    if (typeof object.report_markdown === 'string' || typeof object.reportMarkdown === 'string') return object
    if (nested && typeof nested === 'object') return nested as ReportSource
    return object as ReportSource
  }
  return { report: String(value ?? '') } as ReportSource
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function formatUpstreamError(value: unknown, fallback = 'Upstream request failed') {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (value !== undefined && value !== null) {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return fallback
}

async function dumpCtClassificationTags(dcmdump: string, filePath: string) {
  const tags = ['0018,0015', '0008,1030', '0008,103E', '0018,1030']
  return new Promise<string>((resolve, reject) => {
    execFile(dcmdump, tags.flatMap((tag) => ['+P', tag]).concat(filePath), { windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message))
      else resolve(stdout)
    })
  })
}

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

async function countZipEntries(zipPath: string) {
  const zipFile = await openZip(zipPath)
  let count = 0
  await new Promise<void>((resolve, reject) => {
    zipFile.readEntry()
    zipFile.on('entry', (entry) => {
      if (!/\/$/.test(entry.fileName)) count += 1
      zipFile.readEntry()
    })
    zipFile.on('end', resolve)
    zipFile.on('error', reject)
  })
  zipFile.close()
  return count
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

function isImageFileName(fileName: string) {
  return /\.(jpg|jpeg|png|bmp|webp)$/i.test(fileName)
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
