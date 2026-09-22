import crypto from 'node:crypto'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import FormData from 'form-data'
import yazl from 'yazl'
import type { TeleradiologyProviderAdapter, ProviderReport, ProviderStudySubmission } from './providerAdapters'
import { ProviderSubmissionError } from './providerAdapters'

const signedStatuses = new Set(['FINAL', 'SIGNED', 'AMENDED'])

export class RenewistAdapter implements TeleradiologyProviderAdapter {
  constructor(private readonly config: { apiBaseUrl?: string; studySubmissionEndpoint?: string | null; apiKey?: string; hmacSecret?: string; timeoutMs?: number } = {}) {}

  async submitStudy(input: ProviderStudySubmission) {
    const explicitUrl = process.env.RENEWIST_OUTBOUND_STUDY_SUBMISSION_URL
    const baseUrl = this.config.apiBaseUrl ?? process.env.RENEWIST_OUTBOUND_API_BASE_URL ?? 'https://radagent.renewist.com'
    const submitPath = this.config.studySubmissionEndpoint ?? process.env.RENEWIST_OUTBOUND_STUDY_SUBMISSION_PATH ?? '/api/v1/teleradiology/dectrocel/reports'
    // Outbound credentials are issued by Renewist for their API. Never fall
    // back to RENEWIST_API_KEY, which authenticates Renewist callbacks to us.
    const apiKey = this.config.apiKey ?? process.env.RENEWIST_OUTBOUND_API_KEY ?? process.env.DECTROCEL_TELERAD_API_KEY
    const hmacSecret = this.config.hmacSecret ?? process.env.RENEWIST_OUTBOUND_HMAC_SECRET ?? process.env.RENEWIST_HMAC_SECRET
    if (!baseUrl || !apiKey) {
      throw new Error('Renewist outbound API is not configured. Set the Renewist-issued RENEWIST_OUTBOUND_API_KEY; the inbound RENEWIST_API_KEY cannot be used for study uploads')
    }
    if (!input.studyZipPath) throw new Error('Study ZIP is required for Renewist outbound submission')
    const url = explicitUrl ?? new URL(submitPath, baseUrl).toString()
    const requestId = crypto.randomUUID()
    const timestamp = String(Math.floor(Date.now() / 1000))
    const metadata = input.metadata ?? {}
    const dicomMetadata = metadata.dicomMetadata && typeof metadata.dicomMetadata === 'object' ? metadata.dicomMetadata as Record<string, unknown> : {}
    const hospitalSlug = 'marengo'
    const patientId = firstString(input.patientId, dicomMetadata.patientId, metadata.patientId, input.dectrocelJobId)
    const patientName = firstString(metadata.patientName, dicomMetadata.patientName)
    const patientAge = firstString(metadata.patientAge, dicomMetadata.patientAge)
    const patientSex = firstString(metadata.patientSex, dicomMetadata.patientSex)
    const referringDoctor = firstString(metadata.referringDoctor, metadata.referringPhysician, dicomMetadata.referringDoctor, dicomMetadata.referringPhysician)
    const modality = firstString(input.modality, dicomMetadata.modality, normalizeRenewistFallbackModality(metadata.service, input.modality))
    const clinicalHistory = firstString(metadata.clinicalHistory, metadata.clinicalIndication, dicomMetadata.clinicalHistory)
    const clinicalIndicationAttachments = normalizeAttachmentFiles(metadata.clinicalIndicationAttachments ?? metadata.supportingFiles)
    const form = new FormData()
    form.append('job_id', input.dectrocelJobId)
    form.append('hospital_slug', hospitalSlug)
    form.append('submission_mode', 'SIGNED_REPORT_ONLY')
    form.append('patient_id', patientId)
    form.append('study_instance_uid', firstString(input.studyInstanceUid, dicomMetadata.studyInstanceUid))
    form.append('accession_number', firstString(input.accessionNumber, dicomMetadata.accession, dicomMetadata.accessionNumber))
    form.append('modality', modality)
    form.append('patient_name', patientName)
    form.append('patient_age', patientAge)
    form.append('patient_sex', patientSex)
    form.append('referring_doctor', referringDoctor)
    form.append('clinical_history', clinicalHistory)
    form.append('study_date', formatRenewistStudyDate(metadata.studyDate ?? dicomMetadata.studyDate))
    form.append('urgent', String(firstString(input.priority, metadata.priority).toUpperCase() === 'URGENT'))
    form.append('study', fsSync.createReadStream(input.studyZipPath), { filename: path.basename(input.studyZipPath), contentType: 'application/zip' })
    const clinicalAttachmentZipPath = clinicalIndicationAttachments.length
      ? await zipClinicalIndicationAttachments(clinicalIndicationAttachments, input.studyZipPath, input.dectrocelJobId)
      : null
    if (clinicalAttachmentZipPath) {
      form.append('clinical_indication_attachment', fsSync.createReadStream(clinicalAttachmentZipPath), { filename: path.basename(clinicalAttachmentZipPath), contentType: 'application/zip' })
    }
    const headers: Record<string, string> = {
      ...form.getHeaders(),
      'X-API-KEY': apiKey,
      'x-renewist-api-key': apiKey,
      'x-renewist-request-id': requestId,
      'x-renewist-timestamp': timestamp,
    }
    if (hmacSecret) {
      headers['x-renewist-signature'] = crypto.createHmac('sha256', hmacSecret).update(`${timestamp}.${requestId}.${input.dectrocelJobId}`).digest('hex')
    }
    const timeoutMs = Number(process.env.RENEWIST_OUTBOUND_TIMEOUT_MS ?? this.config.timeoutMs ?? 1800000)
    try {
      const response = await postMultipartStream(url, form, headers, timeoutMs)
      const responseBody = parseResponseBody(response.body)
      if (response.statusCode < 200 || response.statusCode >= 300) throw new ProviderSubmissionError(response.statusCode, responseBody)
      return {
        providerJobId: String(responseBody.renewist_job_id ?? responseBody.provider_job_id ?? responseBody.study_id ?? responseBody.scan_id ?? responseBody.job_id ?? input.dectrocelJobId),
        providerStatus: String(responseBody.provider_status ?? responseBody.status ?? 'SUBMITTED_TO_TELERADIOLOGY'),
        raw: responseBody,
        httpStatus: response.statusCode,
      }
    } finally {
      if (clinicalAttachmentZipPath) {
        await fs.rm(clinicalAttachmentZipPath, { force: true }).catch(() => undefined)
      }
    }
  }

  async getStudyStatus(providerJobId: string) {
    return { providerStatus: 'UNKNOWN', raw: { providerJobId } }
  }

  async getReport() {
    return null
  }

  async cancelStudy(providerJobId: string, reason?: string) {
    return { cancelled: false, raw: { providerJobId, reason, message: 'Renewist cancellation endpoint is not configured' } }
  }

  async validateCallback(input: { headers: Record<string, string | string[] | undefined>; fields: Record<string, unknown> }) {
    const expectedKey = process.env.RENEWIST_API_KEY
    const secret = process.env.RENEWIST_HMAC_SECRET
    if (!expectedKey || !secret) return { ok: false, reason: 'Renewist API credentials are not configured' }

    const apiKey = header(input.headers, 'x-renewist-api-key')
    const signature = header(input.headers, 'x-renewist-signature')
    const timestamp = header(input.headers, 'x-renewist-timestamp')
    const requestId = header(input.headers, 'x-renewist-request-id')
    if (apiKey !== expectedKey) return { ok: false, reason: 'Invalid Renewist API key' }
    if (!signature || !timestamp || !requestId) return { ok: false, reason: 'Missing Renewist signature headers' }

    const toleranceSeconds = Number(process.env.RENEWIST_SIGNATURE_TOLERANCE_SECONDS ?? 300)
    const now = Math.floor(Date.now() / 1000)
    const sentAt = Number(timestamp)
    if (!Number.isFinite(sentAt) || Math.abs(now - sentAt) > toleranceSeconds) return { ok: false, reason: 'Renewist timestamp expired' }

    const dectrocelJobId = String(input.fields.dectrocel_job_id ?? '')
    const renewistJobId = String(input.fields.renewist_job_id ?? '')
    const payload = `${timestamp}.${requestId}.${dectrocelJobId}.${renewistJobId}`
    const expectedSignature = crypto.createHmac('sha256', secret).update(payload).digest('hex')
    if (!timingSafeEqual(signature, expectedSignature)) return { ok: false, reason: 'Invalid Renewist signature' }
    return { ok: true }
  }

  normalizeProviderStatus(status: string) {
    const upper = status.toUpperCase()
    if (upper === 'DRAFT') return 'PRELIMINARY_REPORT_AVAILABLE'
    if (upper === 'PRELIMINARY') return 'PRELIMINARY_REPORT_AVAILABLE'
    if (signedStatuses.has(upper)) return 'REPORT_SIGNED'
    if (upper === 'FAILED') return 'FAILED'
    if (upper === 'CANCELLED') return 'CANCELLED'
    return upper
  }

  normalizeProviderReport(report: ProviderReport) {
    return {
      ...report,
      status: report.status.toUpperCase(),
      reportType: report.reportType.toUpperCase(),
      reportFormat: report.reportFormat.toUpperCase(),
    }
  }

  async testConnection() {
    if (!process.env.RENEWIST_API_KEY || !process.env.RENEWIST_HMAC_SECRET) {
      return { ok: false, message: 'Renewist callback credentials are not configured.' }
    }
    return { ok: true, message: 'Renewist callback credentials are configured.' }
  }
}

function postMultipartStream(url: string, form: FormData, headers: Record<string, string>, timeoutMs: number) {
  return new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
    const target = new URL(url)
    const transport = target.protocol === 'https:' ? https : http
    const request = transport.request({
      method: 'POST',
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      headers,
      timeout: timeoutMs,
    }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      response.on('end', () => resolve({ statusCode: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
    })
    request.on('timeout', () => request.destroy(new Error(`Renewist outbound submit timed out after ${timeoutMs}ms`)))
    request.on('error', reject)
    form.on('error', reject)
    form.pipe(request)
  })
}

function parseResponseBody(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { value: parsed }
  } catch {
    return { text: value }
  }
}

function header(headers: Record<string, string | string[] | undefined>, name: string) {
  const value = headers[name] ?? headers[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

function formatRenewistStudyDate(value: unknown) {
  const raw = String(value ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const compactDicomDate = /^(\d{4})(\d{2})(\d{2})$/.exec(raw)
  if (compactDicomDate) return `${compactDicomDate[1]}-${compactDicomDate[2]}-${compactDicomDate[3]}`
  const parsed = raw ? new Date(raw) : new Date()
  if (Number.isFinite(parsed.getTime())) return parsed.toISOString().slice(0, 10)
  return new Date().toISOString().slice(0, 10)
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    const text = String(value ?? '').trim()
    if (text) return text
  }
  return ''
}

function normalizeRenewistFallbackModality(service: unknown, modality: unknown) {
  const serviceName = service && typeof service === 'object' && !Array.isArray(service)
    ? String((service as Record<string, unknown>).name ?? '')
    : String(service ?? '')
  const text = `${serviceName} ${String(modality ?? '')}`.toLowerCase()
  if (text.includes('mammo')) return 'Mammography'
  if (text.includes('special') && text.includes('x')) return 'Special X-ray'
  if (text.includes('xray') || text.includes('x-ray') || text.includes('dx')) return 'X-Ray'
  if (text.includes('mrcp')) return 'MRCP'
  if (text.includes('mri') || text.includes('mr')) return 'MRI Screening'
  if (text.includes('ct')) return text.includes('angio') ? 'CT Angiography' : 'CT Thorax'
  return 'X-Ray'
}

type RenewistAttachmentFile = {
  filePath: string
  originalName?: string
}

function normalizeAttachmentFiles(value: unknown): RenewistAttachmentFile[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const record = item as Record<string, unknown>
    const filePath = typeof record.filePath === 'string' ? record.filePath : ''
    if (!filePath.trim()) return []
    const originalName = typeof record.originalName === 'string'
      ? record.originalName
      : typeof record.name === 'string'
        ? record.name
        : path.basename(filePath)
    return [{ filePath, originalName }]
  })
}

async function zipClinicalIndicationAttachments(files: RenewistAttachmentFile[], studyZipPath: string, jobId: string) {
  const existingFiles: RenewistAttachmentFile[] = []
  for (const file of files) {
    const stat = await fs.stat(file.filePath).catch(() => null)
    if (stat?.isFile()) existingFiles.push(file)
  }
  if (!existingFiles.length) return null

  const zipPath = path.join(path.dirname(studyZipPath), `clinical-indication-${safeFileStem(jobId)}.zip`)
  const zip = new yazl.ZipFile()
  const outputDone = pipeline(zip.outputStream, fsSync.createWriteStream(zipPath))
  const usedNames = new Set<string>()
  for (const file of existingFiles) {
    zip.addFile(file.filePath, uniqueZipEntryName(safeZipEntryName(file.originalName ?? path.basename(file.filePath)), usedNames))
  }
  zip.end()
  await outputDone
  return zipPath
}

function safeZipEntryName(value: string) {
  return (value || 'attachment')
    .replace(/[/\\:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || 'attachment'
}

function safeFileStem(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || crypto.randomUUID()
}

function uniqueZipEntryName(entryName: string, usedNames: Set<string>) {
  const parsed = path.parse(entryName)
  let candidate = entryName
  let counter = 1
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${parsed.name}-${counter}${parsed.ext}`
    counter += 1
  }
  usedNames.add(candidate.toLowerCase())
  return candidate
}

function timingSafeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer)
}
