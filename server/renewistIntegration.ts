import Busboy from 'busboy'
import { Prisma } from '@prisma/client'
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import express, { type Request, type Response } from 'express'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import yauzl from 'yauzl'
import { z } from 'zod'
import { prisma } from './db'
import { renderHtmlReportPdf, sendApprovedReportToPacs } from './pacsSender'
import { storeObject, type StoredObject } from './reportStorage'
import { getDeploymentFeatures } from './deploymentProfile'
import { RenewistAdapter } from './renewistAdapter'
import { enqueueStudyStatusNotification } from './whatsapp'
import { recordStudyAcknowledgement } from './studyTracking'
import { redactExchange } from './telegramPolicy'
import { evidenceHash } from './adminEvidence'

const uploadsPath = path.resolve(process.cwd(), 'uploads')
const renewistReportPath = path.join(uploadsPath, 'renewist-reports')
const renewistAdapter = new RenewistAdapter()
const execFileAsync = promisify(execFile)

export const renewistIntegrationRouter = express.Router()

renewistIntegrationRouter.use((req, res, next) => {
  if (req.method !== 'POST') return next()
  const receivedAt = new Date().toISOString()
  // Parsed JSON only: no credentials, raw binary uploads, or claims of wire-byte capture.
  const requestPayload = req.is('application/json') ? redactExchange(req.body) : null
  const originalJson = res.json.bind(res)
  res.json = ((body: unknown) => {
    const responsePayload = redactExchange(body)
    const responseAt = new Date().toISOString()
    const status = res.statusCode
    const fields = (req.body ?? {}) as Record<string, unknown>
    const reference = String(fields.dectrocel_job_id ?? fields.job_id ?? '')
    res.once('finish', () => {
      void (async () => {
        const mapping = reference ? await prisma.providerJobMapping.findUnique({ where: { dectrocelJobId: reference } }) : null
        const job = mapping?.processingJobId ? await prisma.processingJob.findUnique({ where: { id: mapping.processingJobId }, select: { clientId: true } }) : null
        const evidence = { requestPayload, responsePayload, receivedAt, responseAt, httpStatus: status, endpoint: req.path, requestId: req.get('x-renewist-request-id') ?? null, dectrocelJobId: reference || null, processingJobId: mapping?.processingJobId ?? null, captureScope: requestPayload === null ? 'Multipart request body not captured; response JSON captured' : 'Redacted parsed JSON; not original wire bytes', responseFinishedLocally: true }
        await prisma.auditLog.create({ data: { clientId: job?.clientId, action: 'RENEWIST_HTTP_EXCHANGE', ipAddress: req.ip, metadata: { ...evidence, capturedEvidenceSha256: evidenceHash(evidence) } as Prisma.InputJsonObject } })
      })().catch(() => console.error('Renewist exchange audit persistence failed; HTTP handling is unchanged.'))
    })
    return originalJson(body)
  }) as typeof res.json
  next()
})

const reportSchema = z.object({
  dectrocel_job_id: z.string().min(3),
  renewist_job_id: z.string().min(1),
  report_status: z.enum(['DRAFT', 'PRELIMINARY', 'FINAL', 'SIGNED', 'AMENDED', 'CANCELLED', 'FAILED']),
  report_type: z.enum(['PRELIMINARY_REPORT', 'FINAL_REPORT', 'SIGNED_REPORT', 'ADDENDUM', 'CORRECTED_REPORT']),
  report_format: z.enum(['PDF', 'DOCX', 'HTML', 'JSON', 'TEXT', 'DICOM_PDF', 'DICOM_SC']),
  reported_at: z.string().min(1),
  accession_number: z.string().optional(),
  study_instance_uid: z.string().optional(),
  patient_id: z.string().optional(),
  findings: z.string().optional(),
  impression: z.string().optional(),
  advice: z.string().optional(),
  clinical_history: z.string().optional(),
  comparison: z.string().optional(),
  urgency_status: z.string().optional(),
  critical_finding: z.coerce.boolean().optional(),
  critical_finding_text: z.string().optional(),
  radiologist_name: z.string().optional(),
  radiologist_qualification: z.string().optional(),
  radiologist_registration_number: z.string().optional(),
  signed_at: z.string().optional(),
  signature_status: z.string().optional(),
  report_version: z.coerce.number().int().positive().default(1),
  amendment_reason: z.string().optional(),
  comments: z.string().optional(),
  provider_status: z.string().optional(),
  turnaround_time_seconds: z.coerce.number().int().nonnegative().optional(),
  callback_reference: z.string().optional(),
  report_checksum: z.string().optional(),
  metadata_json: z.string().optional(),
})

type ParsedReportRequest = z.infer<typeof reportSchema> & {
  reportFilePath?: string
  reportChecksum?: string
  fileName?: string
  signedFiles?: SignedReportFiles
}

type SavedReportFile = { path: string; checksum: string; fileName: string; format?: 'pdf' | 'docx' | 'other'; field?: string; storage?: StoredObject | null }
type SignedReportFiles = {
  pdf?: SavedReportFile
  withoutLetterheadPdf?: SavedReportFile
  docx?: SavedReportFile
  withoutLetterheadDocx?: SavedReportFile
  all?: SavedReportFile[]
}

renewistIntegrationRouter.get('/health', (_req, res) => {
  res.json({ ok: true, provider: 'renewist', callbackApiEnabled: process.env.RENEWIST_API_ENABLED !== 'false' })
})

renewistIntegrationRouter.get('/version', (_req, res) => {
  res.json({ service: 'DecXpert Renewist Integration API', version: '1.0.0' })
})

renewistIntegrationRouter.get('/reports', (_req, res) => {
  res.json({
    ok: true,
    method: 'POST',
    contentType: 'multipart/form-data',
    requiredHeaders: ['X-API-KEY'],
    requiredFields: ['job_id', 'report'],
    aliases: {
      job_id: ['dectrocel_job_id'],
      report: ['Signed PDF with letterhead'],
      report_wlh: ['Optional signed PDF without letterhead'],
    },
  })
})

renewistIntegrationRouter.post('/reports', async (req, res) => {
  if (process.env.RENEWIST_API_ENABLED === 'false') return sendError(res, 503, 'PROVIDER_NOT_CONFIGURED', 'Renewist API is disabled', false)
  const parsed = await parseMultipartReport(req).catch((error) => ({ error }))
  if ('error' in parsed) {
    const message = parsed.error instanceof Error ? parsed.error.message : 'Invalid multipart request'
    console.warn('Renewist report callback rejected during parsing:', message)
    return sendError(res, 400, 'REPORT_STATUS_INVALID', message, false)
  }
  return handleReportSubmission(req, res, parsed)
})

renewistIntegrationRouter.post('/reports/json', async (req, res) => {
  if (process.env.RENEWIST_API_ENABLED === 'false') return sendError(res, 503, 'PROVIDER_NOT_CONFIGURED', 'Renewist API is disabled', false)
  const body = { ...req.body }
  const reportBase64 = body.report_base64 ?? body.report
  const reportFileName = body.report_file_name ?? body.report_name ?? body.file_name ?? 'report.pdf'
  if (reportBase64) {
    const saved = await saveBase64Report(String(reportBase64), String(reportFileName), String(body.report_format ?? 'PDF')).catch((error) => ({ error }))
    if ('error' in saved) return sendError(res, 400, 'REPORT_STORAGE_FAILED', saved.error instanceof Error ? saved.error.message : 'Unable to save report file', false)
    body.reportFilePath = saved.path
    body.reportChecksum = saved.checksum
    body.fileName = saved.fileName
    body.signedFiles = signedFilesFromSaved(saved, String(body.report_format ?? body.report_file_name))
  }
  if (body.pdf_report_base64 && body.pdf_report_file_name) {
    const saved = await saveBase64Report(String(body.pdf_report_base64), String(body.pdf_report_file_name), 'PDF').catch((error) => ({ error }))
    if ('error' in saved) return sendError(res, 400, 'REPORT_STORAGE_FAILED', saved.error instanceof Error ? saved.error.message : 'Unable to save signed PDF', false)
    const current = typeof body.signedFiles === 'object' && body.signedFiles ? body.signedFiles as SignedReportFiles : {}
    body.signedFiles = mergeSignedReportFiles(current, signedFilesFromSaved(saved, 'PDF'))
    body.reportFilePath ??= saved.path
    body.reportChecksum ??= saved.checksum
    body.fileName ??= saved.fileName
  }
  const withoutLetterheadBase64 = body.report_wlh_base64 ?? body.report_wlh ?? body.report_without_letterhead_base64
  const withoutLetterheadFileName = body.report_wlh_file_name ?? body.report_without_letterhead_file_name ?? 'report-without-letterhead.pdf'
  if (withoutLetterheadBase64) {
    const saved = await saveBase64Report(String(withoutLetterheadBase64), String(withoutLetterheadFileName), 'PDF').catch((error) => ({ error }))
    if ('error' in saved) return sendError(res, 400, 'REPORT_STORAGE_FAILED', saved.error instanceof Error ? saved.error.message : 'Unable to save PDF without letterhead', false)
    const current = typeof body.signedFiles === 'object' && body.signedFiles ? body.signedFiles as SignedReportFiles : {}
    body.signedFiles = mergeSignedReportFiles(current, {
      withoutLetterheadPdf: { ...saved, format: 'pdf', field: 'report_without_letterhead' },
      all: [{ ...saved, format: 'pdf', field: 'report_without_letterhead' }],
    })
  }
  if (body.docx_report_base64 && body.docx_report_file_name) {
    const saved = await saveBase64Report(String(body.docx_report_base64), String(body.docx_report_file_name), 'DOCX').catch((error) => ({ error }))
    if ('error' in saved) return sendError(res, 400, 'REPORT_STORAGE_FAILED', saved.error instanceof Error ? saved.error.message : 'Unable to save signed DOCX', false)
    const current = typeof body.signedFiles === 'object' && body.signedFiles ? body.signedFiles as SignedReportFiles : {}
    body.signedFiles = mergeSignedReportFiles(current, signedFilesFromSaved(saved, 'DOCX'))
    body.reportFilePath ??= saved.path
    body.reportChecksum ??= saved.checksum
    body.fileName ??= saved.fileName
  }
  const parsed = reportSchema.safeParse(normalizeMinimalReportFields(body))
  if (!parsed.success) return sendError(res, 400, 'REPORT_STATUS_INVALID', parsed.error.message, false)
  return handleReportSubmission(req, res, { ...parsed.data, reportFilePath: body.reportFilePath, reportChecksum: body.reportChecksum, fileName: body.fileName, signedFiles: body.signedFiles as SignedReportFiles | undefined })
})

renewistIntegrationRouter.post('/status', async (req, res) => {
  const body = z.object({
    dectrocel_job_id: z.string().min(3),
    renewist_job_id: z.string().min(1),
    provider_status: z.string().min(1),
    comments: z.string().optional(),
  }).safeParse(req.body)
  if (!body.success) return sendError(res, 400, 'REPORT_STATUS_INVALID', body.error.message, false)
  const validation = await validateRenewistRequest(req, body.data)
  if (!validation.ok) return sendError(res, validation.status, validation.code, validation.message, false)
  const normalized = renewistAdapter.normalizeProviderStatus(body.data.provider_status)
  const mapping = await prisma.providerJobMapping.findUnique({ where: { dectrocelJobId: body.data.dectrocel_job_id } })
  await prisma.jobStatusHistory.create({
    data: {
      newStatus: normalized,
      sourceSystem: 'RENEWIST',
      processingJobId: mapping?.processingJobId,
      relatedRequestId: validation.requestId,
      relatedProviderStatus: body.data.provider_status,
      reason: body.data.comments,
      technicalDetails: body.data,
    },
  })
  const acknowledgement = { accepted: true, dectrocel_job_id: body.data.dectrocel_job_id, normalized_status: normalized }
  if (mapping?.processingJobId) await recordStudyAcknowledgement(mapping.processingJobId, 'RENEWIST_EXCHANGE', acknowledgement)
  res.json(acknowledgement)
})

async function handleReportSubmission(req: Request, res: Response, rawInput: ParsedReportRequest) {
  let input = rawInput
  const validation = await validateRenewistRequest(req, input)
  if (!validation.ok) return sendError(res, validation.status, validation.code, validation.message, false)

  const existingRequest = await prisma.providerApiRequest.findUnique({ where: { requestId: validation.requestId } })
  if (existingRequest?.status === 'ACCEPTED') {
    return res.json({ accepted: true, duplicate: true, request_id: validation.requestId, dectrocel_job_id: input.dectrocel_job_id })
  }

  const report = await findReportForDectrocelJob(input.dectrocel_job_id, input.study_instance_uid)
  if (!report) {
    await recordProviderRequest(validation.requestId, 'REJECTED', false, 404, input)
    return sendError(res, 404, 'STUDY_NOT_FOUND', 'No matching Dectrocel report or processing job was found', false, input.dectrocel_job_id)
  }
  const processingJob = await findProcessingJobForRenewistReport(input, report.id)
  if (input.renewist_job_id === input.dectrocel_job_id && processingJob?.providerJobId && processingJob.providerJobId !== input.dectrocel_job_id) {
    input = { ...input, renewist_job_id: processingJob.providerJobId }
  }
  const isFinalReport = ['FINAL', 'SIGNED', 'AMENDED'].includes(input.report_status)
  if (!getDeploymentFeatures().renewistPdfConversion && isFinalReport && !input.signedFiles?.pdf?.path) {
    await recordProviderRequest(validation.requestId, 'REJECTED', true, 422, input)
    await cleanupRenewistLocalFiles(input)
    return sendError(res, 422, 'REPORT_STORAGE_FAILED', 'The Marengo deployment requires the original signed Renewist PDF; generated or converted PDFs are disabled.', false, input.dectrocel_job_id)
  }
  input = await ensureRenewistDisplayPdf(input)
  input = await storeRenewistSignedReports(input, report.id)

  const currentVersion = await prisma.reportVersion.findUnique({
    where: { reportReviewId_version: { reportReviewId: report.id, version: input.report_version } },
  })
  const htmlReport = buildRenewistReportHtml(input)
  const normalizedProviderStatus = renewistAdapter.normalizeProviderStatus(input.report_status)
  const nextReviewStatus = input.report_status === 'FAILED' ? 'FAILED' : isFinalReport ? 'APPROVED' : 'SAVED'
  const metadata = toPrismaJsonObject({
    ...buildSubmissionMetadata(input, validation.requestId, normalizedProviderStatus),
    ...(currentVersion ? {
      replacement: {
        replacedAt: new Date().toISOString(),
        previousChecksum: currentVersion.checksum,
        previousFilePath: currentVersion.filePath,
        reason: 'Renewist repushed an existing report version',
      },
    } : {}),
  })

  const [submission] = await prisma.$transaction([
    prisma.providerReportSubmission.upsert({
      where: {
        dectrocelJobId_renewistJobId_reportVersion: {
          dectrocelJobId: input.dectrocel_job_id,
          renewistJobId: input.renewist_job_id,
          reportVersion: input.report_version,
        },
      },
      update: {
        providerId: validation.providerId,
        requestId: validation.requestId,
        reportStatus: input.report_status,
        reportType: input.report_type,
        reportFormat: input.report_format,
        reportFilePath: input.reportFilePath,
        reportChecksum: input.reportChecksum ?? input.report_checksum,
        metadata,
        reportReviewId: report.id,
        processedAt: new Date(),
        processingError: null,
      },
      create: {
        providerId: validation.providerId,
        requestId: validation.requestId,
        dectrocelJobId: input.dectrocel_job_id,
        renewistJobId: input.renewist_job_id,
        reportStatus: input.report_status,
        reportType: input.report_type,
        reportFormat: input.report_format,
        reportVersion: input.report_version,
        reportFilePath: input.reportFilePath,
        reportChecksum: input.reportChecksum ?? input.report_checksum,
        metadata,
        reportReviewId: report.id,
        processedAt: new Date(),
      },
    }),
    prisma.reportVersion.upsert({
      where: { reportReviewId_version: { reportReviewId: report.id, version: input.report_version } },
      update: {
        status: input.report_status,
        source: 'RENEWIST',
        htmlReport,
        filePath: input.reportFilePath,
        checksum: input.reportChecksum ?? input.report_checksum,
        metadata,
      },
      create: {
        reportReviewId: report.id,
        version: input.report_version,
        status: input.report_status,
        source: 'RENEWIST',
        htmlReport,
        filePath: input.reportFilePath,
        checksum: input.reportChecksum ?? input.report_checksum,
        metadata,
      },
    }),
    prisma.providerJobMapping.upsert({
      where: { dectrocelJobId: input.dectrocel_job_id },
      update: {
        providerId: validation.providerId,
        providerJobId: input.renewist_job_id,
        processingJobId: processingJob?.id ?? null,
        reportReviewId: report.id,
        studyInstanceUid: input.study_instance_uid ?? report.studyUid,
        accessionNumber: input.accession_number ?? report.accession,
        status: normalizedProviderStatus,
        metadata,
      },
      create: {
        providerId: validation.providerId,
        providerJobId: input.renewist_job_id,
        processingJobId: processingJob?.id ?? null,
        dectrocelJobId: input.dectrocel_job_id,
        reportReviewId: report.id,
        studyInstanceUid: input.study_instance_uid ?? report.studyUid,
        accessionNumber: input.accession_number ?? report.accession,
        status: normalizedProviderStatus,
        metadata,
      },
    }),
    prisma.reportReview.update({
      where: { id: report.id },
      data: {
        status: nextReviewStatus,
        locked: isFinalReport,
        reviewedAt: new Date(input.reported_at),
        approvedAt: isFinalReport ? new Date(input.signed_at ?? input.reported_at) : null,
        editedReportJson: toPrismaJsonObject({
          ...(report.editedReportJson as Record<string, unknown>),
          htmlReport,
          renewist: metadata,
          reportFilePath: input.reportFilePath,
          reportChecksum: input.reportChecksum ?? input.report_checksum,
          signedReportFiles: signedReportFilesForJson(input.signedFiles),
        }),
      },
    }),
    ...(isFinalReport && processingJob ? [prisma.processingJob.update({
      where: { id: processingJob.id },
      data: {
        status: 'completed',
        clinicalStatus: 'APPROVED',
        providerJobId: input.renewist_job_id,
        error: null,
      },
    }),
    prisma.availableBridgeStudy.updateMany({
      where: { processingJobId: processingJob.id },
      data: { workflowStatus: 'ReportGenerated' },
    })] : []),
    prisma.pacsReturnJob.create({
      data: {
        reportReviewId: report.id,
        status: isFinalReport ? 'PENDING' : 'NOT_REQUIRED',
        returnFormat: report.outputFormat,
        maxAttempts: Number(process.env.DICOM_RETURN_MAX_RETRIES ?? 3),
      },
    }),
    prisma.jobStatusHistory.create({
      data: {
        reportReviewId: report.id,
        previousStatus: report.status,
        newStatus: normalizedProviderStatus,
        sourceSystem: 'RENEWIST',
        relatedRequestId: validation.requestId,
        relatedProviderStatus: input.report_status,
        reason: input.comments ?? input.amendment_reason,
        technicalDetails: metadata,
      },
    }),
    prisma.reportAuditLog.create({
      data: {
        reportId: report.id,
        action: 'RENEWIST_REPORT_RECEIVED',
        metadata,
      },
    }),
    prisma.providerApiRequest.create({
      data: {
        providerId: validation.providerId,
        requestId: validation.requestId,
        direction: 'INBOUND',
        endpoint: req.path,
        status: 'ACCEPTED',
        authenticated: true,
        requestHash: hashJson(metadata),
        responseCode: 202,
        metadata,
      },
    }),
  ])

  await enqueueStudyStatusNotification(prisma, {
    eventType: 'RENEWIST_REPORT_STATUS_RECEIVED',
    clientId: report.clientId,
    reportId: report.id,
    processingJobId: processingJob?.id ?? null,
    status: nextReviewStatus,
    patientName: report.patientName,
    patientId: input.patient_id ?? report.patientId,
    accession: input.accession_number ?? report.accession,
    modality: report.modality,
    serviceName: report.serviceName,
    radiologistName: input.radiologist_name,
    idempotencyKey: `study-status:renewist:${report.id}:${input.report_version}:${input.report_status}`,
  })

  let pacsDelivery: unknown = null
  if (isFinalReport) {
    const signedPdfPath = input.signedFiles?.pdf?.path ?? (input.report_format === 'PDF' ? input.reportFilePath : null)
    try {
      if (!signedPdfPath) {
        throw new Error('Exact Renewist signed PDF is not available; refusing to push generated fallback report')
      }
      pacsDelivery = await sendApprovedReportToPacs({
        report: { ...report, editedReportJson: { htmlReport }, outputFormat: report.outputFormat },
        htmlReport,
        sourcePdfPath: signedPdfPath,
      })
      await prisma.$transaction([
        prisma.reportReview.update({
          where: { id: report.id },
          data: {
            status: 'APPROVED',
            pushedAt: new Date(),
            editedReportJson: toPrismaJsonObject({
              ...(report.editedReportJson as Record<string, unknown>),
              htmlReport,
              renewist: metadata,
              reportFilePath: input.reportFilePath,
              reportChecksum: input.reportChecksum ?? input.report_checksum,
              signedReportFiles: signedReportFilesForJson(input.signedFiles),
              pacsDelivery,
            }),
          },
        }),
        ...(processingJob ? [prisma.processingJob.update({
          where: { id: processingJob.id },
          data: {
            status: 'completed',
            clinicalStatus: 'APPROVED',
            providerJobId: input.renewist_job_id,
            error: null,
          },
        })] : []),
        prisma.pacsReturnJob.updateMany({
          where: { reportReviewId: report.id, status: 'PENDING' },
          data: { status: 'SUCCESS', attempts: { increment: 1 }, lastAttemptAt: new Date(), errorMessage: null, deliveryResult: toPrismaJsonValue(pacsDelivery) },
        }),
        prisma.reportAuditLog.create({
          data: { reportId: report.id, action: 'RENEWIST_REPORT_SENT_TO_CLIENT_PACS', metadata: toPrismaJsonObject({ ...metadata, pacsDelivery }) },
        }),
      ])
      await enqueueStudyStatusNotification(prisma, {
        eventType: 'RENEWIST_REPORT_SENT_TO_CLIENT_PACS',
        clientId: report.clientId,
        reportId: report.id,
        processingJobId: processingJob?.id ?? null,
        status: 'APPROVED',
        patientName: report.patientName,
        patientId: input.patient_id ?? report.patientId,
        accession: input.accession_number ?? report.accession,
        modality: report.modality,
        serviceName: report.serviceName,
        radiologistName: input.radiologist_name,
        idempotencyKey: `study-status:renewist-pushed:${report.id}:${input.report_version}`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to send Renewist report to client PACS'
      await prisma.$transaction([
        prisma.pacsReturnJob.updateMany({
          where: { reportReviewId: report.id, status: 'PENDING' },
          data: { status: 'PENDING', attempts: { increment: 1 }, lastAttemptAt: new Date(), errorMessage: message },
        }),
        prisma.reportAuditLog.create({
          data: { reportId: report.id, action: 'RENEWIST_REPORT_PACS_SEND_FAILED', metadata: toPrismaJsonObject({ ...metadata, error: message }) },
        }),
      ])
    }
  }
  if (!isFinalReport || pacsDelivery) {
    await cleanupRenewistLocalFiles(input).catch((error) => {
      console.warn(`Unable to clean local Renewist report files for ${report.id}:`, error instanceof Error ? error.message : error)
    })
  }

  const acknowledgement = {
    accepted: true,
    request_id: validation.requestId,
    dectrocel_job_id: input.dectrocel_job_id,
    report_id: report.id,
    submission_id: submission.id,
    pacs_return_status: isFinalReport ? (pacsDelivery ? 'SUCCESS' : 'PENDING') : 'NOT_REQUIRED',
  }
  if (processingJob) await recordStudyAcknowledgement(processingJob.id, 'RENEWIST_EXCHANGE', acknowledgement)
  res.status(202).json(acknowledgement)
}

async function validateRenewistRequest(req: Request, fields: Record<string, unknown>) {
  const requestId = header(req, 'x-renewist-request-id') ?? crypto.randomUUID()
  const provider = await prisma.teleradiologyProvider.findUnique({ where: { code: 'RENEWIST' } }).catch(() => null)
  // Renewist clients in the field use both header spellings. Either header
  // authenticates the callback with the dedicated inbound API key; HMAC is
  // still supported when no matching simple key is supplied.
  const authorization = header(req, 'authorization')
  const authorizationApiKey = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
    ?? authorization?.trim()
  const simpleApiKeys = [
    header(req, 'x-api-key'),
    header(req, 'x-renewist-api-key'),
    header(req, 'api-key'),
    header(req, 'x-api-token'),
    header(req, 'x-auth-token'),
    authorizationApiKey,
    typeof req.query.api_key === 'string' ? req.query.api_key : undefined,
    typeof fields.api_key === 'string' ? fields.api_key : undefined,
    typeof fields.apiKey === 'string' ? fields.apiKey : undefined,
    typeof fields.x_api_key === 'string' ? fields.x_api_key : undefined,
    typeof fields.token === 'string' ? fields.token : undefined,
  ].filter((value): value is string => Boolean(value))
  const acceptedSimpleKeys = [process.env.RENEWIST_API_KEY, process.env.DECTROCEL_TELERAD_API_KEY, process.env.RENEWIST_OUTBOUND_API_KEY].filter(Boolean)
  if (simpleApiKeys.some((apiKey) => acceptedSimpleKeys.includes(apiKey))) {
    return { ok: true as const, requestId, providerId: provider?.id }
  }
  if (simpleApiKeys.length) {
    await recordProviderRequest(requestId, 'REJECTED', false, 401, { reason: 'Invalid Renewist API key', credentialProvided: true, fields })
    return { ok: false as const, status: 401, code: 'INVALID_RENEWIST_API_KEY', message: 'Invalid Renewist API key', requestId, providerId: provider?.id }
  }
  const adapterValidation = await renewistAdapter.validateCallback({ headers: req.headers, fields })
  if (!adapterValidation.ok) {
    await recordProviderRequest(requestId, 'REJECTED', false, 401, { reason: adapterValidation.reason, fields })
    return { ok: false as const, status: 401, code: adapterValidation.reason?.includes('timestamp') ? 'RENEWIST_TIMESTAMP_EXPIRED' : adapterValidation.reason?.includes('signature') ? 'INVALID_RENEWIST_SIGNATURE' : 'INVALID_RENEWIST_API_KEY', message: adapterValidation.reason ?? 'Renewist authentication failed', requestId, providerId: provider?.id }
  }
  const allowedIps = (process.env.RENEWIST_ALLOWED_IPS ?? '').split(',').map((item) => item.trim()).filter(Boolean)
  const remoteIp = req.ip?.replace(/^::ffff:/, '')
  if (allowedIps.length && remoteIp && !allowedIps.includes(remoteIp)) {
    await recordProviderRequest(requestId, 'REJECTED', true, 403, { reason: 'IP allowlist rejected', remoteIp })
    return { ok: false as const, status: 403, code: 'PROVIDER_AUTHENTICATION_FAILED', message: 'Renewist source IP is not allowed', requestId, providerId: provider?.id }
  }
  return { ok: true as const, requestId, providerId: provider?.id }
}

async function parseMultipartReport(req: Request): Promise<ParsedReportRequest> {
  await fsp.mkdir(renewistReportPath, { recursive: true })
  const maxBytes = Number(process.env.RENEWIST_MAX_FILE_SIZE_MB ?? 25) * 1024 * 1024
  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers, limits: { files: 5, fileSize: maxBytes } })
    const fields: Record<string, unknown> = {}
    let reportFile: SavedReportFile | null = null
    let signedFiles: SignedReportFiles = { all: [] }
    const writes: Promise<unknown>[] = []

    busboy.on('field', (name, value) => {
      fields[name] = value
    })
    busboy.on('file', (field, file, info) => {
      const safeName = sanitizeFileName(info.filename || `${field}.bin`)
      const outputPath = path.join(renewistReportPath, `${Date.now()}-${crypto.randomUUID()}-${safeName}`)
      const hash = crypto.createHash('sha256')
      const output = fs.createWriteStream(outputPath)
      file.on('data', (chunk: Buffer) => hash.update(chunk))
      writes.push(new Promise((fileResolve, fileReject) => {
        output.on('finish', () => {
          const saved: SavedReportFile = { path: outputPath, checksum: hash.digest('hex'), fileName: safeName, format: inferReportFileFormat(field, safeName, info.mimeType), field }
          signedFiles.all = [...(signedFiles.all ?? []), saved]
          if (isWithoutLetterheadReportField(field)) {
            if (saved.format === 'pdf') signedFiles.withoutLetterheadPdf = saved
            if (saved.format === 'docx') signedFiles.withoutLetterheadDocx = saved
          } else {
            if (saved.format === 'pdf' || (isPdfReportField(field) && saved.format !== 'docx')) signedFiles.pdf = saved
            if (saved.format === 'docx' || (isDocxReportField(field) && saved.format !== 'pdf')) signedFiles.docx = saved
          }
          if ((isPrimaryReportField(field) && !isWithoutLetterheadReportField(field)) || !reportFile) reportFile = saved
          fileResolve(saved)
        })
        output.on('error', fileReject)
        file.on('error', fileReject)
      }))
      file.pipe(output)
    })
    busboy.on('error', reject)
    busboy.on('finish', async () => {
      try {
        await Promise.all(writes)
        const parsed = reportSchema.parse(normalizeMinimalReportFields(fields))
        if (!reportFile?.path) throw new Error('Missing required report file field "report"')
        resolve({ ...parsed, reportFilePath: reportFile?.path, reportChecksum: reportFile?.checksum, fileName: reportFile?.fileName, signedFiles })
      } catch (error) {
        reject(error)
      }
    })
    req.pipe(busboy)
  })
}

function normalizeMinimalReportFields(fields: Record<string, unknown>) {
  const dectrocelJobId = fields.dectrocel_job_id ?? fields.jobID ?? fields.jobId ?? fields.job_id
  return {
    ...fields,
    dectrocel_job_id: dectrocelJobId,
    renewist_job_id: fields.renewist_job_id ?? fields.jobID ?? fields.jobId ?? fields.job_id ?? dectrocelJobId,
    report_status: fields.report_status ?? 'SIGNED',
    report_type: fields.report_type ?? 'SIGNED_REPORT',
    report_format: fields.report_format ?? 'PDF',
    reported_at: fields.reported_at ?? new Date().toISOString(),
  }
}

async function findReportForDectrocelJob(dectrocelJobId: string, studyInstanceUid?: string) {
  const direct = await prisma.reportReview.findUnique({ where: { id: dectrocelJobId } })
  if (direct) return direct
  const mapped = await prisma.providerJobMapping.findFirst({
    where: {
      OR: [
        { dectrocelJobId },
        { providerJobId: dectrocelJobId },
      ],
    },
    orderBy: { createdAt: 'desc' },
  })
  if (mapped?.reportReviewId) {
    const mappedReport = await prisma.reportReview.findUnique({ where: { id: mapped.reportReviewId } })
    if (mappedReport) return mappedReport
  }
  const processingJob = await prisma.processingJob.findFirst({
    where: { OR: [{ id: dectrocelJobId }, { internalJobId: dectrocelJobId }, { providerJobId: dectrocelJobId }] },
  })
  if (processingJob) {
    const fromProcessing = await prisma.reportReview.findFirst({
      where: {
        OR: [
          { aiReportJson: { path: ['processingJob', 'id'], equals: processingJob.id } },
          { editedReportJson: { path: ['processingJob', 'id'], equals: processingJob.id } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    })
    if (fromProcessing) return fromProcessing
  }
  const byStudyUid = await prisma.reportReview.findFirst({ where: { studyUid: dectrocelJobId }, orderBy: { createdAt: 'desc' } })
  if (byStudyUid) return byStudyUid
  if (studyInstanceUid) return prisma.reportReview.findFirst({ where: { studyUid: studyInstanceUid }, orderBy: { createdAt: 'desc' } })
  return null
}

async function findProcessingJobForRenewistReport(input: ParsedReportRequest, reportId: string) {
  const mapped = await prisma.providerJobMapping.findFirst({
    where: {
      OR: [
        { dectrocelJobId: input.dectrocel_job_id },
        { providerJobId: input.dectrocel_job_id },
        { providerJobId: input.renewist_job_id },
        { reportReviewId: reportId },
      ],
    },
    orderBy: { updatedAt: 'desc' },
  })
  if (mapped?.processingJobId) {
    const job = await prisma.processingJob.findUnique({ where: { id: mapped.processingJobId } })
    if (job) return job
  }
  const direct = await prisma.processingJob.findFirst({
    where: { OR: [{ id: input.dectrocel_job_id }, { internalJobId: input.dectrocel_job_id }, { providerJobId: input.dectrocel_job_id }, { providerJobId: input.renewist_job_id }] },
  })
  if (direct) return direct
  if (input.study_instance_uid) {
    return prisma.processingJob.findFirst({
      where: { bridgeStudy: { studyInstanceUid: input.study_instance_uid } },
      orderBy: { createdAt: 'desc' },
    })
  }
  return null
}

function buildRenewistReportHtml(input: ParsedReportRequest) {
  const rows = [
    ['Patient ID', input.patient_id],
    ['Accession', input.accession_number],
    ['Study UID', input.study_instance_uid],
    ['Renewist Job ID', input.renewist_job_id],
    ['Reported At', input.reported_at],
    ['Radiologist', input.radiologist_name],
  ].filter((row): row is [string, string] => Boolean(row[1]))
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><title>Renewist Signed Report</title><style>
body{font-family:Arial,Helvetica,sans-serif;color:#111827;margin:0;background:#f3f4f6}.page{width:794px;min-height:1123px;margin:24px auto;background:#fff;padding:44px 54px;box-sizing:border-box}table{width:100%;border-collapse:collapse;margin-bottom:24px}th,td{border:1px solid #111827;padding:7px 9px;text-align:left;font-size:13px}.title{text-align:center;font-weight:700;font-size:16px;margin:18px 0;text-transform:uppercase}h2{font-size:14px;margin:16px 0 8px}.signature{margin-top:28px;text-align:right;font-size:13px}p{font-size:14px;line-height:1.5;margin:0 0 9px}</style></head><body><main class="page">
<table><tbody>${rows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join('')}</tbody></table>
<div class="title">${escapeHtml(input.report_type.replaceAll('_', ' '))}</div>
${input.clinical_history ? `<h2>Clinical History:</h2><p>${escapeHtml(input.clinical_history)}</p>` : ''}
${input.findings ? `<h2>OBSERVATION:</h2><p>${escapeHtml(input.findings)}</p>` : ''}
${input.comparison ? `<h2>Comparison:</h2><p>${escapeHtml(input.comparison)}</p>` : ''}
${input.impression ? `<h2>IMPRESSION: -</h2><p>${escapeHtml(input.impression)}</p>` : ''}
${input.advice ? `<h2>Adv: -</h2><p>${escapeHtml(input.advice)}</p>` : ''}
${input.critical_finding_text ? `<h2>Critical Finding:</h2><p>${escapeHtml(input.critical_finding_text)}</p>` : ''}
<div class="signature">${input.radiologist_name ? `<strong>${escapeHtml(input.radiologist_name)}</strong><br/>` : ''}${input.radiologist_qualification ? `${escapeHtml(input.radiologist_qualification)}<br/>` : ''}${input.radiologist_registration_number ? `Reg. No: ${escapeHtml(input.radiologist_registration_number)}` : ''}</div>
</main></body></html>`
}

function buildSubmissionMetadata(input: ParsedReportRequest, requestId: string, normalizedProviderStatus: string) {
  return {
    requestId,
    dectrocelJobId: input.dectrocel_job_id,
    renewistJobId: input.renewist_job_id,
    providerStatus: input.provider_status ?? input.report_status,
    normalizedProviderStatus,
    reportStatus: input.report_status,
    reportType: input.report_type,
    reportFormat: input.report_format,
    reportedAt: input.reported_at,
    signedAt: input.signed_at,
    urgencyStatus: input.urgency_status,
    criticalFinding: input.critical_finding,
    radiologist: {
      name: input.radiologist_name,
      qualification: input.radiologist_qualification,
      registrationNumber: input.radiologist_registration_number,
      signatureStatus: input.signature_status,
    },
    file: {
      path: input.reportFilePath,
      checksum: input.reportChecksum ?? input.report_checksum,
      name: input.fileName,
    },
    signedFiles: signedReportFilesForJson(input.signedFiles),
    metadataJson: parseMetadataJson(input.metadata_json),
  }
}

async function recordProviderRequest(requestId: string, status: string, authenticated: boolean, responseCode: number, metadata: unknown) {
  const normalizedMetadata = toPrismaJsonValue(metadata)
  await prisma.providerApiRequest.upsert({
    where: { requestId },
    update: { status, authenticated, responseCode, metadata: normalizedMetadata },
    create: {
      requestId,
      direction: 'INBOUND',
      endpoint: 'renewist',
      status,
      authenticated,
      responseCode,
      metadata: normalizedMetadata,
    },
  }).catch(() => undefined)
}

async function saveBase64Report(base64: string, fileName: string, reportFormat: string) {
  await fsp.mkdir(renewistReportPath, { recursive: true })
  const buffer = Buffer.from(base64.replace(/^data:[^;]+;base64,/, ''), 'base64')
  const maxBytes = Number(process.env.RENEWIST_MAX_FILE_SIZE_MB ?? 25) * 1024 * 1024
  if (buffer.length > maxBytes) throw new Error('Report file is too large')
  const safeName = sanitizeFileName(fileName || `report.${reportFormat.toLowerCase()}`)
  const outputPath = path.join(renewistReportPath, `${Date.now()}-${crypto.randomUUID()}-${safeName}`)
  await fsp.writeFile(outputPath, buffer)
  return { path: outputPath, checksum: crypto.createHash('sha256').update(buffer).digest('hex'), fileName: safeName }
}

function signedFilesFromSaved(saved: { path: string; checksum: string; fileName: string }, hint: string): SignedReportFiles {
  const file: SavedReportFile = { ...saved, format: inferReportFileFormat('', saved.fileName, '', hint) }
  return {
    all: [file],
    ...(file.format === 'pdf' ? { pdf: file } : {}),
    ...(file.format === 'docx' ? { docx: file } : {}),
  }
}

function mergeSignedReportFiles(first: SignedReportFiles, second: SignedReportFiles): SignedReportFiles {
  return {
    pdf: second.pdf ?? first.pdf,
    withoutLetterheadPdf: second.withoutLetterheadPdf ?? first.withoutLetterheadPdf,
    docx: second.docx ?? first.docx,
    withoutLetterheadDocx: second.withoutLetterheadDocx ?? first.withoutLetterheadDocx,
    all: [...(first.all ?? []), ...(second.all ?? [])],
  }
}

async function ensureRenewistDisplayPdf(input: ParsedReportRequest): Promise<ParsedReportRequest> {
  if (!getDeploymentFeatures().renewistPdfConversion) return input
  let nextSignedFiles = input.signedFiles ?? {}
  const docx = nextSignedFiles.docx
  if (docx?.path && !nextSignedFiles.pdf?.path) {
    const converted = await convertDocxReportToPdf(docx).catch((error) => {
      console.warn('Renewist DOCX to PDF conversion failed:', error instanceof Error ? error.message : error)
      return null
    })
    if (converted) nextSignedFiles = mergeSignedReportFiles(nextSignedFiles, { pdf: converted, all: [converted] })
  }

  const withoutLetterheadDocx = nextSignedFiles.withoutLetterheadDocx
  if (withoutLetterheadDocx?.path && !nextSignedFiles.withoutLetterheadPdf?.path) {
    const converted = await convertDocxReportToPdf(withoutLetterheadDocx).catch((error) => {
      console.warn('Renewist without-letterhead DOCX to PDF conversion failed:', error instanceof Error ? error.message : error)
      return null
    })
    if (converted) {
      nextSignedFiles = mergeSignedReportFiles(nextSignedFiles, {
        withoutLetterheadPdf: { ...converted, field: 'converted_without_letterhead_docx' },
        all: [{ ...converted, field: 'converted_without_letterhead_docx' }],
      })
    }
  }

  return { ...input, signedFiles: nextSignedFiles }
}

export async function convertRenewistDocxReportToPdf(docx: Pick<SavedReportFile, 'path' | 'fileName' | 'checksum'>): Promise<SavedReportFile | null> {
  if (!getDeploymentFeatures().renewistPdfConversion) return null
  await fsp.mkdir(renewistReportPath, { recursive: true })
  const baseName = safeBaseName(docx.fileName || path.basename(docx.path))
  const outputPath = path.join(renewistReportPath, `${Date.now()}-${crypto.randomUUID()}-${baseName}.pdf`)
  const convertedByOffice = await convertDocxWithSoffice(docx.path, outputPath)
  if (!convertedByOffice) {
    console.warn(`Renewist DOCX to PDF conversion unavailable for ${docx.fileName || docx.path}. Install Microsoft Word or LibreOffice on the backend to preserve document layout.`)
  }
  if (!convertedByOffice) return null
  const stats = await fsp.stat(outputPath).catch(() => null)
  if (!stats?.size) return null
  const checksum = crypto.createHash('sha256').update(await fsp.readFile(outputPath)).digest('hex')
  return {
    path: outputPath,
    checksum,
    fileName: path.basename(outputPath),
    format: 'pdf',
    field: 'converted_from_docx',
  }
}

async function convertDocxReportToPdf(docx: SavedReportFile): Promise<SavedReportFile | null> {
  return convertRenewistDocxReportToPdf(docx)
}

async function storeRenewistSignedReports(input: ParsedReportRequest, reportId: string): Promise<ParsedReportRequest> {
  if (!input.signedFiles) return input
  const storedByPath = new Map<string, SavedReportFile>()
  const storeFile = async (file: SavedReportFile | undefined): Promise<SavedReportFile | undefined> => {
    if (!file?.path || file.storage) return file
    const existing = storedByPath.get(file.path)
    if (existing) return existing
    const contentType = file.format === 'pdf'
      ? 'application/pdf'
      : file.format === 'docx'
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/octet-stream'
    const storage = await storeObject({
      kind: 'provider-reports',
      keyParts: ['reports', reportId, 'renewist', String(input.report_version), sanitizeFileName(file.fileName || path.basename(file.path))],
      body: fs.createReadStream(file.path),
      contentType,
      localPath: file.path,
    }).catch((error) => {
      console.warn(`Unable to upload Renewist report file ${file.path} to S3:`, error instanceof Error ? error.message : error)
      return null
    })
    const stored = { ...file, storage }
    storedByPath.set(file.path, stored)
    return stored
  }
  const nextAll: SavedReportFile[] = []
  for (const file of input.signedFiles.all ?? []) {
    const stored = await storeFile(file)
    if (stored) nextAll.push(stored)
  }
  const pdf = await storeFile(input.signedFiles.pdf)
  const withoutLetterheadPdf = await storeFile(input.signedFiles.withoutLetterheadPdf)
  const docx = await storeFile(input.signedFiles.docx)
  const withoutLetterheadDocx = await storeFile(input.signedFiles.withoutLetterheadDocx)
  return {
    ...input,
    signedFiles: {
      pdf,
      withoutLetterheadPdf,
      docx,
      withoutLetterheadDocx,
      all: nextAll.length ? nextAll : [pdf, withoutLetterheadPdf, docx, withoutLetterheadDocx].filter((file): file is SavedReportFile => Boolean(file)),
    },
  }
}

async function cleanupRenewistLocalFiles(input: ParsedReportRequest) {
  const candidates = new Set<string>()
  if (input.reportFilePath) candidates.add(input.reportFilePath)
  for (const file of input.signedFiles?.all ?? []) if (file.path) candidates.add(file.path)
  if (input.signedFiles?.pdf?.path) candidates.add(input.signedFiles.pdf.path)
  if (input.signedFiles?.withoutLetterheadPdf?.path) candidates.add(input.signedFiles.withoutLetterheadPdf.path)
  if (input.signedFiles?.docx?.path) candidates.add(input.signedFiles.docx.path)
  await Promise.all([...candidates].map(async (candidate) => {
    try {
      const realUploadsRoot = fs.realpathSync(uploadsPath)
      const realCandidate = fs.realpathSync(path.resolve(candidate))
      if (!isPathInside(realUploadsRoot, realCandidate) || !fs.statSync(realCandidate).isFile()) return
      await fsp.rm(realCandidate, { force: true })
    } catch {
      // Missing files are already clean; other cleanup failures should not fail
      // the Renewist acknowledgement after the report has been stored.
    }
  }))
}

function isPathInside(parent: string, child: string) {
  const relative = path.relative(parent, child)
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
}



async function convertDocxWithSoffice(docxPath: string, outputPath: string) {
  const soffice = await findSoffice()
  if (!soffice) return false
  const outputDir = path.dirname(outputPath)
  await fsp.mkdir(outputDir, { recursive: true })
  await execFileAsync(soffice, [
    '--headless',
    '--convert-to',
    'pdf',
    '--outdir',
    outputDir,
    docxPath,
  ], { windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 * 4 })
  const generatedPath = path.join(outputDir, `${path.basename(docxPath, path.extname(docxPath))}.pdf`)
  if (generatedPath.toLowerCase() !== outputPath.toLowerCase()) {
    await fsp.rm(outputPath, { force: true }).catch(() => undefined)
    await fsp.rename(generatedPath, outputPath).catch(async () => {
      await fsp.copyFile(generatedPath, outputPath)
      await fsp.rm(generatedPath, { force: true }).catch(() => undefined)
    })
  }
  const stats = await fsp.stat(outputPath).catch(() => null)
  return Boolean(stats?.size)
}

async function findSoffice() {
  const candidates = [
    process.env.SOFFICE_PATH,
    process.env.LIBREOFFICE_PATH,
    'soffice.exe',
    'soffice',
    'libreoffice',
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  ].filter((value): value is string => Boolean(value))
  for (const candidate of candidates) {
    if (candidate.includes('\\') || candidate.includes('/')) {
      const exists = await fsp.access(candidate).then(() => true).catch(() => false)
      if (exists) return candidate
      continue
    }
    const ok = await execFileAsync(candidate, ['--version'], { windowsHide: true, timeout: 10000 }).then(() => true).catch(() => false)
    if (ok) return candidate
  }
  return null
}

async function extractDocxText(docxPath: string) {
  const xml = await readZipEntry(docxPath, 'word/document.xml').catch(() => '')
  const text = xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
  return text || 'Signed Renewist report document received.'
}

function readZipEntry(zipPath: string, entryName: string) {
  return new Promise<string>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openError, zipFile) => {
      if (openError || !zipFile) return reject(openError ?? new Error('Unable to open DOCX'))
      const chunks: Buffer[] = []
      zipFile.readEntry()
      zipFile.on('entry', (entry) => {
        if (entry.fileName !== entryName) return zipFile.readEntry()
        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            zipFile.close()
            return reject(streamError ?? new Error(`Unable to read ${entryName}`))
          }
          stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
          stream.on('error', (error) => {
            zipFile.close()
            reject(error)
          })
          stream.on('end', () => {
            zipFile.close()
            resolve(Buffer.concat(chunks).toString('utf8'))
          })
        })
      })
      zipFile.on('end', () => reject(new Error(`${entryName} not found in DOCX`)))
      zipFile.on('error', reject)
    })
  })
}

function safeBaseName(fileName: string) {
  return sanitizeFileName(path.basename(fileName, path.extname(fileName))).replace(/\.+$/, '') || `report-${Date.now()}`
}

async function writeSimpleTextPdf(input: { outputPath: string; title: string; lines: string[] }) {
  const wrappedLines = input.lines.flatMap((line) => wrapTextForPdf(line, 92))
  const pages = chunkForPdf(wrappedLines.length ? wrappedLines : ['Signed report document received.'], 48)
  const objects: string[] = []
  objects.push('<< /Type /Catalog /Pages 2 0 R >>')
  objects.push(`<< /Type /Pages /Kids [${pages.map((_, index) => `${3 + index * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`)
  for (const [index, lines] of pages.entries()) {
    const pageObject = 3 + index * 2
    const contentObject = pageObject + 1
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> /F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> >> >> /Contents ${contentObject} 0 R >>`)
    const content = [
      'BT',
      '/F2 16 Tf',
      '50 748 Td',
      `(${escapePdfText(index === 0 ? input.title : `${input.title} cont.`)}) Tj`,
      '0 -18 Td',
      '/F1 10 Tf',
      '14 TL',
      ...lines.map((line) => `(${escapePdfText(line)}) Tj T*`),
      'ET',
    ].join('\n')
    objects.push(`<< /Length ${Buffer.byteLength(content, 'binary')} >>\nstream\n${content}\nendstream`)
  }
  const header = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'
  const parts = [header]
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(parts.join(''), 'binary'))
    parts.push(`${index + 1} 0 obj\n${object}\nendobj\n`)
  }
  const xrefOffset = Buffer.byteLength(parts.join(''), 'binary')
  parts.push(`xref\n0 ${objects.length + 1}\n`)
  parts.push('0000000000 65535 f \n')
  for (let index = 1; index < offsets.length; index += 1) parts.push(`${String(offsets[index]).padStart(10, '0')} 00000 n \n`)
  parts.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`)
  await fsp.writeFile(input.outputPath, parts.join(''), 'binary')
}

function wrapTextForPdf(text: string, width: number) {
  const words = text.split(/\s+/).filter(Boolean)
  if (!words.length) return ['']
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (next.length > width && line) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

function chunkForPdf<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))
  return chunks
}

function escapePdfText(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[\r\n]+/g, ' ')
}

function signedReportFilesForJson(files: SignedReportFiles | undefined) {
  if (!files) return undefined
  return {
    pdf: files.pdf ? reportFileForJson(files.pdf) : undefined,
    withoutLetterheadPdf: files.withoutLetterheadPdf ? reportFileForJson(files.withoutLetterheadPdf) : undefined,
    docx: files.docx ? reportFileForJson(files.docx) : undefined,
    withoutLetterheadDocx: files.withoutLetterheadDocx ? reportFileForJson(files.withoutLetterheadDocx) : undefined,
    all: (files.all ?? []).map(reportFileForJson),
  }
}

function reportFileForJson(file: SavedReportFile) {
  return {
    path: file.path,
    checksum: file.checksum,
    name: file.fileName,
    format: file.format,
    field: file.field,
    storage: file.storage,
  }
}

function inferReportFileFormat(field: string, fileName: string, mimeType?: string, hint?: string): SavedReportFile['format'] {
  const value = `${field} ${fileName} ${mimeType ?? ''} ${hint ?? ''}`.toLowerCase()
  if (value.includes('docx') || value.includes('wordprocessingml') || value.includes('msword')) return 'docx'
  if (value.includes('pdf')) return 'pdf'
  return 'other'
}

function isPrimaryReportField(field: string) {
  return ['report_file', 'report', 'pdf', 'pdf_report', 'signed_pdf', 'signed_report_pdf', 'docx', 'docx_report', 'signed_docx', 'signed_report_docx', 'word_report', 'report_wlh', 'report_without_letterhead', 'pdf_report_without_letterhead', 'without_letterhead_pdf', 'signed_pdf_without_letterhead'].includes(field)
}

function isPdfReportField(field: string) {
  return ['report_file', 'report', 'pdf', 'pdf_report', 'signed_pdf', 'signed_report_pdf'].includes(field)
}

function isWithoutLetterheadReportField(field: string) {
  return ['report_wlh', 'report_without_letterhead', 'pdf_report_without_letterhead', 'without_letterhead_pdf', 'signed_pdf_without_letterhead'].includes(field)
}

function isDocxReportField(field: string) {
  return ['docx', 'docx_report', 'signed_docx', 'signed_report_docx', 'word_report'].includes(field)
}

function sendError(res: Response, status: number, code: string, message: string, retryable: boolean, jobId?: string) {
  return res.status(status).json({ error: { code, message, retryable, job_id: jobId, timestamp: new Date().toISOString() } })
}

function header(req: Request, name: string) {
  const value = req.headers[name] ?? req.headers[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

function hashJson(value: unknown) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function parseMetadataJson(value: string | undefined) {
  if (!value) return undefined
  try {
    return JSON.parse(value) as unknown
  } catch {
    return { raw: value }
  }
}

function toPrismaJsonObject(value: Record<string, unknown>): Prisma.InputJsonObject {
  const normalized = normalizeJson(value)
  return normalized && typeof normalized === 'object' && !Array.isArray(normalized)
    ? normalized as Prisma.InputJsonObject
    : {}
}

function toPrismaJsonValue(value: unknown): Prisma.InputJsonValue | Prisma.NullTypes.JsonNull {
  const normalized = normalizeJson(value)
  return normalized === null ? Prisma.JsonNull : normalized as Prisma.InputJsonValue
}

function normalizeJson(value: unknown): unknown {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) return null
  return JSON.parse(serialized) as unknown
}

function sanitizeFileName(fileName: string) {
  return path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_') || `report-${Date.now()}.bin`
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
