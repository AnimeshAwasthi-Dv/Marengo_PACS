import { sendStudyBundle, StudyArchiveError, type BundleStudySource } from './studyBundle'
import { registerWorklistRoutes } from './routers/worklist.router'
import { registerReportRoutes } from './routers/reports.router'
import { activeCallBookingStatuses, reportClientSelect, reportListOmit, reportRadiologistSelect } from './queries/reports.queries'
import { withReportSummaries } from './services/reports.service'
import { formatBridgeStudyForAdmin, formatBridgeStudyForClient } from './lib/bridgeStudyFormat'
import { followUpStatusFilter } from './followUps'
import { technicalAlertsRouter, startTechnicalMonitor } from './technicalAlerts'
import { ensureMarengoServices } from './marengoServices'
import { resolveArchivePath } from './viewer/archivePaths'
import QRCode from 'qrcode'
import { preferredCallWindows, normalizeCallPhone } from './callScheduling'
import { externalViewerOrigin } from './viewer/externalViewer';
import { classifyBreastXrayModalities } from '../src/mammography';
import { holdSpecialXrayForManualSubmission } from '../src/specialXray';
import { nonOverlapping } from './runtime/tasks';
import { findExecutable } from './platform/tools';
import { registerExternalViewerRoutes } from './viewer/routes';
import bcrypt from 'bcryptjs'
import { scopedShareToken, scopedShareReportId, verifyShareScope } from './shareScope'
import { workspacePermissions, assignableCenterRoles } from '../src/workspacePermissions'
import { workspaceRouter } from './workspaceRouter'
import { adminConsoleRouter } from './adminConsoleRouter'
import { requireWorkspaceCapability, workspaceAccess } from './workspaceAccess'
import cors from 'cors'
import compression from 'compression'
import crypto from 'node:crypto'
import { spawn, execFile } from 'node:child_process'
import dotenv from 'dotenv'
import express from 'express'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import helmet from 'helmet'
import morgan from 'morgan'
import net from 'node:net'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import Busboy from 'busboy'



import type { Request, Response } from 'express'
import yauzl from 'yauzl'
import yazl from 'yazl'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { login, requireAuth, requireClientUser, requireProviderAdmin, requireProviderStaff, requireRadiologist, requireSuperAdmin } from './auth'
import { registerAdminOrganizationRoutes } from './adminOrganization'
import { billingRouter, clientBillingRouter, generateDueMonthlyInvoices, getAdminBillingSnapshot, getClientBillingSnapshot, handleRazorpayWebhook, recordBillingEvent } from './billing'
import { allocatePacsEndpoint, isTeleradiologyWorkflow, normalizeAeTitle, validatePacsProcessing } from './dicom'
import { prisma } from './db'
import { getDeploymentFeatures, publicDeploymentFeatures } from './deploymentProfile'
import { renderHtmlReportPdf, sendApprovedReportToPacs } from './pacsSender'
import { convertRenewistDocxReportToPdf, renewistIntegrationRouter } from './renewistIntegration'
import { notificationsRouter } from './notifications'
import { operationsRouter } from './operations'
import { createDomainNotification } from './notificationService'
import { managementRouter } from './management'
import { RenewistAdapter } from './renewistAdapter'
import { enqueueTelegramStudy, startTelegramWorker } from './telegram'
import { recordStudyAcknowledgement } from './studyTracking'
import type { ProviderStudySubmission } from './providerAdapters'
import { ProviderSubmissionError } from './providerAdapters'
import { redactExchange } from './telegramPolicy'
import { buildRadiologyReport } from './reportBuilder'
import { findStoredStudyObject, readStoredObject, storeObject, uploadReportHtmlToS3, type StorageKind } from './reportStorage'
import { bridgeStudyS3KeyCandidates, studyViewerStorageKind } from './lib/studyStorage'
import { closeRedis, invalidateDashboardCaches, redisGetJson, redisNamespace, redisPing, redisSetJson } from './redisCache'
import { supportRouter } from './support'
import { enqueueCallBookingNotification, enqueueStudyStatusNotification, startWhatsappOutboxWorker, whatsappRouter } from './whatsapp'
import { aiServiceTypeForServiceName, aiServiceTypeForServiceType, extractDicomStudyMetadata, inferBridgeServiceType, prepareRenewistStudyZip, saveIncomingUpload, serviceMatchesBridgeInference, serviceNameForType, serviceNames, serviceTypeForServiceName, zipDirectory, type DicomStudyMetadata, type ServiceType } from './uploadPipeline'

dotenv.config({
  path: process.env.LOAD_STORAGE_ENV === 'true' ? ['.env', '.env.storage'] : ['.env'],
  override: false,
})

const app = express()
app.set('json replacer', (_key: string, value: unknown) => typeof value === 'bigint' ? value.toString() : value)
app.set('etag', false)
const port = Number(process.env.PORT ?? 4000)
const host = process.env.HOST ?? '127.0.0.1'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const distPath = path.resolve(__dirname, '..', 'dist')
const uploadsPath = path.resolve(__dirname, '..', 'uploads')
const appUploadPath = path.join(uploadsPath, 'application-jobs')
const dicomInboundPath = path.join(uploadsPath, 'dicom-inbound')
const receiverProcesses = new Map<number, ReturnType<typeof spawn>>()
const externalViewerImports = new Map<string, { archivePath: string; importId: string; status: string; viewerUrl?: string; expiresAt: number }>()


const reportPublicShareTtlMs = 5 * 24 * 60 * 60 * 1000
let pacsReturnRecoveryRunning = false
let outboundSubmissionRecoveryRunning = false
let renewistSubmissionTail: Promise<unknown> = Promise.resolve()
const queuedRenewistJobIds = new Set<string>()
const portalUserSelect = { id: true, userId: true, email: true, name: true, role: true, portalRole: true, clientId: true, providerCode: true, active: true, createdAt: true, updatedAt: true } as const
const clientPortalRoleSchema = z.enum(['FRONT_DESK', 'TECHNICIAN', 'MANAGER', 'IT_TEAM'])
type ViewerImportStatus = { id: string; status: string; statusUrl?: string; expiresAt?: number }
type ViewerSessionResponse = { viewerUrl?: string; expiresAt?: number }

function viewerServiceConfig() {
  const viewerBaseUrl = (process.env.DICOM_VIEWER_API_URL ?? '').trim()
  const apiKey = (process.env.DICOM_VIEWER_SERVICE_API_KEY ?? '').trim()
  if (!viewerBaseUrl || !apiKey) throw new Error('DICOM viewer service credentials are not configured')
  return { baseUrl: viewerBaseUrl.replace(/\/+$/g, ''), apiKey }
}


function viewerModality(kind: ReturnType<typeof studyViewerStorageKind>) {
  if (kind === 'ct-studies') return 'CT'
  if (kind === 'mri-studies') return 'MRI'
  if (kind === 'mammography-studies') return 'MAMMOGRAPHY'
  return 'XRAY'
}

async function viewerServiceRequest<T>(pathName: string, init: RequestInit = {}): Promise<T> {
  const config = viewerServiceConfig()
  const response = await fetch(new URL(pathName, config.baseUrl), {
    ...init,
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', ...init.headers },
    signal: init.signal ?? AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`DICOM viewer service returned ${response.status}: ${await response.text()}`)
  return response.json() as Promise<T>
}

async function waitForViewerImport(importId: string) {
  const deadline = Date.now() + 25_000
  let current: ViewerImportStatus | null = null
  while (Date.now() < deadline) {
    current = await viewerServiceRequest<ViewerImportStatus>(`/api/v1/studies/${encodeURIComponent(importId)}`)
    if (current.status === 'completed') return current
    if (current.status === 'failed') throw new Error('DICOM viewer import failed')
    await new Promise(resolve => setTimeout(resolve, 1500))
  }
  return current
}

async function createBridgeStudyViewerUrl(studyId: string, _req: Request) {
  const study = await prisma.availableBridgeStudy.findUnique({
    where: { id: studyId },
    select: {
      id: true,
      publicStudyId: true,
      studyInstanceUid: true,
      archivePath: true,
      archiveName: true,
      modalities: true,
      processingJob: { select: { id: true, uploadName: true, upstreamStatus: true } },
    },
  })
  if (!study) return null
  const storedStudy = getOriginalStudyStorage(study.processingJob?.upstreamStatus)
  const archivePath = await resolveSafeBundleFile(study.archivePath)
  const kind = studyViewerStorageKind(study.modalities)
  const discoveredStudy = storedStudy?.key ? null : await findStoredStudyObject({
    kinds: [kind, 'original-studies', 'cleaned-dicoms', 'ct-studies', 'mri-studies', 'xray-studies', 'mammography-studies'],
    keys: bridgeStudyS3KeyCandidates(study),
  }).catch((error) => {
    console.warn(`Unable to search S3 for bridge study ${study.id}:`, error instanceof Error ? error.message : error)
    return null
  })
  if (!storedStudy?.key && !discoveredStudy?.key && !archivePath) return null
  const cached = externalViewerImports.get(study.id)
  const sourceIdentity = storedStudy ? `${storedStudy.bucket}/${storedStudy.key}` : discoveredStudy ? `${discoveredStudy.bucket}/${discoveredStudy.key}` : archivePath ?? ''
  if (cached?.archivePath === sourceIdentity && cached.status === 'completed' && cached.viewerUrl && cached.expiresAt > Date.now() + 60_000) return cached.viewerUrl
  let importId = cached?.archivePath === sourceIdentity ? cached.importId : ''
  if (!importId) {
    const storage = storedStudy?.key || discoveredStudy?.key ? { key: storedStudy?.key ?? discoveredStudy!.key, bucket: storedStudy?.bucket ?? discoveredStudy!.bucket } : await storeObject({
      kind,
      keyParts: ['viewer-imports', study.id, study.archiveName || path.basename(archivePath!)],
      body: fsSync.createReadStream(archivePath!),
      contentType: 'application/zip',
      localPath: archivePath!,
    })
    if (!storage?.key) throw new Error('Unable to upload the study ZIP for DICOM viewer import')
    const imported = await viewerServiceRequest<ViewerImportStatus>('/api/v1/studies', {
      method: 'POST',
      // The viewer's import API is strict: only { zipKey, modality }, modality in CT | MRI | XRAY | MAMMOGRAPHY.
      // It picks the S3 bucket and prefix from the modality itself.
      body: JSON.stringify({ zipKey: storage.key, modality: viewerModality(kind) }),
    })
    importId = imported.id
    externalViewerImports.set(study.id, { archivePath: sourceIdentity, importId, status: imported.status, expiresAt: Date.now() + 60 * 60 * 1000 })
  }
  const ready = await waitForViewerImport(importId)
  if (ready?.status !== 'completed') throw new Error('DICOM viewer is still indexing this study. Please try again shortly.')
  const session = await viewerServiceRequest<ViewerSessionResponse>('/api/v1/sessions', {
    method: 'POST',
    body: JSON.stringify({ studyId: importId }),
  })
  if (!session.viewerUrl) throw new Error('DICOM viewer service did not return a viewer URL')
  externalViewerImports.set(study.id, { archivePath: sourceIdentity, importId, status: 'completed', viewerUrl: session.viewerUrl, expiresAt: session.expiresAt ?? Date.now() + 55 * 60 * 1000 })
  return session.viewerUrl
}


function userIdForEmail(email: string) {
  const prefix = email.split('@')[0]!.toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 40) || 'user'
  return `${prefix}-${crypto.createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 6)}`
}

function toPrismaJsonObject(value: Record<string, unknown>): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item)) as Prisma.InputJsonObject
}

type ReceiverStartResult = {
  receivingPort: number
  aeTitle: string
  firewallRule: 'created' | 'existing'
  listener: 'started' | 'already-running' | 'already-listening'
}

function requireDeploymentFeature(feature: 'billing' | 'calling' | 'notifications' | 'support' | 'whatsapp') {
  return (_req: Request, res: Response, next: express.NextFunction) => {
    if (!getDeploymentFeatures()[feature]) return res.status(404).json({ message: 'Feature is disabled for this deployment' })
    next()
  }
}

app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true }))
app.use(compression({ threshold: 1024 }))
app.use('/api', (req, res, next) => {
  if (process.env.DATABASE_READ_ONLY === 'true' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
    && !(req.method === 'POST' && req.path === '/auth/login')) return res.status(403).json({ message: 'Production database is read-only. Changes are disabled.' })
  next()
})
// 'wasm-unsafe-eval' lets the QuickView worker compile its WebAssembly image decoders; it does not allow JavaScript eval.
app.use(helmet({ contentSecurityPolicy: { directives: { frameSrc: ["'self'", 'blob:', ...(externalViewerOrigin() ? [externalViewerOrigin()!] : [])], scriptSrc: ["'self'", "'wasm-unsafe-eval'"] } } }))
app.post('/api/v1/billing/razorpay/webhook', requireDeploymentFeature('billing'), express.raw({ type: 'application/json', limit: '2mb' }), handleRazorpayWebhook)
app.use(express.json({
  limit: '12mb',
  verify: (req, _res, buffer) => {
    ;(req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buffer)
  },
}))
app.use(morgan(process.env.NODE_ENV === 'production' ? ':method :url :status :response-time ms' : 'dev', { skip: req => req.path === '/api/health' }))
app.use('/api/client/study-sync', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
  next()
})
app.use('/api', (req, res, next) => {
  const startedAt = Date.now()
  res.on('finish', () => {
    if (process.env.DATABASE_READ_ONLY === 'true') return
    if (req.path === '/health') return
    if (req.method === 'GET' && /\/dashboard$/.test(req.path)) return
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && res.statusCode < 400) void invalidateDashboardCaches()
    const user = req.user
    void prisma.auditLog.create({
      data: {
        clientId: user?.clientId ?? null,
        actorUserId: user?.sub ?? null,
        action: `PORTAL_${req.method}_${req.path.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').toUpperCase() || 'ROOT'}`,
        metadata: {
          method: req.method,
          path: req.originalUrl,
          statusCode: res.statusCode,
          durationMs: Date.now() - startedAt,
          role: user?.role ?? null,
          providerCode: user?.providerCode ?? null,
        },
        ipAddress: req.ip,
      },
    }).catch((error) => console.error('Portal audit log failed', error))
  })
  next()
})
app.use('/uploads', (_req, res) => res.status(404).json({ message: 'File not found' }))







app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'DecXpert PACS/API Portal API' })
})

app.get('/api/health/redis', async (_req, res) => {
  const ok = await redisPing()
  res.status(ok ? 200 : 503).json({ ok, service: 'redis-cache' })
})

app.post('/api/auth/login', login)

registerAdminOrganizationRoutes(app)

app.use('/api/v1/integrations/renewist', renewistIntegrationRouter)
app.use('/api/v1/teleradiology/dectrocel', renewistIntegrationRouter)
app.use('/api/integrations/renewist', renewistIntegrationRouter)
app.use('/api/teleradiology/dectrocel', renewistIntegrationRouter)
app.use('/api/v1/billing', requireDeploymentFeature('billing'), billingRouter)
app.use('/api/v1/client', requireAuth, requireWorkspaceCapability('billing'), requireDeploymentFeature('billing'), clientBillingRouter)
app.use('/api/workspace', workspaceRouter)
app.use('/api/technical-alerts', technicalAlertsRouter)
app.use('/api/admin/console', adminConsoleRouter)
app.use('/api/v1/whatsapp', requireDeploymentFeature('whatsapp'), whatsappRouter)
app.use('/api/v1/support', requireDeploymentFeature('support'), supportRouter)
app.use('/api/notifications', requireDeploymentFeature('notifications'), notificationsRouter)
app.use('/api/operations', requireDeploymentFeature('calling'), operationsRouter)
app.use('/api/management', managementRouter)

app.get('/api/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.sub },
    select: { ...portalUserSelect, client: true },
  })
  res.json(user ? { ...user, deploymentFeatures: publicDeploymentFeatures() } : null)
})

const patientInputSchema = z.object({
  patientIdentifier: z.string().trim().min(1).max(128), name: z.string().trim().min(1).max(200),
  dateOfBirth: z.string().datetime().or(z.literal('')).optional(), age: z.string().trim().max(32).optional(),
  gender: z.string().trim().max(32).optional(), sex: z.string().trim().max(32).optional(), phone: z.string().trim().max(64).optional(),
  email: z.string().email().or(z.literal('')).optional(), address: z.string().trim().max(500).optional(),
  clinicalHistory: z.string().trim().max(10000).optional(), medicalHistory: z.string().trim().max(10000).optional(), followUpInfo: z.string().trim().max(10000).optional(),
})

async function accessibleClientIds(req: express.Request) {
  if (req.user!.role === 'SUPER_ADMIN') return null
  if (req.user!.role === 'CLIENT_USER' && req.user!.clientId) {
    const client = await prisma.client.findUnique({ where: { id: req.user!.clientId }, select: { kind: true } })
    if (client?.kind === 'GROUP') return (await prisma.client.findMany({ where: { OR: [{ id: req.user!.clientId }, { parentClientId: req.user!.clientId }] }, select: { id: true } })).map((item) => item.id)
    return [req.user!.clientId]
  }
  if (req.user!.role === 'RADIOLOGIST') {
    const profile = await prisma.radiologistProfile.findUnique({ where: { userId: req.user!.sub }, include: { client: true } })
    if (profile?.client?.kind === 'GROUP') return (await prisma.client.findMany({ where: { parentClientId: profile.clientId! }, select: { id: true } })).map((item) => item.id)
    if (profile?.clientId) return [profile.clientId]
    if (profile?.providerCode) return (await prisma.providerJobMapping.findMany({ where: { metadata: { path: ['providerCode'], equals: profile.providerCode } }, select: { reportReviewId: true } })).flatMap(() => [])
  }
  return []
}

function requireWorkspaceAction(action: 'upload' | 'submit' | 'attach' | 'share' | 'schedule') {
  return async (req: Request, res: Response, next: express.NextFunction) => {
    const group = req.user?.clientId ? (await prisma.client.findUnique({ where: { id: req.user.clientId }, select: { kind: true } }))?.kind === 'GROUP' : false
    if (!req.user || !workspacePermissions(req.user.role, req.user.portalRole, group)[action]) return res.status(403).json({ message: 'Your role does not permit this action' })
    next()
  }
}

async function workspaceStudyScope(req: Request) {
  if (!req.user || !['SUPER_ADMIN', 'CLIENT_USER'].includes(req.user.role)) {
    throw Object.assign(new Error('Use the study workspace assigned to your role'), { status: 403 })
  }
  const ids = await accessibleClientIds(req)
  return ids === null ? {} : { clientId: { in: ids } }
}

async function requirePatientClient(req: express.Request, requestedClientId?: string) {
  const ids = await accessibleClientIds(req)
  if (ids === null) return requestedClientId
  if (requestedClientId && ids.includes(requestedClientId)) return requestedClientId
  if (!requestedClientId && ids.length === 1) return ids[0]
  return undefined
}

app.get('/api/patients', requireAuth, async (req, res) => {
  const ids = await accessibleClientIds(req)
  const query = String(req.query.q ?? '').trim().slice(0, 100)
  const clientId = String(req.query.clientId ?? '').trim()
  if (ids !== null && clientId && !ids.includes(clientId)) return res.status(403).json({ message: 'Patient access denied' })
  const where = {
    ...(ids === null ? (clientId ? { clientId } : {}) : { clientId: { in: ids } }),
    ...(query ? { OR: [{ patientIdentifier: { contains: query, mode: 'insensitive' as const } }, { name: { contains: query, mode: 'insensitive' as const } }, { age: { contains: query, mode: 'insensitive' as const } }] } : {}),
  }
  const [items, total] = await Promise.all([
    prisma.patient.findMany({ where, include: { client: { select: { id: true, name: true, code: true } }, _count: { select: { studies: true, reports: true, followUps: true, archivedStudies: true } } }, orderBy: { updatedAt: 'desc' }, take: Math.min(Number(req.query.limit) || 50, 100) }),
    prisma.patient.count({ where }),
  ])
  res.json({ items, total })
})

app.post('/api/patients', requireAuth, async (req, res) => {
  if (!['CLIENT_USER', 'SUPER_ADMIN'].includes(req.user!.role)) return res.status(403).json({ message: 'Patient edit permission required' })
  const body = patientInputSchema.extend({ clientId: z.string().optional() }).parse(req.body)
  const clientId = await requirePatientClient(req, body.clientId)
  if (!clientId) return res.status(403).json({ message: 'A permitted center is required' })
  const patient = await prisma.patient.create({ data: { ...body, clientId, dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null, email: body.email || null } })
  await prisma.auditLog.create({ data: { clientId, actorUserId: req.user!.sub, action: 'PATIENT_CREATED', metadata: { patientProfileId: patient.id } } })
  res.status(201).json(patient)
})

app.get('/api/patients/:patientId', requireAuth, async (req, res) => {
  const patient = await prisma.patient.findUnique({
    where: { id: String(req.params.patientId) },
    include: {
      client: { select: { id: true, name: true, code: true } },
      studies: { include: { reportReviews: { include: { radiologist: true }, orderBy: { createdAt: 'desc' } } }, orderBy: { createdAt: 'desc' } },
      reports: { include: { radiologist: true }, orderBy: { createdAt: 'desc' } },
      processingJobs: {
        include: {
          bridgeStudy: { include: { attachments: { orderBy: { createdAt: 'asc' } } } },
        },
        orderBy: { createdAt: 'desc' },
      },
      bridgeStudies: { include: { attachments: { orderBy: { createdAt: 'asc' } } }, orderBy: { studyDate: 'desc' } },
      archivedStudies: { include: { files: { orderBy: { createdAt: 'asc' } } }, orderBy: [{ studyDate: 'desc' }, { createdAt: 'desc' }] },
      followUps: { include: { report: true }, orderBy: { followUpDate: 'desc' } },
    },
  })
  const ids = await accessibleClientIds(req)
  if (!patient || (ids !== null && !ids.includes(patient.clientId))) return res.status(404).json({ message: 'Patient not found' })
  res.json(patient)
})

app.post('/api/patients/:patientId/archive-studies', requireAuth, requireClientUser, async (req, res) => {
  const patient = await prisma.patient.findFirst({ where: { id: String(req.params.patientId), clientId: req.user!.clientId! } })
  if (!patient) return res.status(404).json({ message: 'Patient not found for this center' })
  const archiveId = `pas_${crypto.randomUUID().replaceAll('-', '')}`
  const folder = path.join(uploadsPath, 'patient-study-archives', archiveId)
  try {
    const upload = await parsePatientStudyArchive(req, folder)
    const fields = z.object({
      studyDescription: z.string().trim().min(1).max(500), modality: z.string().trim().max(64).optional(),
      studyInstanceUid: z.string().trim().max(200).optional(), accessionNumber: z.string().trim().max(128).optional(),
      studyDate: z.string().optional(), bodyRegion: z.string().trim().max(128).optional(), clinicalIndication: z.string().trim().max(10000).optional(),
      institutionName: z.string().trim().max(300).optional(), referringPhysician: z.string().trim().max(300).optional(),
      seriesCount: z.coerce.number().int().nonnegative().optional(), instanceCount: z.coerce.number().int().nonnegative().optional(),
    }).parse(upload.fields)
    if (!upload.files.some((file) => file.role === 'STUDY')) throw new Error('At least one study file is required')
    const archive = await prisma.patientStudyArchive.create({
      data: {
        id: archiveId, clientId: patient.clientId, patientId: patient.id, createdByUserId: req.user!.sub,
        ...fields, studyDate: fields.studyDate ? new Date(`${fields.studyDate}T00:00:00.000Z`) : null,
        files: { create: upload.files },
      },
      include: { files: true },
    })
    await prisma.auditLog.create({ data: { clientId: patient.clientId, actorUserId: req.user!.sub, action: 'PATIENT_HISTORICAL_STUDY_ARCHIVED', metadata: { patientProfileId: patient.id, archiveId: archive.id, fileCount: archive.files.length } } })
    res.status(201).json(archive)
  } catch (error) {
    await fs.rm(folder, { recursive: true, force: true }).catch(() => undefined)
    res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to archive study' })
  }
})

app.get('/api/patient-study-archives/:archiveId/files/:fileId', requireAuth, async (req, res) => {
  const file = await prisma.patientStudyArchiveFile.findFirst({ where: { id: String(req.params.fileId), archiveId: String(req.params.archiveId) }, include: { archive: true } })
  const ids = await accessibleClientIds(req)
  if (!file || (ids !== null && !ids.includes(file.archive.clientId))) return res.status(404).json({ message: 'Archived file not found' })
  if (!isPathInside(uploadsPath, file.filePath) || !fsSync.existsSync(file.filePath)) return res.status(404).json({ message: 'Archived file is unavailable' })
  res.type(file.mimeType || 'application/octet-stream')
  res.setHeader('Content-Disposition', `inline; filename="${sanitizeFileName(file.originalName)}"`)
  res.sendFile(file.filePath)
})

app.get('/api/patient-study-archives/:archiveId/files/:fileId/preview', requireAuth, async (req, res) => {
  const file = await prisma.patientStudyArchiveFile.findFirst({ where: { id: String(req.params.fileId), archiveId: String(req.params.archiveId) }, include: { archive: true } })
  const ids = await accessibleClientIds(req)
  if (!file || (ids !== null && !ids.includes(file.archive.clientId))) return res.status(404).json({ message: 'Archived file not found' })
  if (!isPathInside(uploadsPath, file.filePath) || !fsSync.existsSync(file.filePath)) return res.status(404).json({ message: 'Archived file is unavailable' })
  if (file.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || file.originalName.toLowerCase().endsWith('.docx')) {
    const paragraphs = await extractDocxParagraphs(file.filePath)
    res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><style>body{font:15px/1.55 Arial,sans-serif;color:#172033;margin:0;padding:28px}h1{font-size:22px}p{margin:0 0 12px;white-space:pre-wrap}</style></head><body><h1>${escapeHtml(path.basename(file.originalName, path.extname(file.originalName)))}</h1>${paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}</body></html>`)
    return
  }
  res.type(file.mimeType || 'application/octet-stream')
  res.setHeader('Content-Disposition', `inline; filename="${sanitizeFileName(file.originalName)}"`)
  res.sendFile(file.filePath)
})







app.patch('/api/patients/:patientId', requireAuth, async (req, res) => {
  if (!['CLIENT_USER', 'SUPER_ADMIN'].includes(req.user!.role)) return res.status(403).json({ message: 'Patient edit permission required' })
  const existing = await prisma.patient.findUnique({ where: { id: String(req.params.patientId) } })
  const ids = await accessibleClientIds(req)
  if (!existing || (ids !== null && !ids.includes(existing.clientId))) return res.status(404).json({ message: 'Patient not found' })
  const body = patientInputSchema.partial().parse(req.body)
  const patient = await prisma.patient.update({ where: { id: existing.id }, data: { ...body, dateOfBirth: body.dateOfBirth === undefined ? undefined : body.dateOfBirth ? new Date(body.dateOfBirth) : null, email: body.email === undefined ? undefined : body.email || null } })
  await prisma.auditLog.create({ data: { clientId: existing.clientId, actorUserId: req.user!.sub, action: 'PATIENT_UPDATED', metadata: { patientProfileId: patient.id, fields: Object.keys(body) } } })
  res.json(patient)
})

app.patch('/api/studies/:studyId/patient', requireAuth, async (req, res) => {
  if (!['CLIENT_USER', 'SUPER_ADMIN'].includes(req.user!.role)) return res.status(403).json({ message: 'Study assignment permission required' })
  const body = z.object({ patientId: z.string().min(1) }).parse(req.body)
  const patient = await prisma.patient.findUnique({ where: { id: body.patientId } })
  const ids = await accessibleClientIds(req)
  if (!patient || (ids !== null && !ids.includes(patient.clientId))) return res.status(404).json({ message: 'Patient not found' })
  const bridge = await prisma.availableBridgeStudy.findUnique({ where: { id: String(req.params.studyId) } })
  if (bridge) {
    if (bridge.clientId !== patient.clientId) return res.status(400).json({ message: 'Study and patient must belong to the same center' })
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.availableBridgeStudy.update({ where: { id: bridge.id }, data: { patientProfileId: patient.id } })
      if (bridge.processingJobId) await tx.processingJob.update({ where: { id: bridge.processingJobId }, data: { patientId: patient.id } })
      return result
    })
    return res.json(updated)
  }
  const study = await prisma.study.findUnique({ where: { id: String(req.params.studyId) } })
  if (!study || study.clientId !== patient.clientId) return res.status(404).json({ message: 'Study not found' })
  res.json(await prisma.study.update({ where: { id: study.id }, data: { patientId: patient.id, reportReviews: { updateMany: { where: {}, data: { patientProfileId: patient.id } } } } }))
})

const followUpSchema = z.object({ patientId: z.string().min(1), reportId: z.string().optional(), required: z.boolean().default(true), followUpDate: z.string().datetime(), reason: z.string().trim().min(1).max(1000), status: z.enum(['PENDING', 'SCHEDULED', 'COMPLETED', 'OVERDUE', 'CANCELLED']).default('PENDING'), notes: z.string().max(10000).optional(), assignedUserId: z.string().optional() })
app.get('/api/follow-ups', requireAuth, async (req, res) => {
  const ids = await accessibleClientIds(req)
  const status = String(req.query.status ?? '').toUpperCase()
  const now = new Date()
  const where = { ...(ids === null ? {} : { clientId: { in: ids } }), ...followUpStatusFilter(status, now) }
  const items = await prisma.patientFollowUp.findMany({ where, include: { patient: true, client: { select: { id: true, name: true, code: true } }, report: true }, orderBy: { followUpDate: 'asc' }, take: 500 })
  res.json(items.map((item) => ['PENDING', 'SCHEDULED'].includes(item.status) && item.followUpDate < now ? { ...item, status: 'OVERDUE' } : item))
})
app.post('/api/follow-ups', requireAuth, async (req, res) => {
  if (!['CLIENT_USER', 'RADIOLOGIST', 'SUPER_ADMIN'].includes(req.user!.role)) return res.status(403).json({ message: 'Follow-up permission required' })
  const body = followUpSchema.parse(req.body); const patient = await prisma.patient.findUnique({ where: { id: body.patientId } }); const ids = await accessibleClientIds(req)
  if (!patient || (ids !== null && !ids.includes(patient.clientId))) return res.status(404).json({ message: 'Patient not found' })
  const item = await prisma.patientFollowUp.create({ data: { ...body, clientId: patient.clientId, followUpDate: new Date(body.followUpDate) } })
  await prisma.auditLog.create({ data: { clientId: patient.clientId, actorUserId: req.user!.sub, action: 'PATIENT_FOLLOW_UP_CREATED', metadata: { followUpId: item.id, patientProfileId: patient.id } } })
  res.status(201).json(item)
})
app.patch('/api/follow-ups/:id', requireAuth, async (req, res) => {
  const existing = await prisma.patientFollowUp.findUnique({ where: { id: String(req.params.id) } }); const ids = await accessibleClientIds(req)
  if (!existing || (ids !== null && !ids.includes(existing.clientId))) return res.status(404).json({ message: 'Follow-up not found' })
  const body = followUpSchema.omit({ patientId: true }).partial().parse(req.body)
  res.json(await prisma.patientFollowUp.update({ where: { id: existing.id }, data: { ...body, followUpDate: body.followUpDate ? new Date(body.followUpDate) : undefined } }))
})

const feedbackTypeSchema = z.enum(['GENERAL', 'INCORRECT_FINDING', 'MISSING_FINDING', 'INCORRECT_SEVERITY_URGENCY', 'INCORRECT_TERMINOLOGY', 'FORMATTING_REPORTING_ISSUE', 'OTHER'])
app.post('/api/radiologist/reports/:reportId/feedback', requireAuth, requireRadiologist, async (req, res) => {
  const body = z.object({ feedbackType: feedbackTypeSchema, comment: z.string().trim().min(1).max(10000), overallRating: z.number().int().min(1).max(5).optional(), accuracyAssessment: z.enum(['ACCURATE', 'PARTIALLY_ACCURATE', 'INACCURATE', 'NOT_ASSESSABLE']).optional(), falsePositive: z.boolean().default(false), falseNegative: z.boolean().default(false), missedFinding: z.boolean().default(false), incorrectFinding: z.boolean().default(false), severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(), categories: z.array(z.string().trim().min(1).max(80)).max(20).default([]) }).parse(req.body)
  const report = await prisma.reportReview.findUnique({ where: { id: String(req.params.reportId) } }); const profile = await prisma.radiologistProfile.findUniqueOrThrow({ where: { userId: req.user!.sub } })
  if (!report || !(await canRadiologistAccessReport(profile, report))) return res.status(404).json({ message: 'Report not found' })
  const latest = await prisma.radiologistFeedback.findFirst({ where: { reportId: report.id, radiologistUserId: req.user!.sub }, orderBy: { submissionVersion: 'desc' }, select: { submissionVersion: true } })
  const feedback = await prisma.radiologistFeedback.create({ data: { clientId: report.clientId, patientId: report.patientProfileId, studyId: report.studyId, reportId: report.id, radiologistUserId: req.user!.sub, ...body, submissionVersion: (latest?.submissionVersion ?? 0) + 1 } })
  await prisma.notificationOutbox.create({ data: { eventType: 'RADIOLOGIST_FEEDBACK_CREATED', aggregateType: 'RadiologistFeedback', aggregateId: feedback.id, idempotencyKey: `feedback:${feedback.id}:created`, payload: { feedbackId: feedback.id, reportId: report.id, clientId: report.clientId } } })
  await prisma.auditLog.create({ data: { clientId: report.clientId, actorUserId: req.user!.sub, action: 'RADIOLOGIST_FEEDBACK_CREATED', metadata: { feedbackId: feedback.id, reportId: report.id } } })
  await createDomainNotification(prisma, { eventType: 'AI_REPORT_FEEDBACK_SUBMITTED', aggregateType: 'RadiologistFeedback', aggregateId: feedback.id, idempotencyKey: `domain:feedback:${feedback.id}:created`, clientId: report.clientId, patientRef: report.patientId, status: feedback.status, title: 'New AI report feedback', message: `AI report feedback submitted for report ${report.id}.`, category: 'AI_FEEDBACK', organizations: ['DECTROCEL'], metadata: { feedbackId: feedback.id, reportId: report.id, feedbackType: feedback.feedbackType, submissionVersion: feedback.submissionVersion } })
  res.status(201).json(feedback)
})
app.get('/api/feedback', requireAuth, async (req, res) => {
  const ids = await accessibleClientIds(req); const status = String(req.query.status ?? '').toUpperCase(); const feedbackType = String(req.query.feedbackType ?? '').toUpperCase(); const q = String(req.query.q ?? '').trim()
  const providerReportWhere = req.user!.providerCode ? await providerReportScopeWhere(req.user!.providerCode) : null
  const providerReportIds = providerReportWhere && 'id' in providerReportWhere && typeof providerReportWhere.id === 'object' && providerReportWhere.id && 'in' in providerReportWhere.id ? providerReportWhere.id.in as string[] : providerReportWhere ? [] : null
  if (ids !== null && !ids.length && !providerReportIds) return res.status(403).json({ message: 'Feedback access denied' })
  const items = await prisma.radiologistFeedback.findMany({ where: { ...(ids === null ? {} : providerReportIds ? { reportId: { in: providerReportIds } } : { clientId: { in: ids } }), ...(status ? { status } : {}), ...(feedbackType ? { feedbackType } : {}), ...(q ? { OR: [{ comment: { contains: q, mode: 'insensitive' } }, { reportId: { contains: q, mode: 'insensitive' } }] } : {}) }, include: { client: { select: { id: true, name: true, code: true } }, patient: true, report: true, radiologist: { select: portalUserSelect }, reviewedBy: { select: portalUserSelect } }, orderBy: { createdAt: 'desc' }, take: 500 })
  res.json(items)
})
app.patch('/api/feedback/:id', requireAuth, async (req, res) => {
  if (!['SUPER_ADMIN', 'PROVIDER_ADMIN', 'PROVIDER_MANAGER'].includes(req.user!.role)) return res.status(403).json({ message: 'Feedback management permission required' })
  const body = z.object({ status: z.enum(['NEW', 'REVIEWED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(), internalNotes: z.string().max(10000).optional(), renewistStatus: z.enum(['PENDING', 'SYNCED', 'FAILED']).optional() }).parse(req.body)
  const existing = await prisma.radiologistFeedback.findUnique({ where: { id: String(req.params.id) } })
  if (!existing) return res.status(404).json({ message: 'Feedback not found' })
  if (req.user!.providerCode) {
    const reportWhere = await providerReportScopeWhere(req.user!.providerCode)
    const allowed = await prisma.reportReview.count({ where: { ...reportWhere, id: existing.reportId } })
    if (!allowed) return res.status(403).json({ message: 'Feedback access denied' })
  }
  const item = await prisma.radiologistFeedback.update({ where: { id: String(req.params.id) }, data: { ...body, reviewedById: req.user!.sub, reviewedAt: new Date(), renewistSyncedAt: body.renewistStatus === 'SYNCED' ? new Date() : undefined } })
  await prisma.auditLog.create({ data: { clientId: item.clientId, actorUserId: req.user!.sub, action: 'RADIOLOGIST_FEEDBACK_UPDATED', metadata: { feedbackId: item.id, status: item.status } } })
  res.json(item)
})

app.get('/api/services', requireAuth, async (_req, res) => {
  const services = await prisma.service.findMany({ where: { enabled: true }, orderBy: { name: 'asc' } })
  res.json(services)
})

app.get('/api/admin/dashboard', requireAuth, requireSuperAdmin, async (_req, res) => {
  const [totalClients, activeClients, blockedClients, totalStudies, failedJobs, liveJobs] = await Promise.all([
    prisma.client.count({ where: { kind: 'CENTER' } }),
    prisma.client.count({ where: { kind: 'CENTER', status: 'ACTIVE' } }),
    prisma.client.count({ where: { kind: 'CENTER', status: 'BLOCKED' } }),
    prisma.processingJob.count(),
    prisma.job.count({ where: { status: 'FAILED' } }),
    prisma.job.count({ where: { status: { in: ['QUEUED', 'PROCESSING'] } } }),
  ])

  res.json({ totalClients, activeClients, blockedClients, totalStudies, failedJobs, liveJobs })
})

app.get('/api/admin/overview', requireAuth, requireSuperAdmin, async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store')
  const dashboardOnly = req.query.scope === 'dashboard'
  const dashboardCacheKey = `${redisNamespace}:admin-overview:v2:${dashboardOnly ? 'dashboard' : 'full'}`
  const cachedDashboard = req.query.fresh === '1' ? null : await redisGetJson<unknown>(dashboardCacheKey)
  if (cachedDashboard) return res.json(cachedDashboard)

  if (dashboardOnly) {
    const [dashboard, clients, services, processingJobs] = await Promise.all([
      Promise.all([
        prisma.client.count({ where: { kind: 'CENTER' } }),
        prisma.client.count({ where: { kind: 'CENTER', status: 'ACTIVE' } }),
        prisma.client.count({ where: { kind: 'CENTER', status: 'BLOCKED' } }),
        prisma.processingJob.count(),
        prisma.job.count({ where: { status: 'FAILED' } }),
        prisma.job.count({ where: { status: { in: ['QUEUED', 'PROCESSING'] } } }),
      ]),
      prisma.client.findMany({ where: { kind: 'CENTER' }, select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.service.findMany({ where: { enabled: true, name: { not: 'DecXpert CT Thorax' } }, select: { id: true } }),
      prisma.processingJob.findMany({
        select: {
          id: true, clientId: true, uploadName: true, serviceType: true, priority: true,
          imageCount: true, status: true, error: true, updatedAt: true,
          client: { select: { id: true, code: true, name: true } },
          bridgeStudy: { select: { patientId: true, patientName: true, studyInstanceUid: true, studyDescription: true, modalities: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 50,
      }),
    ])
    const [totalClients, activeClients, blockedClients, totalStudies, failedJobs, liveJobs] = dashboard
    const payload = {
      dashboard: { totalClients, activeClients, blockedClients, totalStudies, failedJobs, liveJobs },
      clients,
      services,
      processingJobs,
      jobs: [], usageLogs: [], reportSettings: [], reportReviews: [], radiologists: [], availableBridgeStudies: [], auditLogs: [],
    }
    void redisSetJson(dashboardCacheKey, payload, Number(process.env.REDIS_DASHBOARD_TTL_SECONDS ?? 60))
    return res.json(payload)
  }

  const [dashboard, clients, services, jobs, usageLogs, reportSettings, reportReviews, radiologists, processingJobs, availableBridgeStudies, auditLogs, billing] = await Promise.all([
    Promise.all([
      prisma.client.count({ where: { kind: 'CENTER' } }),
      prisma.client.count({ where: { kind: 'CENTER', status: 'ACTIVE' } }),
      prisma.client.count({ where: { kind: 'CENTER', status: 'BLOCKED' } }),
      prisma.processingJob.count(),
      prisma.job.count({ where: { status: 'FAILED' } }),
      prisma.job.count({ where: { status: { in: ['QUEUED', 'PROCESSING'] } } }),
    ]),
    prisma.client.findMany({
      where: { kind: 'CENTER' },
      include: {
        services: { include: { service: true, pacsConfig: true } },
        users: { select: portalUserSelect },
        _count: { select: { processingJobs: { where: { demoMode: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.service.findMany({ where: { enabled: true, name: { not: 'DecXpert CT Thorax' } }, orderBy: { name: 'asc' } }),
    prisma.job.findMany({ include: { client: true, study: true }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.usageLog.findMany({ include: { client: true }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.reportFormatSetting.findMany({ include: { client: true } }),
    prisma.reportReview.findMany({ omit: reportListOmit, include: { client: { select: reportClientSelect }, radiologist: true }, orderBy: { createdAt: 'desc' } }),
    prisma.radiologistProfile.findMany({ include: { client: true, user: { select: portalUserSelect } }, orderBy: { createdAt: 'desc' } }),
    prisma.processingJob.findMany({
      omit: { reportHtml: true },
      include: {
        client: true,
        bridgeStudy: {
          select: {
            patientId: true,
            patientName: true,
            patientSex: true,
            patientAge: true,
            accessionNumber: true,
            studyInstanceUid: true,
            studyDescription: true,
            modalities: true,
            clinicalIndication: true,
            submittedAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: getDeploymentFeatures().marengoMinimal ? 100 : 500,
    }),
    prisma.availableBridgeStudy.findMany({
      include: {
        client: { select: reportClientSelect },
        attachments: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true } },
        processingJob: { omit: { reportHtml: true, upstreamStatus: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    }),
    prisma.auditLog.findMany({ include: { client: true }, orderBy: { createdAt: 'desc' }, take: getDeploymentFeatures().marengoMinimal ? 100 : 500 }),
    getDeploymentFeatures().billing ? getAdminBillingSnapshot() : Promise.resolve(null),
  ])

  const [totalClients, activeClients, blockedClients, totalStudies, failedJobs, liveJobs] = dashboard
  const payload = {
    dashboard: { totalClients, activeClients, blockedClients, totalStudies, failedJobs, liveJobs },
    clients,
    services,
    jobs,
    usageLogs,
    reportSettings,
    reportReviews: await withReportSummaries(reportReviews),
    radiologists,
    processingJobs,
    availableBridgeStudies,
    auditLogs,
    ...(billing ? { billing } : {}),
  }
  void redisSetJson(dashboardCacheKey, payload, Number(process.env.REDIS_DASHBOARD_TTL_SECONDS ?? 60))
  res.json(payload)
})

app.get('/api/admin/bridge-studies/:studyId', requireAuth, requireSuperAdmin, async (req, res) => {
  const study = await prisma.availableBridgeStudy.findUnique({
    where: { id: String(req.params.studyId) },
    include: { client: true, attachments: { orderBy: { createdAt: 'desc' } }, processingJob: true, dispatchRequests: { orderBy: { createdAt: 'desc' }, take: 10 } },
  })
  if (!study) return res.status(404).json({ message: 'Bridge study not found' })
  res.json(formatBridgeStudyForAdmin(study))
})

app.get('/api/admin/bridge-studies/:studyId/download', requireAuth, requireSuperAdmin, async (req, res) => {
  const study = await prisma.availableBridgeStudy.findUnique({
    where: { id: String(req.params.studyId) },
    include: { client: true, attachments: { orderBy: { createdAt: 'asc' } }, processingJob: true },
  })
  if (!study) return res.status(404).json({ message: 'Bridge study not found' })
  await sendBridgeStudyBundle(res, study)
})

app.get('/api/admin/clients', requireAuth, requireSuperAdmin, async (_req, res) => {
  const clients = await prisma.client.findMany({
    where: { kind: 'CENTER' },
    include: {
      services: { include: { service: true, pacsConfig: true } },
      users: { select: portalUserSelect },
      _count: { select: { processingJobs: { where: { demoMode: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  })
  res.json(clients)
})

app.get('/api/admin/teleradiology/providers', requireAuth, requireSuperAdmin, async (_req, res) => {
  const providers = await prisma.teleradiologyProvider.findMany({ orderBy: { name: 'asc' } })
  const providerUsers = await prisma.user.findMany({
    where: { role: 'PROVIDER_ADMIN' },
    select: portalUserSelect,
    orderBy: { createdAt: 'desc' },
  })
  res.json(providers.map((provider) => ({
    ...provider,
    users: providerUsers.filter((user) => user.providerCode === provider.code),
  })))
})

app.post('/api/admin/teleradiology/providers/:providerCode/users', requireAuth, requireSuperAdmin, async (req, res) => {
  const body = z.object({
    name: z.string().min(2),
    email: z.string().email(),
  }).parse(req.body)
  const providerCode = String(req.params.providerCode).toUpperCase()
  const provider = await prisma.teleradiologyProvider.findUniqueOrThrow({ where: { code: providerCode } })
  const temporaryPassword = generatePortalPassword()
  const passwordHash = await bcrypt.hash(temporaryPassword, 12)
  const user = await prisma.user.upsert({
    where: { email: body.email },
    update: {
      userId: userIdForEmail(body.email),
      name: body.name,
      passwordHash,
      lastGeneratedPassword: null,
      role: 'PROVIDER_ADMIN',
      clientId: null,
      providerCode: provider.code,
      active: true,
    },
    create: {
      userId: userIdForEmail(body.email),
      email: body.email,
      name: body.name,
      passwordHash,
      lastGeneratedPassword: null,
      role: 'PROVIDER_ADMIN',
      providerCode: provider.code,
      active: true,
    },
    select: portalUserSelect,
  })
  await prisma.auditLog.create({
    data: { actorUserId: req.user!.sub, action: 'PROVIDER_ADMIN_CREATED', metadata: { providerCode: provider.code, email: body.email } },
  })
  res.status(201).json({ user, temporaryPassword })
})

app.post('/api/admin/teleradiology/provider-users/:userId/reset-password', requireAuth, requireSuperAdmin, async (req, res) => {
  const userId = String(req.params.userId)
  const existing = await prisma.user.findFirstOrThrow({ where: { id: userId, role: 'PROVIDER_ADMIN' } })
  const temporaryPassword = generatePortalPassword()
  const passwordHash = await bcrypt.hash(temporaryPassword, 12)
  const user = await prisma.user.update({
    where: { id: existing.id },
    data: { passwordHash, lastGeneratedPassword: null, active: true },
    select: portalUserSelect,
  })
  await prisma.auditLog.create({
    data: { actorUserId: req.user!.sub, action: 'PROVIDER_ADMIN_PASSWORD_RESET', metadata: { providerCode: user.providerCode, email: user.email } },
  })
  res.json({ user, temporaryPassword })
})

app.post('/api/admin/teleradiology/provider-users/:userId/view-password', requireAuth, requireSuperAdmin, async (req, res) => {
  await auditDeprecatedPasswordView(req, 'PROVIDER_ADMIN_PASSWORD_VIEW_BLOCKED', { providerUserId: String(req.params.userId) })
  res.status(410).json({ message: 'Stored password viewing has been disabled. Reset the password to generate a one-time temporary credential.' })
})

app.post('/api/admin/clients', requireAuth, requireSuperAdmin, async (req, res) => {
  const body = z.object({
    name: z.string().min(2),
    hospitalSlug: z.string().min(2).optional().or(z.literal('')),
    facilityType: z.string().min(2),
    primaryContact: z.string().min(2),
    email: z.string().email(),
  }).parse(req.body)

  const temporaryPassword = generatePortalPassword()
  const passwordHash = await bcrypt.hash(temporaryPassword, 12)
  const isMarengoCenter = getDeploymentFeatures().marengoMinimal || /\bmarengo\b/i.test(`${body.name} ${body.email}`)
  const marengoGroup = isMarengoCenter
    ? await prisma.client.findFirst({ where: { code: 'MARENGO', kind: 'GROUP' }, select: { id: true } })
    : null
  const slugBase = normalizeHospitalSlug(body.hospitalSlug || body.name)
  let code = await nextClientCode()
  if (marengoGroup) {
    const codeBase = `MARENGO_${slugBase.replace(/-/g, '_').toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 28) || 'CENTER'}`
    code = codeBase
    for (let suffix = 2; await prisma.client.findUnique({ where: { code } }); suffix += 1) code = `${codeBase}_${suffix}`
  }
  const slugPrefix = marengoGroup ? slugBase : `${code}-${body.name}`
  let hospitalSlug = normalizeHospitalSlug(body.hospitalSlug || slugPrefix)
  for (let suffix = 2; await prisma.client.findUnique({ where: { hospitalSlug } }); suffix += 1) hospitalSlug = `${normalizeHospitalSlug(body.hospitalSlug || slugPrefix)}-${suffix}`
  const result = await prisma.$transaction(async (tx) => {
    const client = await tx.client.create({
      data: {
        ...body,
        hospitalSlug,
        code,
        kind: 'CENTER',
        parentClientId: marengoGroup?.id ?? null,
        studySyncEnabled: Boolean(marengoGroup),
      },
    })
    const user = await tx.user.create({
      data: {
        userId: userIdForEmail(body.email),
        email: body.email,
        name: body.primaryContact,
        passwordHash,
        lastGeneratedPassword: temporaryPassword,
        role: 'CLIENT_USER',
        portalRole: 'IT_TEAM',
        clientId: client.id,
      },
      select: portalUserSelect,
    })
    await tx.auditLog.create({
      data: {
        clientId: client.id,
        actorUserId: req.user!.sub,
        action: 'CLIENT_CREATED',
        metadata: { code, hospitalSlug, email: body.email, generatedLogin: true },
      },
    })
    await ensureMarengoServices(tx, client.id)
    return { client, user }
  })

  res.status(201).json({ ...result, temporaryPassword })
})

app.post('/api/admin/clients/:clientId/users', requireAuth, requireSuperAdmin, async (req, res) => {
  const clientId = String(req.params.clientId)
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { id: true, code: true, name: true } })
  const body = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    portalRole: clientPortalRoleSchema,
  }).parse(req.body)

  const temporaryPassword = generatePortalPassword()
  const passwordHash = await bcrypt.hash(temporaryPassword, 12)
  const user = await prisma.user.create({
    data: {
      userId: userIdForEmail(body.email),
      email: body.email,
      name: body.name,
      passwordHash,
      lastGeneratedPassword: temporaryPassword,
      role: 'CLIENT_USER',
      portalRole: body.portalRole,
      clientId: client.id,
    },
    select: portalUserSelect,
  })
  await prisma.auditLog.create({
    data: {
      clientId: client.id,
      actorUserId: req.user!.sub,
      action: 'CLIENT_USER_CREATED',
      metadata: { centerCode: client.code, email: body.email, portalRole: body.portalRole },
    },
  })
  res.status(201).json({ client, user, temporaryPassword })
})

app.patch('/api/admin/clients/:clientId/status', requireAuth, requireSuperAdmin, async (req, res) => {
  const body = z.object({ status: z.enum(['ACTIVE', 'BLOCKED']) }).parse(req.body)
  const client = await prisma.client.update({
    where: { id: String(req.params.clientId) },
    data: { status: body.status },
    include: { pacsConfigs: true },
  })
  if (body.status === 'BLOCKED') {
    for (const config of client.pacsConfigs) {
      stopDicomReceiver(config.receivingPort)
      if (config.urgentReceivingPort) stopDicomReceiver(config.urgentReceivingPort)
      for (const endpoint of readPacsExtraEndpoints(config.extraEndpoints)) stopDicomReceiver(endpoint.receivingPort)
    }
  } else {
    const configs = await prisma.pacsConfig.findMany({
      where: { clientId: client.id, clientService: { status: 'ACTIVE' } },
      include: { client: true },
    })
    await Promise.all(configs.flatMap((config) => receiverSpecsForConfig(config).map((receiver) => startDicomReceiver({ ...receiver, clientCode: config.client.code }))))
  }
  await prisma.auditLog.create({
    data: { clientId: client.id, actorUserId: req.user!.sub, action: 'CLIENT_STATUS_UPDATED', metadata: body },
  })
  res.json(client)
})

app.patch('/api/admin/clients/:clientId/billing-discount', requireAuth, requireSuperAdmin, async (req, res) => {
  const body = z.object({ billingDiscountPercent: z.number().min(0).max(100) }).parse(req.body)
  const client = await prisma.client.update({
    where: { id: String(req.params.clientId) },
    data: { billingDiscountPercent: body.billingDiscountPercent },
  })
  await prisma.auditLog.create({
    data: {
      clientId: client.id,
      actorUserId: req.user!.sub,
      action: 'CLIENT_BILLING_DISCOUNT_UPDATED',
      metadata: { billingDiscountPercent: body.billingDiscountPercent },
    },
  })
  res.json(client)
})

app.get('/api/admin/clients/:clientId/billing-usage', requireAuth, requireSuperAdmin, async (req, res) => {
  const clientId = String(req.params.clientId)
  const start = req.query.start ? new Date(String(req.query.start)) : new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  const end = req.query.end ? new Date(String(req.query.end)) : new Date()
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return res.status(400).json({ message: 'Valid start and end dates are required' })
  const endInclusive = new Date(end)
  endInclusive.setHours(23, 59, 59, 999)
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, code: true, name: true } })
  if (!client) return res.status(404).json({ message: 'Client not found' })
  const transactions = await prisma.studyBillingTransaction.findMany({
    where: { clientId, createdAt: { gte: start, lte: endInclusive } },
    include: { invoice: true },
    orderBy: { createdAt: 'desc' },
  })
  const summary = transactions.reduce((total, item) => ({
    units: total.units + item.units,
    amountMinor: total.amountMinor + item.amountMinor,
    providerPayableMinor: total.providerPayableMinor + Number((item.metadata as Record<string, unknown> | null)?.providerPayableMinor ?? 0),
  }), { units: 0, amountMinor: 0, providerPayableMinor: 0 })
  res.json({
    client,
    start: start.toISOString(),
    end: endInclusive.toISOString(),
    summary: { transactionCount: transactions.length, ...summary, currency: transactions[0]?.currency ?? 'INR' },
    transactions,
  })
})

app.patch('/api/admin/clients/:clientId/hospital-slug', requireAuth, requireSuperAdmin, async (req, res) => {
  res.status(410).json({ message: 'Hospital slug editing is disabled. Renewist submissions use the fixed marengo slug.' })
})

app.patch('/api/admin/clients/:clientId/study-sync', requireAuth, requireSuperAdmin, async (req, res) => {
  const body = z.object({ studySyncEnabled: z.boolean() }).parse(req.body)
  const client = await prisma.client.update({
    where: { id: String(req.params.clientId) },
    data: { studySyncEnabled: body.studySyncEnabled },
    include: {
      services: { include: { service: true, pacsConfig: true } },
      users: { select: portalUserSelect },
      _count: { select: { processingJobs: { where: { demoMode: true } } } },
    },
  })
  await prisma.auditLog.create({
    data: {
      clientId: client.id,
      actorUserId: req.user!.sub,
      action: body.studySyncEnabled ? 'STUDY_SYNC_ENABLED' : 'STUDY_SYNC_DISABLED',
      metadata: { clientCode: client.code },
    },
  })
  res.json(client)
})

app.patch('/api/admin/clients/:clientId/demo-mode', requireAuth, requireSuperAdmin, async (req, res) => {
  const body = z.object({
    demoModeEnabled: z.boolean(),
    demoStudyLimit: z.number().int().min(0).max(100000).nullable().optional(),
  }).parse(req.body)
  const client = await prisma.client.update({
    where: { id: String(req.params.clientId) },
    data: {
      demoModeEnabled: body.demoModeEnabled,
      demoStudyLimit: body.demoModeEnabled ? body.demoStudyLimit ?? null : null,
    },
    include: {
      services: { include: { service: true, pacsConfig: true } },
      users: { select: portalUserSelect },
      _count: { select: { processingJobs: { where: { demoMode: true } } } },
    },
  })
  await prisma.auditLog.create({
    data: {
      clientId: client.id,
      actorUserId: req.user!.sub,
      action: body.demoModeEnabled ? 'CLIENT_DEMO_MODE_ENABLED' : 'CLIENT_DEMO_MODE_DISABLED',
      metadata: { demoStudyLimit: client.demoStudyLimit },
    },
  })
  res.json(client)
})

app.delete('/api/admin/clients/:clientId', requireAuth, requireSuperAdmin, async (req, res) => {
  const auth = await verifyCurrentUserPassword(req)
  if (!auth.ok) return res.status(auth.status).json({ message: auth.message })
  const clientId = String(req.params.clientId)
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId }, include: { pacsConfigs: true } })
  for (const config of client.pacsConfigs) {
    stopDicomReceiver(config.receivingPort)
    if (config.urgentReceivingPort) stopDicomReceiver(config.urgentReceivingPort)
    for (const endpoint of readPacsExtraEndpoints(config.extraEndpoints)) stopDicomReceiver(endpoint.receivingPort)
  }

  await prisma.$transaction([
    prisma.auditLog.create({
      data: {
        clientId,
        actorUserId: req.user!.sub,
        action: 'CLIENT_DELETED',
        metadata: { clientId, code: client.code, name: client.name, email: client.email },
      },
    }),
    prisma.reportAuditLog.deleteMany({ where: { report: { clientId } } }),
    prisma.payment.deleteMany({ where: { clientId } }),
    prisma.paymentLink.deleteMany({ where: { invoice: { clientId } } }),
    prisma.invoiceLineItem.deleteMany({ where: { invoice: { clientId } } }),
    prisma.studyBillingTransaction.deleteMany({ where: { clientId } }),
    prisma.invoice.deleteMany({ where: { clientId } }),
    prisma.billingDispute.deleteMany({ where: { clientId } }),
    prisma.reportReview.deleteMany({ where: { clientId } }),
    prisma.radiologistProfile.deleteMany({ where: { clientId } }),
    prisma.job.deleteMany({ where: { clientId } }),
    prisma.usageLog.deleteMany({ where: { clientId } }),
    prisma.processingJob.deleteMany({ where: { clientId } }),
    prisma.study.deleteMany({ where: { clientId } }),
    prisma.apiKey.deleteMany({ where: { clientId } }),
    prisma.hl7Config.deleteMany({ where: { clientId } }),
    prisma.pacsConfig.deleteMany({ where: { clientId } }),
    prisma.serviceCredit.deleteMany({ where: { clientService: { clientId } } }),
    prisma.clientService.deleteMany({ where: { clientId } }),
    prisma.reportFormatSetting.deleteMany({ where: { clientId } }),
    prisma.user.deleteMany({ where: { clientId } }),
    prisma.client.delete({ where: { id: clientId } }),
  ])
  res.json({ deleted: true, clientId })
})

app.post('/api/admin/clients/:clientId/reset-password', requireAuth, requireSuperAdmin, async (req, res) => {
  const clientId = String(req.params.clientId)
  const body = z.object({ userId: z.string().optional() }).parse(req.body ?? {})
  const user = body.userId
    ? await prisma.user.findFirstOrThrow({ where: { id: body.userId, clientId, role: 'CLIENT_USER' } })
    : await prisma.user.findFirstOrThrow({ where: { clientId, role: 'CLIENT_USER' }, orderBy: { createdAt: 'asc' } })
  const temporaryPassword = generatePortalPassword()
  const passwordHash = await bcrypt.hash(temporaryPassword, 12)
  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, lastGeneratedPassword: temporaryPassword, active: true },
    select: portalUserSelect,
  })
  await prisma.auditLog.create({
    data: {
      clientId,
      actorUserId: req.user!.sub,
      action: 'CLIENT_PASSWORD_RESET',
      metadata: { email: updatedUser.email },
    },
  })
  res.json({ user: updatedUser, temporaryPassword })
})

app.post('/api/admin/clients/:clientId/view-password', requireAuth, requireSuperAdmin, async (req, res) => {
  const clientId = String(req.params.clientId)
  const body = z.object({ password: z.string().optional(), userId: z.string().optional() }).parse(req.body ?? {})
  const auth = await verifyCurrentUserPassword(req)
  if (!auth.ok) return res.status(auth.status).json({ message: auth.message })
  const user = body.userId
    ? await prisma.user.findFirst({ where: { id: body.userId, clientId, role: 'CLIENT_USER' }, select: { id: true, email: true, lastGeneratedPassword: true } })
    : await prisma.user.findFirst({ where: { clientId, role: 'CLIENT_USER' }, orderBy: { createdAt: 'asc' }, select: { id: true, email: true, lastGeneratedPassword: true } })
  if (!user) return res.status(404).json({ message: 'Client login was not found' })
  if (!user.lastGeneratedPassword) {
    await auditDeprecatedPasswordView(req, 'CLIENT_PASSWORD_VIEW_UNAVAILABLE', { clientId, userId: user.id })
    return res.status(404).json({ message: 'No readable generated password is stored for this account. Reset the password to generate one.' })
  }
  await prisma.auditLog.create({
    data: {
      clientId,
      actorUserId: req.user!.sub,
      action: 'CLIENT_PASSWORD_VIEWED',
      metadata: { userId: user.id, email: user.email },
      ipAddress: req.ip,
    },
  })
  res.json({ userId: user.id, email: user.email, password: user.lastGeneratedPassword })
})

app.post('/api/admin/clients/:clientId/services', requireAuth, requireSuperAdmin, async (req, res) => {
  const body = z.object({
    serviceName: z.string(),
    workflowType: z.enum(['AI_ONLY', 'TELERADIOLOGY_ONLY', 'AI_TELERADIOLOGY']).default('AI_ONLY'),
    teleradiologyProviderCode: z.string().optional(),
    credits: z.number().int().nonnegative(),
    validUntil: z.string().datetime(),
    outsourceTeleradiology: z.boolean().default(false),
    returnFormat: z.enum(['DICOM_ENCAPSULATED_PDF', 'DICOM_SECONDARY_CAPTURE', 'HL7', 'HTML', 'PDF', 'DOCX']).default('DICOM_ENCAPSULATED_PDF'),
  }).parse(req.body)

  const clientId = String(req.params.clientId)
  const service = await prisma.service.findUniqueOrThrow({ where: { name: body.serviceName } })
  const isPostpaidTeleradiology = isTeleradiologyWorkflow(body.workflowType)
  const validUntil = isPostpaidTeleradiology ? new Date('2099-12-31T23:59:59.000Z') : new Date(body.validUntil)
  const credits = isPostpaidTeleradiology ? 0 : body.credits
  const outsourceTeleradiology = isPostpaidTeleradiology || body.outsourceTeleradiology
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } })
  const clientService = await prisma.clientService.upsert({
    where: { clientId_serviceId: { clientId: client.id, serviceId: service.id } },
    update: { status: 'ACTIVE', workflowType: body.workflowType, credits, validUntil },
    create: { clientId: client.id, serviceId: service.id, workflowType: body.workflowType, credits, validUntil },
  })
  const existingPacsConfig = await prisma.pacsConfig.findUnique({ where: { clientServiceId: clientService.id } })
  if (existingPacsConfig) {
    await prisma.pacsConfig.update({
      where: { id: existingPacsConfig.id },
      data: {
        returnFormat: body.returnFormat,
        workflowType: body.workflowType,
        teleradiologyProviderCode: body.teleradiologyProviderCode ?? null,
        outsourceTeleradiology,
      },
    })
  } else {
    const sharedConfig = await prisma.pacsConfig.findFirst({
      where: { clientId: client.id },
      orderBy: [{ receivingPort: 'asc' }, { id: 'asc' }],
    })
    const endpoint = sharedConfig
      ? {
        ec2PublicIp: sharedConfig.ec2PublicIp,
        receivingPort: sharedConfig.receivingPort,
        aeTitle: sharedConfig.aeTitle,
        urgentReceivingPort: sharedConfig.urgentReceivingPort,
        urgentAeTitle: sharedConfig.urgentAeTitle,
      }
      : await allocatePacsEndpoint(client.code, service.name)
    await prisma.pacsConfig.create({
      data: {
        clientId: client.id,
        clientServiceId: clientService.id,
        ...endpoint,
        clientPacsIp: sharedConfig?.clientPacsIp ?? process.env.DEFAULT_CLIENT_PACS_IP ?? '0.0.0.0',
        clientPacsPort: sharedConfig?.clientPacsPort ?? Number(process.env.DEFAULT_CLIENT_PACS_PORT ?? 104),
        clientPacsAeTitle: normalizeAeTitle(sharedConfig?.clientPacsAeTitle ?? process.env.DEFAULT_CLIENT_PACS_AE_TITLE ?? `${client.code}_PACS`),
        returnFormat: body.returnFormat,
        workflowType: body.workflowType,
        teleradiologyProviderCode: body.teleradiologyProviderCode ?? null,
        outsourceTeleradiology,
      },
    })
  }

  const saved = await prisma.clientService.findUniqueOrThrow({ where: { id: clientService.id }, include: { service: true, pacsConfig: true } })
  res.json(saved)
})

app.patch('/api/admin/clients/:clientId/direct-pacs', requireAuth, requireSuperAdmin, async (req, res) => {
  const clientId = String(req.params.clientId)
  const body = z.object({
    ec2PublicIp: z.string().trim().optional(),
    receivingPort: z.coerce.number().int().min(1).max(65535).optional(),
    aeTitle: z.string().trim().max(16).optional(),
    clientPacsIp: z.string().trim().min(1),
    clientPacsPort: z.coerce.number().int().min(1).max(65535),
    clientPacsAeTitle: z.string().trim().min(1).max(16),
    returnFormat: z.enum(['DICOM_ENCAPSULATED_PDF', 'DICOM_SECONDARY_CAPTURE', 'HL7', 'HTML', 'PDF', 'DOCX']).optional(),
  }).parse(req.body)

  const normalizedClientAeTitle = normalizeAeTitle(body.clientPacsAeTitle)
  const client = await prisma.client.findUniqueOrThrow({
    where: { id: clientId },
    select: {
      code: true,
      studySyncEnabled: true,
      services: {
        where: { status: { not: 'REVOKED' } },
        include: { service: true, pacsConfig: true },
        orderBy: { service: { name: 'asc' } },
      },
    },
  })
  let configs = await prisma.pacsConfig.findMany({
    where: { clientId },
    include: { clientService: { include: { service: true } } },
    orderBy: [{ receivingPort: 'asc' }, { id: 'asc' }],
  })
  if (!configs.length) {
    if (!client.studySyncEnabled) return res.status(404).json({ message: 'No PACS service is configured yet.' })
    const configurableServices = client.services.filter((item) => !item.pacsConfig)
    if (!configurableServices.length) return res.status(404).json({ message: 'Allot at least one PACS service before configuring Bridge report push-back.' })
    for (const service of configurableServices) {
      const endpoint = await allocatePacsEndpoint(client.code, service.service.name)
      await prisma.pacsConfig.create({
        data: {
          clientId,
          clientServiceId: service.id,
          ...endpoint,
          clientPacsIp: body.clientPacsIp,
          clientPacsPort: body.clientPacsPort,
          clientPacsAeTitle: normalizedClientAeTitle,
          returnFormat: 'DICOM_ENCAPSULATED_PDF',
          workflowType: service.workflowType,
        },
      })
    }
    configs = await prisma.pacsConfig.findMany({
      where: { clientId },
      include: { clientService: { include: { service: true } } },
      orderBy: [{ receivingPort: 'asc' }, { id: 'asc' }],
    })
  }

  const primary = configs[0]
  const normalizedAeTitle = normalizeAeTitle(body.aeTitle ?? primary.aeTitle)
  const receivingPort = body.receivingPort ?? primary.receivingPort
  const ec2PublicIp = body.ec2PublicIp ?? primary.ec2PublicIp
  if (!client.studySyncEnabled && (!body.ec2PublicIp || !body.receivingPort || !body.aeTitle)) {
    return res.status(400).json({ message: 'Incoming PACS IP, port, and AE title are required for direct PACS clients.' })
  }
  if (!client.studySyncEnabled) {
    const conflictingPort = await prisma.pacsConfig.findFirst({
      where: { receivingPort, id: { not: primary.id } },
      select: { id: true, clientId: true },
    })
    if (conflictingPort) return res.status(409).json({ message: `Incoming port ${receivingPort} is already assigned to another PACS route.` })
    const conflictingAe = await prisma.pacsConfig.findFirst({
      where: { aeTitle: normalizedAeTitle, id: { not: primary.id } },
      select: { id: true, clientId: true },
    })
    if (conflictingAe) return res.status(409).json({ message: `Incoming AE title ${normalizedAeTitle} is already assigned to another PACS route.` })
  }

  const configUpdates = client.studySyncEnabled
    ? [
      prisma.pacsConfig.updateMany({
        where: { clientId },
        data: {
          clientPacsIp: body.clientPacsIp,
          clientPacsPort: body.clientPacsPort,
          clientPacsAeTitle: normalizedClientAeTitle,
          returnFormat: 'DICOM_ENCAPSULATED_PDF',
        },
      }),
    ]
    : [
      prisma.pacsConfig.update({
        where: { id: primary.id },
        data: {
          ec2PublicIp,
          receivingPort,
          aeTitle: normalizedAeTitle,
          clientPacsIp: body.clientPacsIp,
          clientPacsPort: body.clientPacsPort,
          clientPacsAeTitle: normalizedClientAeTitle,
          ...(body.returnFormat ? { returnFormat: body.returnFormat } : {}),
        },
      }),
      prisma.pacsConfig.updateMany({
        where: { clientId, id: { not: primary.id } },
        data: {
          clientPacsIp: body.clientPacsIp,
          clientPacsPort: body.clientPacsPort,
          clientPacsAeTitle: normalizedClientAeTitle,
          ...(body.returnFormat ? { returnFormat: body.returnFormat } : {}),
        },
      }),
    ]

  await prisma.$transaction([
    ...configUpdates,
    prisma.auditLog.create({
      data: {
        clientId,
        actorUserId: req.user!.sub,
        action: client.studySyncEnabled ? 'BRIDGE_PACS_PUSH_UPDATED' : 'DIRECT_PACS_UPDATED',
        metadata: {
          bridgeEnabled: client.studySyncEnabled,
          receivingPort,
          aeTitle: normalizedAeTitle,
          clientPacsIp: body.clientPacsIp,
          clientPacsPort: body.clientPacsPort,
          clientPacsAeTitle: normalizedClientAeTitle,
          returnFormat: client.studySyncEnabled ? 'DICOM_ENCAPSULATED_PDF' : body.returnFormat ?? null,
        },
      },
    }),
  ])

  const services = await prisma.clientService.findMany({
    where: { clientId, status: { not: 'REVOKED' } },
    include: { service: true, pacsConfig: true },
    orderBy: { service: { name: 'asc' } },
  })
  res.json({ services })
})

app.patch('/api/admin/clients/:clientId/services/:clientServiceId/revoke', requireAuth, requireSuperAdmin, async (req, res) => {
  const clientId = String(req.params.clientId)
  const clientServiceId = String(req.params.clientServiceId)
  const clientService = await prisma.clientService.findFirstOrThrow({
    where: { id: clientServiceId, clientId },
    include: { pacsConfig: true, service: true },
  })
  if (clientService.pacsConfig) {
    stopDicomReceiver(clientService.pacsConfig.receivingPort)
    if (clientService.pacsConfig.urgentReceivingPort) stopDicomReceiver(clientService.pacsConfig.urgentReceivingPort)
    for (const endpoint of readPacsExtraEndpoints(clientService.pacsConfig.extraEndpoints)) stopDicomReceiver(endpoint.receivingPort)
  }
  const updated = await prisma.clientService.update({
    where: { id: clientService.id },
    data: { status: 'REVOKED' },
    include: { service: true, pacsConfig: true },
  })
  await prisma.auditLog.create({
    data: { clientId, actorUserId: req.user!.sub, action: 'CLIENT_SERVICE_REVOKED', metadata: { serviceName: clientService.service.name, clientServiceId } },
  })
  res.json(updated)
})

app.get('/api/admin/jobs', requireAuth, requireSuperAdmin, async (_req, res) => {
  const jobs = await prisma.job.findMany({ include: { client: true, study: true }, orderBy: { createdAt: 'desc' }, take: 100 })
  res.json(jobs)
})

app.get('/api/admin/usage', requireAuth, requireSuperAdmin, async (_req, res) => {
  const usage = await prisma.usageLog.findMany({ include: { client: true }, orderBy: { createdAt: 'desc' }, take: 100 })
  res.json(usage)
})

app.get('/api/provider/dashboard', requireAuth, requireProviderStaff, async (req, res) => {
  const providerCode = req.user!.providerCode!
  const provider = await prisma.teleradiologyProvider.findUniqueOrThrow({ where: { code: providerCode } })
  const teleradiologyWorkflows = ['TELERADIOLOGY_ONLY', 'AI_TELERADIOLOGY']
  const mappings = await prisma.providerJobMapping.findMany({
    where: { providerId: provider.id },
    select: {
      id: true,
      processingJobId: true,
      reportReviewId: true,
      dectrocelJobId: true,
      providerJobId: true,
      studyInstanceUid: true,
      accessionNumber: true,
      status: true,
      // No `metadata`: about 4 KB per study and no provider screen reads it.
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: 500,
  })
  const mappedReportIds = [...new Set(mappings.flatMap((item) => item.reportReviewId ? [item.reportReviewId] : []))]
  const mappedProcessingJobIds = [...new Set(mappings.flatMap((item) => item.processingJobId ? [item.processingJobId] : []))]
  const providerReportWhere = mappedReportIds.length ? { id: { in: mappedReportIds } } : { id: '__none__' }
  const providerTransactionWhere = mappedProcessingJobIds.length
    ? { OR: [{ processingJobId: { in: mappedProcessingJobIds } }, { metadata: { path: ['providerCode'], equals: providerCode } }] }
    : { metadata: { path: ['providerCode'], equals: providerCode } }
  const [submissions, apiLogs, payables, settlements, radiologists, reportReviews, managers, availabilitySlots, callBookings, clientTransactions, portalLogs] = await Promise.all([
    prisma.providerReportSubmission.findMany({
      where: { providerId: provider.id },
      select: {
        id: true,
        dectrocelJobId: true,
        renewistJobId: true,
        reportStatus: true,
        reportType: true,
        reportFormat: true,
        reportVersion: true,
        receivedAt: true,
        processedAt: true,
      },
      orderBy: { receivedAt: 'desc' },
      take: 100,
    }),
    prisma.providerApiRequest.findMany({
      where: { providerId: provider.id },
      select: {
        id: true,
        requestId: true,
        direction: true,
        endpoint: true,
        status: true,
        authenticated: true,
        responseCode: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.providerPayableTransaction.findMany({
      where: { providerCode, workflowType: { in: teleradiologyWorkflows } },
      select: {
        id: true,
        providerCode: true,
        serviceName: true,
        workflowType: true,
        priority: true,
        category: true,
        units: true,
        amountMinor: true,
        currency: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.providerSettlement.findMany({
      where: { providerCode },
      select: {
        id: true,
        settlementNumber: true,
        providerCode: true,
        periodStart: true,
        periodEnd: true,
        status: true,
        currency: true,
        subtotalMinor: true,
        paidAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.radiologistProfile.findMany({
      where: { providerCode },
      include: {
        user: { select: portalUserSelect },
        manager: { select: portalUserSelect },
        availabilitySlots: { orderBy: { slotStart: 'asc' }, take: 50 },
        reportReviews: { where: providerReportWhere, omit: reportListOmit, orderBy: { createdAt: 'desc' } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.reportReview.findMany({
      where: providerReportWhere,
      omit: reportListOmit,
      include: { client: { select: reportClientSelect }, radiologist: { select: reportRadiologistSelect } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.user.findMany({
      where: { providerCode, role: 'PROVIDER_MANAGER' },
      select: portalUserSelect,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.radiologistAvailability.findMany({
      where: { providerCode, slotEnd: { gte: new Date() } },
      include: { radiologist: true, createdBy: { select: portalUserSelect } },
      orderBy: { slotStart: 'asc' },
      take: 200,
    }),
    prisma.reportCallBooking.findMany({
      where: { report: providerReportWhere },
      include: { radiologist: true, report: { omit: reportListOmit, include: { client: { select: reportClientSelect } } }, client: { select: reportClientSelect }, managerAcceptedBy: { select: portalUserSelect }, radiologistAcceptedBy: { select: portalUserSelect } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    prisma.studyBillingTransaction.findMany({
      where: providerTransactionWhere,
      include: { client: true, invoice: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    prisma.auditLog.findMany({
      where: { metadata: { path: ['providerCode'], equals: providerCode } },
      include: { client: true },
      orderBy: { createdAt: 'desc' },
      take: 250,
    }),
  ])
  const providerProcessingJobs = mappedProcessingJobIds.length
    ? await prisma.processingJob.findMany({
        where: { id: { in: mappedProcessingJobIds } },
        omit: { reportHtml: true },
        include: {
          client: { select: { id: true, code: true, name: true } },
          bridgeStudy: { include: { attachments: { orderBy: { createdAt: 'asc' } } } },
        },
        orderBy: { updatedAt: 'desc' },
      })
    : []
  const mappedInvoiceIds = [...new Set(clientTransactions.flatMap((item) => item.invoiceId ? [item.invoiceId] : []))]
  const clientInvoices = mappedInvoiceIds.length
    ? await prisma.invoice.findMany({
        where: { id: { in: mappedInvoiceIds } },
        include: { client: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })
    : []
  const processingJobById = new Map(providerProcessingJobs.map((job) => [job.id, job]))
  const reportReviewById = new Map(reportReviews.map((report) => [report.id, report]))
  const providerStudies = mappings.map((mapping) => {
    const job = mapping.processingJobId ? processingJobById.get(mapping.processingJobId) : null
    const bridgeStudy = job?.bridgeStudy
    const report = mapping.reportReviewId ? reportReviewById.get(mapping.reportReviewId) : null
    const queuedMetadata = extractQueuedMetadata(job?.upstreamStatus)
    return {
      ...mapping,
      client: job?.client ?? null,
      patientName: bridgeStudy?.patientName ?? report?.patientName ?? queuedMetadata.patientName ?? null,
      patientId: bridgeStudy?.patientId ?? report?.patientId ?? queuedMetadata.patientId ?? null,
      accessionNumber: bridgeStudy?.accessionNumber ?? report?.accession ?? mapping.accessionNumber ?? queuedMetadata.accession ?? null,
      studyDescription: bridgeStudy?.studyDescription ?? queuedMetadata.studyDescription ?? null,
      modalities: bridgeStudy?.modalities?.length ? bridgeStudy.modalities : [report?.modality ?? queuedMetadata.modality].filter((value): value is string => Boolean(value)),
      clinicalIndication: bridgeStudy?.clinicalIndication ?? getClinicalIndication(job?.upstreamStatus) ?? null,
      priority: job?.priority ?? null,
      processingStatus: job?.status ?? mapping.status,
      imageCount: job?.imageCount ?? bridgeStudy?.instanceCount ?? 0,
      pushedAt: mapping.createdAt,
      bundleStudyId: bridgeStudy?.id ?? job?.id ?? null,
      archiveName: bridgeStudy?.archiveName ?? job?.uploadName ?? null,
      attachments: (bridgeStudy?.attachments ?? []).map((attachment) => ({
        id: attachment.id,
        originalName: attachment.originalName,
        mimeType: attachment.mimeType,
        sizeBytes: String(attachment.sizeBytes),
        createdAt: attachment.createdAt,
      })),
    }
  })
  const disputes = await prisma.billingDispute.findMany({
    where: { settlementId: { in: settlements.map((settlement) => settlement.id) } },
    select: {
      id: true,
      settlementId: true,
      dectrocelJobId: true,
      type: true,
      reason: true,
      status: true,
      resolution: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  const pendingPayableMinor = payables.filter((item) => item.status !== 'PAID').reduce((sum, item) => sum + item.amountMinor, 0)
  // The lists above are capped; KPI cards need true totals.
  const [assignedStudyCount, submittedReportCount, apiRequestCount] = await Promise.all([
    prisma.providerJobMapping.count({ where: { providerId: provider.id } }),
    prisma.providerReportSubmission.count({ where: { providerId: provider.id } }),
    prisma.providerApiRequest.count({ where: { providerId: provider.id } }),
  ])
  res.json({
    provider: {
      id: provider.id,
      name: provider.name,
      code: provider.code,
      active: provider.active,
      reportCallbackEndpoint: provider.reportCallbackEndpoint,
    },
    summary: {
      assignedStudies: assignedStudyCount,
      reportsSubmitted: submittedReportCount,
      apiRequests: apiRequestCount,
      pendingPayableMinor,
      settlementCount: settlements.length,
      disputeCount: disputes.length,
      managerCount: managers.length,
      callRequestCount: callBookings.filter((item) => ['REQUESTED', 'MANAGER_ACCEPTED', 'RADIOLOGIST_ACCEPTED'].includes(item.status)).length,
    },
    studies: providerStudies,
    reports: submissions,
    apiLogs,
    usage: payables,
    settlements,
    disputes,
    radiologists,
    reportReviews: await withReportSummaries(reportReviews),
    managers,
    availabilitySlots,
    callBookings,
    clientInvoices,
    clientTransactions,
    portalLogs,
  })
})

app.get('/api/provider/studies/:studyId/download', requireAuth, requireProviderStaff, async (req, res) => {
  const study = await getProviderStudyBundle(String(req.params.studyId), req.user!.providerCode!)
  if (!study) return res.status(404).json({ message: 'Study was not found in this Renewist worklist' })
  await prisma.auditLog.create({
    data: {
      clientId: study.clientId,
      actorUserId: req.user!.sub,
      action: 'PROVIDER_STUDY_BUNDLE_DOWNLOADED',
      metadata: {
        providerCode: req.user!.providerCode,
        bridgeStudyId: study.bridgeStudyId,
        processingJobId: study.processingJobId,
        dectrocelJobId: study.dectrocelJobId,
        attachmentCount: study.attachments.length,
      },
      ipAddress: req.ip,
    },
  })
  await sendProviderStudyBundle(res, study)
})

app.post('/api/provider/managers', requireAuth, requireProviderAdmin, async (req, res) => {
  const body = z.object({ name: z.string().min(2), email: z.string().email() }).parse(req.body)
  const providerCode = req.user!.providerCode!
  const temporaryPassword = generatePortalPassword()
  const passwordHash = await bcrypt.hash(temporaryPassword, 12)
  const user = await prisma.user.upsert({
    where: { email: body.email },
    update: { userId: userIdForEmail(body.email), name: body.name, passwordHash, lastGeneratedPassword: null, role: 'PROVIDER_MANAGER', providerCode, clientId: null, active: true },
    create: { userId: userIdForEmail(body.email), name: body.name, email: body.email, passwordHash, lastGeneratedPassword: null, role: 'PROVIDER_MANAGER', providerCode, active: true },
    select: portalUserSelect,
  })
  await prisma.auditLog.create({ data: { actorUserId: req.user!.sub, action: 'PROVIDER_MANAGER_CREATED', metadata: { providerCode, email: body.email } } })
  res.status(201).json({ user, temporaryPassword })
})

app.post('/api/provider/managers/:managerUserId/view-password', requireAuth, requireProviderAdmin, async (req, res) => {
  await auditDeprecatedPasswordView(req, 'PROVIDER_MANAGER_PASSWORD_VIEW_BLOCKED', { providerCode: req.user!.providerCode, managerUserId: String(req.params.managerUserId) })
  res.status(410).json({ message: 'Stored password viewing has been disabled. Reset the password to generate a one-time temporary credential.' })
})

app.post('/api/provider/managers/:managerUserId/reset-password', requireAuth, requireProviderAdmin, async (req, res) => {
  const manager = await prisma.user.findFirstOrThrow({
    where: { id: String(req.params.managerUserId), role: 'PROVIDER_MANAGER', providerCode: req.user!.providerCode },
  })
  const temporaryPassword = generatePortalPassword()
  const passwordHash = await bcrypt.hash(temporaryPassword, 12)
  const user = await prisma.user.update({
    where: { id: manager.id },
    data: { passwordHash, lastGeneratedPassword: null, active: true },
    select: portalUserSelect,
  })
  await prisma.auditLog.create({ data: { actorUserId: req.user!.sub, action: 'PROVIDER_MANAGER_PASSWORD_RESET', metadata: { providerCode: req.user!.providerCode, managerUserId: user.id, email: user.email } } })
  res.json({ user, temporaryPassword })
})

app.post('/api/provider/radiologists', requireAuth, requireProviderStaff, async (req, res) => {
  const body = z.object({
    fullName: z.string().min(2),
    email: z.string().email(),
    phone: z.string().optional().default(''),
    qualification: z.string().min(2),
    medicalRegistrationNumber: z.string().min(2),
    organisationName: z.string().min(2),
    signatureImageUrl: z.string().optional().default(''),
    signatureImageData: z.string().optional().default(''),
    documentData: z.string().optional().default(''),
    documentName: z.string().optional().default(''),
  }).parse(req.body)
  const providerCode = req.user!.providerCode!
  const { signatureImageData, documentData, documentName, ...profileInput } = body
  let signatureImageUrl = profileInput.signatureImageUrl
  let documentUrl = ''
  try {
    signatureImageUrl = signatureImageData ? await saveSignatureImage(signatureImageData) : profileInput.signatureImageUrl
    documentUrl = documentData ? await saveRadiologistDocument(documentData, documentName) : ''
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid radiologist upload' })
  }

  const temporaryPassword = generatePortalPassword()
  const passwordHash = await bcrypt.hash(temporaryPassword, 12)
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        userId: userIdForEmail(body.email),
        email: body.email,
        name: body.fullName,
        passwordHash,
        lastGeneratedPassword: null,
        role: 'RADIOLOGIST',
        clientId: null,
        providerCode,
      },
      select: portalUserSelect,
    })
    const profile = await tx.radiologistProfile.create({
      data: {
        ...profileInput,
        signatureImageUrl,
        documentUrl,
        documentName: documentUrl ? sanitizeFileName(documentName || 'radiologist-document') : null,
        userId: user.id,
        clientId: null,
        providerCode,
        managerUserId: req.user!.role === 'PROVIDER_MANAGER' ? req.user!.sub : null,
      },
      include: { user: { select: portalUserSelect } },
    })
    await tx.auditLog.create({
      data: { actorUserId: req.user!.sub, action: 'PROVIDER_RADIOLOGIST_CREATED', metadata: { providerCode, email: body.email } },
    })
    return { profile, user }
  })

  res.status(201).json({ ...result, temporaryPassword })
})

app.post('/api/provider/radiologists/:radiologistId/reset-password', requireAuth, requireProviderStaff, async (req, res) => {
  const existing = await prisma.radiologistProfile.findFirstOrThrow({
    where: { id: String(req.params.radiologistId), providerCode: req.user!.providerCode },
    include: { user: true },
  })
  const temporaryPassword = generatePortalPassword()
  const passwordHash = await bcrypt.hash(temporaryPassword, 12)
  const user = await prisma.user.update({
    where: { id: existing.userId },
    data: { passwordHash, lastGeneratedPassword: null, active: true },
    select: portalUserSelect,
  })
  await prisma.auditLog.create({
    data: { actorUserId: req.user!.sub, action: 'PROVIDER_RADIOLOGIST_PASSWORD_RESET', metadata: { providerCode: req.user!.providerCode, email: user.email, radiologistId: existing.id } },
  })
  res.json({ user, temporaryPassword })
})

app.post('/api/provider/radiologists/:radiologistId/view-password', requireAuth, requireProviderStaff, async (req, res) => {
  await auditDeprecatedPasswordView(req, 'PROVIDER_RADIOLOGIST_PASSWORD_VIEW_BLOCKED', { providerCode: req.user!.providerCode, radiologistId: String(req.params.radiologistId) })
  res.status(410).json({ message: 'Stored password viewing has been disabled. Reset the password to generate a one-time temporary credential.' })
})

app.delete('/api/provider/radiologists/:radiologistId', requireAuth, requireProviderStaff, async (req, res) => {
  const auth = await verifyCurrentUserPassword(req)
  if (!auth.ok) return res.status(auth.status).json({ message: auth.message })
  const existing = await prisma.radiologistProfile.findFirstOrThrow({
    where: { id: String(req.params.radiologistId), providerCode: req.user!.providerCode },
    include: { user: { select: { id: true, email: true } } },
  })
  await prisma.$transaction([
    prisma.reportReview.updateMany({ where: { radiologistId: existing.id, locked: false }, data: { radiologistId: null, status: 'PENDING' } }),
    prisma.radiologistProfile.delete({ where: { id: existing.id } }),
    prisma.user.delete({ where: { id: existing.userId } }),
    prisma.auditLog.create({
      data: { actorUserId: req.user!.sub, action: 'PROVIDER_RADIOLOGIST_DELETED', metadata: { providerCode: req.user!.providerCode, email: existing.user.email, radiologistId: existing.id } },
    }),
  ])
  res.json({ deleted: true, radiologistId: existing.id })
})

app.post('/api/provider/radiologists/:radiologistId/availability', requireAuth, requireProviderStaff, async (req, res) => {
  const body = z.object({
    slotStart: z.string().datetime(),
    slotEnd: z.string().datetime().optional(),
    durationMinutes: z.number().int().min(5).max(720).optional(),
  }).parse(req.body)
  const providerCode = req.user!.providerCode!
  const radiologist = await prisma.radiologistProfile.findFirstOrThrow({ where: { id: String(req.params.radiologistId), providerCode } })
  const slotStart = new Date(body.slotStart)
  const slotEnd = body.slotEnd ? new Date(body.slotEnd) : new Date(slotStart.getTime() + (body.durationMinutes ?? 15) * 60 * 1000)
  const durationMinutes = Math.round((slotEnd.getTime() - slotStart.getTime()) / 60000)
  if (slotStart <= new Date()) return res.status(400).json({ message: 'Choose a future availability slot' })
  if (!Number.isFinite(durationMinutes) || durationMinutes < 5) return res.status(400).json({ message: 'End time must be after start time' })
  if (durationMinutes > 720) return res.status(400).json({ message: 'Availability window cannot be longer than 12 hours' })
  const conflict = await prisma.radiologistAvailability.findFirst({
    where: { radiologistId: radiologist.id, status: 'AVAILABLE', slotStart: { lt: slotEnd }, slotEnd: { gt: slotStart } },
  })
  if (conflict) return res.status(409).json({ message: 'Availability overlaps an existing slot' })
  const slot = await prisma.radiologistAvailability.create({
    data: { providerCode, radiologistId: radiologist.id, slotStart, slotEnd, durationMinutes, createdByUserId: req.user!.sub },
    include: { radiologist: true, createdBy: { select: portalUserSelect } },
  })
  await prisma.auditLog.create({ data: { actorUserId: req.user!.sub, action: 'RADIOLOGIST_AVAILABILITY_CREATED', metadata: { providerCode, radiologistId: radiologist.id, slotId: slot.id, slotStart: slotStart.toISOString(), slotEnd: slotEnd.toISOString(), durationMinutes } } })
  res.status(201).json(slot)
})

app.delete('/api/provider/availability/:slotId', requireAuth, requireProviderStaff, async (req, res) => {
  const providerCode = req.user!.providerCode!
  const slot = await prisma.radiologistAvailability.findFirstOrThrow({ where: { id: String(req.params.slotId), providerCode } })
  const updated = await prisma.radiologistAvailability.update({ where: { id: slot.id }, data: { status: 'CANCELLED' } })
  await prisma.auditLog.create({ data: { actorUserId: req.user!.sub, action: 'RADIOLOGIST_AVAILABILITY_CANCELLED', metadata: { providerCode, slotId: slot.id, radiologistId: slot.radiologistId } } })
  res.json(updated)
})

app.post('/api/provider/call-bookings/:bookingId/accept-manager', requireAuth, requireProviderStaff, async (req, res) => {
  const providerCode = req.user!.providerCode!
  const booking = await prisma.reportCallBooking.findUniqueOrThrow({ where: { id: String(req.params.bookingId) }, include: { report: true } })
  await assertProviderOwnsReport(providerCode, booking.report)
  const radiologistAccepted = Boolean(booking.radiologistAcceptedAt)
  const updated = await prisma.reportCallBooking.update({
    where: { id: booking.id },
    data: { managerAcceptedAt: new Date(), managerAcceptedByUserId: req.user!.sub, status: radiologistAccepted ? 'BOOKED' : 'MANAGER_ACCEPTED' },
    include: { radiologist: true, report: { include: { client: true } }, client: true },
  })
  await prisma.auditLog.create({ data: { clientId: booking.clientId, actorUserId: req.user!.sub, action: 'CALL_MANAGER_ACCEPTED', metadata: { providerCode, bookingId: booking.id, reportId: booking.reportId } } })
  await enqueueCallBookingNotification(prisma, {
    eventType: 'CALL_MANAGER_ACCEPTED',
    bookingId: updated.id,
    clientId: updated.clientId,
    reportId: updated.reportId,
    radiologistId: updated.radiologistId,
    status: updated.status,
    slotStart: updated.slotStart,
    slotEnd: updated.slotEnd,
    meetingUrl: updated.meetingUrl,
    communicationMode: updated.communicationMode,
    phoneNumber: updated.phoneNumber,
    idempotencyKey: `call-booking:manager-accepted:${updated.id}:${updated.updatedAt.getTime()}`,
  })
  res.json(updated)
})

app.post('/api/provider/call-bookings/:bookingId/complete', requireAuth, requireProviderStaff, async (req, res) => {
  const body = z.object({ actualDurationMinutes: z.number().int().min(1).max(240) }).parse(req.body)
  const providerCode = req.user!.providerCode!
  const booking = await prisma.reportCallBooking.findUniqueOrThrow({ where: { id: String(req.params.bookingId) }, include: { report: true } })
  await assertProviderOwnsReport(providerCode, booking.report)
  const updated = await completeCallBooking(booking.id, body.actualDurationMinutes, req.user!.sub, providerCode)
  await enqueueCallBookingNotification(prisma, {
    eventType: 'CALL_COMPLETED_BY_PROVIDER',
    bookingId: updated.id,
    clientId: updated.clientId,
    reportId: updated.reportId,
    radiologistId: updated.radiologistId,
    status: updated.status,
    slotStart: updated.slotStart,
    slotEnd: updated.slotEnd,
    meetingUrl: updated.meetingUrl,
    communicationMode: updated.communicationMode,
    phoneNumber: updated.phoneNumber,
    idempotencyKey: `call-booking:completed-provider:${updated.id}:${updated.updatedAt.getTime()}`,
  })
  res.json(updated)
})

// Dashboards list many reports: they send each report's JSON as a small summary
// (`withReportSummaries`) and screens that show report text load `GET /api/reports/:id`.
// The client dashboard also drops job payloads and per-radiologist report lists, which
// it never shows; the worklist loads its own slim study pages.
const dashboardJobOmit = { upstreamStatus: true, reportHtml: true } as const

app.get('/api/client/dashboard', requireAuth, requireClientUser, async (req, res) => {
  if (!req.user!.clientId) return res.status(403).json({ message: 'Client account required' })
  const access = await workspaceAccess(req)
  const dashboardCacheKey = `${redisNamespace}:client-dashboard:v3:${req.user!.clientId}:${req.user!.sub}:${req.user!.portalRole}`
  res.setHeader('Cache-Control', 'private, no-store')
  const cachedDashboard = req.query.fresh === '1' ? null : await redisGetJson<unknown>(dashboardCacheKey)
  if (cachedDashboard) return res.json(cachedDashboard)

  const [client, billing] = await Promise.all([
    prisma.client.findUnique({
    where: { id: req.user!.clientId },
    include: {
      services: { include: { service: true, pacsConfig: true } },
      jobs: { orderBy: { createdAt: 'desc' }, take: 25 },
      usageLogs: { orderBy: { createdAt: 'desc' }, take: 25 },
      processingJobs: {
        orderBy: { createdAt: 'desc' },
        take: 50,
        omit: dashboardJobOmit,
        include: {
          bridgeStudy: {
            select: {
              id: true,
              referringPhysician: true,
              patientId: true,
              patientName: true,
              patientSex: true,
              patientAge: true,
              studyInstanceUid: true,
              studyDescription: true,
              submittedAt: true,
            },
          },
        },
      },
      reportSettings: true,
      hl7Config: true,
      users: access.permissions.manageUsers ? { select: portalUserSelect, orderBy: { createdAt: 'asc' } } : false,
      _count: { select: { processingJobs: { where: { demoMode: true } } } },
      radiologists: {
        include: { user: { select: portalUserSelect } },
        orderBy: { createdAt: 'desc' },
      },
      reportReviews: { omit: reportListOmit, include: { radiologist: { select: reportRadiologistSelect }, callBookings: { where: { status: { in: ['REQUESTED', 'MANAGER_ACCEPTED', 'RADIOLOGIST_ACCEPTED', 'BOOKED'] } }, orderBy: { slotStart: 'asc' }, take: 5 } }, orderBy: { updatedAt: 'desc' } },
    },
    }),
    getDeploymentFeatures().billing && access.permissions.billing ? getClientBillingSnapshot(req.user!.clientId) : Promise.resolve(undefined),
  ])
  if (!client) return res.json(null)
  const clientReports = await withReportSummaries(client.reportReviews)
  if (client.kind !== 'GROUP') {
    const payload = { ...client, reportReviews: clientReports, ...(billing ? { billing } : {}) }
    void redisSetJson(dashboardCacheKey, payload, Number(process.env.REDIS_DASHBOARD_TTL_SECONDS ?? 60))
    return res.json(payload)
  }

  const centers = await prisma.client.findMany({
    where: { kind: 'CENTER', parentClientId: client.id },
    include: {
      services: { include: { service: true, pacsConfig: true } },
      _count: {
        select: {
          processingJobs: true,
          reportReviews: true,
          supportTickets: true,
        },
      },
    },
    orderBy: { name: 'asc' },
  })
  const centerIds = centers.map((center) => center.id)
  const [organizationReports, organizationProcessingJobs] = centerIds.length
    ? await Promise.all([
      prisma.reportReview.findMany({
        where: { clientId: { in: centerIds } },
        omit: reportListOmit,
        include: {
          client: { select: { name: true, code: true } },
          radiologist: { select: reportRadiologistSelect },
          callBookings: { where: { status: { in: ['REQUESTED', 'MANAGER_ACCEPTED', 'RADIOLOGIST_ACCEPTED', 'BOOKED'] } }, orderBy: { slotStart: 'asc' }, take: 5 },
        },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.processingJob.findMany({
        where: { clientId: { in: centerIds } },
        omit: dashboardJobOmit,
        include: {
          client: { select: { id: true, code: true, name: true } },
          bridgeStudy: {
            select: {
              id: true,
              publicStudyId: true,
              patientId: true,
              patientName: true,
              patientSex: true,
              patientAge: true,
              accessionNumber: true,
              studyInstanceUid: true,
              studyDescription: true,
              modalities: true,
              clinicalIndication: true,
              referringPhysician: true,
              submittedAt: true,
              _count: { select: { attachments: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
    ])
    : [[], []]
  const organizationRadiologists = await prisma.radiologistProfile.findMany({
    where: {
      providerCode: null,
      clientId: client.id,
    },
    include: { user: { select: portalUserSelect } },
    orderBy: { createdAt: 'desc' },
  })
  const organization = {
    centers: centers.map((center) => ({
      id: center.id,
      code: center.code,
      name: center.name,
      status: center.status,
      studySyncEnabled: center.studySyncEnabled,
      services: center.services.length,
      studies: center._count.processingJobs,
      reports: center._count.reportReviews,
      tickets: center._count.supportTickets,
    })),
    reports: await withReportSummaries(organizationReports),
    processingJobs: organizationProcessingJobs,
    radiologists: organizationRadiologists,
    totals: {
      centers: centers.length,
      activeCenters: centers.filter((center) => center.status === 'ACTIVE').length,
      services: centers.reduce((sum, center) => sum + center.services.length, 0),
      studies: centers.reduce((sum, center) => sum + center._count.processingJobs, 0),
      reports: centers.reduce((sum, center) => sum + center._count.reportReviews, 0),
      tickets: centers.reduce((sum, center) => sum + center._count.supportTickets, 0),
    },
  }
  const payload = { ...client, reportReviews: clientReports, ...(billing ? { billing } : {}), organization }
  void redisSetJson(dashboardCacheKey, payload, Number(process.env.REDIS_DASHBOARD_TTL_SECONDS ?? 60))
  res.json(payload)
})

app.post('/api/client/organization/centers', requireAuth, requireClientUser, async (req, res) => {
  const managementClient = await prisma.client.findUniqueOrThrow({ where: { id: req.user!.clientId! }, select: { id: true, code: true, kind: true } })
  if (managementClient.kind !== 'GROUP') return res.status(403).json({ message: 'Only Marengo Group Admin can create center accounts' })
  const body = z.object({
    name: z.string().min(2),
    hospitalSlug: z.string().min(2).optional().or(z.literal('')),
    facilityType: z.string().min(2).default('Hospital'),
    primaryContact: z.string().min(2),
    email: z.string().email(),
    portalRole: clientPortalRoleSchema.default('IT_TEAM'),
  }).parse(req.body)

  const temporaryPassword = generatePortalPassword()
  const passwordHash = await bcrypt.hash(temporaryPassword, 12)
  const slugBase = normalizeHospitalSlug(body.hospitalSlug || body.name)
  const codeBase = `MARENGO_${slugBase.replace(/-/g, '_').toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 28) || 'CENTER'}`
  let code = codeBase
  for (let suffix = 2; await prisma.client.findUnique({ where: { code } }); suffix += 1) code = `${codeBase}_${suffix}`
  let hospitalSlug = slugBase
  for (let suffix = 2; await prisma.client.findUnique({ where: { hospitalSlug } }); suffix += 1) hospitalSlug = `${slugBase}-${suffix}`

  const result = await prisma.$transaction(async (tx) => {
    const client = await tx.client.create({
      data: {
        name: body.name,
        hospitalSlug,
        facilityType: body.facilityType,
        primaryContact: body.primaryContact,
        email: body.email,
        code,
        kind: 'CENTER',
        parentClientId: managementClient.id,
        studySyncEnabled: true,
        status: 'ACTIVE',
      },
    })
    const user = await tx.user.create({
      data: {
        userId: userIdForEmail(body.email),
        email: body.email,
        name: body.primaryContact,
        passwordHash,
        lastGeneratedPassword: null,
        role: 'CLIENT_USER',
        portalRole: body.portalRole,
        clientId: client.id,
      },
      select: portalUserSelect,
    })
    await tx.auditLog.create({
      data: {
        clientId: managementClient.id,
        actorUserId: req.user!.sub,
        action: 'MARENGO_CENTER_CREATED',
        metadata: { centerClientId: client.id, code, hospitalSlug, email: body.email },
      },
    })
    await ensureMarengoServices(tx, client.id)
    return { client, user }
  })

  res.status(201).json({ ...result, temporaryPassword })
})

app.post('/api/client/organization/centers/:centerId/users', requireAuth, requireClientUser, async (req, res) => {
  const managementClient = await prisma.client.findUniqueOrThrow({ where: { id: req.user!.clientId! }, select: { id: true, code: true, kind: true } })
  if (managementClient.kind !== 'GROUP') return res.status(403).json({ message: 'Only Marengo Group Admin can create center logins' })
  const centerId = String(req.params.centerId)
  const center = await prisma.client.findFirstOrThrow({
    where: {
      id: centerId,
      kind: 'CENTER',
      parentClientId: managementClient.id,
    },
    select: { id: true, code: true, name: true },
  })
  const body = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    portalRole: clientPortalRoleSchema.default('IT_TEAM'),
  }).parse(req.body)

  const temporaryPassword = generatePortalPassword()
  const passwordHash = await bcrypt.hash(temporaryPassword, 12)
  const user = await prisma.user.create({
    data: {
      userId: userIdForEmail(body.email),
      email: body.email,
      name: body.name,
      passwordHash,
      lastGeneratedPassword: null,
      role: 'CLIENT_USER',
      portalRole: body.portalRole,
      clientId: center.id,
    },
    select: portalUserSelect,
  })
  await prisma.auditLog.create({
    data: {
      clientId: managementClient.id,
      actorUserId: req.user!.sub,
      action: 'MARENGO_CENTER_USER_CREATED',
      metadata: { centerClientId: center.id, centerCode: center.code, email: body.email },
    },
  })
  res.status(201).json({ center, user, temporaryPassword })
})

app.post('/api/client/users', requireAuth, requireClientUser, async (req, res) => {
  if (!req.user!.clientId) return res.status(403).json({ message: 'Client account required' })
  if (req.user!.portalRole !== 'IT_TEAM') return res.status(403).json({ message: 'Only IT Team users can create center logins' })
  const client = await prisma.client.findUniqueOrThrow({ where: { id: req.user!.clientId }, select: { id: true, code: true, name: true, kind: true } })
  if (client.kind !== 'CENTER') return res.status(403).json({ message: 'Use Marengo group user management for group accounts' })
  const body = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    portalRole: clientPortalRoleSchema,
  }).parse(req.body)

  if (!assignableCenterRoles().includes(body.portalRole)) return res.status(403).json({ message: 'Center IT can create Front Desk, Technician and Radiology Manager accounts only.' })

  const temporaryPassword = generatePortalPassword()
  const passwordHash = await bcrypt.hash(temporaryPassword, 12)
  const user = await prisma.user.create({
    data: {
      userId: userIdForEmail(body.email),
      email: body.email,
      name: body.name,
      passwordHash,
      lastGeneratedPassword: null,
      role: 'CLIENT_USER',
      portalRole: body.portalRole,
      clientId: client.id,
    },
    select: portalUserSelect,
  })
  await prisma.auditLog.create({
    data: {
      clientId: client.id,
      actorUserId: req.user!.sub,
      action: 'CENTER_USER_CREATED',
      metadata: { centerCode: client.code, email: body.email, portalRole: body.portalRole },
    },
  })
  res.status(201).json({ client, user, temporaryPassword })
})

app.get('/api/client/study-sync/config', requireAuth, requireClientUser, async (req, res) => {
  const client = await prisma.client.findUniqueOrThrow({
    where: { id: req.user!.clientId! },
    select: { id: true, code: true, name: true, studySyncEnabled: true },
  })
  if (!client.studySyncEnabled) return res.status(403).json({ message: 'Study Sync Agent pipeline is not enabled for this client' })
  res.json(await buildStudySyncApiDetails(client))
})

registerWorklistRoutes(app, { requireAuth, studyScope: workspaceStudyScope })

app.get('/api/client/study-sync/available-studies/:studyId/attachments/:attachmentId', requireAuth, async (req, res) => {
  const scope = await workspaceStudyScope(req)
  const attachment = await prisma.bridgeStudyAttachment.findFirst({
    where: { id: String(req.params.attachmentId), bridgeStudyId: String(req.params.studyId), ...scope, bridgeStudy: { ...scope } },
  })
  if (!attachment) return res.status(404).json({ message: 'Attachment not found' })
  const filePath = await resolveSafeBundleFile(attachment.filePath)
  if (!filePath) return res.status(404).json({ message: 'Attachment file is unavailable' })
  const previewTypes: Record<string, string> = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.txt': 'text/plain' }
  const mime = previewTypes[path.extname(attachment.originalName).toLowerCase()] ?? 'application/octet-stream'
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Disposition', `${mime === 'application/octet-stream' || req.query.download === '1' ? 'attachment' : 'inline'}; filename="${sanitizeFileName(attachment.originalName)}"`)
  res.type(mime).sendFile(filePath)
})

app.get('/api/client/study-sync/available-studies/:studyId/download', requireAuth, async (req, res) => {
  const study = await prisma.availableBridgeStudy.findFirst({
    where: { id: String(req.params.studyId), ...await workspaceStudyScope(req) },
    include: {
      client: { select: { id: true, name: true, code: true } },
      processingJob: { select: { id: true, status: true, clinicalStatus: true, completedAt: true, priority: true, uploadName: true, uploadPath: true, upstreamStatus: true } },
      dispatchRequests: {
        select: { requestId: true, status: true, progressPercentage: true, createdAt: true, lastErrorMessage: true },
        orderBy: { createdAt: 'desc' },
      },
      attachments: true,
    },
  })
  if (!study) return res.status(404).json({ message: 'Study was not found for this client' })
  return sendBridgeStudyBundle(res, study)
})

app.post('/api/client/study-sync/manual-upload/:modality', requireAuth, requireClientUser, requireWorkspaceAction('upload'), async (req, res) => {
  const clientId = req.user!.clientId!
  const modality = z.enum(['XRAY', 'CT', 'MRI']).parse(String(req.params.modality).toUpperCase())
  const dicomModality = modality === 'XRAY' ? 'DX' : modality === 'MRI' ? 'MR' : 'CT'
  try {
    const upload = await saveManualAvailableStudyUpload(req)
    const extracted: DicomStudyMetadata = await extractDicomStudyMetadata(upload.filePath).catch(() => ({}))
    const study = await prisma.availableBridgeStudy.create({
      data: {
        publicStudyId: `BS-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
        clientId,
        agentId: `PORTAL-MANUAL-${req.user!.sub}`,
        agentName: 'Portal manual upload',
        studyInstanceUid: extracted.studyInstanceUid || `MANUAL-${crypto.randomUUID()}`,
        patientId: extracted.patientId ?? null,
        patientName: extracted.patientName ?? null,
        patientSex: extracted.patientSex ?? null,
        patientAge: extracted.patientAge ?? null,
        accessionNumber: extracted.accession ?? null,
        studyDate: extracted.studyDate ?? null,
        studyTime: extracted.studyTime ?? null,
        studyDescription: extracted.studyDescription ?? extracted.seriesDescription ?? extracted.protocolName ?? `${modality === 'XRAY' ? 'X-ray' : modality} manual upload`,
        modalities: classifyBreastXrayModalities([extracted.modality ?? dicomModality], extracted.bodyPartExamined),
        referringPhysician: extracted.referringPhysician ?? null,
        archiveName: upload.uploadName,
        archivePath: upload.filePath,
        totalSizeBytes: BigInt(upload.sizeBytes),
        availabilityStatus: 'Available',
        workflowStatus: 'Available',
        firstDetectedAt: new Date(),
        readyAt: new Date(),
        lastSyncedAt: new Date(),
      },
      include: { dispatchRequests: { orderBy: { createdAt: 'desc' }, take: 1 }, attachments: true, processingJob: true },
    })
    await prisma.auditLog.create({
      data: {
        clientId,
        actorUserId: req.user!.sub,
        action: 'MANUAL_STUDY_PARKED',
        metadata: { studyId: study.id, publicStudyId: study.publicStudyId, modality, uploadName: upload.uploadName },
      },
    })
    const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { code: true } })
    const renewistJob = await autoQueueAvailableStudyForRenewist({
      clientId,
      clientCode: client.code,
      studyId: study.id,
      requestedServiceType: inferBridgeServiceType({ modalities: study.modalities, studyDescription: study.studyDescription ?? undefined }),
      auditAction: 'MANUAL_STUDY_AUTO_SUBMITTED_TO_RENEWIST',
    })
    const updated = renewistJob
      ? await prisma.availableBridgeStudy.findUniqueOrThrow({
        where: { id: study.id },
        include: { dispatchRequests: { orderBy: { createdAt: 'desc' }, take: 1 }, attachments: true, processingJob: true },
      })
      : study
    res.status(201).json({ study: formatBridgeStudyForClient(updated), renewist_job_queued: Boolean(renewistJob) })
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to park manual study upload' })
  }
})

app.post('/api/client/study-sync/available-studies/:studyId/submit', requireAuth, requireWorkspaceAction('submit'), async (req, res) => {
  const study = await prisma.availableBridgeStudy.findFirst({
    where: { id: String(req.params.studyId), ...await workspaceStudyScope(req) },
    include: { attachments: true },
  })
  if (!study) return res.status(404).json({ message: 'Study was not found for this client' })
  const clientId = study.clientId
  if (study.availabilityStatus !== 'Available' || !study.archivePath) return res.status(409).json({ message: 'Study upload is not complete yet' })
  if (study.processingJobId) return res.status(409).json({ message: 'Study is already queued for processing' })

  try {
    const demoStatus = await getDemoUploadStatus(clientId)
    if (!demoStatus.allowed) return res.status(403).json({ message: demoStatus.message })
    const submission = await saveBridgeStudySubmission(req, clientId, study.id)
    const archiveMetadata = study.archivePath ? await extractDicomStudyMetadata(study.archivePath).catch(() => ({})) : {}
    const dicomMetadata = mergeDicomMetadata(bridgeStudyDicomMetadata(study), archiveMetadata)
    const serviceStudy = bridgeStudyWithMetadata(study, archiveMetadata)
    const serviceSelection = await resolveBridgeStudyService(clientId, serviceStudy, submission.serviceType)
    if (!serviceSelection) return res.status(400).json({ message: 'No active reporting service is configured for this study modality' })
    const job = await prisma.$transaction(async (tx) => {
      await tx.bridgeStudyAttachment.createMany({ data: submission.attachments })
      const currentPriority = await tx.availableBridgeStudy.findUniqueOrThrow({ where: { id: study.id }, select: { priority: true } })
      const selectedPriority = currentPriority.priority === 'URGENT' ? 'URGENT' : submission.priority
      const processingJob = await tx.processingJob.create({
        data: {
          clientId,
          serviceType: serviceSelection.serviceType,
          workflowType: serviceSelection.workflowType,
          clinicalStatus: 'QUEUED',
          priority: selectedPriority,
          uploadName: study.archiveName ?? path.basename(study.archivePath!),
          uploadPath: study.archivePath!,
          demoMode: demoStatus.demoMode,
          upstreamStatus: {
            state: 'queued_for_renewist_from_bridge_upload',
            bridgeStudyId: study.id,
            clinicalIndication: submission.clinicalIndication,
            priority: selectedPriority,
            supportingFiles: submission.attachments.map((item) => ({ name: item.originalName, sizeBytes: String(item.sizeBytes), mimeType: item.mimeType })),
            dicomMetadata,
          },
        },
      })
      await tx.availableBridgeStudy.update({
        where: { id: study.id },
        data: {
          clinicalIndication: submission.noClinicalIndication ? null : submission.clinicalIndication || null,
          workflowStatus: 'QueuedForRenewist',
          priority: selectedPriority,
          selectedAt: new Date(),
          submittedAt: new Date(),
          processingJobId: processingJob.id,
        },
      })
      await tx.auditLog.create({
        data: {
          clientId,
          actorUserId: req.user!.sub,
          action: 'BRIDGE_STUDY_SUBMITTED_FOR_REPORTING',
          metadata: { studyId: study.id, publicStudyId: study.publicStudyId, processingJobId: processingJob.id, attachmentCount: submission.attachments.length, priority: selectedPriority },
        },
      })
      await enqueueTelegramStudy(tx, processingJob, study.modalities[0], undefined, study.studyDescription)
      return processingJob
    })
    queueRenewistSubmission(job.id, 'Bridge portal submission')
    const updated = await prisma.availableBridgeStudy.findUniqueOrThrow({
      where: { id: study.id },
      include: { dispatchRequests: { orderBy: { createdAt: 'desc' }, take: 1 }, attachments: { orderBy: { createdAt: 'desc' } }, processingJob: true },
    })
    res.status(201).json({ study: formatBridgeStudyForClient(updated), job })
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to submit study for reporting' })
  }
})

app.post('/api/client/study-sync/available-studies/:studyId/additional-info', requireAuth, requireWorkspaceAction('attach'), async (req, res) => {
  const study = await prisma.availableBridgeStudy.findFirst({
    where: { id: String(req.params.studyId), ...await workspaceStudyScope(req) },
    include: { attachments: true },
  })
  if (!study) return res.status(404).json({ message: 'Study was not found for this client' })
  const clientId = study.clientId

  try {
    const submission = await saveBridgeStudySubmission(req, clientId, study.id)
    if (study.attachments.length + submission.attachments.length > 5) {
      await Promise.all(submission.attachments.map((attachment) => fs.rm(attachment.filePath, { force: true }).catch(() => undefined)))
      return res.status(400).json({ message: 'Upload up to 5 supporting files per study.' })
    }
    const updated = await prisma.$transaction(async (tx) => {
      await tx.bridgeStudyAttachment.createMany({ data: submission.attachments })
      await tx.availableBridgeStudy.update({
        where: { id: study.id },
        data: {
          clinicalIndication: submission.noClinicalIndication ? null : submission.clinicalIndication || study.clinicalIndication,
        },
      })
      await tx.auditLog.create({
        data: {
          clientId,
          actorUserId: req.user!.sub,
          action: 'BRIDGE_STUDY_ADDITIONAL_INFO_SAVED',
          metadata: { studyId: study.id, publicStudyId: study.publicStudyId, attachmentCount: submission.attachments.length, hasClinicalIndication: Boolean(submission.clinicalIndication) },
        },
      })
      return tx.availableBridgeStudy.findUniqueOrThrow({
        where: { id: study.id },
        include: { dispatchRequests: { orderBy: { createdAt: 'desc' }, take: 1 }, attachments: { orderBy: { createdAt: 'desc' } }, processingJob: true },
      })
    })
    res.status(200).json({ study: formatBridgeStudyForClient(updated) })
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to save study details' })
  }
})

app.delete('/api/client/study-sync/available-studies/:studyId', requireAuth, requireClientUser, async (req, res) => {
  const clientId = req.user!.clientId!
  const study = await prisma.availableBridgeStudy.findFirst({
    where: { id: String(req.params.studyId), clientId },
    include: { attachments: true },
  })
  if (!study) return res.status(404).json({ message: 'Study was not found for this client' })
  if (study.processingJobId) return res.status(409).json({ message: 'Submitted or processed studies cannot be removed from the portal' })

  const pathsToDelete = [
    study.archivePath,
    ...study.attachments.map((attachment) => attachment.filePath),
  ].filter((value): value is string => Boolean(value))

  await prisma.$transaction([
    prisma.auditLog.create({
      data: {
        clientId,
        actorUserId: req.user!.sub,
        action: 'AVAILABLE_BRIDGE_STUDY_REMOVED',
        metadata: { studyId: study.id, publicStudyId: study.publicStudyId, archiveName: study.archiveName, attachmentCount: study.attachments.length },
      },
    }),
    prisma.availableBridgeStudy.delete({ where: { id: study.id } }),
  ])

  await Promise.all(pathsToDelete.map(async (filePath) => {
    const resolved = path.resolve(filePath)
    if (!resolved.startsWith(uploadsPath)) return
    await fs.rm(resolved, { force: true }).catch(() => undefined)
  }))
  if (study.archivePath) {
    const archiveFolder = path.dirname(study.archivePath)
    const resolvedFolder = path.resolve(archiveFolder)
    if (resolvedFolder.startsWith(path.join(uploadsPath, 'bridge-studies'))) {
      await fs.rm(resolvedFolder, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  res.json({ ok: true, removedStudyId: study.id })
})

app.get('/api/client/study-sync/bridge-status', requireAuth, requireClientUser, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  const clientId = req.user!.clientId!
  const latestCommand = await prisma.bridgeControlCommand.findFirst({
    where: { clientId },
    orderBy: { createdAt: 'desc' },
  })
  const recentCommands = await prisma.bridgeControlCommand.findMany({
    where: { clientId },
    orderBy: { createdAt: 'desc' },
    take: 5,
  })
  const studyCount = await prisma.availableBridgeStudy.count({ where: { clientId } })
  const pendingDispatchCount = await prisma.bridgeDispatchRequest.count({ where: { clientId, status: { in: ['Pending', 'AgentAcknowledged', 'Sending'] } } })
  res.json({
    studyCount,
    pendingDispatchCount,
    latestCommand: latestCommand ? {
      commandId: latestCommand.commandId,
      agentId: latestCommand.agentId,
      type: latestCommand.type,
      status: latestCommand.status,
      requestedAt: latestCommand.requestedAt,
      acknowledgedAt: latestCommand.acknowledgedAt,
      completedAt: latestCommand.completedAt,
      lastErrorMessage: latestCommand.lastErrorMessage,
    } : null,
    recentCommands: recentCommands.map((command) => ({
      commandId: command.commandId,
      agentId: command.agentId,
      type: command.type,
      status: command.status,
      requestedAt: command.requestedAt,
      acknowledgedAt: command.acknowledgedAt,
      completedAt: command.completedAt,
      lastErrorMessage: command.lastErrorMessage,
    })),
  })
})

app.post('/api/client/study-sync/scan-request', requireAuth, requireClientUser, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  const clientId = req.user!.clientId!
  const body = z.object({
    agentId: z.string().min(1).optional(),
  }).parse(req.body)
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { code: true, studySyncEnabled: true } })
  if (!client.studySyncEnabled) return res.status(403).json({ message: 'Study Sync Agent pipeline is not enabled for this client' })
  const latestStudy = body.agentId ? null : await prisma.availableBridgeStudy.findFirst({
    where: { clientId },
    orderBy: { lastSyncedAt: 'desc' },
    select: { agentId: true },
  })
  const agentId = body.agentId ?? latestStudy?.agentId ?? client.code
  const activeCommand = await prisma.bridgeControlCommand.findFirst({
    where: { clientId, agentId, type: 'InventoryScan', status: { in: ['Pending', 'AgentAcknowledged', 'Running'] } },
    orderBy: { requestedAt: 'desc' },
  })
  if (activeCommand) return res.status(202).json({ command: formatBridgeCommandForAgent(activeCommand, client.code), reused: true })

  const command = await prisma.bridgeControlCommand.create({
    data: {
      commandId: `BC-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
      clientId,
      agentId,
      type: 'InventoryScan',
      requestedBy: req.user!.sub,
      payloadJson: { requested_by: 'portal', include_studies: true },
    },
  })
  await prisma.auditLog.create({
    data: {
      clientId,
      actorUserId: req.user!.sub,
      action: 'BRIDGE_INVENTORY_SCAN_REQUESTED',
      metadata: { commandId: command.commandId, agentId },
    },
  })
  res.status(201).json({ command: formatBridgeCommandForAgent(command, client.code), reused: false })
})

app.post('/api/client/study-sync/available-studies/:studyId/select', requireAuth, requireClientUser, async (req, res) => {
  res.status(410).json({ message: 'Bridge dispatch selection has been replaced by direct Bridge upload and submit processing.' })
})

app.post(['/api/v1/bridge/studies/receiving', '/api/v1/study-bridge/studies/receiving'], async (req, res) => {
  const auth = await requireBridgeToken(req, res)
  if (!auth) return
  const parsedBody = bridgeReceivingSchema.safeParse(req.body)
  if (!parsedBody.success) return res.status(400).json({ error: { code: 'INVALID_BRIDGE_STUDY', message: parsedBody.error.issues[0]?.message ?? 'Invalid bridge study payload' } })
  const body = parsedBody.data
  const centerCode = bridgeCenterCode(body)
  if (!centerCode) return res.status(400).json({ error: { code: 'CENTER_CODE_REQUIRED', message: 'center_code is required' } })
  const client = await findBridgeClient(centerCode)
  if (!client) return res.status(403).json({ error: { code: 'CLIENT_NOT_ENABLED', message: 'Client is not active or center_code is invalid' } })
  const agentId = body.agent_id || body.local_ae_title || client.code
  let metadata: DirectBridgeStudyMetadata
  try {
    metadata = normalizeDirectBridgeStudyMetadata(body)
  } catch (error) {
    return res.status(400).json({ error: { code: 'INVALID_BRIDGE_STUDY', message: error instanceof Error ? error.message : 'Invalid bridge study payload' } })
  }
  const study = await prisma.availableBridgeStudy.upsert({
    where: { clientId_agentId_studyInstanceUid: { clientId: client.id, agentId, studyInstanceUid: metadata.study_instance_uid } },
    update: directBridgeStudyData(metadata, body, 'Receiving', 'Receiving'),
    create: {
      publicStudyId: `BS-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
      clientId: client.id,
      agentId,
      studyInstanceUid: metadata.study_instance_uid,
      ...directBridgeStudyData(metadata, body, 'Receiving', 'Receiving'),
    },
    include: { attachments: true, processingJob: true, dispatchRequests: { orderBy: { createdAt: 'desc' }, take: 1 } },
  })
  await enqueueStudyStatusNotification(prisma, {
    eventType: 'BRIDGE_STUDY_RECEIVING',
    clientId: client.id,
    status: 'RECEIVING',
    patientName: study.patientName,
    patientId: study.patientId,
    accession: study.accessionNumber,
    modality: study.modalities.join('/'),
    serviceName: 'Study Sync',
    idempotencyKey: `study-status:bridge-receiving:${study.id}:${study.updatedAt.getTime()}`,
  })
  res.status(202).json({ study_id: study.id, public_study_id: study.publicStudyId, status: study.availabilityStatus, study: formatBridgeStudyForClient(study) })
})

app.post(['/api/v1/bridge/studies/park', '/api/v1/study-bridge/studies/park'], async (req, res) => {
  const auth = await requireBridgeToken(req, res)
  if (!auth) return
  try {
    const body = bridgeReceivingSchema.parse(req.body)
    const centerCode = bridgeCenterCode(body)
    if (!centerCode) return res.status(400).json({ error: { code: 'CENTER_CODE_REQUIRED', message: 'center_code is required' } })
    const client = await findBridgeClient(centerCode)
    if (!client) return res.status(403).json({ error: { code: 'CLIENT_NOT_ENABLED', message: 'Client is not active or center_code is invalid' } })
    const agentId = body.agent_id || body.local_ae_title || client.code
    const metadata = normalizeDirectBridgeStudyMetadata(body)
    const study = await prisma.availableBridgeStudy.upsert({
      where: { clientId_agentId_studyInstanceUid: { clientId: client.id, agentId, studyInstanceUid: metadata.study_instance_uid } },
      update: { ...directBridgeStudyData(metadata, body, 'Available', 'Available'), readyAt: new Date() },
      create: {
        publicStudyId: `BS-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
        clientId: client.id,
        agentId,
        studyInstanceUid: metadata.study_instance_uid,
        ...directBridgeStudyData(metadata, body, 'Available', 'Available'),
        readyAt: new Date(),
      },
      include: { attachments: true, processingJob: true, dispatchRequests: { orderBy: { createdAt: 'desc' }, take: 1 } },
    })
    await enqueueStudyStatusNotification(prisma, {
      eventType: 'BRIDGE_STUDY_AVAILABLE',
      clientId: client.id,
      status: 'AVAILABLE',
      patientName: study.patientName,
      patientId: study.patientId,
      accession: study.accessionNumber,
      modality: study.modalities.join('/'),
      serviceName: 'Study Sync',
      idempotencyKey: `study-status:bridge-parked:${study.id}:${study.updatedAt.getTime()}`,
    })
    res.status(201).json({ study_id: study.id, public_study_id: study.publicStudyId, status: study.availabilityStatus, study: formatBridgeStudyForClient(study) })
  } catch (error) {
    res.status(400).json({ error: { code: 'BRIDGE_STUDY_PARK_FAILED', message: error instanceof Error ? error.message : 'Unable to park bridge study' } })
  }
})

app.post(['/api/v1/bridge/studies/upload', '/api/v1/study-bridge/studies/upload'], async (req, res) => {
  const auth = await requireBridgeToken(req, res)
  if (!auth) return
  try {
    const upload = await saveDirectBridgeStudyUpload(req)
    const client = await findBridgeClient(upload.clientCode)
    if (!client) {
      await fs.rm(upload.folder, { recursive: true, force: true }).catch(() => undefined)
      return res.status(403).json({ error: { code: 'CLIENT_NOT_ENABLED', message: 'Client is not active or center_code is invalid' } })
    }
    const agentId = upload.agentId || upload.localAeTitle || client.code
    const study = await prisma.availableBridgeStudy.upsert({
      where: { clientId_agentId_studyInstanceUid: { clientId: client.id, agentId, studyInstanceUid: upload.metadata.study_instance_uid } },
      update: {
        ...directBridgeStudyData(upload.metadata, upload, 'Available', 'Available'),
        archiveName: upload.uploadName,
        archivePath: upload.filePath,
        totalSizeBytes: BigInt(upload.sizeBytes),
        readyAt: new Date(),
      },
      create: {
        publicStudyId: `BS-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
        clientId: client.id,
        agentId,
        studyInstanceUid: upload.metadata.study_instance_uid,
        ...directBridgeStudyData(upload.metadata, upload, 'Available', 'Available'),
        archiveName: upload.uploadName,
        archivePath: upload.filePath,
        totalSizeBytes: BigInt(upload.sizeBytes),
        readyAt: new Date(),
      },
      include: { attachments: true, processingJob: true, dispatchRequests: { orderBy: { createdAt: 'desc' }, take: 1 } },
    })
    const autoQueuedJob = await autoQueueAvailableStudyForRenewist({
      clientId: client.id,
      clientCode: client.code,
      studyId: study.id,
      requestedServiceType: inferBridgeServiceType({
        modalities: upload.metadata.modalities,
        studyDescription: upload.metadata.study_description ?? undefined,
      }),
      auditAction: 'BRIDGE_STUDY_AUTO_SUBMITTED_TO_RENEWIST',
    })
    await enqueueStudyStatusNotification(prisma, {
      eventType: autoQueuedJob ? 'STUDY_SUBMITTED_TO_RENEWIST' : 'BRIDGE_STUDY_AVAILABLE',
      clientId: client.id,
      status: autoQueuedJob ? 'QUEUED' : 'AVAILABLE',
      patientName: study.patientName,
      patientId: study.patientId,
      accession: study.accessionNumber,
      modality: study.modalities.join('/'),
      serviceName: autoQueuedJob ? serviceNameForType(autoQueuedJob.serviceType) : 'Study Sync',
      idempotencyKey: `study-status:bridge-available:${study.id}:${study.updatedAt.getTime()}`,
    })
    const acknowledgement = {
      study_id: study.id,
      public_study_id: study.publicStudyId,
      status: autoQueuedJob ? 'QueuedForRenewist' : study.availabilityStatus,
      upload_name: study.archiveName,
      size_bytes: String(study.totalSizeBytes),
      auto_queued: Boolean(autoQueuedJob),
      processing_job_id: autoQueuedJob?.id,
      study: formatBridgeStudyForClient(autoQueuedJob
        ? await prisma.availableBridgeStudy.findUniqueOrThrow({
          where: { id: study.id },
          include: { attachments: true, processingJob: true, dispatchRequests: { orderBy: { createdAt: 'desc' }, take: 1 } },
        })
        : study),
    }
    if (autoQueuedJob) await recordStudyAcknowledgement(autoQueuedJob.id, 'BRIDGE_EXCHANGE', acknowledgement)
    res.status(201).json(acknowledgement)
  } catch (error) {
    res.status(400).json({ error: { code: 'BRIDGE_UPLOAD_FAILED', message: error instanceof Error ? error.message : 'Unable to upload bridge study' } })
  }
})

app.post(['/api/v1/study-bridge/register', '/api/v1/study-agents/register'], async (req, res) => {
  const expectedTokens = getBridgeExpectedTokens()
  const expected = expectedTokens[0]
  if (!expected) return res.status(503).json({ error: { code: 'BRIDGE_TOKEN_NOT_CONFIGURED', message: 'Bridge API token is not configured on the portal' } })
  const body = z.object({
    center_code: z.string().min(1).optional(),
    client_id: z.string().min(1).optional(),
    agent_id: z.string().min(1).optional(),
    agent_name: z.string().optional(),
    registration_code: z.string().optional(),
  }).parse(req.body)
  const presented = readBridgePresentedToken(req) || body.registration_code || ''
  if (!expectedTokens.includes(presented)) return res.status(401).json({ error: { code: 'INVALID_BRIDGE_TOKEN', message: 'Invalid bridge registration token' } })
  const centerCode = bridgeCenterCode(body)
  if (!centerCode) return res.status(400).json({ error: { code: 'CENTER_CODE_REQUIRED', message: 'center_code is required' } })
  const client = await findBridgeClient(centerCode)
  if (!client) return res.status(403).json({ error: { code: 'CLIENT_NOT_ENABLED', message: 'Client is not active or center_code is invalid' } })
  const agentId = body.agent_id ?? client.code
  res.json({
    center_code: client.code,
    client_id: client.code,
    agent_id: agentId,
    agent_name: body.agent_name ?? null,
    access_token: expected,
    token_type: 'Bearer',
    expires_in: 31536000,
    poll_interval_seconds: 3,
  })
})

app.post(['/api/v1/study-bridge/token/refresh', '/api/v1/study-agents/token/refresh'], async (req, res) => {
  const auth = await requireBridgeToken(req, res)
  if (!auth) return
  const expected = getBridgeExpectedToken()
  res.json({ access_token: expected, token_type: 'Bearer', expires_in: 31536000 })
})

app.post(['/api/v1/study-bridge/:agentId/heartbeat', '/api/v1/study-agents/:agentId/heartbeat'], async (req, res) => {
  const auth = await requireBridgeToken(req, res)
  if (!auth) return
  const body = z.object({
    center_code: z.string().min(1).optional(),
    client_id: z.string().min(1).optional(),
    agent_name: z.string().optional(),
    status: z.string().optional(),
    local_study_count: z.number().int().min(0).optional(),
  }).passthrough().parse(req.body ?? {})
  const centerCode = bridgeCenterCode(body, req)
  if (!centerCode) return res.status(400).json({ error: { code: 'CENTER_CODE_REQUIRED', message: 'center_code is required' } })
  const client = await findBridgeClient(centerCode)
  if (!client) return res.status(403).json({ error: { code: 'CLIENT_NOT_ENABLED', message: 'Client is not active or center_code is invalid' } })
  res.json({
    ok: true,
    center_code: client.code,
    client_id: client.code,
    agent_id: String(req.params.agentId),
    server_time: new Date().toISOString(),
    poll_interval_seconds: 3,
  })
})

app.post(['/api/v1/study-bridge/studies/sync', '/api/v1/study-bridge/:agentId/studies/sync', '/api/v1/study-agents/studies/sync', '/api/v1/study-agents/:agentId/studies/sync'], async (req, res) => {
  const auth = await requireBridgeToken(req, res)
  if (!auth) return
  const body = z.object({
    center_code: z.string().min(1).optional(),
    client_id: z.string().min(1).optional(),
    agent_id: z.string().min(1).optional(),
    agent_name: z.string().optional(),
    sync_batch_id: z.string().optional(),
    studies: z.array(z.object({
      study_instance_uid: z.string().min(1),
      patient_id: z.string().optional().nullable(),
      patient_name: z.string().optional().nullable(),
      patient_sex: z.string().optional().nullable(),
      patient_age: z.string().optional().nullable(),
      accession_number: z.string().optional().nullable(),
      study_date: z.string().optional().nullable(),
      study_time: z.string().optional().nullable(),
      study_description: z.string().optional().nullable(),
      body_part_examined: z.string().optional().nullable(),
      bodyPartExamined: z.string().optional().nullable(),
      modalities: z.array(z.string()).optional().default([]),
      institution_name: z.string().optional().nullable(),
      referring_physician: z.string().optional().nullable(),
      series_count: z.number().int().min(0).optional().default(0),
      instance_count: z.number().int().min(0).optional().default(0),
      total_size_bytes: z.number().int().min(0).optional().default(0),
      study_fingerprint: z.string().optional().nullable(),
      first_detected_at: z.string().datetime().optional().nullable(),
      ready_at: z.string().datetime().optional().nullable(),
      availability_status: z.enum(['available', 'locally_missing', 'deleted', 'restored', 'unknown']).optional().default('available'),
    })).max(Number(process.env.BRIDGE_STUDY_SYNC_MAX_BATCH ?? 100)),
  }).parse(req.body)
  const agentId = body.agent_id ?? String(req.params.agentId ?? '')
  if (!agentId) return res.status(400).json({ error: { code: 'AGENT_ID_REQUIRED', message: 'agent_id is required in body or URL' } })
  const centerCode = bridgeCenterCode(body)
  if (!centerCode) return res.status(400).json({ error: { code: 'CENTER_CODE_REQUIRED', message: 'center_code is required' } })
  const client = await findBridgeClient(centerCode)
  if (!client) return res.status(403).json({ error: { code: 'CLIENT_NOT_ENABLED', message: 'Client is not active or center_code is invalid' } })
  const accepted = []
  const rejected = []
  for (const study of body.studies) {
    try {
      const existing = await prisma.availableBridgeStudy.findUnique({
        where: { clientId_agentId_studyInstanceUid: { clientId: client.id, agentId, studyInstanceUid: study.study_instance_uid } },
      })
      const availabilityStatus = normalizeBridgeAvailability(study.availability_status)
      const workflowStatus = existing?.workflowStatus && !['Available', 'Selected'].includes(existing.workflowStatus) ? existing.workflowStatus : availabilityStatus === 'Available' ? existing?.workflowStatus ?? 'Available' : 'StudyUnavailable'
      const saved = await prisma.availableBridgeStudy.upsert({
        where: { clientId_agentId_studyInstanceUid: { clientId: client.id, agentId, studyInstanceUid: study.study_instance_uid } },
        update: bridgeStudyData(study, { agent_id: agentId, agent_name: body.agent_name }, availabilityStatus, workflowStatus),
        create: {
          publicStudyId: `BS-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
          clientId: client.id,
          agentId,
          studyInstanceUid: study.study_instance_uid,
          ...bridgeStudyData(study, { agent_id: agentId, agent_name: body.agent_name }, availabilityStatus, workflowStatus),
        },
      })
      accepted.push({ study_instance_uid: study.study_instance_uid, portal_study_id: saved.id, public_study_id: saved.publicStudyId, status: existing ? 'updated' : 'created' })
    } catch (error) {
      rejected.push({ study_instance_uid: study.study_instance_uid, code: 'INVALID_METADATA', message: error instanceof Error ? error.message : 'Unable to save study metadata' })
    }
  }
  res.json({ sync_batch_id: body.sync_batch_id ?? null, accepted, rejected })
})

app.get(['/api/v1/study-bridge/:agentId/dispatch-requests', '/api/v1/study-agents/:agentId/dispatch-requests'], async (req, res) => {
  const auth = await requireBridgeToken(req, res)
  if (!auth) return
  const centerCode = bridgeCenterCode({}, req)
  if (!centerCode) return res.status(400).json({ error: { code: 'CENTER_CODE_REQUIRED', message: 'center_code is required' } })
  const client = await findBridgeClient(centerCode)
  if (!client) return res.status(403).json({ error: { code: 'CLIENT_NOT_ENABLED', message: 'Client is not active or center_code is invalid' } })
  const statuses = normalizeBridgeStatusList(req.query.status, ['Pending'])
  const requests = await prisma.bridgeDispatchRequest.findMany({
    where: { clientId: client.id, agentId: String(req.params.agentId), status: { in: statuses } },
    include: { availableStudy: true },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    take: Math.min(50, Math.max(1, Number(req.query.limit ?? 10))),
  })
  res.json({ requests: requests.map((request) => formatBridgeDispatchForAgent(request, request.availableStudy, client.code)) })
})

app.get(['/api/v1/study-bridge/:agentId/commands', '/api/v1/study-agents/:agentId/commands'], async (req, res) => {
  const auth = await requireBridgeToken(req, res)
  if (!auth) return
  const centerCode = bridgeCenterCode({}, req)
  if (!centerCode) return res.status(400).json({ error: { code: 'CENTER_CODE_REQUIRED', message: 'center_code is required' } })
  const client = await findBridgeClient(centerCode)
  if (!client) return res.status(403).json({ error: { code: 'CLIENT_NOT_ENABLED', message: 'Client is not active or center_code is invalid' } })
  const statuses = normalizeBridgeStatusList(req.query.status, ['Pending'])
  const commands = await prisma.bridgeControlCommand.findMany({
    where: { clientId: client.id, agentId: String(req.params.agentId), status: { in: statuses } },
    orderBy: { requestedAt: 'asc' },
    take: Math.min(50, Math.max(1, Number(req.query.limit ?? 10))),
  })
  res.json({ commands: commands.map((command) => formatBridgeCommandForAgent(command, client.code)) })
})

app.post(['/api/v1/study-bridge/:agentId/commands/:commandId/acknowledge', '/api/v1/study-agents/:agentId/commands/:commandId/acknowledge'], async (req, res) => {
  const auth = await requireBridgeToken(req, res)
  if (!auth) return
  const centerCode = bridgeCenterCode(req.body ?? {}, req)
  if (!centerCode) return res.status(400).json({ error: { code: 'CENTER_CODE_REQUIRED', message: 'center_code is required' } })
  const client = await findBridgeClient(centerCode)
  if (!client) return res.status(403).json({ error: { code: 'CLIENT_NOT_ENABLED', message: 'Client is not active or center_code is invalid' } })
  const existing = await prisma.bridgeControlCommand.findFirst({
    where: { commandId: String(req.params.commandId), agentId: String(req.params.agentId), clientId: client.id },
  })
  if (!existing) return res.status(404).json({ error: { code: 'COMMAND_NOT_FOUND', message: 'Command not found for this agent' } })
  const command = await prisma.bridgeControlCommand.update({
    where: { id: existing.id },
    data: { status: 'AgentAcknowledged', acknowledgedAt: new Date() },
  })
  res.json({ command: formatBridgeCommandForAgent(command, client.code) })
})

app.post(['/api/v1/study-bridge/:agentId/commands/:commandId/result', '/api/v1/study-bridge/:agentId/commands/:commandId/complete', '/api/v1/study-agents/:agentId/commands/:commandId/result', '/api/v1/study-agents/:agentId/commands/:commandId/complete'], async (req, res) => {
  const auth = await requireBridgeToken(req, res)
  if (!auth) return
  const body = z.object({
    center_code: z.string().min(1).optional(),
    client_id: z.string().min(1).optional(),
    agent_name: z.string().optional(),
    status: z.enum(['completed', 'failed']).default('completed'),
    error: z.object({ code: z.string().optional(), message: z.string().optional() }).optional().nullable(),
    studies: z.array(z.object({
      study_instance_uid: z.string().min(1),
      patient_id: z.string().optional().nullable(),
      patient_name: z.string().optional().nullable(),
      patient_sex: z.string().optional().nullable(),
      patient_age: z.string().optional().nullable(),
      accession_number: z.string().optional().nullable(),
      study_date: z.string().optional().nullable(),
      study_time: z.string().optional().nullable(),
      study_description: z.string().optional().nullable(),
      body_part_examined: z.string().optional().nullable(),
      bodyPartExamined: z.string().optional().nullable(),
      modalities: z.array(z.string()).optional().default([]),
      institution_name: z.string().optional().nullable(),
      referring_physician: z.string().optional().nullable(),
      series_count: z.number().int().min(0).optional().default(0),
      instance_count: z.number().int().min(0).optional().default(0),
      total_size_bytes: z.number().int().min(0).optional().default(0),
      study_fingerprint: z.string().optional().nullable(),
      first_detected_at: z.string().datetime().optional().nullable(),
      ready_at: z.string().datetime().optional().nullable(),
      availability_status: z.enum(['available', 'locally_missing', 'deleted', 'restored', 'unknown']).optional().default('available'),
    })).max(Number(process.env.BRIDGE_STUDY_SYNC_MAX_BATCH ?? 1000)).default([]),
  }).parse(req.body)
  const centerCode = bridgeCenterCode(body, req)
  if (!centerCode) return res.status(400).json({ error: { code: 'CENTER_CODE_REQUIRED', message: 'center_code is required' } })
  const client = await findBridgeClient(centerCode)
  if (!client) return res.status(403).json({ error: { code: 'CLIENT_NOT_ENABLED', message: 'Client is not active or center_code is invalid' } })
  const command = await prisma.bridgeControlCommand.findFirst({
    where: { commandId: String(req.params.commandId), agentId: String(req.params.agentId), clientId: client.id },
  })
  if (!command) return res.status(404).json({ error: { code: 'COMMAND_NOT_FOUND', message: 'Command not found for this agent' } })

  const accepted = []
  const rejected = []
  if (body.status === 'completed') {
    for (const study of body.studies) {
      try {
        const existing = await prisma.availableBridgeStudy.findUnique({
          where: { clientId_agentId_studyInstanceUid: { clientId: client.id, agentId: String(req.params.agentId), studyInstanceUid: study.study_instance_uid } },
        })
        const availabilityStatus = normalizeBridgeAvailability(study.availability_status)
        const workflowStatus = existing?.workflowStatus && !['Available', 'Selected'].includes(existing.workflowStatus) ? existing.workflowStatus : availabilityStatus === 'Available' ? existing?.workflowStatus ?? 'Available' : 'StudyUnavailable'
        const saved = await prisma.availableBridgeStudy.upsert({
          where: { clientId_agentId_studyInstanceUid: { clientId: client.id, agentId: String(req.params.agentId), studyInstanceUid: study.study_instance_uid } },
          update: bridgeStudyData(study, { agent_id: String(req.params.agentId), agent_name: body.agent_name }, availabilityStatus, workflowStatus),
          create: {
            publicStudyId: `BS-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
            clientId: client.id,
            agentId: String(req.params.agentId),
            studyInstanceUid: study.study_instance_uid,
            ...bridgeStudyData(study, { agent_id: String(req.params.agentId), agent_name: body.agent_name }, availabilityStatus, workflowStatus),
          },
        })
        accepted.push({ study_instance_uid: study.study_instance_uid, portal_study_id: saved.id, public_study_id: saved.publicStudyId, status: existing ? 'updated' : 'created' })
      } catch (error) {
        rejected.push({ study_instance_uid: study.study_instance_uid, code: 'INVALID_METADATA', message: error instanceof Error ? error.message : 'Unable to save study metadata' })
      }
    }
  }
  const updated = await prisma.bridgeControlCommand.update({
    where: { id: command.id },
    data: {
      status: body.status === 'completed' ? 'Completed' : 'Failed',
      completedAt: new Date(),
      resultJson: { accepted, rejected, study_count: body.studies.length },
      lastErrorCode: body.error?.code ?? null,
      lastErrorMessage: body.error?.message ?? null,
    },
  })
  res.json({ command: updated, accepted, rejected })
})

app.post(['/api/v1/study-bridge/:agentId/dispatch-requests/:requestId/acknowledge', '/api/v1/study-agents/:agentId/dispatch-requests/:requestId/acknowledge'], async (req, res) => {
  const auth = await requireBridgeToken(req, res)
  if (!auth) return
  const centerCode = bridgeCenterCode(req.body ?? {}, req)
  if (!centerCode) return res.status(400).json({ error: { code: 'CENTER_CODE_REQUIRED', message: 'center_code is required' } })
  const client = await findBridgeClient(centerCode)
  if (!client) return res.status(403).json({ error: { code: 'CLIENT_NOT_ENABLED', message: 'Client is not active or center_code is invalid' } })
  const request = await prisma.bridgeDispatchRequest.findFirst({
    where: { requestId: String(req.params.requestId), agentId: String(req.params.agentId), clientId: client.id },
    include: { availableStudy: true },
  })
  if (!request) return res.status(404).json({ error: { code: 'DISPATCH_NOT_FOUND', message: 'Dispatch request not found for this agent' } })
  const dispatch = await prisma.bridgeDispatchRequest.update({
    where: { id: request.id },
    data: { status: 'AgentAcknowledged', agentAcknowledgedAt: new Date() },
  })
  await prisma.availableBridgeStudy.update({
    where: { id: request.availableStudyId },
    data: { workflowStatus: 'Dispatching' },
  })
  res.json({ request: formatBridgeDispatchForAgent(dispatch, request.availableStudy, client.code) })
})

app.post(['/api/v1/study-bridge/:agentId/dispatch-requests/:requestId/complete', '/api/v1/study-agents/:agentId/dispatch-requests/:requestId/complete'], async (req, res) => {
  const auth = await requireBridgeToken(req, res)
  if (!auth) return
  const body = z.object({
    center_code: z.string().min(1).optional(),
    client_code: z.string().min(1).optional(),
    client_id: z.string().min(1).optional(),
    total_instances: z.number().int().min(0).optional(),
    sent_instances: z.number().int().min(0).optional(),
    failed_instances: z.number().int().min(0).optional(),
  }).passthrough().parse(req.body ?? {})
  const centerCode = bridgeCenterCode(body, req)
  if (!centerCode) return res.status(400).json({ error: { code: 'CENTER_CODE_REQUIRED', message: 'center_code is required' } })
  const client = await findBridgeClient(centerCode)
  if (!client) return res.status(403).json({ error: { code: 'CLIENT_NOT_ENABLED', message: 'Client is not active or center_code is invalid' } })
  const request = await prisma.bridgeDispatchRequest.findFirst({
    where: { requestId: String(req.params.requestId), agentId: String(req.params.agentId), clientId: client.id },
    include: { availableStudy: true },
  })
  if (!request) return res.status(404).json({ error: { code: 'DISPATCH_NOT_FOUND', message: 'Dispatch request not found for this agent' } })
  const dispatch = await prisma.$transaction(async (tx) => {
    const updated = await tx.bridgeDispatchRequest.update({
      where: { id: request.id },
      data: {
        status: 'Sent',
        totalInstances: body.total_instances ?? request.totalInstances,
        sentInstances: body.sent_instances ?? body.total_instances ?? request.totalInstances,
        failedInstances: body.failed_instances ?? 0,
        progressPercentage: 100,
        completedAt: new Date(),
      },
    })
    await tx.availableBridgeStudy.update({
      where: { id: request.availableStudyId },
      data: { workflowStatus: 'Delivered' },
    })
    return updated
  })
  res.json({ request: dispatch })
})

app.post(['/api/v1/study-bridge/:agentId/dispatch-requests/:requestId/progress', '/api/v1/study-agents/:agentId/dispatch-requests/:requestId/progress'], async (req, res) => {
  const auth = await requireBridgeToken(req, res)
  if (!auth) return
  const body = z.object({
    center_code: z.string().min(1).optional(),
    client_code: z.string().min(1).optional(),
    client_id: z.string().min(1).optional(),
    status: z.enum(['accepted', 'sending', 'sent', 'failed', 'partially_sent', 'study_not_found']).default('sending'),
    total_instances: z.number().int().min(0).optional(),
    sent_instances: z.number().int().min(0).optional(),
    failed_instances: z.number().int().min(0).optional(),
    progress_percentage: z.number().min(0).max(100).optional(),
    error: z.object({ code: z.string().optional(), message: z.string().optional() }).optional().nullable(),
  }).parse(req.body)
  const centerCode = bridgeCenterCode(body, req)
  if (!centerCode) return res.status(400).json({ error: { code: 'CENTER_CODE_REQUIRED', message: 'center_code is required' } })
  const client = await findBridgeClient(centerCode)
  if (!client) return res.status(403).json({ error: { code: 'CLIENT_NOT_ENABLED', message: 'Client is not active or center_code is invalid' } })
  const request = await prisma.bridgeDispatchRequest.findFirst({
    where: { requestId: String(req.params.requestId), agentId: String(req.params.agentId), clientId: client.id },
    include: { availableStudy: true },
  })
  if (!request) return res.status(404).json({ error: { code: 'DISPATCH_NOT_FOUND', message: 'Dispatch request not found for this agent' } })
  const status = body.status === 'accepted' ? 'AgentAcknowledged'
    : body.status === 'sent' ? 'Sent'
      : body.status === 'failed' ? 'Failed'
        : body.status === 'partially_sent' ? 'PartiallySent'
          : body.status === 'study_not_found' ? 'StudyUnavailable'
            : 'Sending'
  const updated = await prisma.$transaction(async (tx) => {
    const dispatch = await tx.bridgeDispatchRequest.update({
      where: { id: request.id },
      data: {
        status,
        totalInstances: body.total_instances ?? request.totalInstances,
        sentInstances: body.sent_instances ?? request.sentInstances,
        failedInstances: body.failed_instances ?? request.failedInstances,
        progressPercentage: body.progress_percentage ?? request.progressPercentage,
        agentAcknowledgedAt: status === 'AgentAcknowledged' ? new Date() : request.agentAcknowledgedAt,
        startedAt: status === 'Sending' && !request.startedAt ? new Date() : request.startedAt,
        completedAt: ['Sent', 'Failed', 'PartiallySent', 'StudyUnavailable'].includes(status) ? new Date() : request.completedAt,
        lastErrorCode: body.error?.code ?? request.lastErrorCode,
        lastErrorMessage: body.error?.message ?? request.lastErrorMessage,
      },
    })
    await tx.availableBridgeStudy.update({
      where: { id: request.availableStudyId },
      data: {
        workflowStatus: status === 'Sent' ? 'Delivered' : status === 'Failed' ? 'DispatchFailed' : status === 'StudyUnavailable' ? 'StudyUnavailable' : 'Dispatching',
        availabilityStatus: status === 'StudyUnavailable' ? 'LocallyMissing' : request.availableStudy.availabilityStatus,
      },
    })
    return dispatch
  })
  res.json({ request: updated })
})

app.post('/api/client/processing-jobs/:jobId/mark-urgent', requireAuth, requireClientUser, async (req, res) => {
  const job = await prisma.processingJob.findUniqueOrThrow({ where: { id: String(req.params.jobId) } })
  if (job.clientId !== req.user!.clientId) return res.status(403).json({ message: 'Cannot update another client study' })
  const ageMs = Date.now() - job.createdAt.getTime()
  if (ageMs > 5 * 60 * 1000) return res.status(409).json({ message: 'Urgent marking is available only for 5 minutes after study submission.' })
  if (['submitted_to_outsourced_teleradiology', 'sent_to_radiologist', 'completed', 'sent_to_pacs', 'failed'].includes(job.status)) {
    return res.status(409).json({ message: 'This study has already moved past the urgent update window for outbound submission.' })
  }
  const updated = await prisma.processingJob.update({
    where: { id: job.id },
    data: {
      priority: 'URGENT',
      upstreamStatus: {
        ...(job.upstreamStatus && typeof job.upstreamStatus === 'object' && !Array.isArray(job.upstreamStatus) ? job.upstreamStatus as Record<string, unknown> : {}),
        priority: 'URGENT',
        urgentMarkedAt: new Date().toISOString(),
      },
    },
  })
  await prisma.auditLog.create({
    data: {
      clientId: job.clientId,
      actorUserId: req.user!.sub,
      action: 'STUDY_MARKED_URGENT',
      metadata: { processingJobId: job.id, uploadName: job.uploadName, previousPriority: job.priority ?? 'REGULAR' },
    },
  })
  res.json(formatProcessingStatus(updated))
})

app.get('/api/client/reports/:reportId/pdf', requireAuth, requireClientUser, async (req, res) => {
  req.query.format = 'pdf'
  return handleClientReportDownload(req, res)
})

app.get('/api/client/reports/:reportId/download', requireAuth, requireClientUser, async (req, res) => {
  return handleClientReportDownload(req, res)
})

app.get('/api/reports/:reportId/pdf', requireAuth, async (req, res) => {
  try {
    const report = await getAuthorizedReport(req)
    req.query.format = 'pdf'
    return serveFinalReport(report, req, res)
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 404
    return res.status(status).json({ message: error instanceof Error ? error.message : 'Report is not available' })
  }
})

app.get('/api/reports/:reportId/download', requireAuth, async (req, res) => {
  try {
    const report = await getAuthorizedReport(req)
    return serveFinalReport(report, req, res)
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 404
    return res.status(status).json({ message: error instanceof Error ? error.message : 'Report is not available' })
  }
})

app.post('/api/admin/reports/:reportId/manual-pdf', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const report = await prisma.reportReview.findUniqueOrThrow({ where: { id: String(req.params.reportId) } })
    const upload = await saveManualReportPdfUpload(req, report.id)
    const now = new Date()
    const existingLatest = await prisma.reportVersion.findFirst({
      where: { reportReviewId: report.id },
      orderBy: { version: 'desc' },
      select: { version: true, checksum: true, filePath: true },
    })
    const nextVersion = (existingLatest?.version ?? 0) + 1
    const htmlReport = manualSignedReportHtml(report)
    const signedReportFiles = await buildManualSignedReportFiles(report.id, upload)
    const metadata = toPrismaJsonObject({
      source: 'MANUAL_SUPER_ADMIN',
      uploadedByUserId: req.user!.sub,
      uploadedAt: now.toISOString(),
      reason: upload.reason,
      signedReportFiles,
      ...(existingLatest ? {
        replacement: {
          replacedAt: now.toISOString(),
          previousChecksum: existingLatest.checksum,
          previousFilePath: existingLatest.filePath,
          reason: upload.reason || 'Manual report PDF uploaded by Superadmin',
        },
      } : {}),
    })
    const reportFilePath = upload.withLetterhead.path
    const reportChecksum = upload.withLetterhead.checksum
    const editedReportJson = report.editedReportJson && typeof report.editedReportJson === 'object' && !Array.isArray(report.editedReportJson)
      ? report.editedReportJson as Record<string, unknown>
      : {}
    const processingJobId = getReportProcessingJobId(report.editedReportJson) ?? getReportProcessingJobId(report.aiReportJson)
    const [updated] = await prisma.$transaction([
      prisma.reportReview.update({
        where: { id: report.id },
        data: {
          status: 'APPROVED',
          locked: true,
          reviewedAt: report.reviewedAt ?? now,
          approvedAt: report.approvedAt ?? now,
          pushedAt: now,
          editedReportJson: toPrismaJsonObject({
            ...editedReportJson,
            htmlReport,
            manualReportUpload: metadata,
            reportFilePath,
            reportChecksum,
            signedReportFiles,
          }),
        },
        include: { client: true, radiologist: true },
      }),
      prisma.reportVersion.create({
        data: {
          reportReviewId: report.id,
          version: nextVersion,
          status: 'SIGNED',
          source: 'MANUAL_SUPER_ADMIN',
          htmlReport,
          filePath: reportFilePath,
          checksum: reportChecksum,
          metadata,
        },
      }),
      ...(processingJobId ? [
        prisma.processingJob.updateMany({
          where: { id: processingJobId },
          data: { status: 'completed', clinicalStatus: 'APPROVED', completedAt: now, error: null },
        }),
        prisma.availableBridgeStudy.updateMany({
          where: { processingJobId },
          data: { workflowStatus: 'ReportGenerated' },
        }),
      ] : []),
      prisma.pacsReturnJob.create({
        data: {
          reportReviewId: report.id,
          status: 'MANUAL_UPLOAD',
          returnFormat: report.outputFormat,
          attempts: 0,
          acknowledgedAt: now,
          deliveryResult: toPrismaJsonObject({ manualUpload: true, uploadedByUserId: req.user!.sub }),
        },
      }),
      prisma.reportAuditLog.create({
        data: {
          reportId: report.id,
          actorUserId: req.user!.sub,
          action: 'MANUAL_SIGNED_REPORT_UPLOADED',
          metadata,
        },
      }),
      prisma.auditLog.create({
        data: {
          clientId: report.clientId,
          actorUserId: req.user!.sub,
          action: 'MANUAL_SIGNED_REPORT_APPROVED',
          metadata: toPrismaJsonObject({ reportId: report.id, version: nextVersion, hasWithoutLetterhead: Boolean(upload.withoutLetterhead), visibleToClient: true }),
        },
      }),
    ])
    await enqueueStudyStatusNotification(prisma, {
      eventType: 'REPORT_APPROVED',
      clientId: report.clientId,
      reportId: report.id,
      processingJobId,
      status: 'APPROVED',
      patientName: report.patientName,
      patientId: report.patientId,
      accession: report.accession,
      modality: report.modality,
      serviceName: report.serviceName,
      idempotencyKey: `study-status:manual-report-pushed:${report.id}:${nextVersion}`,
    }).catch((error) => console.warn('Unable to enqueue manual report notification:', error instanceof Error ? error.message : error))
    res.json({ ...updated, clientVisible: true, finalReportStatus: 'APPROVED' })
  } catch (error) {
    console.error('Manual report PDF upload failed', error)
    res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to upload manual report PDF' })
  }
})

async function publicShareResponse(reportId: string, token: string, expiresAt: Date, includeViewer: boolean) {
  const scopedToken = scopedShareToken(reportId, token, includeViewer)
  const url = new URL('/shared/' + encodeURIComponent(scopedToken), publicPortalBaseUrl()).toString()
  return { token: scopedToken, expiresAt, includeViewer, url, qr: await QRCode.toDataURL(url, { width: 320, margin: 2, errorCorrectionLevel: 'M' }) }
}

// A share token is deliberately opaque and is the only credential accepted by
// the public routes below. Report IDs and authenticated viewer routes remain private.
app.post('/api/reports/:reportId/public-share', requireAuth, requireWorkspaceAction('share'), async (req, res) => {
  try {
    const report = await getAuthorizedReport(req)
    if (!['APPROVED', 'PUSHED'].includes(report.status)) {
      return res.status(409).json({ message: 'Only approved reports can be shared publicly.' })
    }
    const forceRegenerate = req.query.regenerate === 'true'
      || (req.body && typeof req.body === 'object' && 'regenerate' in req.body && Boolean((req.body as { regenerate?: unknown }).regenerate))
    const { includeViewer } = z.object({ includeViewer: z.boolean().default(true) }).parse(req.body ?? {})
    const now = new Date()
    const expiresAt = new Date(now.getTime() + reportPublicShareTtlMs)
    const existing = forceRegenerate ? null : await prisma.reportPublicShare.findUnique({ where: { reportId: report.id } })
    if (existing && existing.expiresAt > now) {
      return res.json(await publicShareResponse(report.id, existing.token, existing.expiresAt, includeViewer))
    }
    const token = crypto.randomBytes(32).toString('base64url')
    const share = await prisma.reportPublicShare.upsert({
      where: { reportId: report.id },
      create: { reportId: report.id, token, expiresAt },
      update: { token, expiresAt },
    })
    res.json(await publicShareResponse(report.id, share.token, share.expiresAt, includeViewer))
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 404
    res.status(status).json({ message: error instanceof Error ? error.message : 'Report is not available' })
  }
})

app.delete('/api/reports/:reportId/public-share', requireAuth, async (req, res) => {
  try {
    const report = await getAuthorizedReport(req)
    await prisma.reportPublicShare.deleteMany({ where: { reportId: report.id } })
    await prisma.auditLog.create({
      data: {
        clientId: report.clientId,
        actorUserId: req.user!.sub,
        action: 'REPORT_PUBLIC_SHARE_REVOKED',
        metadata: { reportId: report.id },
      },
    })
    res.json({ revoked: true })
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 404
    res.status(status).json({ message: error instanceof Error ? error.message : 'Report share could not be revoked' })
  }
})

app.get('/api/analytics/mis.xlsx', requireAuth, (req, res, next) => req.user?.role === 'CLIENT_USER' ? requireWorkspaceCapability('analytics')(req, res, next) : next(), async (req, res) => {
  try {
    const start = parseReportDateQuery(req.query.start, startOfDay(new Date(Date.now() - 29 * 24 * 60 * 60 * 1000)))
    const end = parseReportDateQuery(req.query.end, endOfDay(new Date()))
    const clientIds = await accessibleAnalyticsClientIds(req, typeof req.query.centerId === 'string' ? req.query.centerId : undefined)
    if (!clientIds.length) return res.status(403).json({ message: 'Analytics access denied' })
    const [reports, jobs] = await Promise.all([
      prisma.reportReview.findMany({
        where: {
          clientId: { in: clientIds },
          OR: [
            { createdAt: { gte: start, lte: end } },
            { updatedAt: { gte: start, lte: end } },
            { approvedAt: { gte: start, lte: end } },
            { pushedAt: { gte: start, lte: end } },
          ],
        },
        include: { client: { select: { name: true, code: true } }, radiologist: true },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      }),
      prisma.processingJob.findMany({
        where: { clientId: { in: clientIds }, createdAt: { gte: start, lte: end } },
        include: {
          client: { select: { name: true, code: true } },
          bridgeStudy: {
            select: {
              patientId: true,
              patientName: true,
              accessionNumber: true,
              studyInstanceUid: true,
              studyDescription: true,
              modalities: true,
              submittedAt: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      }),
    ])
    const reportVersions = reports.length
      ? await prisma.reportVersion.findMany({
        where: { reportReviewId: { in: reports.map((report) => report.id) } },
        orderBy: [{ reportReviewId: 'asc' }, { version: 'desc' }],
      })
      : []
    const latestVersionByReportId = new Map<string, (typeof reportVersions)[number]>()
    for (const version of reportVersions) if (!latestVersionByReportId.has(version.reportReviewId)) latestVersionByReportId.set(version.reportReviewId, version)
    const jobsById = new Map(jobs.map((job) => [job.id, job]))
    const reportRows = reports.map((report) => {
      const reportJson = getReportJsonRecord(report.editedReportJson) ?? getReportJsonRecord(report.aiReportJson) ?? {}
      const jobId = getReportProcessingJobId(report.editedReportJson) ?? getReportProcessingJobId(report.aiReportJson)
      const job = jobId ? jobsById.get(jobId) : undefined
      const receivedAt = job?.bridgeStudy?.submittedAt ?? job?.createdAt ?? report.createdAt
      const deliveredAt = report.approvedAt ?? report.pushedAt ?? report.reviewedAt ?? (['APPROVED', 'PUSHED'].includes(report.status) ? report.updatedAt : null)
      const latestVersion = latestVersionByReportId.get(report.id)
      return {
        center: report.client?.name ?? '',
        centerCode: report.client?.code ?? '',
        reportId: report.id,
        processingJobId: jobId ?? '',
        patientId: report.patientId ?? job?.bridgeStudy?.patientId ?? '',
        patientName: report.patientName ?? job?.bridgeStudy?.patientName ?? '',
        accession: report.accession ?? job?.bridgeStudy?.accessionNumber ?? '',
        studyUid: report.studyUid ?? job?.bridgeStudy?.studyInstanceUid ?? '',
        modality: report.modality ?? job?.bridgeStudy?.modalities?.[0] ?? '',
        exam: String(reportJson.studyDescription ?? job?.bridgeStudy?.studyDescription ?? report.serviceName ?? ''),
        service: report.serviceName,
        status: report.status,
        readiness: ['APPROVED', 'PUSHED'].includes(report.status) ? 'READY' : 'PROCESSING',
        studyReceivedAt: receivedAt,
        reportDeliveredAt: deliveredAt,
        tatMinutes: deliveredAt ? Math.max(0, Math.round((new Date(deliveredAt).getTime() - new Date(receivedAt).getTime()) / 60000)) : '',
        radiologist: report.radiologist?.fullName ?? '',
        pdfDelivered: ['APPROVED', 'PUSHED'].includes(report.status) ? 'Yes' : 'No',
        tbProbability: extractTbProbability(reportJson) ?? extractTbProbability(getReportJsonRecord(report.aiReportJson)) ?? '',
        criticalFindings: extractCriticalFindings(reportJson) ?? extractCriticalFindings(getReportJsonRecord(report.aiReportJson)) ?? '',
        updateRemarks: latestVersion && latestVersion.version > 1 ? renewistUpdateRemark(latestVersion.metadata) : '',
        latestVersion: latestVersion?.version ?? 1,
      }
    })
    const pendingJobRows = jobs
      .filter((job) => !reportRows.some((row) => row.processingJobId === job.id))
      .map((job) => ({
        center: job.client?.name ?? '',
        centerCode: job.client?.code ?? '',
        reportId: '',
        processingJobId: job.id,
        patientId: job.bridgeStudy?.patientId ?? '',
        patientName: job.bridgeStudy?.patientName ?? '',
        accession: job.bridgeStudy?.accessionNumber ?? '',
        studyUid: job.bridgeStudy?.studyInstanceUid ?? '',
        modality: job.bridgeStudy?.modalities?.[0] ?? job.serviceType,
        exam: job.bridgeStudy?.studyDescription ?? job.uploadName,
        service: serviceNameForType(job.serviceType),
        status: job.status,
        readiness: processingReadiness(job.status),
        studyReceivedAt: job.bridgeStudy?.submittedAt ?? job.createdAt,
        reportDeliveredAt: '',
        tatMinutes: '',
        radiologist: '',
        pdfDelivered: 'No',
        tbProbability: '',
        criticalFindings: '',
        updateRemarks: job.error ?? '',
        latestVersion: '',
      }))
    const rows = [...reportRows, ...pendingJobRows]
    const workbook = buildMisExcelWorkbook(rows, { start, end })
    res.type('application/vnd.ms-excel')
    res.setHeader('Content-Disposition', `attachment; filename="marengo-mis-${start.toISOString().slice(0, 10)}-to-${end.toISOString().slice(0, 10)}.xls"`)
    res.send(workbook)
  } catch (error) {
    console.error('MIS export failed', error)
    res.status(500).json({ message: error instanceof Error ? error.message : 'Unable to export MIS report' })
  }
})

async function publicSharedReport(token: string, requireViewer = false) {
  const share = await prisma.reportPublicShare.findUnique({
    where: scopedShareReportId(token) ? { reportId: scopedShareReportId(token)! } : { token },
    include: { report: { include: { client: { select: { id: true, name: true, code: true } } } } },
  })
  if (share?.expiresAt && share.expiresAt <= new Date()) return null
  if (!share || !['APPROVED', 'PUSHED'].includes(share.report.status)) return null
  const scope = token.startsWith('s1.') ? verifyShareScope(token, share.reportId, share.token) : { includeViewer: true }
  if (!scope || (requireViewer && !scope.includeViewer)) return null
  return { ...share.report, includeViewer: scope.includeViewer }
}

function startOfDay(date: Date) {
  const value = new Date(date)
  value.setHours(0, 0, 0, 0)
  return value
}

function endOfDay(date: Date) {
  const value = new Date(date)
  value.setHours(23, 59, 59, 999)
  return value
}

function parseReportDateQuery(value: unknown, fallback: Date) {
  if (typeof value !== 'string' || !value.trim()) return fallback
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : fallback
}

async function accessibleAnalyticsClientIds(req: Request, requestedCenterId?: string) {
  const user = req.user!
  if (user.role === 'SUPER_ADMIN') {
    if (requestedCenterId && requestedCenterId !== 'ALL') {
      const center = await prisma.client.findUnique({ where: { id: requestedCenterId }, select: { id: true } })
      return center ? [center.id] : []
    }
    const centers = await prisma.client.findMany({ where: { kind: 'CENTER' }, select: { id: true } })
    return centers.map((center) => center.id)
  }
  if (user.role !== 'CLIENT_USER' || !user.clientId) return []
  const client = await prisma.client.findUnique({ where: { id: user.clientId }, select: { id: true, kind: true } })
  if (!client) return []
  if (client.kind === 'GROUP') {
    if (requestedCenterId && requestedCenterId !== 'ALL') {
      const center = await prisma.client.findFirst({ where: { id: requestedCenterId, parentClientId: client.id, kind: 'CENTER' }, select: { id: true } })
      return center ? [center.id] : []
    }
    const centers = await prisma.client.findMany({ where: { parentClientId: client.id, kind: 'CENTER' }, select: { id: true } })
    return centers.map((center) => center.id)
  }
  return [client.id]
}

function getReportJsonRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function extractTbProbability(value: unknown): string | null {
  const record = getReportJsonRecord(value)
  if (!record) return null
  const direct = record.tbProbability ?? record.tb_probability ?? record.tuberculosisProbability ?? record.tb_score
  if (direct !== undefined && direct !== null && String(direct).trim()) return String(direct)
  for (const key of ['findings', 'result', 'results', 'report', 'raw_ai_json']) {
    const nested = extractTbProbability(record[key])
    if (nested) return nested
  }
  return null
}

function extractCriticalFindings(value: unknown): string | null {
  const record = getReportJsonRecord(value)
  if (!record) return null
  for (const key of ['criticalFindings', 'critical_findings', 'critical', 'urgentFindings', 'urgent_findings']) {
    const direct = record[key]
    if (direct !== undefined && direct !== null && String(direct).trim()) return String(direct)
  }
  for (const key of ['findings', 'result', 'results', 'report', 'raw_ai_json']) {
    const nested = extractCriticalFindings(record[key])
    if (nested) return nested
  }
  return null
}

function processingReadiness(status: string) {
  const normalized = status.trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (['completed', 'sent_to_pacs'].includes(normalized)) return 'READY'
  if (['available', 'queued', 'pending'].includes(normalized)) return 'AVAILABLE'
  return 'PROCESSING'
}

function renewistUpdateRemark(metadata: unknown) {
  const record = getReportJsonRecord(metadata)
  const replacement = getReportJsonRecord(record?.replacement)
  if (!replacement) return 'Updated report pushed after final delivery'
  const reason = typeof replacement.reason === 'string' ? replacement.reason : 'Updated report pushed after final delivery'
  const replacedAt = typeof replacement.replacedAt === 'string' ? replacement.replacedAt : ''
  return [reason, replacedAt ? `at ${replacedAt}` : ''].filter(Boolean).join(' ')
}

type MisExportRow = {
  center: string
  centerCode: string
  reportId: string
  processingJobId: string
  patientId: string
  patientName: string
  accession: string
  studyUid: string
  modality: string
  exam: string
  service: string
  status: string
  readiness: string
  studyReceivedAt: Date | string
  reportDeliveredAt: Date | string | null
  tatMinutes: number | string
  radiologist: string
  pdfDelivered: string
  tbProbability: string
  criticalFindings: string
  updateRemarks: string
  latestVersion: number | string
}

function buildMisExcelWorkbook(rows: MisExportRow[], range: { start: Date; end: Date }) {
  const columns: Array<[keyof MisExportRow, string]> = [
    ['center', 'Center'],
    ['centerCode', 'Center Code'],
    ['reportId', 'Report ID'],
    ['processingJobId', 'Job ID'],
    ['patientId', 'Patient ID'],
    ['patientName', 'Patient Name'],
    ['accession', 'Accession Number'],
    ['studyUid', 'Study Instance UID'],
    ['modality', 'Modality'],
    ['exam', 'Study / Exam'],
    ['service', 'Service'],
    ['status', 'Portal Status'],
    ['readiness', 'Report Status'],
    ['studyReceivedAt', 'Study Received'],
    ['reportDeliveredAt', 'Report Delivered'],
    ['tatMinutes', 'TAT Minutes'],
    ['radiologist', 'Radiologist'],
    ['pdfDelivered', 'PDF Delivered'],
    ['tbProbability', 'TB Probability'],
    ['criticalFindings', 'Critical Finding Report'],
    ['latestVersion', 'Report Version'],
    ['updateRemarks', 'Revoked / Amended Report Remarks'],
  ]
  const summary = [
    ['Date Range', `${range.start.toISOString()} to ${range.end.toISOString()}`],
    ['Total Studies/Reports', rows.length],
    ['Ready Reports', rows.filter((row) => row.readiness === 'READY').length],
    ['Processing', rows.filter((row) => row.readiness === 'PROCESSING').length],
    ['Available', rows.filter((row) => row.readiness === 'AVAILABLE').length],
    ['Critical Findings', rows.filter((row) => row.criticalFindings.trim()).length],
    ['Revoked/Amended Reports With Remarks', rows.filter((row) => row.updateRemarks.trim()).length],
  ]
  const summaryRows = summary.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(String(cell))}</td>`).join('')}</tr>`).join('')
  const dataRows = rows.map((row) => `<tr>${columns.map(([key]) => `<td>${escapeHtml(formatMisCell(row[key]))}</td>`).join('')}</tr>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8" /><style>table{border-collapse:collapse;font-family:Arial,sans-serif;font-size:12px}th{background:#1d4ed8;color:#fff}td,th{border:1px solid #94a3b8;padding:6px 8px;vertical-align:top}.summary th{background:#0f766e}</style></head><body><table class="summary"><thead><tr><th colspan="2">Marengo MIS Summary</th></tr></thead><tbody>${summaryRows}</tbody></table><br/><table><thead><tr>${columns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join('')}</tr></thead><tbody>${dataRows || `<tr><td colspan="${columns.length}">No records found for this duration.</td></tr>`}</tbody></table></body></html>`
}

function formatMisCell(value: unknown) {
  if (value instanceof Date) return value.toISOString()
  if (value === null || value === undefined) return ''
  return String(value)
}

app.get('/api/public/reports/:token', async (req, res) => {
  const report = await publicSharedReport(String(req.params.token))
  if (!report) return res.status(404).json({ message: 'This shared report link is invalid or no longer available.' })
  res.setHeader('Cache-Control', 'private, no-store')
  res.json(report)
})

app.get('/api/public/reports/:token/pdf', async (req, res) => {
  const report = await publicSharedReport(String(req.params.token))
  if (!report) return res.status(404).json({ message: 'This shared report link is invalid or no longer available.' })
  req.query.format = 'pdf'
  return serveFinalReport(report, req, res)
})







app.get('/api/client/organization/studies/:studyId/download', requireAuth, requireClientUser, async (req, res) => {
  const managementClient = await prisma.client.findUniqueOrThrow({ where: { id: req.user!.clientId! }, select: { id: true, kind: true } })
  if (managementClient.kind !== 'GROUP') return res.status(403).json({ message: 'Marengo Group Admin access required' })
  const study = await prisma.availableBridgeStudy.findFirst({
    where: { id: String(req.params.studyId), client: { kind: 'CENTER', parentClientId: managementClient.id } },
    include: { client: true, attachments: { orderBy: { createdAt: 'asc' } }, processingJob: true },
  })
  if (!study) return res.status(404).json({ message: 'Center study not found' })
  await sendBridgeStudyBundle(res, study)
})

async function handleClientReportDownload(req: Request, res: Response) {
  const report = await prisma.reportReview.findUniqueOrThrow({ where: { id: String(req.params.reportId) } })
  if (report.clientId !== req.user!.clientId) {
    const [managementClient, reportClient] = await Promise.all([
      prisma.client.findUnique({ where: { id: req.user!.clientId! }, select: { id: true, kind: true } }),
      prisma.client.findUnique({ where: { id: report.clientId }, select: { kind: true, parentClientId: true } }),
    ])
    if (managementClient?.kind !== 'GROUP' || reportClient?.kind !== 'CENTER' || reportClient.parentClientId !== managementClient.id) {
      return res.status(403).json({ message: 'Cannot open another client report' })
    }
  }
  return serveFinalReport(report, req, res)
}

async function serveFinalReport(report: Awaited<ReturnType<typeof prisma.reportReview.findUniqueOrThrow>>, req: Request, res: Response) {
  const format = String(req.query.format ?? 'pdf').toLowerCase()
  if (!['pdf', 'docx'].includes(format)) return res.status(400).json({ message: 'Choose PDF or DOCX format' })
  const variant = reportVariantFromQuery(req.query.variant)
  if (variant === 'without-letterhead' && format !== 'pdf') return res.status(400).json({ message: 'Without-letterhead report is available only as PDF' })
  const signedStorage = await getExactSignedReportStorage(report, format as 'pdf' | 'docx', variant)
  if (signedStorage && !(format === 'pdf' && signedStorage.name && isGeneratedRenewistFallbackPdf(signedStorage.name))) {
    const body = await readStoredObject({ bucket: signedStorage.bucket, key: signedStorage.key }).catch((error) => {
      console.warn(`Unable to read signed report ${report.id} from S3:`, error instanceof Error ? error.message : error)
      return null
    })
    if (body) {
      if (format === 'docx') res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      else res.type('pdf')
      res.setHeader('Content-Disposition', `${format === 'pdf' && req.query.download !== '1' ? 'inline' : 'attachment'}; filename="${sanitizeFileName(report.id)}.${format}"`)
      return res.send(body)
    }
  }
  const signedFilePath = await getExactSignedReportFilePath(report, format as 'pdf' | 'docx', variant)
  const signedPdfPath = format === 'pdf' ? signedFilePath : await getExactSignedReportFilePath(report, 'pdf', variant)
  const renewistReport = await hasRenewistReportSource(report.id)
  if (format === 'pdf' && signedFilePath && renewistReport && isGeneratedRenewistFallbackPdf(signedFilePath)) {
    return res.status(404).json({ message: 'Renewist signed PDF is not available on this server. The previously generated placeholder PDF was rejected; please ask Renewist to resend the exact signed report PDF.' })
  }
  const hasRenewistSignedPdf = Boolean(signedPdfPath && fsSync.existsSync(signedPdfPath))
  const hasFinalReportStatus = report.status === 'APPROVED' || report.status === 'PUSHED'
  if (!hasFinalReportStatus && !hasRenewistSignedPdf) {
    return res.status(409).json({ message: 'Final signed report is not available yet.' })
  }
  if (signedFilePath && fsSync.existsSync(signedFilePath)) {
    if (format === 'docx') res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    else res.type('pdf')
    res.setHeader('Content-Disposition', `${format === 'pdf' && req.query.download !== '1' ? 'inline' : 'attachment'}; filename="${sanitizeFileName(report.id)}.${format}"`)
    return res.sendFile(signedFilePath)
  }
  if (signedPdfPath && fsSync.existsSync(signedPdfPath) && format === 'pdf') {
    res.type('pdf')
    res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${sanitizeFileName(report.id)}.pdf"`)
    return res.sendFile(signedPdfPath)
  }
  if (format === 'pdf' && hasFinalReportStatus && renewistReport) {
    return res.status(404).json({ message: variant === 'without-letterhead' ? 'Renewist PDF without letterhead is not available for this report.' : 'Renewist signed PDF is not available on this server. Please ask Renewist to resend the exact signed report PDF.' })
  }
  if (variant === 'without-letterhead') return res.status(404).json({ message: 'A signed PDF without letterhead has not been supplied for this report.' })
  const htmlReport = getReportHtml(report)
  if (!htmlReport) return res.status(404).json({ message: `Report ${format.toUpperCase()} is not available yet` })
  if (format === 'docx') {
    res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFileName(report.id)}.docx"`)
    return res.send(await buildDocxReportDocument(htmlReport))
  }
  const workDir = path.join(uploadsPath, 'client-report-pdfs', report.id)
  const pdfPath = path.join(workDir, 'report.pdf')
  await fs.mkdir(workDir, { recursive: true })
  await renderHtmlReportPdf({ html: htmlReport, outputPath: pdfPath, workDir })
  res.type('pdf')
  res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${sanitizeFileName(report.id)}.pdf"`)
  res.sendFile(pdfPath)
}

app.get('/api/client/reports/:reportId/call-bookings', requireAuth, requireWorkspaceAction('schedule'), async (req, res) => {
  const report = await getAuthorizedReport(req)
  const bookings = await prisma.reportCallBooking.findMany({
    where: { reportId: report.id, status: { in: ['REQUESTED', 'MANAGER_ACCEPTED', 'RADIOLOGIST_ACCEPTED', 'BOOKED'] } },
    include: { radiologist: true },
    orderBy: { slotStart: 'asc' },
  })
  res.json(bookings)
})

app.get('/api/client/reports/:reportId/call-options', requireAuth, requireWorkspaceAction('schedule'), async (req, res) => {
  const report = await getAuthorizedReport(req)
  const requestedDuration = Number(req.query.durationMinutes ?? 15)
  const duration = Number.isInteger(requestedDuration) && requestedDuration >= 5 && requestedDuration <= 120 ? requestedDuration : 15
  res.json({ pricePerMinuteMinor: 1000, currency: 'INR', preferredWindows: true, slots: preferredCallWindows(duration) })
})

app.post('/api/client/reports/:reportId/call-bookings', requireAuth, requireWorkspaceAction('schedule'), async (req, res) => {
  const body = z.object({
    availabilityId: z.string().optional(),
    radiologistId: z.string().optional(),
    slotStart: z.string().datetime(),
    durationMinutes: z.number().int().min(5).max(120).default(15),
    communicationMode: z.enum(['BUILT_IN_MEETING', 'PHONE_CALL']).default('BUILT_IN_MEETING'),
    phoneNumber: z.string().optional().default(''),
  }).parse(req.body)
  const report = await getAuthorizedReport(req)
  if (body.communicationMode === 'PHONE_CALL' && !body.phoneNumber.trim()) return res.status(400).json({ message: 'Phone number is required for phone call mode' })
  const slotStart = new Date(body.slotStart)
  const slotEnd = new Date(slotStart.getTime() + body.durationMinutes * 60 * 1000)
  const now = new Date()
  if (slotStart <= now) return res.status(400).json({ message: 'Choose a future slot' })
  const providerCode = await getReportProviderCode(report)

  // A requested window is a preference, not a reservation against availability.
  const radiologistId = report.radiologistId ?? null
  let phoneNumber = ''
  if (body.communicationMode === 'PHONE_CALL') {
    try { phoneNumber = normalizeCallPhone(body.phoneNumber) }
    catch (error) { return res.status(400).json({ message: (error as Error).message }) }
  }
  const existing = await prisma.reportCallBooking.findFirst({
    where: { reportId: report.id, status: { in: ['REQUESTED', 'MANAGER_ACCEPTED', 'RADIOLOGIST_ACCEPTED', 'BOOKED'] }, slotEnd: { gt: now } },
    orderBy: { slotStart: 'asc' },
  })
  if (existing && existing.slotStart.getTime() - now.getTime() < 2 * 60 * 60 * 1000) {
    return res.status(409).json({ message: 'Rescheduling is allowed only up to 2 hours before the booked call' })
  }
  const room = `DecXpert-${report.id}-${crypto.randomBytes(4).toString('hex')}`.replace(/[^a-zA-Z0-9-]/g, '')
  const booking = await prisma.$transaction(async (tx) => {
    if (existing) {
      await tx.reportCallBooking.update({ where: { id: existing.id }, data: { status: 'RESCHEDULED' } })
    }
    const created = await tx.reportCallBooking.create({
      data: {
        reportId: report.id,
        clientId: report.clientId,
        radiologistId,
        slotStart,
        slotEnd,
        status: 'REQUESTED',
        requestedDurationMinutes: body.durationMinutes,
        communicationMode: body.communicationMode,
        phoneNumber: body.communicationMode === 'PHONE_CALL' ? phoneNumber : null,
        pricePerMinuteMinor: 1000,
        estimatedAmountMinor: body.durationMinutes * 1000,
        meetingRoom: room,
        meetingUrl: `https://meet.jit.si/${room}`,
        createdByUserId: req.user!.sub,
      },
      include: { radiologist: true, report: true },
    })
    return created
  })
  await prisma.auditLog.create({ data: { clientId: report.clientId, actorUserId: req.user!.sub, action: 'CALL_REQUESTED', metadata: { providerCode, bookingId: booking.id, reportId: report.id, radiologistId, durationMinutes: body.durationMinutes, communicationMode: body.communicationMode } } })
  await enqueueCallBookingNotification(prisma, {
    eventType: existing ? 'CALL_RESCHEDULED' : 'CALL_REQUESTED',
    bookingId: booking.id,
    clientId: booking.clientId,
    reportId: booking.reportId,
    radiologistId: booking.radiologistId,
    status: booking.status,
    slotStart: booking.slotStart,
    slotEnd: booking.slotEnd,
    meetingUrl: booking.meetingUrl,
    communicationMode: booking.communicationMode,
    phoneNumber: booking.phoneNumber,
    idempotencyKey: `call-booking:${existing ? 'rescheduled' : 'requested'}:${booking.id}:${booking.updatedAt.getTime()}`,
  })
  res.status(201).json(booking)
})

app.post('/api/client/radiologists', requireAuth, requireClientUser, async (req, res) => {
  const body = z.object({
    fullName: z.string().min(2),
    email: z.string().email(),
    phone: z.string().optional().default(''),
    qualification: z.string().min(2),
    medicalRegistrationNumber: z.string().min(2),
    organisationName: z.string().min(2),
    signatureImageUrl: z.string().optional().default(''),
    signatureImageData: z.string().optional().default(''),
    documentData: z.string().optional().default(''),
    documentName: z.string().optional().default(''),
  }).parse(req.body)
  const managementClient = await prisma.client.findUniqueOrThrow({
    where: { id: req.user!.clientId! },
    select: { id: true, kind: true, name: true },
  })
  if (managementClient.kind !== 'GROUP') {
    return res.status(403).json({ message: 'Only Marengo Group Admin can create radiologist logins' })
  }
  const { signatureImageData, documentData, documentName, ...profileInput } = body
  let signatureImageUrl = profileInput.signatureImageUrl
  let documentUrl = ''
  try {
    signatureImageUrl = signatureImageData ? await saveSignatureImage(signatureImageData) : profileInput.signatureImageUrl
    documentUrl = documentData ? await saveRadiologistDocument(documentData, documentName) : ''
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid radiologist upload' })
  }

  const temporaryPassword = generatePortalPassword()
  const passwordHash = await bcrypt.hash(temporaryPassword, 12)
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        userId: userIdForEmail(body.email),
        email: body.email,
        name: body.fullName,
        passwordHash,
        lastGeneratedPassword: null,
        role: 'RADIOLOGIST',
        clientId: managementClient.id,
      },
      select: portalUserSelect,
    })
    const profile = await tx.radiologistProfile.create({
      data: {
        ...profileInput,
        signatureImageUrl,
        documentUrl,
        documentName: documentUrl ? sanitizeFileName(documentName || 'radiologist-document') : null,
        userId: user.id,
        clientId: managementClient.id,
        providerCode: null,
        organisationName: managementClient.name,
      },
      include: { user: { select: portalUserSelect } },
    })
    await tx.auditLog.create({
      data: { clientId: managementClient.id, actorUserId: req.user!.sub, action: 'GROUP_RADIOLOGIST_CREATED', metadata: { email: body.email } },
    })
    return { profile, user }
  })

  res.status(201).json({ ...result, temporaryPassword })
})

app.patch('/api/client/radiologists/:radiologistId', requireAuth, requireClientUser, async (req, res) => {
  const body = z.object({
    fullName: z.string().min(2),
    phone: z.string().optional().default(''),
    qualification: z.string().min(2),
    medicalRegistrationNumber: z.string().min(2),
    organisationName: z.string().min(2),
    signatureImageUrl: z.string().optional().default(''),
    signatureImageData: z.string().optional().default(''),
    documentData: z.string().optional().default(''),
    documentName: z.string().optional().default(''),
    active: z.boolean().default(true),
  }).parse(req.body)
  const { signatureImageData, documentData, documentName, ...profileInput } = body
  let signatureImageUrl = profileInput.signatureImageUrl
  let documentUpdate: { documentUrl?: string; documentName?: string | null } = {}
  try {
    signatureImageUrl = signatureImageData ? await saveSignatureImage(signatureImageData) : profileInput.signatureImageUrl
    if (documentData) {
      const documentUrl = await saveRadiologistDocument(documentData, documentName)
      documentUpdate = { documentUrl, documentName: sanitizeFileName(documentName || 'radiologist-document') }
    }
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid radiologist upload' })
  }
  const [existing, managementClient] = await Promise.all([
    prisma.radiologistProfile.findUniqueOrThrow({ where: { id: String(req.params.radiologistId) } }),
    prisma.client.findUniqueOrThrow({ where: { id: req.user!.clientId! }, select: { id: true, kind: true } }),
  ])
  const canManage = managementClient.kind === 'GROUP' && existing.clientId === managementClient.id && !existing.providerCode
  if (!canManage) return res.status(403).json({ message: 'Cannot edit another client radiologist' })
  const profile = await prisma.radiologistProfile.update({
    where: { id: existing.id },
    data: { ...profileInput, signatureImageUrl, ...documentUpdate },
    include: { user: { select: portalUserSelect } },
  })
  res.json(profile)
})

app.post('/api/client/radiologists/:radiologistId/reset-password', requireAuth, requireClientUser, async (req, res) => {
  const [existing, managementClient] = await Promise.all([
    prisma.radiologistProfile.findUniqueOrThrow({
      where: { id: String(req.params.radiologistId) },
      include: { user: true },
    }),
    prisma.client.findUniqueOrThrow({ where: { id: req.user!.clientId! }, select: { id: true, kind: true } }),
  ])
  const canManage = managementClient.kind === 'GROUP' && existing.clientId === managementClient.id && !existing.providerCode
  if (!canManage) return res.status(403).json({ message: 'Cannot reset another client radiologist' })

  const temporaryPassword = generatePortalPassword()
  const passwordHash = await bcrypt.hash(temporaryPassword, 12)
  const user = await prisma.user.update({
    where: { id: existing.userId },
    data: { passwordHash, lastGeneratedPassword: null, active: true },
    select: portalUserSelect,
  })
  await prisma.auditLog.create({
    data: {
      clientId: req.user!.clientId,
      actorUserId: req.user!.sub,
      action: 'RADIOLOGIST_PASSWORD_RESET',
      metadata: { email: user.email, radiologistId: existing.id },
    },
  })
  res.json({ user, temporaryPassword })
})

app.post('/api/client/radiologists/:radiologistId/view-password', requireAuth, requireClientUser, async (req, res) => {
  const [existing, managementClient] = await Promise.all([
    prisma.radiologistProfile.findUniqueOrThrow({
      where: { id: String(req.params.radiologistId) },
      select: { id: true, clientId: true, providerCode: true },
    }),
    prisma.client.findUniqueOrThrow({ where: { id: req.user!.clientId! }, select: { id: true, kind: true } }),
  ])
  if (managementClient.kind !== 'GROUP' || existing.clientId !== managementClient.id || existing.providerCode) {
    return res.status(403).json({ message: 'Cannot access another client radiologist' })
  }
  await auditDeprecatedPasswordView(req, 'CLIENT_RADIOLOGIST_PASSWORD_VIEW_BLOCKED', { clientId: req.user!.clientId, radiologistId: existing.id })
  res.status(410).json({ message: 'Stored password viewing has been disabled. Reset the password to generate a one-time temporary credential.' })
})

app.delete('/api/client/radiologists/:radiologistId', requireAuth, requireClientUser, async (req, res) => {
  const auth = await verifyCurrentUserPassword(req)
  if (!auth.ok) return res.status(auth.status).json({ message: auth.message })
  const [existing, managementClient] = await Promise.all([
    prisma.radiologistProfile.findUniqueOrThrow({
      where: { id: String(req.params.radiologistId) },
      include: { user: { select: { id: true, email: true } } },
    }),
    prisma.client.findUniqueOrThrow({ where: { id: req.user!.clientId! }, select: { id: true, kind: true } }),
  ])
  const canManage = managementClient.kind === 'GROUP' && existing.clientId === managementClient.id && !existing.providerCode
  if (!canManage) return res.status(403).json({ message: 'Cannot delete another client radiologist' })
  await prisma.$transaction([
    prisma.reportReview.updateMany({ where: { radiologistId: existing.id }, data: { radiologistId: null } }),
    prisma.radiologistProfile.delete({ where: { id: existing.id } }),
    prisma.user.delete({ where: { id: existing.userId } }),
    prisma.auditLog.create({
      data: {
        clientId: req.user!.clientId,
        actorUserId: req.user!.sub,
        action: 'RADIOLOGIST_DELETED',
        metadata: { email: existing.user.email, radiologistId: existing.id },
      },
    }),
  ])
  res.json({ deleted: true, radiologistId: existing.id })
})

app.patch('/api/client/pacs-config/:configId', requireAuth, async (req, res) => {
  res.status(410).json({ message: 'Client PACS endpoint configuration has been replaced by Bridge study upload integration.' })
})

app.put('/api/client/report-format', requireAuth, requireClientUser, async (req, res) => {
  if (!req.user!.clientId) return res.status(403).json({ message: 'Client account required' })
  const body = z.object({
    serviceName: z.string().min(2),
    dicomReturnFormat: z.enum(['DICOM_ENCAPSULATED_PDF', 'DICOM_SECONDARY_CAPTURE']),
    outputFormat: z.enum(['DICOM_ENCAPSULATED_PDF', 'DICOM_SECONDARY_CAPTURE', 'HL7', 'HTML', 'PDF', 'DOCX']).optional(),
    reportMode: z.enum(['Comprehensive', 'Custom']),
    radiologistReviewEnabled: z.boolean().default(false),
    includeRadiologistSignature: z.boolean().default(true),
    signatureDetailFields: z.array(z.enum(['fullName', 'qualification', 'medicalRegistrationNumber', 'organisationName', 'approvedAt'])).default(['fullName', 'qualification', 'medicalRegistrationNumber', 'organisationName']),
    enabledSections: z.array(z.string()).default([]),
    structuredHeaderJson: z.record(z.string(), z.unknown()).default({}),
  }).parse(req.body)
  const settingData: Prisma.ReportFormatSettingUncheckedUpdateInput = {
    ...body,
    structuredHeaderJson: toPrismaJsonObject(body.structuredHeaderJson),
    outputFormat: body.dicomReturnFormat,
  }
  const createData: Prisma.ReportFormatSettingUncheckedCreateInput = {
    ...body,
    structuredHeaderJson: toPrismaJsonObject(body.structuredHeaderJson),
    outputFormat: body.dicomReturnFormat,
    clientId: req.user!.clientId,
  }

  const setting = await prisma.reportFormatSetting.upsert({
    where: { clientId_serviceName: { clientId: req.user!.clientId, serviceName: body.serviceName } },
    update: settingData,
    create: createData,
  })
  res.json(setting)
})

app.get('/api/radiologist/dashboard', requireAuth, requireRadiologist, async (req, res) => {
  const profile = await prisma.radiologistProfile.findUnique({
    where: { userId: req.user!.sub },
    include: {
      client: true,
      user: { select: portalUserSelect },
      callBookings: {
        where: { status: { in: ['REQUESTED', 'MANAGER_ACCEPTED', 'RADIOLOGIST_ACCEPTED', 'BOOKED', 'COMPLETED'] }, slotEnd: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        include: { client: { select: reportClientSelect }, report: { omit: reportListOmit } },
        orderBy: { slotStart: 'asc' },
        take: 100,
      },
    },
  })
  if (!profile) return res.status(404).json({ message: 'Radiologist profile not found' })
  const isGroupRadiologist = !profile.providerCode && profile.client?.kind === 'GROUP'
  const reportScopeWhere = profile.providerCode
    ? await providerReportScopeWhere(profile.providerCode)
    : isGroupRadiologist
      ? { client: { kind: 'CENTER' as const, parentClientId: profile.clientId! } }
    : profile.clientId
      ? { clientId: profile.clientId }
      : { id: '__none__' }
  const reportReviews = await prisma.reportReview.findMany({
    where: {
      ...reportScopeWhere,
      ...(isGroupRadiologist ? {} : {
        OR: [
          { radiologistId: profile.id },
          { radiologistId: null, locked: false, status: { in: ['PENDING', 'IN_REVIEW', 'SAVED'] } },
        ],
      }),
    },
    // No audit trail here: no screen shows it, and it was the largest part after the report JSON.
    omit: reportListOmit,
    include: { client: { select: reportClientSelect }, radiologist: { select: reportRadiologistSelect }, callBookings: { where: { status: { in: activeCallBookingStatuses } }, orderBy: { slotStart: 'asc' }, take: 5 } },
    orderBy: { createdAt: 'desc' },
  })
  // The JSON summary keeps workflow.preferredRadiologistId, so the visibility filter still applies.
  const summarized = await withReportSummaries(reportReviews)
  res.json({ ...profile, reportReviews: isGroupRadiologist ? summarized : summarized.filter((report) => canSeePreferredRadiologistReport(profile, report)) })
})

app.get('/api/radiologist/reports/:reportId/pdf', requireAuth, requireRadiologist, async (req, res) => {
  const profile = await prisma.radiologistProfile.findUniqueOrThrow({ where: { userId: req.user!.sub } })
  const report = await prisma.reportReview.findUniqueOrThrow({ where: { id: String(req.params.reportId) } })
  if (!(await canRadiologistAccessReport(profile, report))) return res.status(403).json({ message: 'Report PDF cannot be opened by this radiologist' })
  const reportFilePath = await getExactSignedReportFilePath(report, 'pdf')
  if (reportFilePath && fsSync.existsSync(reportFilePath)) {
    res.type('pdf')
    res.setHeader('Content-Disposition', `inline; filename="${sanitizeFileName(report.id)}.pdf"`)
    return res.sendFile(reportFilePath)
  }
  if (['APPROVED', 'PUSHED'].includes(report.status) && await hasRenewistReportSource(report.id)) {
    return res.status(404).json({ message: 'Renewist signed PDF is not available on this server. Please ask Renewist to resend the exact signed report PDF.' })
  }
  const htmlReport = getReportHtml(report)
  if (!htmlReport) return res.status(404).json({ message: 'PDF report is not available yet' })
  const workDir = path.join(uploadsPath, 'radiologist-report-pdfs', report.id)
  const pdfPath = path.join(workDir, 'report.pdf')
  await fs.mkdir(workDir, { recursive: true })
  await renderHtmlReportPdf({ html: htmlReport, outputPath: pdfPath, workDir })
  res.type('pdf')
  res.setHeader('Content-Disposition', `inline; filename="${sanitizeFileName(report.id)}.pdf"`)
  res.sendFile(pdfPath)
})









app.post('/api/radiologist/call-bookings/:bookingId/accept', requireAuth, requireRadiologist, async (req, res) => {
  return res.status(403).json({ message: 'Radiologist accounts are view-only' })
  /* legacy reporting workflow retained below for data migration reference */
  const profile = await prisma.radiologistProfile.findUniqueOrThrow({ where: { userId: req.user!.sub } })
  if (await isGroupRadiologistProfile(profile)) return res.status(403).json({ message: 'Group radiologist access is view-only' })
  const booking = await prisma.reportCallBooking.findFirstOrThrow({
    where: { id: String(req.params.bookingId), radiologistId: profile.id },
    include: { report: true },
  })
  const managerAccepted = Boolean(booking.managerAcceptedAt)
  const updated = await prisma.reportCallBooking.update({
    where: { id: booking.id },
    data: { radiologistAcceptedAt: new Date(), radiologistAcceptedByUserId: req.user!.sub, status: managerAccepted ? 'BOOKED' : 'RADIOLOGIST_ACCEPTED' },
    include: { radiologist: true, report: { include: { client: true } }, client: true },
  })
  await prisma.auditLog.create({ data: { clientId: booking.clientId, actorUserId: req.user!.sub, action: 'CALL_RADIOLOGIST_ACCEPTED', metadata: { providerCode: profile.providerCode, bookingId: booking.id, reportId: booking.reportId } } })
  await enqueueCallBookingNotification(prisma, {
    eventType: 'CALL_RADIOLOGIST_ACCEPTED',
    bookingId: updated.id,
    clientId: updated.clientId,
    reportId: updated.reportId,
    radiologistId: updated.radiologistId,
    status: updated.status,
    slotStart: updated.slotStart,
    slotEnd: updated.slotEnd,
    meetingUrl: updated.meetingUrl,
    communicationMode: updated.communicationMode,
    phoneNumber: updated.phoneNumber,
    idempotencyKey: `call-booking:radiologist-accepted:${updated.id}:${updated.updatedAt.getTime()}`,
  })
  res.json(updated)
})

app.post('/api/radiologist/call-bookings/:bookingId/complete', requireAuth, requireRadiologist, async (req, res) => {
  return res.status(403).json({ message: 'Radiologist accounts are view-only' })
  const body = z.object({ actualDurationMinutes: z.number().int().min(1).max(240) }).parse(req.body)
  const profile = await prisma.radiologistProfile.findUniqueOrThrow({ where: { userId: req.user!.sub } })
  if (await isGroupRadiologistProfile(profile)) return res.status(403).json({ message: 'Group radiologist access is view-only' })
  const booking = await prisma.reportCallBooking.findFirstOrThrow({
    where: { id: String(req.params.bookingId), radiologistId: profile.id },
    include: { report: true },
  })
  const updated = await completeCallBooking(booking.id, body.actualDurationMinutes, req.user!.sub, profile.providerCode ?? 'RENEWIST')
  await enqueueCallBookingNotification(prisma, {
    eventType: 'CALL_COMPLETED_BY_RADIOLOGIST',
    bookingId: updated.id,
    clientId: updated.clientId,
    reportId: updated.reportId,
    radiologistId: updated.radiologistId,
    status: updated.status,
    slotStart: updated.slotStart,
    slotEnd: updated.slotEnd,
    meetingUrl: updated.meetingUrl,
    communicationMode: updated.communicationMode,
    phoneNumber: updated.phoneNumber,
    idempotencyKey: `call-booking:completed-radiologist:${updated.id}:${updated.updatedAt.getTime()}`,
  })
  res.json(updated)
})

app.patch('/api/radiologist/reports/:reportId/claim', requireAuth, requireRadiologist, async (req, res) => {
  return res.status(403).json({ message: 'Radiologist accounts are view-only' })
  const profile = await prisma.radiologistProfile.findUniqueOrThrow({ where: { userId: req.user!.sub } })
  if (await isGroupRadiologistProfile(profile)) return res.status(403).json({ message: 'Group radiologist access is view-only' })
  const report = await prisma.reportReview.findUniqueOrThrow({ where: { id: String(req.params.reportId) } })
  if (!(await canRadiologistAccessReport(profile, report))) return res.status(403).json({ message: 'Report cannot be claimed by this radiologist' })
  if (!canSeePreferredRadiologistReport(profile, report)) return res.status(403).json({ message: 'Report is reserved for another radiologist' })
  if (report.locked) return res.status(409).json({ message: 'Report is already locked' })
  if (report.radiologistId && report.radiologistId !== profile.id) return res.status(409).json({ message: 'Report has already been claimed by another radiologist' })
  const claimedAt = new Date()
  const updated = await prisma.reportReview.update({
    where: { id: report.id },
    data: { radiologistId: profile.id, status: 'IN_REVIEW', reviewedAt: claimedAt },
  })
  await prisma.reportAuditLog.create({
    data: {
      reportId: report.id,
      actorUserId: req.user!.sub,
      action: 'REPORT_CLAIMED',
      metadata: { reportId: report.id, radiologistId: profile.id, claimedAt: claimedAt.toISOString(), providerCode: profile.providerCode },
    },
  })
  res.json(updated)
})







app.patch('/api/radiologist/reports/:reportId/save', requireAuth, requireRadiologist, async (req, res) => {
  return res.status(403).json({ message: 'Radiologist accounts are view-only' })
})

app.patch('/api/radiologist/reports/:reportId/approve', requireAuth, requireRadiologist, async (req, res) => {
  return res.status(403).json({ message: 'Radiologist accounts are view-only' })
})

app.patch('/api/radiologist/reports/:reportId/send-pacs', requireAuth, requireRadiologist, async (req, res) => {
  return res.status(403).json({ message: 'Radiologist accounts are view-only' })
})

app.post('/api/app/uploads/:serviceType', requireAuth, requireClientUser, async (req, res) => {
  const serviceType = parseServiceType(String(req.params.serviceType))
  if (!serviceType) return res.status(400).json({ message: 'Unknown service type' })
  const serviceName = serviceNameForType(serviceType)

  const clientService = await prisma.clientService.findFirst({
    where: { clientId: req.user!.clientId, service: { name: serviceName }, status: 'ACTIVE' },
    include: { service: true, client: true },
  })
  if (!clientService) return res.status(403).json({ message: `${serviceName} is not assigned to this client` })
  const requestedPatientId = String(req.query.patientId ?? '').trim()
  const patient = requestedPatientId ? await prisma.patient.findFirst({ where: { id: requestedPatientId, clientId: req.user!.clientId! } }) : null
  if (requestedPatientId && !patient) return res.status(404).json({ message: 'Patient profile not found for this center' })
  const clinicalIndication = String(req.query.clinicalIndication ?? '').trim().slice(0, 4000)
  const priority = String(req.query.priority ?? 'REGULAR').trim().toUpperCase()
  if (!['REGULAR', 'URGENT'].includes(priority)) return res.status(400).json({ message: 'Priority must be regular or urgent' })
  const demoStatus = await getDemoUploadStatus(req.user!.clientId!)
  if (!demoStatus.allowed) return res.status(403).json({ message: demoStatus.message })
  if (!demoStatus.demoMode && !isTeleradiologyWorkflow(clientService.workflowType)) {
    if (clientService.validUntil < new Date()) return res.status(403).json({ message: 'Assigned service is expired' })
    if (clientService.credits - clientService.usedCredits <= 0) return res.status(403).json({ message: 'Insufficient credits for this service' })
  }

  try {
    const saved = await saveIncomingUpload(req, appUploadPath)
    const job = await prisma.$transaction(async (tx) => {
      const queued = await tx.processingJob.create({
      data: {
        clientId: req.user!.clientId!,
        serviceType,
        status: 'queued',
        workflowType: clientService.workflowType,
        clinicalStatus: 'QUEUED',
        uploadName: saved.uploadName,
        uploadPath: saved.filePath,
        demoMode: demoStatus.demoMode,
        upstreamStatus: clinicalIndication ? { clinicalIndication, uploadSource: 'PORTAL_MANUAL' } : { uploadSource: 'PORTAL_MANUAL' },
        patientId: patient?.id,
        priority,
      },
      })
      await enqueueTelegramStudy(tx, queued)
      return queued
    })
    await prisma.auditLog.create({ data: { clientId: job.clientId, actorUserId: req.user!.sub, action: 'MANUAL_STUDY_UPLOAD_QUEUED', metadata: { processingJobId: job.id, serviceType, priority, uploadName: job.uploadName, patientProfileId: patient?.id ?? null } } })
    await enqueueStudyStatusNotification(prisma, {
      eventType: 'PROCESSING_JOB_QUEUED',
      clientId: job.clientId,
      processingJobId: job.id,
      status: 'QUEUED',
      serviceName,
      idempotencyKey: `study-status:queued:${job.id}`,
    })

    queueRenewistSubmission(job.id, 'Portal manual upload')
    res.status(202).json({
      job_id: job.id,
      status: 'queued',
      status_endpoint: `/api/app/jobs/${job.id}/status`,
      report_endpoint: `/api/app/jobs/${job.id}/report`,
    })
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : 'Upload failed' })
  }
})

app.get('/api/client/patient-upload-services', requireAuth, requireClientUser, async (req, res) => {
  const services = await prisma.clientService.findMany({
    where: { clientId: req.user!.clientId!, status: 'ACTIVE' },
    include: { service: true },
    orderBy: { service: { name: 'asc' } },
  })
  res.json(services.map((item) => ({ serviceType: serviceTypeForServiceName(item.service.name), name: item.service.name, workflowType: item.workflowType })))
})

app.get('/api/app/jobs/:jobId/status', requireAuth, async (req, res) => {
  const job = await getAccessibleProcessingJob(String(req.params.jobId), req.user!)
  if (!job) return res.status(404).json({ message: 'Job not found' })
  res.json(formatProcessingStatus(job))
})

app.get('/api/app/jobs/:jobId/report', requireAuth, async (req, res) => {
  const job = await getAccessibleProcessingJob(String(req.params.jobId), req.user!)
  if (!job) return res.status(404).json({ message: 'Job not found' })
  if (!['completed', 'sent_to_radiologist', 'sent_to_pacs', 'awaiting_radiologist', 'submitted_to_outsourced_teleradiology'].includes(job.status) || !job.reportHtml) return res.status(409).json({ message: 'Report is not ready yet', status: job.status })
  res.type('html').send(job.reportHtml)
})

app.post('/api/dicom/mock-receive', requireAuth, requireSuperAdmin, async (req, res) => {
  const body = z.object({
    receivingPort: z.number().int(),
    aeTitle: z.string(),
    studyUid: z.string(),
    modality: z.enum(['DX', 'CR', 'CT']),
  }).parse(req.body)

  const validation = await validatePacsProcessing(body.receivingPort, normalizeAeTitle(body.aeTitle))
  const config = 'config' in validation ? validation.config : undefined
  if (!validation.allowed || !config) return res.status(403).json(validation)

  const study = await prisma.study.upsert({
    where: { studyUid: body.studyUid },
    update: {
      clientId: config.clientId,
      modality: body.modality,
      status: 'SUCCESS',
      aiResponse: { impression: 'AI response pending integration with the configured inference service.' },
      reportJson: { returnFormat: config.returnFormat },
    },
    create: {
      clientId: config.clientId,
      studyUid: body.studyUid,
      modality: body.modality,
      status: 'SUCCESS',
      aiResponse: { impression: 'AI response pending integration with the configured inference service.' },
      reportJson: { returnFormat: config.returnFormat },
    },
  })

  await prisma.job.create({
    data: { clientId: config.clientId, studyId: study.id, serviceName: config.clientService.service.name, status: 'SUCCESS', attempts: 1, latencyMs: 41000 },
  })
  if (!isTeleradiologyWorkflow(config.clientService.workflowType)) {
    await prisma.clientService.update({
      where: { id: config.clientServiceId },
      data: { usedCredits: { increment: 1 } },
    })
  }
  const reportSetting = await prisma.reportFormatSetting.findFirst({
    where: { clientId: config.clientId, serviceName: config.clientService.service.name },
  })

  const teleradiologyProviderCode = isTeleradiologyWorkflow(config.clientService.workflowType)
    ? config.teleradiologyProviderCode ?? process.env.TELERADIOLOGY_DEFAULT_PROVIDER ?? 'RENEWIST'
    : null
  const requiresRadiologistReview = Boolean(reportSetting?.radiologistReviewEnabled || teleradiologyProviderCode)
  if (requiresRadiologistReview) {
    const activeRadiologistCount = await prisma.radiologistProfile.count({ where: teleradiologyProviderCode ? { providerCode: teleradiologyProviderCode, active: true } : { clientId: config.clientId, active: true } })
    const reportId = await nextReportId({ clientCode: config.client.code, serviceCode: config.clientService.service.code })
    const review = await prisma.reportReview.create({
      data: {
        id: reportId,
        clientId: config.clientId,
        studyId: study.id,
        radiologistId: null,
        serviceName: config.clientService.service.name,
        studyUid: body.studyUid,
        modality: body.modality,
        status: activeRadiologistCount ? 'PENDING' : 'FAILED',
        outputFormat: reportSetting.outputFormat,
        aiReportJson: { ...(study.aiResponse as Record<string, unknown> ?? {}), workflow: { providerCode: teleradiologyProviderCode, radiologistReviewEnabled: requiresRadiologistReview } },
        editedReportJson: study.aiResponse ?? {},
      },
    })
    await prisma.reportAuditLog.create({
      data: { reportId: review.id, action: activeRadiologistCount ? 'REPORT_PARKED_FOR_REVIEW' : 'NO_RADIOLOGIST_AVAILABLE', metadata: { studyUid: body.studyUid, activeRadiologistCount, providerCode: teleradiologyProviderCode } },
    })
  }

  res.status(201).json({ study, message: 'DICOM processing completed and credit deducted.' })
})

app.post('/api/admin/jobs/:jobId/retry', requireAuth, requireSuperAdmin, async (req, res) => {
  const job = await prisma.job.update({
    where: { id: String(req.params.jobId) },
    data: { status: 'QUEUED', attempts: { increment: 1 }, error: null },
  })
  await prisma.auditLog.create({
    data: { clientId: job.clientId, actorUserId: req.user!.sub, action: 'JOB_RETRY_REQUESTED', metadata: { jobId: job.id, serviceName: job.serviceName, attempts: job.attempts } },
  })
  res.json(job)
})

app.post('/api/admin/processing-jobs/:jobId/retry-teleradiology', requireAuth, requireSuperAdmin, async (req, res) => {
  const result = await retryOutsourcedTeleradiologySubmission(String(req.params.jobId), req.user!.sub)
  res.json(result)
})

app.post('/api/admin/processing-jobs/:jobId/retry-renewist', requireAuth, requireSuperAdmin, async (req, res) => {
  const jobId = String(req.params.jobId)
  const job = await prisma.processingJob.findUniqueOrThrow({ where: { id: jobId } })
  if (job.providerJobId) return res.status(409).json({ message: 'Renewist already accepted this study', providerJobId: job.providerJobId })
  const acceptedRequest = await prisma.providerApiRequest.findFirst({
    where: { idempotencyKey: jobId, direction: 'OUTBOUND', status: 'ACCEPTED' },
    orderBy: { createdAt: 'desc' },
  })
  if (acceptedRequest) return res.status(409).json({ message: 'Renewist already accepted this study', requestId: acceptedRequest.requestId })
  if (!fsSync.existsSync(job.uploadPath)) return res.status(409).json({ message: 'The study archive is no longer available for submission' })

  await prisma.$transaction([
    prisma.processingJob.update({
      where: { id: jobId },
      data: {
        status: 'queued',
        workflowType: 'TELERADIOLOGY_ONLY',
        clinicalStatus: 'QUEUED',
        providerJobId: null,
        error: null,
        completedAt: null,
        upstreamStatus: toPrismaJsonObject({
          state: 'queued_for_renewist_retry',
          previousStatus: job.upstreamStatus,
          requestedAt: new Date().toISOString(),
        }),
      },
    }),
    prisma.availableBridgeStudy.updateMany({
      where: { processingJobId: jobId },
      data: { workflowStatus: 'QueuedForRenewist' },
    }),
    prisma.auditLog.create({
      data: {
        clientId: job.clientId,
        actorUserId: req.user!.sub,
        action: 'RENEWIST_PRE_OUTBOUND_RETRY_REQUESTED',
        metadata: { processingJobId: jobId, previousStatus: job.status },
      },
    }),
  ])
  queueRenewistSubmission(jobId, 'Admin retry')
  res.status(202).json({ processingJobId: jobId, status: 'QueuedForRenewist' })
})

registerReportRoutes(app, {
  requireAuth,
  getAuthorizedReport,
  async canRadiologistSeeReport(req, report) {
    const profile = await prisma.radiologistProfile.findUniqueOrThrow({ where: { userId: req.user!.sub }, select: { id: true, clientId: true, providerCode: true } })
    return await isGroupRadiologistProfile(profile) || canSeePreferredRadiologistReport(profile, report)
  },
})
registerExternalViewerRoutes(app, { prisma, requireAuth, requireRadiologist, accessibleClientIds, workspaceStudyScope, getAccessibleProcessingJob, extractQueuedMetadata, publicSharedReport, getAuthorizedReport, canRadiologistAccessReport, isGroupRadiologistProfile, getDicomMetadataValue, createBridgeStudyViewerUrl });

app.use((error: unknown, _req: Request, res: Response, next: express.NextFunction) => {
  if (res.headersSent) return next(error)
  if (error instanceof StudyArchiveError) return res.status(error.status).json({ message: error.message })
  // Access helpers such as workspaceStudyScope throw an Error carrying a 4xx `status`.
  const status = (error as { status?: unknown }).status
  if (error instanceof Error && typeof status === 'number' && status >= 400 && status < 500) return res.status(status).json({ message: error.message })
  if (error instanceof z.ZodError) {
    const issue = error.issues[0]
    const field = issue?.path.length ? `${issue.path.join('.')}: ` : ''
    return res.status(400).json({ message: `${field}${issue?.message ?? 'Invalid request data'}` })
  }
  console.error(error)
  return res.status(500).json({ message: 'Unable to complete this action. Please try again.' })
})

app.use('/assets', express.static(path.join(distPath, 'assets'), { immutable: true, maxAge: '1y' }));
app.use(express.static(distPath, { maxAge: 0 }));
app.use('/api', (_req, res) => res.status(404).json({ message: 'API route not found' }));
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'))
})

const httpServer = app.listen(port, host, () => {
  // Technical monitoring has its own explicit enable flag, independent of clinical workers.
  startTechnicalMonitor()
  console.log(`DecXpert API listening on http://${host}:${port}`)
  if (process.env.DISABLE_STARTUP_WORKERS === 'true' || process.env.DATABASE_READ_ONLY === 'true') {
    console.log('Startup workers disabled by DISABLE_STARTUP_WORKERS=true')
    return
  }
  const features = getDeploymentFeatures()
  startTelegramWorker()
  console.log(`Deployment profile: ${features.profile}`)
  void startAllDicomReceivers()
  void (async () => {
    await recoverInterruptedProcessingJobs()
    await resumeQueuedProcessingJobs()
    await repairDuplicateProcessingFailures()
  })().catch((error) => console.error('Processing job recovery failed', error))
  void recoverStaleOutboundSubmissions()
  void processPendingPacsReturnJobs()
  if (features.whatsapp) startWhatsappOutboxWorker()
  else console.log('WhatsApp outbox worker disabled by deployment profile')
  if (features.billing) void generateDueMonthlyInvoices().catch((error) => console.error('Monthly invoice generation failed', error))
  else console.log('Billing invoice worker disabled by deployment profile')
  const scan = nonOverlapping(scanInboundDicomStudies);
  setTimeout(scan, 3000).unref()
  setInterval(scan, 10000).unref()
  setInterval(() => void processPendingPacsReturnJobs(), 5 * 60 * 1000).unref()
  setInterval(() => void recoverStaleOutboundSubmissions(), 10 * 60 * 1000).unref()
  if (features.billing) setInterval(() => void generateDueMonthlyInvoices().catch((error) => console.error('Monthly invoice generation failed', error)), 24 * 60 * 60 * 1000).unref()
})

async function resumeQueuedProcessingJobs() {
  const jobs = await prisma.processingJob.findMany({
    where: { status: 'queued' },
    select: { id: true },
    orderBy: { id: 'asc' },
  })
  for (const job of jobs) {
    queueRenewistSubmission(job.id, 'Startup recovery')
  }
}

function queueRenewistSubmission(jobId: string, source: string) {
  if (queuedRenewistJobIds.has(jobId)) return renewistSubmissionTail
  queuedRenewistJobIds.add(jobId)
  const submission = renewistSubmissionTail
    .catch(() => undefined)
    .then(() => processApplicationJob(jobId))
    .catch((error) => console.error(`${source} Renewist job ${jobId} failed`, error))
    .finally(() => queuedRenewistJobIds.delete(jobId))
  renewistSubmissionTail = submission
  return submission
}

async function recoverStaleOutboundSubmissions() {
  if (outboundSubmissionRecoveryRunning) return
  outboundSubmissionRecoveryRunning = true
  try {
    const staleMinutes = Math.max(15, Number(process.env.RENEWIST_OUTBOUND_STALE_MINUTES ?? 45))
    const staleBefore = new Date(Date.now() - staleMinutes * 60 * 1000)
    const staleRequests = await prisma.providerApiRequest.findMany({
      where: { direction: 'OUTBOUND', status: 'SENDING', createdAt: { lt: staleBefore } },
      orderBy: { createdAt: 'asc' },
      take: 20,
    })
    for (const request of staleRequests) {
      const metadata = request.metadata && typeof request.metadata === 'object' && !Array.isArray(request.metadata)
        ? request.metadata as Record<string, unknown>
        : {}
      const dectrocelJobId = typeof metadata.dectrocelJobId === 'string' ? metadata.dectrocelJobId : null
      const reportReviewId = typeof metadata.reportReviewId === 'string' ? metadata.reportReviewId : null
      if (!dectrocelJobId) {
        await prisma.providerApiRequest.update({
          where: { id: request.id },
          data: { status: 'FAILED', responseCode: 504, metadata: { ...metadata, error: 'Renewist outbound submission became stale before a response was recorded' } },
        })
        continue
      }
      const acceptedAfter = await prisma.providerApiRequest.findFirst({
        where: { idempotencyKey: dectrocelJobId, direction: 'OUTBOUND', status: 'ACCEPTED', createdAt: { gt: request.createdAt } },
      })
      if (acceptedAfter) {
        await prisma.providerApiRequest.update({
          where: { id: request.id },
          data: { status: 'SUPERSEDED', metadata: { ...metadata, supersededByRequestId: acceptedAfter.requestId } },
        })
        continue
      }
      const message = 'Renewist outbound submission timed out before a provider response was recorded'
      await prisma.$transaction([
        prisma.providerApiRequest.update({
          where: { id: request.id },
          data: { status: 'FAILED', responseCode: 504, metadata: { ...metadata, error: message } },
        }),
        prisma.providerJobMapping.upsert({
          where: { dectrocelJobId },
          update: {
            status: 'OUTBOUND_SUBMISSION_FAILED',
            metadata: { ...metadata, error: message, outboundRequestId: request.requestId },
          },
          create: {
            dectrocelJobId,
            reportReviewId,
            processingJobId: dectrocelJobId,
            status: 'OUTBOUND_SUBMISSION_FAILED',
            metadata: { ...metadata, error: message, outboundRequestId: request.requestId },
          },
        }),
        prisma.processingJob.updateMany({
          where: { id: dectrocelJobId, providerJobId: null },
          data: {
            status: 'outbound_submission_failed',
            clinicalStatus: 'FAILED',
            error: message,
            upstreamStatus: { state: 'outbound_submission_failed', error: message, requestId: request.requestId, reportReviewId },
          },
        }),
        ...(reportReviewId ? [prisma.reportReview.updateMany({ where: { id: reportReviewId, status: 'PENDING' }, data: { status: 'FAILED' } })] : []),
      ])
    }
    if (staleRequests.length) console.log(`Recovered ${staleRequests.length} stale outbound Renewist submission(s)`)
  } finally {
    outboundSubmissionRecoveryRunning = false
  }
}

async function recoverInterruptedProcessingJobs() {
  const staleMinutes = Math.max(5, Number(process.env.PROCESSING_JOB_RECOVERY_MINUTES ?? 15))
  const staleBefore = new Date(Date.now() - staleMinutes * 60 * 1000)
  const jobs = await prisma.processingJob.findMany({
    where: {
      status: 'submitting_to_renewist',
      updatedAt: { lt: staleBefore },
    },
    select: { id: true, error: true, upstreamStatus: true },
    orderBy: { updatedAt: 'asc' },
    take: 25,
  })
  for (const job of jobs) {
    const previousStatus = job.upstreamStatus && typeof job.upstreamStatus === 'object' && !Array.isArray(job.upstreamStatus)
      ? job.upstreamStatus as Record<string, unknown>
      : {}
    const previousDicomMetadata = previousStatus.dicomMetadata
      ?? (previousStatus.previousStatus && typeof previousStatus.previousStatus === 'object' && !Array.isArray(previousStatus.previousStatus)
        ? (previousStatus.previousStatus as Record<string, unknown>).dicomMetadata
        : undefined)
    await prisma.processingJob.update({
      where: { id: job.id },
      data: {
        status: 'queued',
        clinicalStatus: 'QUEUED',
        error: null,
        completedAt: null,
        upstreamStatus: toPrismaJsonObject({
          state: 'recovered-after-interrupted-processing',
          recoveredAt: new Date().toISOString(),
          dicomMetadata: previousDicomMetadata ?? {},
          previousStatus: job.upstreamStatus,
          previousError: job.error,
        }),
      },
    })
    await prisma.availableBridgeStudy.updateMany({
      where: { processingJobId: job.id },
      data: { workflowStatus: 'QueuedForRenewist' },
    })
  }
  if (jobs.length) console.log(`Recovered ${jobs.length} interrupted Renewist submission job(s) back to queued`)
}

async function repairDuplicateProcessingFailures() {
  const jobs = await prisma.processingJob.findMany({
    where: {
      status: 'failed',
      OR: [
        { error: { contains: 'studyUid' } },
        { error: { contains: 'prisma.reportReview.create' } },
        { error: { contains: 'Unique constraint failed on the fields: (`id`)' } },
      ],
    },
    select: { id: true, error: true },
    orderBy: { updatedAt: 'asc' },
    take: 25,
  })
  for (const job of jobs) {
    await prisma.processingJob.update({
      where: { id: job.id },
      data: {
        status: 'queued',
        upstreamStatus: { state: 'recovered-after-duplicate-processing-fix', previousError: job.error },
        error: null,
        completedAt: null,
      },
    })
    try {
      await queueRenewistSubmission(job.id, 'Duplicate processing repair')
    } catch (error) {
      console.error(`Duplicate processing repair job ${job.id} failed`, error)
    }
  }
}

async function processPendingPacsReturnJobs() {
  if (pacsReturnRecoveryRunning) return
  pacsReturnRecoveryRunning = true
  try {
  const pendingReturns = await prisma.pacsReturnJob.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    take: 25,
  })
  for (const returnJob of pendingReturns) {
    if (returnJob.attempts >= returnJob.maxAttempts) continue
    const report = await prisma.reportReview.findUnique({ where: { id: returnJob.reportReviewId } })
    if (!report) {
      await prisma.pacsReturnJob.update({
        where: { id: returnJob.id },
        data: { status: 'FAILED', attempts: { increment: 1 }, lastAttemptAt: new Date(), errorMessage: 'Report review was not found' },
      })
      continue
    }
    if (report.status === 'PUSHED') {
      await prisma.pacsReturnJob.update({
        where: { id: returnJob.id },
        data: { status: 'SUCCESS', attempts: { increment: 1 }, lastAttemptAt: new Date(), errorMessage: null },
      })
      continue
    }

    const sourcePdfPath = await getExactSignedReportFilePath(report, 'pdf')
    const renewistReport = await hasRenewistReportSource(report.id)
    const htmlReport = getReportHtml(report)
    if (renewistReport && !sourcePdfPath) {
      await prisma.pacsReturnJob.update({
        where: { id: returnJob.id },
        data: {
          status: returnJob.attempts + 1 >= returnJob.maxAttempts ? 'FAILED' : 'PENDING',
          attempts: { increment: 1 },
          lastAttemptAt: new Date(),
          errorMessage: 'Exact Renewist signed PDF is not available; refusing to push generated fallback report',
        },
      })
      continue
    }
    if (!sourcePdfPath && !htmlReport) {
      await prisma.pacsReturnJob.update({
        where: { id: returnJob.id },
        data: {
          status: returnJob.attempts + 1 >= returnJob.maxAttempts ? 'FAILED' : 'PENDING',
          attempts: { increment: 1 },
          lastAttemptAt: new Date(),
          errorMessage: 'Signed report content is not available',
        },
      })
      continue
    }

    try {
      const pacsDelivery = await sendApprovedReportToPacs({ report, htmlReport, sourcePdfPath: sourcePdfPath || null })
      const processingJobId = getReportProcessingJobId(report.aiReportJson) ?? getReportProcessingJobId(report.editedReportJson)
      await prisma.$transaction([
        prisma.reportReview.update({
          where: { id: report.id },
          data: {
            status: 'PUSHED',
            pushedAt: new Date(),
            editedReportJson: {
              ...(report.editedReportJson as Record<string, unknown>),
              pacsDelivery,
            },
          },
        }),
        ...(processingJobId ? [prisma.processingJob.updateMany({
          where: { id: processingJobId, clientId: report.clientId },
          data: { status: 'sent_to_pacs', clinicalStatus: 'PUSHED', error: null, completedAt: new Date() },
        })] : []),
        prisma.pacsReturnJob.update({
          where: { id: returnJob.id },
          data: {
            status: 'SUCCESS',
            attempts: { increment: 1 },
            lastAttemptAt: new Date(),
            errorMessage: null,
            deliveryResult: pacsDelivery,
          },
        }),
        prisma.reportAuditLog.create({
          data: { reportId: report.id, action: 'PENDING_PACS_RETURN_RECOVERED', metadata: { pacsDelivery, returnJobId: returnJob.id } },
        }),
      ])
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to send pending report to client PACS'
      await prisma.$transaction([
        prisma.pacsReturnJob.update({
          where: { id: returnJob.id },
          data: {
            status: returnJob.attempts + 1 >= returnJob.maxAttempts ? 'FAILED' : 'PENDING',
            attempts: { increment: 1 },
            lastAttemptAt: new Date(),
            errorMessage: message,
          },
        }),
        prisma.reportAuditLog.create({
          data: { reportId: report.id, action: 'PENDING_PACS_RETURN_FAILED', metadata: { error: message, returnJobId: returnJob.id } },
        }),
      ])
    }
  }
  if (pendingReturns.length) console.log(`Processed ${pendingReturns.length} pending PACS return job(s)`)
  } finally {
    pacsReturnRecoveryRunning = false
  }
}

function parseServiceType(value: string): ServiceType | null {
  return serviceNames[value] ? value : null
}

function defaultModalityForServiceType(serviceType: string) {
  if (serviceType === 'mri' || serviceType.startsWith('mri-') || serviceType === 'mrcp' || serviceType === 'mra-mrv-mrs') return 'MR'
  if (serviceType === 'ultrasound') return 'US'
  if (serviceType === 'pet-ct') return 'PT'
  if (serviceType.startsWith('ct-') || serviceType === 'hrct-temporal-bone' || serviceType === 'triple-phase-ct') return 'CT'
  if (serviceType.startsWith('xray-') || serviceType === 'xray' || serviceType === 'special-xray-contrast-media') return 'DX'
  if (serviceType === 'mammography') return 'MG'
  return 'OT'
}

async function getDemoUploadStatus(clientId: string) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { demoModeEnabled: true, demoStudyLimit: true, _count: { select: { processingJobs: { where: { demoMode: true } } } } },
  })
  if (!client?.demoModeEnabled) return { demoMode: false, allowed: true, used: 0, limit: null as number | null }
  const used = client._count.processingJobs
  const limit = client.demoStudyLimit
  if (typeof limit === 'number' && used >= limit) {
    return {
      demoMode: true,
      allowed: false,
      used,
      limit,
      message: `Demo upload limit reached (${used}/${limit}). Contact Dectrocel to enable more studies.`,
    }
  }
  return { demoMode: true, allowed: true, used, limit }
}

function isFinalMammographyPollStatus(status: string) {
  return /^(complete|completed|done|success|succeeded|finished|failed|failure|error|cancelled|canceled)$/i.test(status)
}

function getMammographyUpstreamJobId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const object = value as Record<string, unknown>
  const direct = object.upstreamJobId ?? object.job_id ?? object.jobId
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  const response = object.upstreamResponse
  if (response && typeof response === 'object' && !Array.isArray(response)) {
    const responseJobId = (response as Record<string, unknown>).job_id ?? (response as Record<string, unknown>).jobId
    if (typeof responseJobId === 'string' && responseJobId.trim()) return responseJobId.trim()
  }
  return getMammographyUpstreamJobId(object.previousStatus)
}

async function startAllDicomReceivers() {
  const configs = await prisma.pacsConfig.findMany({
    where: {
      client: { status: 'ACTIVE' },
      clientService: { status: 'ACTIVE', workflowType: { in: ['TELERADIOLOGY_ONLY', 'AI_TELERADIOLOGY'] } },
    },
    include: { client: true, clientService: true },
    orderBy: { receivingPort: 'asc' },
  })
  await Promise.all(configs.flatMap((config) => receiverSpecsForConfig(config).map((receiver) =>
    startDicomReceiver({ ...receiver, clientCode: config.client.code })
      .catch((error) => console.error(`DICOM receiver ${receiver.receivingPort} failed to start`, error))
  )))
}

function receiverSpecsForConfig(config: { receivingPort: number; aeTitle: string; urgentReceivingPort?: number | null; urgentAeTitle?: string | null; extraEndpoints?: unknown }) {
  const specs = [
    { receivingPort: config.receivingPort, aeTitle: config.aeTitle, priority: 'REGULAR' as const },
    ...(config.urgentReceivingPort && config.urgentAeTitle ? [{ receivingPort: config.urgentReceivingPort, aeTitle: config.urgentAeTitle, priority: 'URGENT' as const }] : []),
    ...readPacsExtraEndpoints(config.extraEndpoints).map((endpoint) => ({ receivingPort: endpoint.receivingPort, aeTitle: endpoint.aeTitle, priority: endpoint.priority })),
  ]
  const seen = new Set<string>()
  return specs.filter((spec) => {
    const key = `${spec.receivingPort}:${normalizeAeTitle(spec.aeTitle)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function readPacsExtraEndpoints(value: unknown): Array<{ id: string; receivingPort: number; aeTitle: string; priority: 'REGULAR' | 'URGENT'; label?: string }> {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const endpoint = item as Record<string, unknown>
    const receivingPort = Number(endpoint.receivingPort)
    const aeTitle = normalizeAeTitle(String(endpoint.aeTitle ?? ''))
    if (!Number.isInteger(receivingPort) || !aeTitle) return []
    return [{
      id: String(endpoint.id ?? crypto.randomUUID()),
      receivingPort,
      aeTitle,
      priority: String(endpoint.priority ?? 'REGULAR').toUpperCase() === 'URGENT' ? 'URGENT' as const : 'REGULAR' as const,
      label: typeof endpoint.label === 'string' ? endpoint.label : undefined,
    }]
  })
}

function stopDicomReceiver(port: number) {
  const receiver = receiverProcesses.get(port)
  receiver?.kill()
  receiverProcesses.delete(port)
}

async function startDicomReceiver(config: { receivingPort: number; aeTitle: string; clientCode: string }): Promise<ReceiverStartResult> {
  const aeTitle = normalizeAeTitle(config.aeTitle)
  const firewallRule = await ensureFirewallRule(config.receivingPort)
  const trackedReceiver = receiverProcesses.get(config.receivingPort)
  if (trackedReceiver && await isPortListening(config.receivingPort)) {
    return { receivingPort: config.receivingPort, aeTitle, firewallRule, listener: 'already-running' }
  }
  if (await isPortListening(config.receivingPort)) {
    return { receivingPort: config.receivingPort, aeTitle, firewallRule, listener: 'already-listening' }
  }

  const storescp = await findStorescp()
  if (!storescp) {
    throw new Error('DCMTK storescp was not found. DICOM ports cannot receive studies.')
  }

  const outDir = path.join(dicomInboundPath, config.clientCode, String(config.receivingPort))
  await fs.mkdir(outDir, { recursive: true })

  const args = ['+xa', '-pm', '-aet', aeTitle, '-od', outDir, '-su', 'study', String(config.receivingPort)]
  const stdout = fsSync.openSync(path.join(outDir, 'storescp-out.log'), 'a')
  const stderr = fsSync.openSync(path.join(outDir, 'storescp-err.log'), 'a')
  const child = spawn(storescp, args, {
    cwd: outDir,
    detached: false,
    stdio: ['ignore', stdout, stderr],
    windowsHide: true,
  })
  fsSync.closeSync(stdout);
  fsSync.closeSync(stderr);
  child.on('error', error => { receiverProcesses.delete(config.receivingPort); console.error('DICOM receiver failed', error); });
  receiverProcesses.set(config.receivingPort, child)
  child.on('exit', (code) => {
    receiverProcesses.delete(config.receivingPort)
    console.error(`DICOM receiver on port ${config.receivingPort} exited with code ${code}`)
  })
  console.log(`DICOM receiver listening on ${config.receivingPort} as ${aeTitle}`)
  return { receivingPort: config.receivingPort, aeTitle, firewallRule, listener: 'started' }
}

async function scanInboundDicomStudies() {
  const configs = await prisma.pacsConfig.findMany({
    where: {
      client: { status: 'ACTIVE' },
      clientService: { status: 'ACTIVE', workflowType: { in: ['TELERADIOLOGY_ONLY', 'AI_TELERADIOLOGY'] } },
    },
    include: { client: true, clientService: { include: { service: true } } },
  })

  for (const config of configs) {
    if (!isTeleradiologyWorkflow(config.clientService.workflowType)) {
      if (config.clientService.validUntil < new Date()) continue
      if (config.clientService.credits - config.clientService.usedCredits <= 0) continue
    }
    const serviceType = serviceTypeForServiceName(config.clientService.service.name)
    for (const receiver of receiverSpecsForConfig(config)) {
      const folder = path.join(dicomInboundPath, config.client.code, String(receiver.receivingPort))
      const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith('study_')) continue
        const demoStatus = await getDemoUploadStatus(config.clientId)
        if (!demoStatus.allowed) continue
        await queueInboundStudyIfReady({
          clientId: config.clientId,
          clientCode: config.client.code,
          clientName: config.client.name,
          serviceType,
          serviceName: config.clientService.service.name,
          workflowType: config.clientService.workflowType,
          teleradiologyProviderCode: config.teleradiologyProviderCode,
          receivingPort: receiver.receivingPort,
          aeTitle: receiver.aeTitle,
          priority: receiver.priority,
          demoMode: demoStatus.demoMode,
          studyDir: path.join(folder, entry.name),
          studyUid: entry.name.replace(/^study_/, ''),
        })
      }
    }
  }
}

async function queueInboundStudyIfReady(input: {
  clientId: string
  clientCode: string
  clientName: string
  serviceType: ServiceType
  serviceName: string
  workflowType: string
  teleradiologyProviderCode: string | null
  receivingPort: number
  aeTitle: string
  priority: 'REGULAR' | 'URGENT'
  demoMode?: boolean
  studyDir: string
  studyUid: string
}) {
  const marker = path.join(input.studyDir, '.decxpert-available')

  const files = await listStudyFiles(input.studyDir)
  const dicomFiles = files.filter((file) => !path.basename(file).startsWith('.decxpert-') && !file.endsWith('.log'))
  if (!dicomFiles.length) return

  const newestWrite = Math.max(...dicomFiles.map((file) => fsSync.statSync(file).mtimeMs))
  const markerWrite = fsSync.existsSync(marker) ? fsSync.statSync(marker).mtimeMs : 0
  if (markerWrite >= newestWrite) return
  if (Date.now() - newestWrite < 8000) return

  const jobFolder = path.join(appUploadPath, `dicom-${crypto.randomUUID()}`)
  const uploadName = `${input.studyUid}.zip`
  const uploadPath = path.join(jobFolder, uploadName)
  const dicomMetadata = await extractDicomMetadata(dicomFiles[0]).catch<DicomMetadata>((error) => {
    console.error(`Unable to read DICOM metadata for ${input.studyUid}`, error)
    return {}
  })
  dicomMetadata.studyInstanceUid ??= input.studyUid
  dicomMetadata.modality ??= defaultModalityForServiceType(input.serviceType)
  const zipped = await zipDirectory(input.studyDir, uploadPath)
  const zipStat = await fs.stat(uploadPath)
  const studyInstanceUid = dicomMetadata.studyInstanceUid ?? input.studyUid
  const modalities = classifyBreastXrayModalities(Array.from(new Set([
    dicomMetadata.modality,
    defaultModalityForServiceType(input.serviceType),
  ].filter((value): value is string => Boolean(value)).map((value) => value.toUpperCase()))), dicomMetadata.bodyPartExamined)

  const study = await prisma.$transaction(async (tx) => {
    const savedStudy = await tx.availableBridgeStudy.upsert({
      where: {
        clientId_agentId_studyInstanceUid: {
          clientId: input.clientId,
          agentId: `DIRECT-PACS-${input.receivingPort}`,
          studyInstanceUid,
        },
      },
      update: {
        patientId: dicomMetadata.patientId ?? null,
        patientName: dicomMetadata.patientName ?? null,
        patientSex: dicomMetadata.patientSex ?? null,
        patientAge: dicomMetadata.patientAge ?? null,
        accessionNumber: dicomMetadata.accession ?? null,
        studyDate: dicomMetadata.studyDate ?? null,
        studyTime: dicomMetadata.studyTime ?? null,
        studyDescription: dicomMetadata.studyDescription ?? dicomMetadata.seriesDescription ?? dicomMetadata.protocolName ?? input.serviceName,
        referringPhysician: dicomMetadata.referringPhysician ?? null,
        modalities,
        archiveName: uploadName,
        archivePath: uploadPath,
        totalSizeBytes: BigInt(zipStat.size),
        instanceCount: zipped.fileCount,
        localPort: input.receivingPort,
        localAeTitle: input.aeTitle,
        availabilityStatus: 'Available',
        workflowStatus: 'Available',
        readyAt: new Date(),
        lastSyncedAt: new Date(),
      },
      create: {
        publicStudyId: `DP-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
        clientId: input.clientId,
        agentId: `DIRECT-PACS-${input.receivingPort}`,
        agentName: 'Direct PACS receiver',
        studyInstanceUid,
        patientId: dicomMetadata.patientId ?? null,
        patientName: dicomMetadata.patientName ?? null,
        patientSex: dicomMetadata.patientSex ?? null,
        patientAge: dicomMetadata.patientAge ?? null,
        accessionNumber: dicomMetadata.accession ?? null,
        studyDate: dicomMetadata.studyDate ?? null,
        studyTime: dicomMetadata.studyTime ?? null,
        studyDescription: dicomMetadata.studyDescription ?? dicomMetadata.seriesDescription ?? dicomMetadata.protocolName ?? input.serviceName,
        referringPhysician: dicomMetadata.referringPhysician ?? null,
        modalities,
        archiveName: uploadName,
        archivePath: uploadPath,
        totalSizeBytes: BigInt(zipStat.size),
        instanceCount: zipped.fileCount,
        localPort: input.receivingPort,
        localAeTitle: input.aeTitle,
        availabilityStatus: 'Available',
        workflowStatus: 'Available',
        firstDetectedAt: new Date(),
        readyAt: new Date(),
        lastSyncedAt: new Date(),
      },
    })
    await tx.usageLog.create({
      data: {
        clientId: input.clientId,
        serviceName: input.serviceName,
        studyUid: studyInstanceUid,
        creditsUsed: 0,
        success: true,
        message: `${input.priority === 'URGENT' ? 'Urgent ' : ''}DICOM study received on port ${input.receivingPort} and parked in Available Studies${dicomMetadata.patientName ? ` for ${dicomMetadata.patientName}` : ''}`,
      },
    })
    return savedStudy
  })
  await autoQueueAvailableStudyForRenewist({
    clientId: input.clientId,
    clientCode: input.clientCode,
    studyId: study.id,
    serviceType: input.serviceType,
    workflowType: input.workflowType,
    priority: input.priority,
    demoMode: input.demoMode,
    auditAction: 'DIRECT_PACS_STUDY_AUTO_SUBMITTED_TO_RENEWIST',
  })
  await fs.writeFile(marker, new Date().toISOString())
}

async function autoQueueAvailableStudyForRenewist(input: {
  clientId: string
  clientCode?: string
  studyId: string
  requestedServiceType?: string
  serviceType?: ServiceType
  workflowType?: string
  priority?: 'REGULAR' | 'URGENT'
  demoMode?: boolean
  auditAction: string
}) {
  const study = await prisma.availableBridgeStudy.findFirst({
    where: { id: input.studyId, clientId: input.clientId },
    include: { attachments: true },
  })
  if (!study || study.processingJobId || study.availabilityStatus !== 'Available' || !study.archivePath) return null
  if (study.modalities.includes('MG')) return null
  if (holdSpecialXrayForManualSubmission(study, input.serviceType ?? input.requestedServiceType)) return null
  const archiveMetadata = await extractDicomStudyMetadata(study.archivePath).catch(() => ({}))
  const dicomMetadata = mergeDicomMetadata(bridgeStudyDicomMetadata(study), archiveMetadata)
  const inferredServiceType = inferBridgeServiceType({
    modalities: dicomMetadata.modality ? [dicomMetadata.modality] : study.modalities,
    bodyPartExamined: dicomMetadata.bodyPartExamined,
    studyDescription: [
      dicomMetadata.studyDescription,
      dicomMetadata.bodyPartExamined,
      dicomMetadata.protocolName,
      study.studyDescription,
    ].filter(Boolean).join(' ') || undefined,
  })
  const serviceType = input.serviceType ?? (
    input.requestedServiceType && serviceMatchesBridgeInference(input.requestedServiceType, 'xray')
      ? parseServiceType(input.requestedServiceType)
      : undefined
  )
  const isXray = inferredServiceType === 'xray'
    || Boolean(serviceType && aiServiceTypeForServiceType(serviceType) === 'xray')
  if (inferredServiceType === 'mammography') {
    const modalities = classifyBreastXrayModalities(study.modalities, dicomMetadata.bodyPartExamined)
    if (modalities.includes('MG')) await prisma.availableBridgeStudy.update({ where: { id: study.id }, data: { modalities } })
    return null
  }
  if (inferredServiceType === 'special-xray-contrast-media' || !isXray) return null

  const demoStatus = input.demoMode === undefined ? await getDemoUploadStatus(input.clientId) : { allowed: true, demoMode: input.demoMode, message: '' }
  if (!demoStatus.allowed) return null
  const serviceSelection = input.serviceType && input.workflowType
    ? { serviceType: input.serviceType, workflowType: input.workflowType }
    : await resolveBridgeStudyService(input.clientId, bridgeStudyWithMetadata(study, archiveMetadata), serviceType ?? 'xray')
  if (!serviceSelection) return null

  const job = await prisma.$transaction(async (tx) => {
    const current = await tx.availableBridgeStudy.findUnique({ where: { id: study.id }, select: { processingJobId: true, priority: true } })
    if (current?.processingJobId) return tx.processingJob.findUnique({ where: { id: current.processingJobId } })
    const selectedPriority = current?.priority === 'URGENT' ? 'URGENT' : input.priority ?? 'REGULAR'
    const processingJob = await tx.processingJob.create({
      data: {
        clientId: input.clientId,
        serviceType: serviceSelection.serviceType,
        workflowType: serviceSelection.workflowType,
        clinicalStatus: 'QUEUED',
        priority: selectedPriority,
        uploadName: study.archiveName ?? path.basename(study.archivePath!),
        uploadPath: study.archivePath!,
        demoMode: demoStatus.demoMode,
        upstreamStatus: {
          state: 'auto_queued_for_renewist',
          bridgeStudyId: study.id,
          clinicalIndication: null,
          noClinicalIndication: true,
          priority: selectedPriority,
          supportingFiles: [],
          dicomMetadata,
        },
      },
    })
    await tx.availableBridgeStudy.update({
      where: { id: study.id },
      data: {
        clinicalIndication: null,
        workflowStatus: 'QueuedForRenewist',
        priority: selectedPriority,
        selectedAt: new Date(),
        submittedAt: new Date(),
        processingJobId: processingJob.id,
      },
    })
    await tx.auditLog.create({
      data: {
        clientId: input.clientId,
        action: input.auditAction,
        metadata: {
          studyId: study.id,
          publicStudyId: study.publicStudyId,
          processingJobId: processingJob.id,
          serviceType: serviceSelection.serviceType,
          noClinicalIndication: true,
        },
      },
    })
    await enqueueTelegramStudy(tx, processingJob, study.modalities[0], undefined, study.studyDescription)
    return processingJob
  })
  if (job) queueRenewistSubmission(job.id, 'Automatic submission')
  return job
}

async function processApplicationJob(jobId: string) {
  const job = await prisma.processingJob.findUniqueOrThrow({ where: { id: jobId } })
  const serviceType = parseServiceType(job.serviceType)
  if (!serviceType) throw new Error(`Unknown service type ${job.serviceType}`)
  const queuedState = job.upstreamStatus && typeof job.upstreamStatus === 'object' && !Array.isArray(job.upstreamStatus) ? job.upstreamStatus as Record<string, unknown> : {}
  const queuedMetadata = extractQueuedMetadata(job.upstreamStatus)
  const bridgeStudy = await prisma.availableBridgeStudy.findFirst({
    where: { processingJobId: job.id },
    include: { attachments: { orderBy: { createdAt: 'asc' } } },
  })
  const archiveMetadata = !metadataHasPatientIdentity(queuedMetadata) && bridgeStudy?.archivePath
    ? await extractDicomStudyMetadata(bridgeStudy.archivePath).catch(() => ({}))
    : {}
  const dicomMetadata = bridgeStudy
    ? mergeDicomMetadata(mergeDicomMetadata(bridgeStudyDicomMetadata(bridgeStudy), archiveMetadata), queuedMetadata)
    : queuedMetadata
  let patientProfileId = job.patientId ?? bridgeStudy?.patientProfileId ?? null
  const dicomPatientIdentifier = dicomMetadata.patientId?.trim()
  if (!patientProfileId && dicomPatientIdentifier) {
    const birthDate = /^\d{8}$/.test(dicomMetadata.patientBirthDate ?? '')
      ? new Date(`${dicomMetadata.patientBirthDate!.slice(0, 4)}-${dicomMetadata.patientBirthDate!.slice(4, 6)}-${dicomMetadata.patientBirthDate!.slice(6, 8)}T00:00:00.000Z`)
      : null
    const existingPatient = await prisma.patient.findFirst({
      where: { clientId: job.clientId, patientIdentifier: { equals: dicomPatientIdentifier, mode: 'insensitive' } },
    })
    const patient = existingPatient ? await prisma.patient.update({
      where: { id: existingPatient.id },
      data: {
        ...(existingPatient.name === 'Unknown patient' && dicomMetadata.patientName?.trim() ? { name: dicomMetadata.patientName.trim() } : {}),
        ...(!existingPatient.dateOfBirth && birthDate ? { dateOfBirth: birthDate } : {}),
        ...(!existingPatient.age && dicomMetadata.patientAge?.trim() ? { age: dicomMetadata.patientAge.trim() } : {}),
        ...(!existingPatient.sex && dicomMetadata.patientSex?.trim() ? { sex: dicomMetadata.patientSex.trim() } : {}),
      },
    }) : await prisma.patient.create({
      data: {
        clientId: job.clientId,
        patientIdentifier: dicomPatientIdentifier,
        name: dicomMetadata.patientName?.trim() || 'Unknown patient',
        dateOfBirth: birthDate,
        age: dicomMetadata.patientAge?.trim() || null,
        sex: dicomMetadata.patientSex?.trim() || null,
      },
    })
    patientProfileId = patient.id
    await prisma.$transaction([
      prisma.processingJob.update({ where: { id: job.id }, data: { patientId: patient.id } }),
      prisma.availableBridgeStudy.updateMany({ where: { processingJobId: job.id }, data: { patientProfileId: patient.id } }),
      prisma.auditLog.create({ data: { clientId: job.clientId, action: 'PATIENT_AUTO_LINKED_FROM_DICOM', metadata: { patientProfileId: patient.id, processingJobId: job.id } } }),
    ])
  }
  const clinicalIndication = typeof queuedState.clinicalIndication === 'string' ? queuedState.clinicalIndication : undefined
  if (patientProfileId && clinicalIndication?.trim()) {
    const linkedPatient = await prisma.patient.findUnique({ where: { id: patientProfileId }, select: { clinicalHistory: true } })
    if (linkedPatient && !linkedPatient.clinicalHistory?.trim()) {
      await prisma.patient.update({ where: { id: patientProfileId }, data: { clinicalHistory: clinicalIndication.trim() } })
    }
  }
  const clinicalIndicationAttachments = bridgeStudy?.attachments.map((attachment) => ({
    filePath: attachment.filePath,
    originalName: attachment.originalName,
    mimeType: attachment.mimeType,
    sizeBytes: String(attachment.sizeBytes),
  })) ?? []
  const directRenewistWorkflowType = 'TELERADIOLOGY_ONLY'

  await prisma.processingJob.update({
    where: { id: job.id },
    data: {
      status: 'submitting_to_renewist',
      workflowType: directRenewistWorkflowType,
      clinicalStatus: 'SUBMITTING',
      upstreamStatus: { state: 'submitting_to_renewist', workflowType: directRenewistWorkflowType, priority: job.priority ?? 'REGULAR', clinicalIndication, dicomMetadata },
    },
  })
  await prisma.availableBridgeStudy.updateMany({
    where: { processingJobId: job.id },
    data: { workflowStatus: 'SubmittingToRenewist' },
  })
  await enqueueStudyStatusNotification(prisma, {
    eventType: 'STUDY_SUBMISSION_TO_RENEWIST_STARTED',
    clientId: job.clientId,
    processingJobId: job.id,
    status: 'SUBMITTING_TO_RENEWIST',
    patientName: dicomMetadata.patientName,
    patientId: dicomMetadata.patientId,
    accession: dicomMetadata.accession,
    modality: dicomMetadata.modality ?? defaultModalityForServiceType(serviceType),
    serviceName: serviceNameForType(serviceType),
    idempotencyKey: `study-status:processing:${job.id}`,
  }).catch((error) => {
    console.warn(`Unable to enqueue processing-start notification for ${job.id}:`, error instanceof Error ? error.message : error)
  })
  await prisma.usageLog.create({
    data: {
      clientId: job.clientId,
      serviceName: serviceNameForType(serviceType),
      studyUid: `APP-${job.id}`,
      creditsUsed: 0,
      success: true,
      message: `Study queued for direct Renewist submission as job ${job.id}`,
    },
  })

  try {
    const serviceName = serviceNameForType(serviceType)
    const clientService = await prisma.clientService.findFirstOrThrow({
      where: { clientId: job.clientId, service: { name: serviceName }, status: 'ACTIVE' },
      include: { service: true, client: true, pacsConfig: true },
    })
    const reportId = await nextReportId({
      clientCode: clientService.client.code,
      serviceCode: clientService.service.code,
      uniqueSegment: job.id,
    })
    const workflowType: string = directRenewistWorkflowType
    await queueTeleradiologyOnlyJob({
      job,
      clientService: { ...clientService, workflowType },
      serviceName,
      serviceType,
      reportId,
      dicomMetadata,
      clinicalIndication,
      clinicalIndicationAttachments,
      reason: 'Study submitted directly to Renewist for signed reporting. Local AI processing is disabled.',
    })
    return
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Processing failed'
    await prisma.$transaction([
      prisma.usageLog.create({
        data: {
          clientId: job.clientId,
          serviceName: serviceNameForType(serviceType),
          studyUid: `APP-${job.id}`,
          creditsUsed: 0,
          success: false,
          message,
        },
      }),
      prisma.job.create({
        data: {
          clientId: job.clientId,
          serviceName: serviceNameForType(serviceType),
          status: 'FAILED',
          attempts: 1,
          error: message,
        },
      }),
      prisma.processingJob.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          clinicalStatus: 'FAILED',
          upstreamStatus: { state: 'failed' },
          error: message,
          completedAt: new Date(),
        },
      }),
      prisma.availableBridgeStudy.updateMany({
        where: { processingJobId: job.id },
        data: { workflowStatus: 'ProcessingFailed' },
      }),
    ])
    await enqueueStudyStatusNotification(prisma, {
      eventType: 'STUDY_PROCESSING_FAILED',
      clientId: job.clientId,
      processingJobId: job.id,
      status: 'FAILED',
      patientName: dicomMetadata.patientName,
      patientId: dicomMetadata.patientId,
      accession: dicomMetadata.accession,
      modality: dicomMetadata.modality ?? defaultModalityForServiceType(serviceType),
      serviceName: serviceNameForType(serviceType),
      idempotencyKey: `study-status:failed:${job.id}`,
      error: message,
    })
  }
}

type TeleradiologyQueueClientService = {
  workflowType: string
  pacsConfig?: { teleradiologyProviderCode?: string | null; outsourceTeleradiology?: boolean | null } | null
  client: {
    id: string
    code: string
    name: string
    email: string
    hospitalSlug: string | null
  }
}

async function queueTeleradiologyOnlyJob(input: {
  job: Awaited<ReturnType<typeof prisma.processingJob.findUniqueOrThrow>>
  clientService: TeleradiologyQueueClientService
  serviceName: string
  serviceType: string
  reportId: string
  dicomMetadata: Record<string, string>
  clinicalIndication?: string
  clinicalIndicationAttachments?: Array<{ filePath: string; originalName: string; mimeType?: string | null; sizeBytes: string }>
  reason: string
  upstreamResults?: Array<{ name: string; sourceName?: string; uploadName?: string; ok: boolean; status?: number; latencyMs?: number; error?: string }>
}) {
  const providerCode = input.clientService.pacsConfig?.teleradiologyProviderCode ?? process.env.TELERADIOLOGY_DEFAULT_PROVIDER ?? 'RENEWIST'
  const provider = await prisma.teleradiologyProvider.findUnique({ where: { code: providerCode } })
  if (!provider) throw new Error(`Teleradiology provider ${providerCode} is not configured`)
  const workflowType = input.job.workflowType ?? input.clientService.workflowType
  const outsourceTeleradiology = Boolean(
    providerCode
    && (workflowType === 'TELERADIOLOGY_ONLY' || workflowType === 'AI_TELERADIOLOGY' || input.clientService.pacsConfig?.outsourceTeleradiology)
  )

  const billableUnits = billableUnitsForStudy(input.serviceName, input.serviceType, input.job.imageCount || Number(input.dicomMetadata.numberOfInstances ?? 1) || 1)
  const studyUid = input.dicomMetadata.studyInstanceUid ?? `APP-${input.job.id}`
  const modality = input.dicomMetadata.modality ?? defaultModalityForServiceType(input.serviceType)
  const originalStudyStorage = await storeObject({
    kind: studyStorageKind(input.serviceType),
    keyParts: ['studies', input.job.id, input.job.uploadName],
    body: fsSync.createReadStream(input.job.uploadPath),
    contentType: 'application/zip',
    localPath: input.job.uploadPath,
  }).catch((error) => {
    console.warn(`Unable to upload study ${input.job.id} to S3:`, error instanceof Error ? error.message : error)
    return null
  })
  const refreshedJob = await prisma.processingJob.findUnique({ where: { id: input.job.id }, select: { patientId: true } })
  const matchedPatient = refreshedJob?.patientId ? null : input.dicomMetadata.patientId?.trim()
    ? await prisma.patient.findFirst({ where: { clientId: input.job.clientId, patientIdentifier: { equals: input.dicomMetadata.patientId.trim(), mode: 'insensitive' } }, select: { id: true, clinicalHistory: true } })
    : null
  const patientProfileId = refreshedJob?.patientId ?? matchedPatient?.id ?? null
  if (patientProfileId) {
    await prisma.$transaction([
      prisma.processingJob.update({ where: { id: input.job.id }, data: { patientId: patientProfileId } }),
      prisma.availableBridgeStudy.updateMany({ where: { processingJobId: input.job.id }, data: { patientProfileId } }),
      ...(input.clinicalIndication?.trim() && !matchedPatient?.clinicalHistory?.trim()
        ? [prisma.patient.updateMany({ where: { id: patientProfileId, OR: [{ clinicalHistory: null }, { clinicalHistory: '' }] }, data: { clinicalHistory: input.clinicalIndication.trim() } })]
        : []),
    ])
  }
  const reportSetting = await getProcessingReportSetting(input.job.clientId, input.serviceName)
  const activeRadiologistCount = outsourceTeleradiology ? 0 : await prisma.radiologistProfile.count({ where: { providerCode, active: true } })
  const existingProviderMapping = await prisma.providerJobMapping.findUnique({
    where: { dectrocelJobId: input.job.id },
    select: { reportReviewId: true },
  })
  const effectiveReportId = existingProviderMapping?.reportReviewId ?? input.reportId
  const reportGeneratedAt = new Date()
  const placeholder = buildRadiologyReport(`${input.serviceName} teleradiology report`, [{
    exam_type: modality,
    findings: 'Teleradiology interpretation pending. No AI-generated report is available for this study.',
    impression: 'Pending radiologist review.',
    recommendation: 'Review source images and complete the final radiology report.',
    disclaimer: input.reason,
  }], { reportId: effectiveReportId, generatedAt: reportGeneratedAt })
  const templatedReport = applyReportTemplate(applyReportMetadata(placeholder.html, input.dicomMetadata), placeholder.sections, reportSetting)
  const studyData = {
    clientId: input.job.clientId,
    patientId: patientProfileId,
    studyUid,
    modality,
    status: 'PROCESSING' as const,
    aiResponse: { skipped: true, reason: input.reason, upstreamStatus: input.upstreamResults ? summarizeUpstream(input.upstreamResults) : undefined, storage: { originalStudy: originalStudyStorage } },
    reportJson: { serviceType: input.serviceType, uploadName: input.job.uploadName, dicomMetadata: input.dicomMetadata, teleradiologyProvider: providerCode, storage: { originalStudy: originalStudyStorage } },
  }
  const study = await prisma.study.upsert({
    where: { studyUid },
    update: studyData,
    create: studyData,
  })

  await prisma.$transaction(async (tx) => {
    const reviewData = {
        clientId: input.job.clientId,
        studyId: study.id,
        radiologistId: null,
        serviceName: input.serviceName,
        studyUid: study.studyUid,
        patientName: input.dicomMetadata.patientName || null,
        patientId: input.dicomMetadata.patientId || null,
        patientProfileId,
        accession: input.dicomMetadata.accession || null,
        modality,
        status: outsourceTeleradiology || activeRadiologistCount ? 'PENDING' : 'FAILED',
        outputFormat: reportSetting?.dicomReturnFormat ?? 'DICOM_ENCAPSULATED_PDF',
        locked: false,
        generatedAt: reportGeneratedAt,
        aiReportJson: {
          htmlReport: templatedReport.html,
          ...templatedReport.sections,
          dicomMetadata: input.dicomMetadata,
          processingJob: { id: input.job.id, workflowType, clinicalStatus: outsourceTeleradiology || activeRadiologistCount ? 'PENDING' : 'FAILED', imageCount: billableUnits },
          workflow: { providerCode, aiReportIncluded: false, outsourceTeleradiology, activeRadiologistCount, outputFormat: reportSetting?.dicomReturnFormat ?? 'DICOM_ENCAPSULATED_PDF' },
          storage: { originalStudy: originalStudyStorage },
          upstreamStatus: input.upstreamResults ? summarizeUpstream(input.upstreamResults) : [],
          teleradiologyFallbackReason: input.reason,
        },
        editedReportJson: {
          htmlReport: templatedReport.html,
          ...templatedReport.sections,
          dicomMetadata: input.dicomMetadata,
          generatedAt: reportGeneratedAt.toISOString(),
          enabledSections: getEnabledReportSections(reportSetting),
          storage: { originalStudy: originalStudyStorage },
          teleradiologyFallbackReason: input.reason,
        },
      } satisfies Prisma.ReportReviewUncheckedCreateInput
    const review = await tx.reportReview.upsert({
      where: { id: effectiveReportId },
      update: reviewData as Prisma.ReportReviewUncheckedUpdateInput,
      create: { id: effectiveReportId, ...reviewData },
    })

    await tx.providerJobMapping.upsert({
      where: { dectrocelJobId: input.job.id },
      update: {
        providerId: provider.id,
        processingJobId: input.job.id,
        reportReviewId: review.id,
        studyInstanceUid: study.studyUid,
        accessionNumber: input.dicomMetadata.accession ?? null,
        status: 'SUBMITTED_TO_TELERADIOLOGY',
        metadata: {
          serviceName: input.serviceName,
          workflowType,
          aiReportIncluded: false,
          reason: input.reason,
          reportId: effectiveReportId,
          storage: { originalStudy: originalStudyStorage },
          upstreamStatus: input.upstreamResults ? summarizeUpstream(input.upstreamResults) : [],
        },
      },
      create: {
        providerId: provider.id,
        processingJobId: input.job.id,
        dectrocelJobId: input.job.id,
        providerJobId: null,
        reportReviewId: review.id,
        studyInstanceUid: study.studyUid,
        accessionNumber: input.dicomMetadata.accession ?? null,
        status: 'SUBMITTED_TO_TELERADIOLOGY',
        metadata: {
          serviceName: input.serviceName,
          workflowType,
          aiReportIncluded: false,
          reason: input.reason,
          reportId: effectiveReportId,
          storage: { originalStudy: originalStudyStorage },
          upstreamStatus: input.upstreamResults ? summarizeUpstream(input.upstreamResults) : [],
        },
      },
    })
    if (input.upstreamResults?.length) {
      await Promise.all(input.upstreamResults.map((upstream) => tx.usageLog.create({
        data: {
          clientId: input.job.clientId,
          serviceName: input.serviceName,
          studyUid: study.studyUid,
          creditsUsed: 0,
          success: upstream.ok,
          message: `${upstream.sourceName ?? input.job.uploadName} sent to ${upstream.name}: ${upstream.ok ? `accepted${upstream.status ? ` (${upstream.status})` : ''}` : upstream.error ?? upstream.status ?? 'rejected'}${upstream.latencyMs ? ` in ${(upstream.latencyMs / 1000).toFixed(1)}s` : ''}`,
        },
      })))
    }
    await tx.usageLog.create({
      data: {
        clientId: input.job.clientId,
        serviceName: input.serviceName,
        studyUid: study.studyUid,
        creditsUsed: 0,
        success: true,
        message: `${input.serviceName} routed to ${provider.name} teleradiology without AI report`,
      },
    })
    const existingStudyJob = await tx.job.findFirst({
      where: { clientId: input.job.clientId, studyId: study.id, serviceName: input.serviceName },
      select: { id: true },
    })
    if (existingStudyJob) {
      await tx.job.update({
        where: { id: existingStudyJob.id },
        data: { status: 'PROCESSING', attempts: { increment: 1 }, error: null },
      })
    } else {
      await tx.job.create({ data: {
        clientId: input.job.clientId,
        studyId: study.id,
        serviceName: input.serviceName,
        status: 'PROCESSING',
        attempts: 1,
      } })
    }
    await tx.processingJob.update({
      where: { id: input.job.id },
      data: {
        status: outsourceTeleradiology ? 'submitted_to_outsourced_teleradiology' : activeRadiologistCount ? 'sent_to_radiologist' : 'awaiting_radiologist',
        clinicalStatus: outsourceTeleradiology || activeRadiologistCount ? 'PENDING' : 'FAILED',
        providerJobId: null,
        imageCount: billableUnits,
        upstreamStatus: {
          state: 'submitted_to_teleradiology',
          providerCode,
          aiReportIncluded: false,
          outsourceTeleradiology,
          reason: input.reason,
          dicomMetadata: input.dicomMetadata,
          reportReviewId: review.id,
          storage: { originalStudy: originalStudyStorage },
          upstreamStatus: input.upstreamResults ? summarizeUpstream(input.upstreamResults) : [],
        },
        completedAt: null,
        error: null,
      },
    })
    await tx.reportAuditLog.create({
      data: {
        reportId: review.id,
        action: outsourceTeleradiology ? 'REPORT_SUBMITTED_TO_OUTSOURCED_TELERADIOLOGY' : activeRadiologistCount ? 'REPORT_PARKED_FOR_REVIEW' : 'NO_RADIOLOGIST_AVAILABLE',
        metadata: { reportId: review.id, providerCode, aiReportIncluded: false, outsourceTeleradiology, activeRadiologistCount, reason: input.reason, upstreamStatus: input.upstreamResults ? summarizeUpstream(input.upstreamResults) : [] },
      },
    })
  })
  // Outsourced submission notifications are emitted only after the provider
  // responds. A locally parked review can be announced immediately.
  if (!outsourceTeleradiology) {
    await enqueueStudyStatusNotification(prisma, {
      eventType: 'REPORT_PARKED_FOR_REVIEW',
      clientId: input.job.clientId,
      reportId: effectiveReportId,
      processingJobId: input.job.id,
      status: activeRadiologistCount ? 'PENDING_RADIOLOGIST_REVIEW' : 'NO_RADIOLOGIST_AVAILABLE',
      patientName: input.dicomMetadata.patientName,
      patientId: input.dicomMetadata.patientId,
      accession: input.dicomMetadata.accession,
      modality,
      serviceName: input.serviceName,
      idempotencyKey: `study-status:teleradiology:${effectiveReportId}:${activeRadiologistCount ? 'review' : 'failed'}`,
    })
  }
  if (!input.job.demoMode && getDeploymentFeatures().billing) {
    const billableServiceName = resolveBillableServiceName({ serviceName: input.serviceName, serviceType: input.serviceType, dicomMetadata: input.dicomMetadata, reportJson: placeholder.sections })
    await recordBillingEvent({
      clientId: input.job.clientId,
      processingJobId: input.job.id,
      studyId: study.id,
      serviceName: billableServiceName,
      workflowType,
      units: billableUnits,
      studyUid: study.studyUid,
      modality,
      priority: input.job.priority,
      providerCode,
      outsourceTeleradiology,
      assignedServiceName: input.serviceName,
    }).catch((billingError) => {
      console.error(`Billing transaction creation failed for teleradiology job ${input.job.id}`, billingError)
    })
  }
  if (outsourceTeleradiology) {
    await submitOutsourcedTeleradiologyStudy({
      providerCode,
      dectrocelJobId: input.job.id,
      processingJobId: input.job.id,
      reportReviewId: effectiveReportId,
      studyInstanceUid: study.studyUid,
      accessionNumber: input.dicomMetadata.accession ?? null,
      patientId: input.dicomMetadata.patientId ?? null,
      modality,
      workflowType: workflowType as 'AI_ONLY' | 'TELERADIOLOGY_ONLY' | 'AI_TELERADIOLOGY',
      priority: input.job.priority,
      aiReportHtml: null,
      studyZipPath: input.job.uploadPath,
      metadata: {
        client: {
          id: input.clientService.client.id,
          code: input.clientService.client.code,
          name: input.clientService.client.name,
          email: input.clientService.client.email,
          hospitalSlug: 'marengo',
        },
        hospitalSlug: 'marengo',
        service: { name: input.serviceName, type: input.serviceType },
        priority: input.job.priority ?? 'REGULAR',
        storage: { originalStudy: originalStudyStorage },
        patientName: input.dicomMetadata.patientName,
        patientAge: input.dicomMetadata.patientAge,
        patientSex: input.dicomMetadata.patientSex,
        clinicalHistory: input.clinicalIndication,
        clinicalIndication: input.clinicalIndication,
        clinicalIndicationAttachments: input.clinicalIndicationAttachments,
        dicomMetadata: input.dicomMetadata,
        teleradiologyFallbackReason: input.reason,
        aiReportJson: buildRenewistUnavailableAiReportJson({
          serviceName: input.serviceName,
          serviceType: input.serviceType,
          dicomMetadata: input.dicomMetadata,
        }),
      },
    })
  }
}

type RenewistAiReportPayload =
  | {
    modality: string
    ai_report_available: boolean
    report: { findings: string; impression: string }
    findings: string
    observations: string
    impression: string
    conclusion: string
    raw_ai_json: unknown
    upstream_raw_json: unknown[]
  }

function buildRenewistUnavailableAiReportJson(input: {
  serviceName: string
  serviceType: string
  dicomMetadata: DicomMetadata
}): RenewistAiReportPayload {
  const fallback = renewistFallbackReportText()
  return {
    modality: renewistModalityForStudy(input),
    ai_report_available: false,
    report: fallback,
    findings: fallback.findings,
    observations: fallback.findings,
    impression: fallback.impression,
    conclusion: fallback.impression,
    raw_ai_json: null,
    upstream_raw_json: [],
  }
}

function rawRenewistAiReportJson(
  upstreamResults?: Array<{ ok: boolean; json?: unknown; name?: string; sourceName?: string; uploadName?: string }>,
  fallbackSections?: Record<string, unknown>,
  modality = 'X-Ray',
) {
  const raw = (upstreamResults ?? [])
    .filter((item) => item.ok && item.json !== undefined && item.json !== null)
    .map((item) => item.json)
  if (raw.length === 1) return ensureRenewistAiReportAvailable({ ...(raw[0] && typeof raw[0] === 'object' && !Array.isArray(raw[0]) ? raw[0] as Record<string, unknown> : { result: raw[0] }), raw_ai_report: raw[0] }, true, modality)
  if (raw.length > 1) return ensureRenewistAiReportAvailable({ reports: raw, raw_ai_reports: raw }, true, modality)
  return ensureRenewistAiReportAvailable(fallbackSections ?? {}, Boolean(fallbackSections && Object.keys(fallbackSections).length), modality)
}

function rawRenewistReportJsonFromStoredReport(value: unknown, modality = 'X-Ray') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value ?? {}
  const record = value as Record<string, unknown>
  if (record.raw_ai_json !== undefined) return ensureRenewistAiReportAvailable(record.raw_ai_json ?? {}, true, modality)
  if (Array.isArray(record.upstream_raw_json) && record.upstream_raw_json.length === 1) return ensureRenewistAiReportAvailable(record.upstream_raw_json[0], true, modality)
  if (Array.isArray(record.upstream_raw_json) && record.upstream_raw_json.length > 1) return ensureRenewistAiReportAvailable({ reports: record.upstream_raw_json }, true, modality)
  const { htmlReport: _htmlReport, workflow: _workflow, processingJob: _processingJob, dicomMetadata: _dicomMetadata, ...rawish } = record
  return ensureRenewistAiReportAvailable(rawish, Object.keys(rawish).length > 0, modality)
}

function ensureRenewistAiReportAvailable(value: unknown, available: boolean, modality = 'X-Ray') {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    const existingReport = record.report && typeof record.report === 'object' && !Array.isArray(record.report)
      ? record.report as Record<string, unknown>
      : {}
    const fallback = renewistFallbackReportText()
    const fallbackFindings = cleanRenewistReportText(
      record.findings ?? record.observations ?? existingReport.findings ?? existingReport.observations ?? findNestedReportText(record, ['findings', 'finding', 'observations', 'observation']),
    ) || fallback.findings
    const fallbackImpression = cleanRenewistReportText(
      record.impression ?? record.conclusion ?? existingReport.impression ?? existingReport.conclusion ?? findNestedReportText(record, ['impression', 'summary', 'conclusion', 'diagnosis']),
    ) || fallback.impression
    return {
      ...record,
      ai_report_available: typeof record.ai_report_available === 'boolean' ? record.ai_report_available : available,
      modality: typeof record.modality === 'string' && record.modality.trim() ? record.modality : modality,
      findings: typeof record.findings === 'string' && record.findings.trim() ? record.findings : fallbackFindings,
      observations: typeof record.observations === 'string' && record.observations.trim() ? record.observations : fallbackFindings,
      impression: typeof record.impression === 'string' && record.impression.trim() ? record.impression : fallbackImpression,
      conclusion: typeof record.conclusion === 'string' && record.conclusion.trim() ? record.conclusion : fallbackImpression,
      report: {
        ...existingReport,
        examination: typeof existingReport.examination === 'string' && existingReport.examination.trim() ? existingReport.examination : modality,
        findings: typeof existingReport.findings === 'string' && existingReport.findings.trim() ? existingReport.findings : fallbackFindings,
        impression: typeof existingReport.impression === 'string' && existingReport.impression.trim() ? existingReport.impression : fallbackImpression,
      },
    }
  }
  const fallback = renewistFallbackReportText()
  const text = cleanRenewistReportText(value)
  const findings = text || fallback.findings
  const impression = text || fallback.impression
  return { ai_report_available: available, modality, findings, observations: findings, impression, conclusion: impression, report: { examination: modality, findings, impression, raw: value } }
}

function buildRenewistAiReportJson(input: {
  serviceName: string
  serviceType: string
  dicomMetadata: DicomMetadata
  sections?: Record<string, unknown>
  upstreamResults?: Array<{ name: string; sourceName?: string; uploadName?: string; ok: boolean; status?: number; latencyMs?: number; json?: unknown; error?: string }>
  rawAiJson?: unknown
}): RenewistAiReportPayload {
  const modality = renewistModalityForStudy(input)
  const successfulRawResponses = (input.upstreamResults ?? [])
    .filter((item) => item.ok && item.json)
    .map((item) => item.json)
  const findings = cleanRenewistReportText(
    input.sections?.findings
    ?? input.sections?.Findings
    ?? findNestedReportText(successfulRawResponses, ['findings', 'finding', 'observations', 'observation']),
  )
  const impression = cleanRenewistReportText(
    input.sections?.impression
    ?? input.sections?.Impression
    ?? findNestedReportText(successfulRawResponses, ['impression', 'summary', 'conclusion', 'diagnosis']),
  )

  const fallback = renewistFallbackReportText()
  const outboundFindings = findings || fallback.findings
  const outboundImpression = impression || fallback.impression
  const aiReportAvailable = Boolean(successfulRawResponses.length && (findings || impression))

  if (!successfulRawResponses.length && !findings && !impression) {
    return {
      modality,
      ai_report_available: false,
      report: {
        findings: outboundFindings,
        impression: outboundImpression,
      },
      findings: outboundFindings,
      observations: outboundFindings,
      impression: outboundImpression,
      conclusion: outboundImpression,
      raw_ai_json: input.rawAiJson ?? input.sections ?? null,
      upstream_raw_json: successfulRawResponses,
    }
  }

  return {
    modality,
    ai_report_available: aiReportAvailable,
    report: {
      findings: outboundFindings,
      impression: outboundImpression,
    },
    findings: outboundFindings,
    observations: outboundFindings,
    impression: outboundImpression,
    conclusion: outboundImpression,
    raw_ai_json: input.rawAiJson ?? input.sections ?? null,
    upstream_raw_json: successfulRawResponses,
  }
}

function renewistFallbackReportText() {
  return {
    findings: 'Teleradiology interpretation pending. No AI-generated report is available for this study.',
    impression: 'Pending radiologist review.',
  }
}

function cleanRenewistReportText(value: unknown) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(cleanRenewistReportText).filter(Boolean).join('\n').trim()
  return Object.values(value as Record<string, unknown>).map(cleanRenewistReportText).filter(Boolean).join('\n').trim()
}

function findNestedReportText(value: unknown, keys: string[], depth = 0): string {
  if (depth > 8 || value === undefined || value === null) return ''
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNestedReportText(item, keys, depth + 1)
      if (found) return found
    }
    return ''
  }
  if (typeof value !== 'object') return ''

  const normalizedKeys = new Set(keys.map((key) => key.toLowerCase()))
  for (const [key, candidate] of Object.entries(value as Record<string, unknown>)) {
    if (normalizedKeys.has(key.toLowerCase())) {
      const text = cleanRenewistReportText(candidate)
      if (text) return text
    }
  }
  for (const candidate of Object.values(value as Record<string, unknown>)) {
    const found = findNestedReportText(candidate, keys, depth + 1)
    if (found) return found
  }
  return ''
}

function resolveBillableServiceName(input: {
  serviceName: string
  serviceType: string
  dicomMetadata: DicomMetadata
  reportJson?: unknown
}) {
  const text = [
    input.serviceName,
    input.serviceType,
    input.dicomMetadata.modality,
    input.dicomMetadata.studyDescription,
    input.dicomMetadata.seriesDescription,
    input.dicomMetadata.protocolName,
    input.dicomMetadata.bodyPartExamined,
    cleanRenewistReportText(input.reportJson),
  ].filter(Boolean).join(' ').toLowerCase()

  if (text.includes('mammo') || text.includes('mammography')) return 'Mammography'
  if (text.includes('special') && (text.includes('xray') || text.includes('x-ray') || text.includes(' x '))) return 'Special X-ray (contrast media)'
  if (input.serviceType === 'xray' || input.serviceType.startsWith('xray') || input.dicomMetadata.modality === 'DX' || input.dicomMetadata.modality === 'CR') {
    if (text.includes('chest') || text.includes('thorax') || /\bcxr\b/.test(text)) return 'X-Ray Chest'
    return 'X-Ray Other - per additional view'
  }

  if (input.serviceType === 'mrcp' || text.includes('mrcp')) return 'MRCP'
  if (input.serviceType === 'mra-mrv-mrs' || /\bmra\b/.test(text) || /\bmrv\b/.test(text) || /\bmrs\b/.test(text)) return 'MRA / MRV / MRS'
  if (input.serviceType.startsWith('mri') || input.serviceType === 'mri' || input.dicomMetadata.modality === 'MR') {
    if (text.includes('screening')) return 'MRI Screening'
    if (text.includes('brain') && (text.includes('contrast') || text.includes('epilepsy') || text.includes('c+'))) return 'MRI Brain w/ Contrast - Epilepsy'
    if (text.includes('brain')) return 'MRI Brain'
    if (text.includes('spine') || text.includes('cervical') || text.includes('dorsal') || text.includes('lumbar') || text.includes('sacral')) return 'MRI Spine'
    if (text.includes('whole abdomen')) return 'MRI Whole Abdomen'
    if (text.includes('head-neck') || text.includes('head neck') || text.includes('neck') || text.includes('abdomen') || text.includes('pelvis')) return 'MRI Body - Head-Neck, Upper/Lower Abdomen, Pelvis'
    if (/\b(knee|shoulder|elbow|wrist|hip|ankle|joint|tmj|sacroiliac|si joint|limb|extremit|arm|forearm|hand|thigh|leg|foot)\b/.test(text)) return 'MRI Joints / Limbs'
    if (text.includes('prostate') || text.includes('breast') || text.includes('pituitary')) return 'MRI Prostate / Breast / Pituitary'
    return 'MRI Other'
  }

  if (input.serviceType === 'ct' || input.serviceType.startsWith('ct') || input.dicomMetadata.modality === 'CT') {
    if (text.includes('angio') || /\bcta\b/.test(text)) return 'CT Angio - all studies'
    if (text.includes('triple')) return 'Triple Phase CT'
    if (text.includes('thorax') || text.includes('chest') || text.includes('hrct chest')) return 'CT Thorax'
    if (text.includes('temporal')) return 'HRCT Temporal Bone'
    if (text.includes('head with contrast') || text.includes('brain contrast') || text.includes('contrast head')) return 'CT Head with Contrast'
    if (text.includes('face')) return 'CT Face'
    if (text.includes('pns') || text.includes('orbit') || text.includes('brain')) return 'CT Brain / PNS / Orbit'
    if (text.includes('body') || text.includes('abdomen') || text.includes('pelvis') || text.includes('contrast')) return 'CT Body - with or without Contrast'
    return 'CT Other'
  }

  return input.serviceName
}

function billableUnitsForStudy(serviceName: string, serviceType: string, imageCount: number) {
  return /x-?ray/i.test(serviceName) || serviceType === 'xray' || serviceType.startsWith('xray')
    ? Math.max(1, imageCount || 1)
    : 1
}

function renewistModalityForStudy(input: {
  serviceName: string
  serviceType: string
  dicomMetadata: DicomMetadata
}) {
  const text = [
    input.serviceName,
    input.serviceType,
    input.dicomMetadata.modality,
    input.dicomMetadata.studyDescription,
    input.dicomMetadata.seriesDescription,
    input.dicomMetadata.protocolName,
    input.dicomMetadata.bodyPartExamined,
  ].filter(Boolean).join(' ').toLowerCase()

  if (text.includes('special') && text.includes('x')) return 'Special X-ray'
  if (text.includes('mammo') || text.includes('mammography')) return 'Mammography'
  if (text.includes('xray') || text.includes('x-ray') || text.includes(' dx ') || input.dicomMetadata.modality === 'DX') return 'X-Ray'

  if (text.includes('mrcp')) return 'MRCP'
  if (text.includes('screening')) return 'MRI Screening'
  if (text.includes('epilepsy')) return 'MRI Brain Epilepsy Protocol'
  if (text.includes('brain') && (text.includes('contrast') || text.includes('c+'))) return 'MRI Brain with Contrast'
  if (text.includes('brain')) return 'MRI Brain'
  if (text.includes('spine')) return 'MRI Spine'
  if (text.includes('fistul')) return 'MRI Fistulogram'
  if (text.includes('whole abdomen')) return 'MRI Whole Abdomen'
  if (text.includes('upper abdomen')) return 'MRI Upper Abdomen'
  if (text.includes('lower abdomen')) return 'MRI Lower Abdomen'
  if (text.includes('pelvis')) return 'MRI Pelvis'
  if (text.includes('head-neck') || text.includes('head neck') || text.includes('neck')) return 'MRI Head-Neck'
  if (/\b(joint|knee|shoulder|elbow|wrist|hip|ankle|tmj|sacroiliac|si joint)\b/.test(text)) return 'MRI Joints'
  if (/\b(limb|extremit|arm|forearm|hand|thigh|leg|foot)\b/.test(text)) return 'MRI Limbs'
  if (text.includes('prostate')) return 'MRI Prostate'
  if (text.includes('breast')) return 'MRI Breast'
  if (text.includes('pituitary')) return 'MRI Pituitary'
  if (text.includes('mrv')) return 'MRV'
  if (text.includes('mrs')) return 'MRS'
  if (text.includes('mra')) return 'MRA'
  if (input.dicomMetadata.modality === 'MR' || text.includes('mri')) return 'MRI Screening'

  if (text.includes('venography')) return 'CT Venography'
  if (text.includes('angio')) return 'CT Angiography'
  if (text.includes('triple')) return 'Triple Phase CT'
  if (text.includes('thorax') || text.includes('chest')) return 'CT Thorax'
  if (text.includes('temporal')) return 'CT Temporal Bone'
  if (text.includes('head with contrast')) return 'CT Head with Contrast'
  if (text.includes('face')) return 'CT Face'
  if (text.includes('orbit')) return 'CT Orbit'
  if (text.includes('pns')) return 'CT PNS'
  if (text.includes('brain')) return 'CT Brain'
  if (text.includes('body') && (text.includes('with contrast') || text.includes('contrast'))) return 'CT Body with contrast'
  if (text.includes('body')) return 'CT Body without Contrast'
  if (input.dicomMetadata.modality === 'CT' || text.includes('ct')) return 'CT Thorax'

  return 'X-Ray'
}

function getRenewistOutboundSubmissionUrl(studySubmissionEndpoint?: string | null, apiBaseUrl?: string | null) {
  const explicitUrl = process.env.RENEWIST_OUTBOUND_STUDY_SUBMISSION_URL
  if (explicitUrl) return explicitUrl
  const baseUrl = apiBaseUrl ?? process.env.RENEWIST_OUTBOUND_API_BASE_URL ?? 'https://radagent.renewist.com'
  const submitPath = studySubmissionEndpoint ?? process.env.RENEWIST_OUTBOUND_STUDY_SUBMISSION_PATH ?? '/api/v1/teleradiology/dectrocel/reports'
  return new URL(submitPath, baseUrl).toString()
}

async function retryOutsourcedTeleradiologySubmission(processingJobId: string, actorUserId?: string) {
  const job = await prisma.processingJob.findUniqueOrThrow({
    where: { id: processingJobId },
    include: { client: true, bridgeStudy: { include: { attachments: { orderBy: { createdAt: 'asc' } } } } },
  })
  if (job.status !== 'outbound_submission_failed') {
    throw new Error(`Only outbound_submission_failed jobs can be retried. Current status is ${job.status}.`)
  }
  if (!fsSync.existsSync(job.uploadPath)) throw new Error(`Study ZIP is missing at ${job.uploadPath}`)

  const mapping = await prisma.providerJobMapping.findUnique({ where: { dectrocelJobId: job.id } })
  const report = mapping?.reportReviewId
    ? await prisma.reportReview.findUnique({ where: { id: mapping.reportReviewId } })
    : await prisma.reportReview.findFirst({
      where: {
        OR: [
          { aiReportJson: { path: ['processingJob', 'id'], equals: job.id } },
          { editedReportJson: { path: ['processingJob', 'id'], equals: job.id } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
    })
  if (!report) throw new Error(`No report review is linked to processing job ${job.id}`)

  const serviceName = serviceNameForType(job.serviceType)
  const clientService = await prisma.clientService.findFirstOrThrow({
    where: { clientId: job.clientId, service: { name: serviceName }, status: 'ACTIVE' },
    include: { service: true, client: true, pacsConfig: true },
  })
  const providerCode = clientService.pacsConfig?.teleradiologyProviderCode ?? process.env.TELERADIOLOGY_DEFAULT_PROVIDER ?? 'RENEWIST'
  const workflowType = job.workflowType ?? clientService.workflowType
  const upstream = job.upstreamStatus && typeof job.upstreamStatus === 'object' && !Array.isArray(job.upstreamStatus)
    ? job.upstreamStatus as Record<string, unknown>
    : {}
  const upstreamDicom = upstream.dicomMetadata && typeof upstream.dicomMetadata === 'object' && !Array.isArray(upstream.dicomMetadata)
    ? upstream.dicomMetadata as DicomMetadata
    : {}
  const reportDicom = getDicomMetadataFromReport(report) ?? {}
  const bridgeDicom = job.bridgeStudy ? bridgeStudyDicomMetadata(job.bridgeStudy) : {}
  const dicomMetadata = mergeDicomMetadata(mergeDicomMetadata(bridgeDicom, reportDicom), upstreamDicom)
  const clinicalIndication = typeof upstream.clinicalIndication === 'string'
    ? upstream.clinicalIndication
    : job.bridgeStudy?.clinicalIndication ?? undefined
  const clinicalIndicationAttachments = job.bridgeStudy?.attachments.map((attachment) => ({
    filePath: attachment.filePath,
    originalName: attachment.originalName,
    mimeType: attachment.mimeType,
    sizeBytes: String(attachment.sizeBytes),
  }))
  const aiReportHtml = getReportHtml(report)
  await prisma.processingJob.update({
    where: { id: job.id },
    data: {
      status: 'submitted_to_outsourced_teleradiology',
      clinicalStatus: 'PENDING',
      error: null,
      providerJobId: null,
      upstreamStatus: {
        ...upstream,
        state: 'retrying_outbound_submission',
        providerCode,
        reportReviewId: report.id,
        previousError: job.error,
      },
    },
  })
  await prisma.reportReview.update({ where: { id: report.id }, data: { status: 'PENDING' } })
  await prisma.auditLog.create({
    data: {
      clientId: job.clientId,
      actorUserId,
      action: 'OUTSOURCED_TELERADIOLOGY_RETRY_REQUESTED',
      metadata: { processingJobId: job.id, reportReviewId: report.id, providerCode, previousError: job.error },
    },
  })

  await submitOutsourcedTeleradiologyStudy({
    providerCode,
    dectrocelJobId: job.id,
    processingJobId: job.id,
    reportReviewId: report.id,
    studyInstanceUid: dicomMetadata.studyInstanceUid ?? report.studyUid,
    accessionNumber: dicomMetadata.accession ?? report.accession,
    patientId: dicomMetadata.patientId ?? report.patientId,
    modality: dicomMetadata.modality ?? report.modality ?? defaultModalityForServiceType(job.serviceType),
    workflowType: workflowType as 'AI_ONLY' | 'TELERADIOLOGY_ONLY' | 'AI_TELERADIOLOGY',
    priority: job.priority,
    aiReportHtml,
    studyZipPath: job.uploadPath,
    metadata: {
      client: {
        id: clientService.client.id,
        code: clientService.client.code,
        name: clientService.client.name,
        email: clientService.client.email,
        hospitalSlug: 'marengo',
      },
      hospitalSlug: 'marengo',
      service: { name: serviceName, type: job.serviceType },
      priority: job.priority ?? 'REGULAR',
      patientName: dicomMetadata.patientName ?? report.patientName,
      patientAge: dicomMetadata.patientAge,
      patientSex: dicomMetadata.patientSex,
      clinicalHistory: clinicalIndication,
      clinicalIndication,
      clinicalIndicationAttachments,
      dicomMetadata,
      aiReportJson: aiReportHtml
        ? rawRenewistReportJsonFromStoredReport(report.aiReportJson, renewistModalityForStudy({ serviceName, serviceType: job.serviceType, dicomMetadata }))
        : buildRenewistUnavailableAiReportJson({ serviceName, serviceType: job.serviceType, dicomMetadata }),
    },
  })

  return prisma.processingJob.findUniqueOrThrow({ where: { id: job.id } })
}

function getDicomMetadataFromReport(report: { aiReportJson: unknown; editedReportJson: unknown }): DicomMetadata | null {
  const edited = getReportDicomMetadataValue(report.editedReportJson)
  if (edited) return edited
  return getReportDicomMetadataValue(report.aiReportJson)
}

function getReportDicomMetadataValue(value: unknown): DicomMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const metadata = (value as { dicomMetadata?: unknown }).dicomMetadata
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata as DicomMetadata : null
}

async function submitOutsourcedTeleradiologyStudy(input: ProviderStudySubmission & {
  providerCode: string
  processingJobId: string
  reportReviewId: string
}) {
  const provider = await prisma.teleradiologyProvider.findUnique({ where: { code: input.providerCode } })
  if (!provider) throw new Error(`Teleradiology provider ${input.providerCode} is not configured`)
  const requestId = crypto.randomUUID()
  const adapter = new RenewistAdapter({
    apiBaseUrl: provider.apiBaseUrl ?? undefined,
    studySubmissionEndpoint: provider.studySubmissionEndpoint,
    timeoutMs: provider.timeoutSeconds * 1000,
  })
  const outboundUrl = getRenewistOutboundSubmissionUrl(provider.studySubmissionEndpoint, provider.apiBaseUrl)
  const metadata = input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? input.metadata as Record<string, unknown> : {}
  const storageMetadata = metadata.storage && typeof metadata.storage === 'object' && !Array.isArray(metadata.storage) ? metadata.storage : null
  const dicomMetadata = metadata.dicomMetadata && typeof metadata.dicomMetadata === 'object' && !Array.isArray(metadata.dicomMetadata)
    ? metadata.dicomMetadata as Record<string, string | null | undefined>
    : {}
  const normalizedStudy = input.studyZipPath ? await prepareRenewistStudyZip(input.studyZipPath, {
    ...dicomMetadata,
    patientId: String(input.patientId ?? dicomMetadata.patientId ?? ''),
    studyInstanceUid: String(input.studyInstanceUid ?? dicomMetadata.studyInstanceUid ?? ''),
    modality: String(input.modality ?? dicomMetadata.modality ?? ''),
  }) : null
  const submissionInput = normalizedStudy ? { ...input, studyZipPath: normalizedStudy.zipPath } : input
  const requestHash = crypto.createHash('sha256').update(JSON.stringify(submissionInput)).digest('hex')
  await prisma.providerApiRequest.create({
    data: {
      providerId: provider.id,
      requestId,
      direction: 'OUTBOUND',
      endpoint: outboundUrl,
      status: 'SENDING',
      authenticated: true,
      idempotencyKey: input.dectrocelJobId,
      requestHash,
      metadata: {
        dectrocelJobId: input.dectrocelJobId,
        reportReviewId: input.reportReviewId,
        workflowType: input.workflowType,
        providerCode: input.providerCode,
        outboundUrl,
        normalizedStudyZipPath: normalizedStudy?.zipPath ?? null,
        normalizedStudyFileCount: normalizedStudy?.fileCount ?? null,
        storage: storageMetadata,
        preparedSubmission: redactExchange(submissionInput) as Prisma.InputJsonValue,
      },
    },
  })
  await prisma.providerJobMapping.upsert({
    where: { dectrocelJobId: input.dectrocelJobId },
    update: {
      providerId: provider.id,
      processingJobId: input.processingJobId,
      reportReviewId: input.reportReviewId,
      studyInstanceUid: input.studyInstanceUid ?? null,
      accessionNumber: input.accessionNumber ?? null,
      status: 'OUTBOUND_SENDING',
      metadata: {
        outsourceTeleradiology: true,
        workflowType: input.workflowType,
        outboundRequestId: requestId,
        outboundUrl,
        normalizedStudyZipPath: normalizedStudy?.zipPath ?? null,
        normalizedStudyFileCount: normalizedStudy?.fileCount ?? null,
        storage: storageMetadata,
      },
    },
    create: {
      providerId: provider.id,
      providerJobId: null,
      processingJobId: input.processingJobId,
      reportReviewId: input.reportReviewId,
      dectrocelJobId: input.dectrocelJobId,
      studyInstanceUid: input.studyInstanceUid ?? null,
      accessionNumber: input.accessionNumber ?? null,
      status: 'OUTBOUND_SENDING',
      metadata: {
        outsourceTeleradiology: true,
        workflowType: input.workflowType,
        outboundRequestId: requestId,
        outboundUrl,
        normalizedStudyZipPath: normalizedStudy?.zipPath ?? null,
        normalizedStudyFileCount: normalizedStudy?.fileCount ?? null,
        storage: storageMetadata,
      },
    },
  })
  try {
    const result = await adapter.submitStudy(submissionInput)
    await prisma.$transaction([
      prisma.providerApiRequest.update({
        where: { requestId },
        data: {
          status: 'ACCEPTED',
          responseCode: result.httpStatus ?? 202,
          metadata: toPrismaJsonObject({
            dectrocelJobId: input.dectrocelJobId,
            reportReviewId: input.reportReviewId,
            workflowType: input.workflowType,
            providerCode: input.providerCode,
            storage: storageMetadata,
            response: result.raw,
            preparedSubmission: redactExchange(submissionInput),
            responseReceivedAt: new Date().toISOString(),
          }),
        },
      }),
      prisma.providerJobMapping.upsert({
        where: { dectrocelJobId: input.dectrocelJobId },
        update: {
          providerId: provider.id,
          providerJobId: result.providerJobId,
          processingJobId: input.processingJobId,
          reportReviewId: input.reportReviewId,
          studyInstanceUid: input.studyInstanceUid ?? null,
          accessionNumber: input.accessionNumber ?? null,
          status: result.providerStatus,
          metadata: toPrismaJsonObject({
            outsourceTeleradiology: true,
            workflowType: input.workflowType,
            outboundRequestId: requestId,
            storage: storageMetadata,
            providerResponse: result.raw,
          }),
        },
        create: {
          providerId: provider.id,
          providerJobId: result.providerJobId,
          processingJobId: input.processingJobId,
          reportReviewId: input.reportReviewId,
          dectrocelJobId: input.dectrocelJobId,
          studyInstanceUid: input.studyInstanceUid ?? null,
          accessionNumber: input.accessionNumber ?? null,
          status: result.providerStatus,
          metadata: toPrismaJsonObject({
            outsourceTeleradiology: true,
            workflowType: input.workflowType,
            outboundRequestId: requestId,
            storage: storageMetadata,
            providerResponse: result.raw,
          }),
        },
      }),
      prisma.reportAuditLog.create({
        data: {
          reportId: input.reportReviewId,
          action: 'OUTSOURCED_TELERADIOLOGY_ACCEPTED',
          metadata: { providerCode: input.providerCode, requestId, providerJobId: result.providerJobId, providerStatus: result.providerStatus },
        },
      }),
      prisma.processingJob.update({
        where: { id: input.processingJobId },
        data: {
          providerJobId: result.providerJobId,
          status: 'submitted_to_outsourced_teleradiology',
          clinicalStatus: 'PENDING',
          error: null,
          upstreamStatus: {
            state: 'submitted_to_teleradiology',
            providerCode: input.providerCode,
            providerJobId: result.providerJobId,
            reportReviewId: input.reportReviewId,
            requestId,
            storage: storageMetadata,
          },
        },
      }),
      prisma.availableBridgeStudy.updateMany({
        where: { processingJobId: input.processingJobId },
        data: { workflowStatus: 'SubmittedToRenewist' },
      }),
    ])
    await Promise.all([
      deleteLocalUploadFile(input.studyZipPath),
      normalizedStudy?.zipPath && normalizedStudy.zipPath !== input.studyZipPath ? deleteLocalUploadFile(normalizedStudy.zipPath) : Promise.resolve(),
    ])
    const acceptedJob = await prisma.processingJob.findUnique({ where: { id: input.processingJobId }, select: { clientId: true } })
    if (acceptedJob) {
      await enqueueStudyStatusNotification(prisma, {
        eventType: 'REPORT_SUBMITTED_TO_OUTSOURCED_TELERADIOLOGY',
        clientId: acceptedJob.clientId,
        reportId: input.reportReviewId,
        processingJobId: input.processingJobId,
        status: 'SUBMITTED_TO_TELERADIOLOGY',
        patientId: input.patientId,
        accession: input.accessionNumber,
        modality: input.modality,
        idempotencyKey: `study-status:teleradiology:${input.reportReviewId}:accepted:${requestId}`,
      })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Renewist outbound submit failed'
    await prisma.$transaction([
      prisma.providerApiRequest.update({
        where: { requestId },
        data: { status: 'FAILED', responseCode: error instanceof ProviderSubmissionError ? error.httpStatus : 502, metadata: toPrismaJsonObject({ error: message, dectrocelJobId: input.dectrocelJobId, reportReviewId: input.reportReviewId, preparedSubmission: redactExchange(submissionInput), responseReceivedAt: new Date().toISOString(), ...(error instanceof ProviderSubmissionError ? { response: redactExchange(error.responseBody) } : {}) }) },
      }),
      prisma.providerJobMapping.upsert({
        where: { dectrocelJobId: input.dectrocelJobId },
        update: { providerId: provider.id, status: 'OUTBOUND_SUBMISSION_FAILED', metadata: { outsourceTeleradiology: true, error: message, outboundRequestId: requestId } },
        create: {
          providerId: provider.id,
          processingJobId: input.processingJobId,
          reportReviewId: input.reportReviewId,
          dectrocelJobId: input.dectrocelJobId,
          studyInstanceUid: input.studyInstanceUid ?? null,
          accessionNumber: input.accessionNumber ?? null,
          status: 'OUTBOUND_SUBMISSION_FAILED',
          metadata: { outsourceTeleradiology: true, error: message, outboundRequestId: requestId },
        },
      }),
      prisma.processingJob.update({
        where: { id: input.processingJobId },
        data: {
          status: 'outbound_submission_failed',
          clinicalStatus: 'FAILED',
          error: message,
          upstreamStatus: {
            state: 'outbound_submission_failed',
            providerCode: input.providerCode,
            reportReviewId: input.reportReviewId,
            error: message,
            requestId,
          },
        },
      }),
      prisma.availableBridgeStudy.updateMany({
        where: { processingJobId: input.processingJobId },
        data: { workflowStatus: 'RenewistSubmissionFailed' },
      }),
      prisma.reportReview.update({
        where: { id: input.reportReviewId },
        data: { status: 'FAILED' },
      }),
      prisma.reportAuditLog.create({
        data: { reportId: input.reportReviewId, action: 'OUTSOURCED_TELERADIOLOGY_FAILED', metadata: { providerCode: input.providerCode, requestId, error: message } },
      }),
    ])
    const failedJob = await prisma.processingJob.findUnique({ where: { id: input.processingJobId }, select: { clientId: true } })
    if (failedJob) {
      await enqueueStudyStatusNotification(prisma, {
        eventType: 'OUTSOURCED_TELERADIOLOGY_SUBMISSION_FAILED',
        clientId: failedJob.clientId,
        reportId: input.reportReviewId,
        processingJobId: input.processingJobId,
        status: 'OUTBOUND_SUBMISSION_FAILED',
        patientId: input.patientId,
        accession: input.accessionNumber,
        modality: input.modality,
        error: message,
        idempotencyKey: `study-status:teleradiology:${input.reportReviewId}:failed:${requestId}`,
      })
    }
    console.error(`Outsourced teleradiology submission failed for job ${input.dectrocelJobId}`, error)
  }
}

function summarizeUpstream(results: Array<{ name: string; sourceName?: string; uploadName?: string; ok: boolean; status?: number; latencyMs?: number; error?: string }>) {
  return results.map((result) => ({
    endpoint: result.name,
    sourceName: result.sourceName,
    uploadName: result.uploadName,
    ok: result.ok,
    status: result.status,
    latencyMs: result.latencyMs,
    error: result.error,
  }))
}

async function getAccessibleProcessingJob(jobId: string, user: { role: string; clientId?: string }) {
  const job = await prisma.processingJob.findUnique({ where: { id: jobId } })
  if (!job) return null
  if (user.role === 'SUPER_ADMIN') return job
  if (user.clientId && job.clientId === user.clientId) return job
  return null
}

async function getLatestProcessingPriority(jobId: string, fallback?: string | null) {
  const latest = await prisma.processingJob.findUnique({ where: { id: jobId }, select: { priority: true } })
  return latest?.priority ?? fallback ?? 'REGULAR'
}

function formatProcessingStatus(job: {
  id: string
  status: string
  upstreamStatus: unknown
  serviceType: string
  priority: string | null
  imageCount: number
  uploadName: string
  demoMode?: boolean
  createdAt: Date
  updatedAt: Date
  completedAt: Date | null
  error: string | null
}) {
  return {
    job_id: job.id,
    status: job.status,
    upstream_status: job.upstreamStatus,
    service_type: job.serviceType,
    priority: job.priority ?? 'REGULAR',
    demo_mode: Boolean(job.demoMode),
    image_count: job.imageCount,
    upload_name: job.uploadName,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
    completed_at: job.completedAt,
    error: sanitizeProcessingJobError(job.error, job.serviceType),
  }
}

function sanitizeProcessingJobError(error: string | null, serviceType: string) {
  if (!error) return null
  const engineLabel = serviceType === 'mammography'
    ? 'Mammography AI engine'
    : serviceType === 'mri' || serviceType.startsWith('mri')
      ? 'MRI AI engine'
      : 'AI engine'
  if (/Locator\.click|prompt-textarea|modal-beacon|subtree intercepts pointer events|vision automation failed/i.test(error)) {
    return `${engineLabel} failed inside the upstream automation. The portal upload and routing succeeded; the upstream engine must clear its blocking modal/session and be rerun.`
  }
  if (/0 diagnostic images were processed/i.test(error)) {
    return `${engineLabel} rejected the submitted DICOM package as 0 diagnostic images. The portal has preserved the locally verified image count for this study.`
  }
  return error
}

async function listStudyFiles(folder: string): Promise<string[]> {
  const entries = await fs.readdir(folder, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(folder, entry.name)
    if (entry.isDirectory()) return listStudyFiles(entryPath)
    return isDicomCandidateFile(entry.name) ? [entryPath] : []
  }))
  return nested.flat()
}

function isDicomCandidateFile(fileName: string) {
  const baseName = fileName.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? ''
  if (!baseName || baseName.startsWith('.')) return false
  if (baseName === 'patient_meta.json' || baseName === 'metadata.json' || baseName === 'manifest.json') return false
  if (baseName.startsWith('pdf.')) return false
  if (/\.(json|txt|csv|xml|html?|log|pdf|jpg|jpeg|png|gif|bmp|webp)$/i.test(baseName)) return false
  return true
}

type DicomMetadata = {
  referringPhysician?: string
  patientName?: string
  patientId?: string
  accession?: string
  encounterNo?: string
  billDate?: string
  admissionType?: string
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

async function extractDicomMetadata(filePath: string): Promise<DicomMetadata> {
  const dcmdump = await findTool('dcmdump.exe')
  if (!dcmdump) return {}

  const tags = ['0008,0090', '0010,0010', '0010,0020', '0008,0050', '0010,0040', '0010,1010', '0010,0030', '0020,000D', '0020,000E', '0008,0018', '0008,0020', '0008,0030', '0008,0060', '0008,1030', '0008,103E', '0018,1030', '0018,0015']
  const output = await new Promise<string>((resolve, reject) => {
    execFile(dcmdump, tags.flatMap((tag) => ['+P', tag]).concat(filePath), { windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message))
      else resolve(stdout)
    })
  })

  return {
    patientName: cleanDicomValue(readDicomDumpValue(output, '0010,0010')),
    patientId: cleanDicomValue(readDicomDumpValue(output, '0010,0020')),
    accession: cleanDicomValue(readDicomDumpValue(output, '0008,0050')),
    patientSex: cleanDicomValue(readDicomDumpValue(output, '0010,0040')),
    patientAge: cleanDicomValue(readDicomDumpValue(output, '0010,1010')),
    patientBirthDate: cleanDicomValue(readDicomDumpValue(output, '0010,0030')),
    studyInstanceUid: cleanDicomValue(readDicomDumpValue(output, '0020,000D')),
    seriesInstanceUid: cleanDicomValue(readDicomDumpValue(output, '0020,000E')),
    sopInstanceUid: cleanDicomValue(readDicomDumpValue(output, '0008,0018')),
    studyDate: cleanDicomValue(readDicomDumpValue(output, '0008,0020')),
    studyTime: cleanDicomValue(readDicomDumpValue(output, '0008,0030')),
    modality: cleanDicomValue(readDicomDumpValue(output, '0008,0060')),
    studyDescription: cleanDicomValue(readDicomDumpValue(output, '0008,1030')),
    referringPhysician: cleanDicomValue(readDicomDumpValue(output, '0008,0090')),
    seriesDescription: cleanDicomValue(readDicomDumpValue(output, '0008,103E')),
    protocolName: cleanDicomValue(readDicomDumpValue(output, '0018,1030')),
    bodyPartExamined: cleanDicomValue(readDicomDumpValue(output, '0018,0015')),
  }
}

function readDicomDumpValue(output: string, tag: string) {
  const escapedTag = tag.replace(',', ',')
  const match = output.match(new RegExp(`\\(${escapedTag}\\)\\s+\\w+\\s+\\[([^\\]]*)\\]`, 'i'))
  return match?.[1]
}

function cleanDicomValue(value: string | undefined) {
  return value?.replaceAll('^', ' ').replace(/\s+/g, ' ').trim() || undefined
}

function extractQueuedMetadata(value: unknown): DicomMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const metadata = (value as Record<string, unknown>).dicomMetadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {}
  return {
    patientName: typeof (metadata as Record<string, unknown>).patientName === 'string' ? String((metadata as Record<string, unknown>).patientName) : undefined,
    patientId: typeof (metadata as Record<string, unknown>).patientId === 'string' ? String((metadata as Record<string, unknown>).patientId) : undefined,
    accession: typeof (metadata as Record<string, unknown>).accession === 'string' ? String((metadata as Record<string, unknown>).accession) : undefined,
    patientSex: typeof (metadata as Record<string, unknown>).patientSex === 'string' ? String((metadata as Record<string, unknown>).patientSex) : undefined,
    patientAge: typeof (metadata as Record<string, unknown>).patientAge === 'string' ? String((metadata as Record<string, unknown>).patientAge) : undefined,
    patientBirthDate: typeof (metadata as Record<string, unknown>).patientBirthDate === 'string' ? String((metadata as Record<string, unknown>).patientBirthDate) : undefined,
    studyInstanceUid: typeof (metadata as Record<string, unknown>).studyInstanceUid === 'string' ? String((metadata as Record<string, unknown>).studyInstanceUid) : undefined,
    seriesInstanceUid: typeof (metadata as Record<string, unknown>).seriesInstanceUid === 'string' ? String((metadata as Record<string, unknown>).seriesInstanceUid) : undefined,
    sopInstanceUid: typeof (metadata as Record<string, unknown>).sopInstanceUid === 'string' ? String((metadata as Record<string, unknown>).sopInstanceUid) : undefined,
    studyDate: typeof (metadata as Record<string, unknown>).studyDate === 'string' ? String((metadata as Record<string, unknown>).studyDate) : undefined,
    studyTime: typeof (metadata as Record<string, unknown>).studyTime === 'string' ? String((metadata as Record<string, unknown>).studyTime) : undefined,
    modality: typeof (metadata as Record<string, unknown>).modality === 'string' ? String((metadata as Record<string, unknown>).modality) : undefined,
    studyDescription: typeof (metadata as Record<string, unknown>).studyDescription === 'string' ? String((metadata as Record<string, unknown>).studyDescription) : undefined,
    seriesDescription: typeof (metadata as Record<string, unknown>).seriesDescription === 'string' ? String((metadata as Record<string, unknown>).seriesDescription) : undefined,
    protocolName: typeof (metadata as Record<string, unknown>).protocolName === 'string' ? String((metadata as Record<string, unknown>).protocolName) : undefined,
    bodyPartExamined: typeof (metadata as Record<string, unknown>).bodyPartExamined === 'string' ? String((metadata as Record<string, unknown>).bodyPartExamined) : undefined,
  }
}

function getClinicalIndication(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  for (const candidate of [record.clinicalIndication, record.clinicalHistory]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  const metadata = record.metadata
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const nested = getClinicalIndication(metadata)
    if (nested) return nested
  }
  return undefined
}

function applyReportMetadata(html: string, metadata: DicomMetadata) {
  const ageSex = [metadata.patientAge, metadata.patientSex].filter(Boolean).join('/')
  return html
    .replace(/\{\{\s*patient_id\s*\}\}/gi, escapeHtml(metadata.patientId ?? ''))
    .replace(/\{\{\s*patient_name\s*\}\}/gi, escapeHtml(metadata.patientName ?? ''))
    .replace(/\{\{\s*patient_age\s*\}\}/gi, escapeHtml(metadata.patientAge ?? ''))
    .replace(/\{\{\s*patient_sex\s*\}\}/gi, escapeHtml(metadata.patientSex ?? ''))
    .replace(/\{\{\s*accession\s*\}\}/gi, escapeHtml(metadata.accession ?? ''))
    .replace(/\{\{\s*encounter_no\s*\}\}/gi, escapeHtml(metadata.encounterNo ?? ''))
    .replace(/\{\{\s*bill_date\s*\}\}/gi, escapeHtml(metadata.billDate ?? ''))
    .replace(/\{\{\s*admission_type\s*\}\}/gi, escapeHtml(metadata.admissionType ?? ''))
    .replace(/(<tr><th>Patient ID<\/th><td>)[\s\S]*?(<\/td><th>Age\/Sex<\/th><td>)[\s\S]*?(<\/td><\/tr>)/i, `$1${escapeHtml(metadata.patientId ?? '')}$2${escapeHtml(ageSex)}$3`)
    .replace(/(<tr><th>Patient Name<\/th><td>)[\s\S]*?(<\/td><th>Reported Date<\/th><td>)/i, `$1${escapeHtml(metadata.patientName ?? '')}$2`)
}

const defaultReportSections = ['AI Triage', 'Image Quality', 'Findings', 'Impression', 'Systematic Sweep', 'Abnormality Candidates', 'Comparison', 'Recommendation', 'Disclaimer']
const templateSectionKeyMap: Record<string, string[]> = {
  'AI Triage': ['classification', 'severityScore', 'confidence'],
  'Image Quality': ['imageQuality'],
  Findings: ['findings'],
  Impression: ['impression'],
  'Systematic Sweep': ['systematicSweep'],
  'Abnormality Candidates': ['abnormalityCandidates'],
  Comparison: ['comparison'],
  Recommendation: ['recommendation'],
  Disclaimer: ['disclaimer'],
}

function getEnabledReportSections(setting: { reportMode?: string; enabledSections?: string[] } | null | undefined) {
  if (!setting || setting.reportMode !== 'Custom') return defaultReportSections
  return setting.enabledSections?.filter((section) => defaultReportSections.includes(section)) ?? []
}

async function providerReportScopeWhere(providerCode: string) {
  const provider = await prisma.teleradiologyProvider.findUnique({ where: { code: providerCode }, select: { id: true } })
  if (!provider) return { id: '__none__' }
  const mappings = await prisma.providerJobMapping.findMany({
    where: { providerId: provider.id, reportReviewId: { not: null } },
    select: { reportReviewId: true },
  })
  const reportIds = mappings.flatMap((mapping) => mapping.reportReviewId ? [mapping.reportReviewId] : [])
  return reportIds.length ? { id: { in: reportIds } } : { id: '__none__' }
}

async function getReportProviderCode(report: { id?: string; clientId: string; serviceName: string }) {
  if (report.id) {
    const mappedProvider = await prisma.providerJobMapping.findFirst({
      where: { reportReviewId: report.id, providerId: { not: null } },
      select: { providerId: true },
      orderBy: { updatedAt: 'desc' },
    })
    if (mappedProvider?.providerId) {
      const provider = await prisma.teleradiologyProvider.findUnique({
        where: { id: mappedProvider.providerId },
        select: { code: true },
      })
      if (provider) return provider.code
    }
  }
  const providerService = await prisma.clientService.findFirst({
    where: {
      clientId: report.clientId,
      service: { name: report.serviceName },
      pacsConfig: { teleradiologyProviderCode: { not: null } },
    },
    include: { pacsConfig: true },
  })
  return providerService?.pacsConfig?.teleradiologyProviderCode ?? null
}

async function assertProviderOwnsReport(providerCode: string, report: { id: string; clientId: string; serviceName: string }) {
  const provider = await prisma.teleradiologyProvider.findUnique({ where: { code: providerCode }, select: { id: true } })
  const mapping = provider
    ? await prisma.providerJobMapping.findFirst({ where: { providerId: provider.id, reportReviewId: report.id }, select: { id: true } })
    : null
  if (!mapping) {
    const error = new Error('Provider cannot access this report')
    ;(error as Error & { status?: number }).status = 403
    throw error
  }
}

async function completeCallBooking(bookingId: string, actualDurationMinutes: number, actorUserId: string, providerCode: string) {
  const booking = await prisma.reportCallBooking.findUniqueOrThrow({
    where: { id: bookingId },
    include: { report: true },
  })
  if (booking.status !== 'BOOKED') {
    throw new Error('Call must be confirmed before it can be completed')
  }
  const finalAmountMinor = actualDurationMinutes * booking.pricePerMinuteMinor
  return prisma.$transaction(async (tx) => {
    const transaction = await tx.studyBillingTransaction.create({
      data: {
        clientId: booking.clientId,
        serviceName: 'Radiologist consultation call',
        workflowType: 'TELERADIOLOGY_CALL',
        priority: 'REGULAR',
        category: 'TELERADIOLOGY_CALL',
        units: actualDurationMinutes,
        unitPriceMinor: booking.pricePerMinuteMinor,
        amountMinor: finalAmountMinor,
        currency: 'INR',
        status: 'UNINVOICED',
        metadata: { bookingId: booking.id, reportId: booking.reportId, providerCode, communicationMode: booking.communicationMode },
      },
    })
    const updated = await tx.reportCallBooking.update({
      where: { id: booking.id },
      data: { status: 'COMPLETED', actualDurationMinutes, finalAmountMinor, completedAt: new Date(), billedTransactionId: transaction.id },
      include: { radiologist: true, report: { include: { client: true } }, client: true },
    })
    await tx.auditLog.create({
      data: { clientId: booking.clientId, actorUserId, action: 'CALL_COMPLETED_BILLED', metadata: { providerCode, bookingId: booking.id, reportId: booking.reportId, actualDurationMinutes, finalAmountMinor, billingTransactionId: transaction.id } },
    })
    return updated
  })
}

async function canRadiologistAccessReport(
  profile: { clientId: string | null; providerCode: string | null; active: boolean; organisationName?: string | null },
  report: { id: string; clientId: string; serviceName: string },
) {
  if (!profile.active) return false
  if (profile.clientId && report.clientId === profile.clientId) return true
  if (profile.clientId && !profile.providerCode) {
    const center = await prisma.client.findFirst({
      where: { id: report.clientId, kind: 'CENTER', parentClientId: profile.clientId },
      select: { id: true },
    })
    if (center) return true
  }
  if (!profile.providerCode) return false
  const provider = await prisma.teleradiologyProvider.findUnique({ where: { code: profile.providerCode }, select: { id: true } })
  if (!provider) return false
  const mapping = await prisma.providerJobMapping.findFirst({
    where: { providerId: provider.id, reportReviewId: report.id },
    select: { id: true },
  })
  return Boolean(mapping)
}

async function getAuthorizedReport(req: Request) {
  const report = await prisma.reportReview.findUniqueOrThrow({
    where: { id: String(req.params.reportId) },
    include: { client: { select: { id: true, code: true, kind: true, parentClientId: true } } },
  })
  const user = req.user!
  if (user.role === 'SUPER_ADMIN') return report
  if (user.role === 'CLIENT_USER' && user.clientId) {
    if (report.clientId === user.clientId) return report
    const managementClient = await prisma.client.findUnique({ where: { id: user.clientId }, select: { kind: true } })
    if (managementClient?.kind === 'GROUP' && report.client.kind === 'CENTER' && report.client.parentClientId === user.clientId) return report
  }
  if (['PROVIDER_ADMIN', 'PROVIDER_MANAGER'].includes(user.role) && user.providerCode) {
    const provider = await prisma.teleradiologyProvider.findUnique({ where: { code: user.providerCode }, select: { id: true } })
    const mapping = provider
      ? await prisma.providerJobMapping.findFirst({ where: { providerId: provider.id, reportReviewId: report.id }, select: { id: true } })
      : null
    if (mapping) return report
  }
  if (user.role === 'RADIOLOGIST') {
    const profile = await prisma.radiologistProfile.findUniqueOrThrow({ where: { userId: user.sub } })
    const canAccess = await canRadiologistAccessReport(profile, report)
    const groupRadiologist = await isGroupRadiologistProfile(profile)
    if (canAccess && (groupRadiologist || !report.radiologistId || report.radiologistId === profile.id)) return report
  }
  const error = new Error('Report cannot be opened in viewer')
  ;(error as Error & { status?: number }).status = 403
  throw error
}

function canSeePreferredRadiologistReport(
  profile: { id: string },
  report: { radiologistId?: string | null; aiReportJson?: unknown; editedReportJson?: unknown },
) {
  const preferredRadiologistId = getPreferredRadiologistId(report.aiReportJson) ?? getPreferredRadiologistId(report.editedReportJson)
  return !preferredRadiologistId || preferredRadiologistId === profile.id || report.radiologistId === profile.id
}

async function isGroupRadiologistProfile(profile: { clientId?: string | null; providerCode?: string | null }) {
  if (!profile.clientId || profile.providerCode) return false
  const group = await prisma.client.findFirst({ where: { id: profile.clientId, kind: 'GROUP' }, select: { id: true } })
  return Boolean(group)
}

function getPreferredRadiologistId(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const workflow = (value as { workflow?: unknown }).workflow
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) return null
  const preferredRadiologistId = (workflow as { preferredRadiologistId?: unknown }).preferredRadiologistId
  return typeof preferredRadiologistId === 'string' && preferredRadiologistId.trim() ? preferredRadiologistId.trim() : null
}

function getReportProcessingJobId(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const processingJob = (value as { processingJob?: unknown }).processingJob
  if (!processingJob || typeof processingJob !== 'object' || Array.isArray(processingJob)) return null
  const id = (processingJob as { id?: unknown }).id
  return typeof id === 'string' && id.trim() ? id : null
}

function getReportHtml(report: { editedReportJson: unknown; aiReportJson: unknown }) {
  const edited = report.editedReportJson && typeof report.editedReportJson === 'object' && !Array.isArray(report.editedReportJson)
    ? (report.editedReportJson as Record<string, unknown>).htmlReport
    : null
  if (typeof edited === 'string' && edited.trim()) return edited
  const initial = report.aiReportJson && typeof report.aiReportJson === 'object' && !Array.isArray(report.aiReportJson)
    ? (report.aiReportJson as Record<string, unknown>).htmlReport
    : null
  return typeof initial === 'string' && initial.trim() ? initial : ''
}

async function buildDocxReportDocument(html: string) {
  const zip = new yazl.ZipFile()
  zip.addBuffer(Buffer.from(docxContentTypesXml(), 'utf8'), '[Content_Types].xml')
  zip.addBuffer(Buffer.from(docxRootRelsXml(), 'utf8'), '_rels/.rels')
  zip.addBuffer(Buffer.from(docxDocumentXml(html), 'utf8'), 'word/document.xml')
  zip.addBuffer(Buffer.from(docxStylesXml(), 'utf8'), 'word/styles.xml')
  zip.end()
  const chunks: Buffer[] = []
  return await new Promise<Buffer>((resolve, reject) => {
    zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk))
    zip.outputStream.on('error', reject)
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

function docxContentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`
}

function docxRootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
}

function docxStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
</w:styles>`
}

function docxDocumentXml(html: string) {
  const blocks = htmlToDocxBlocks(html)
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${blocks.join('\n')}
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>
  </w:body>
</w:document>`
}

function htmlToDocxBlocks(html: string) {
  const body = html
    .replace(/<!doctype[^>]*>/i, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/?(html|body)[^>]*>/gi, '')
  const blocks: string[] = []
  let cursor = 0
  const tableRegex = /<table[\s\S]*?<\/table>/gi
  for (const match of body.matchAll(tableRegex)) {
    const index = match.index ?? 0
    blocks.push(...htmlSegmentToParagraphs(body.slice(cursor, index)))
    blocks.push(htmlTableToDocx(match[0]))
    cursor = index + match[0].length
  }
  blocks.push(...htmlSegmentToParagraphs(body.slice(cursor)))
  return blocks.length ? blocks : [docxParagraph('')]
}

function htmlSegmentToParagraphs(html: string) {
  const blocks: string[] = []
  const blockRegex = /<(h[1-6]|p|li)[^>]*>([\s\S]*?)<\/\1>/gi
  for (const match of html.matchAll(blockRegex)) {
    const tag = match[1].toLowerCase()
    const text = htmlToPlainText(match[2])
    if (!text) continue
    blocks.push(docxParagraph(tag === 'h1' ? text : tag === 'h2' || tag === 'h3' ? text : tag === 'li' ? `• ${text}` : text, tag))
  }
  if (blocks.length) return blocks
  return htmlToPlainText(html).split(/\n+/).map(line => line.trim()).filter(Boolean).map(line => docxParagraph(line))
}

function htmlTableToDocx(html: string) {
  const rows: string[] = []
  for (const rowMatch of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map(cellMatch => htmlToPlainText(cellMatch[1]))
    if (!cells.length) continue
    rows.push(`<w:tr>${cells.map(cell => `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>${docxParagraph(cell)}</w:tc>`).join('')}</w:tr>`)
  }
  if (!rows.length) return docxParagraph(htmlToPlainText(html))
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="d9e2ec"/><w:left w:val="single" w:sz="4" w:space="0" w:color="d9e2ec"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="d9e2ec"/><w:right w:val="single" w:sz="4" w:space="0" w:color="d9e2ec"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="d9e2ec"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="d9e2ec"/></w:tblBorders></w:tblPr>${rows.join('')}</w:tbl>`
}

function docxParagraph(text: string, tag = 'p') {
  const style = tag === 'h1' ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' : tag === 'h2' || tag === 'h3' ? '<w:pPr><w:pStyle w:val="Heading2"/></w:pPr>' : ''
  const runs = text.split(/\n/).map(line => `<w:r><w:t xml:space="preserve">${xmlEscape(line)}</w:t></w:r>`).join('<w:r><w:br/></w:r>')
  return `<w:p>${style}${runs || '<w:r><w:t></w:t></w:r>'}</w:p>`
}

function htmlToPlainText(html: string) {
  return decodeHtmlEntities(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim()
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
}

function xmlEscape(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

type ReportDownloadVariant = 'with-letterhead' | 'without-letterhead'

function reportVariantFromQuery(value: unknown): ReportDownloadVariant {
  return value === 'without-letterhead' || value === 'withoutLetterhead' ? 'without-letterhead' : 'with-letterhead'
}

function signedReportKey(format: 'pdf' | 'docx', variant: ReportDownloadVariant) {
  if (variant === 'without-letterhead') return format === 'pdf' ? 'withoutLetterheadPdf' : 'withoutLetterheadDocx'
  return format
}

function getReportFilePath(report: { editedReportJson: unknown; aiReportJson: unknown }, format: 'pdf' | 'docx' = 'pdf', variant: ReportDownloadVariant = 'with-letterhead') {
  const editedSigned = getSignedReportFilePath(report.editedReportJson, format, variant)
  if (editedSigned) return editedSigned
  const initialSigned = getSignedReportFilePath(report.aiReportJson, format, variant)
  if (initialSigned) return initialSigned
  if (variant === 'without-letterhead') return ''
  const edited = report.editedReportJson && typeof report.editedReportJson === 'object' && !Array.isArray(report.editedReportJson)
    ? (report.editedReportJson as Record<string, unknown>).reportFilePath
    : null
  const editedPath = resolveOwnedReportFile(edited, format)
  if (editedPath) return editedPath
  const initial = report.aiReportJson && typeof report.aiReportJson === 'object' && !Array.isArray(report.aiReportJson)
    ? (report.aiReportJson as Record<string, unknown>).reportFilePath
    : null
  return resolveOwnedReportFile(initial, format)
}

async function getExactSignedReportFilePath(
  report: { id: string; editedReportJson: unknown; aiReportJson: unknown },
  format: 'pdf' | 'docx' = 'pdf',
  variant: ReportDownloadVariant = 'with-letterhead',
) {
  const fromReportJson = getReportFilePath(report, format, variant)
  if (fromReportJson && !shouldSkipSignedReportCandidate(fromReportJson, format)) return fromReportJson

  const versions = await prisma.reportVersion.findMany({
    where: { reportReviewId: report.id, source: 'RENEWIST' },
    orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
    take: 10,
  })
  for (const version of versions) {
    const fromMetadata = getSignedReportFilePath(version.metadata, format, variant)
    if (fromMetadata && !shouldSkipSignedReportCandidate(fromMetadata, format)) return fromMetadata
    const fromFilePath = variant === 'with-letterhead' ? resolveOwnedReportFile(version.filePath, format) : ''
    if (fromFilePath && !shouldSkipSignedReportCandidate(fromFilePath, format)) return fromFilePath
  }

  const submissions = await prisma.providerReportSubmission.findMany({
    where: { reportReviewId: report.id },
    orderBy: [{ reportVersion: 'desc' }, { receivedAt: 'desc' }],
    take: 10,
  })
  for (const submission of submissions) {
    const fromMetadata = getSignedReportFilePath(submission.metadata, format, variant)
    if (fromMetadata && !shouldSkipSignedReportCandidate(fromMetadata, format)) return fromMetadata
    const fromFilePath = variant === 'with-letterhead' ? resolveOwnedReportFile(submission.reportFilePath, format) : ''
    if (fromFilePath && !shouldSkipSignedReportCandidate(fromFilePath, format)) return fromFilePath
  }

  if (format === 'pdf') {
    const docxPath = await getExactSignedReportFilePath(report, 'docx', variant)
    if (docxPath) {
      const converted = await convertRenewistDocxReportToPdf({
        path: docxPath,
        fileName: path.basename(docxPath),
        checksum: '',
      }).catch((error) => {
        console.warn(`Unable to convert Renewist DOCX report ${report.id} to PDF:`, error instanceof Error ? error.message : error)
        return null
      })
      if (converted?.path) {
        await persistConvertedRenewistPdf(report, converted, variant)
        return converted.path
      }
    }
  }

  return ''
}

type StoredReportReference = { bucket: string; key: string; url?: string; name?: string; format?: string }

async function getExactSignedReportStorage(
  report: { id: string; editedReportJson: unknown; aiReportJson: unknown },
  format: 'pdf' | 'docx' = 'pdf',
  variant: ReportDownloadVariant = 'with-letterhead',
): Promise<StoredReportReference | null> {
  const direct = getSignedReportStorage(report.editedReportJson, format, variant) ?? getSignedReportStorage(report.aiReportJson, format, variant)
  if (direct) return direct

  const versions = await prisma.reportVersion.findMany({
    where: { reportReviewId: report.id, source: 'RENEWIST' },
    orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
    take: 10,
  })
  for (const version of versions) {
    const stored = getSignedReportStorage(version.metadata, format, variant)
    if (stored) return stored
  }

  const submissions = await prisma.providerReportSubmission.findMany({
    where: { reportReviewId: report.id },
    orderBy: [{ reportVersion: 'desc' }, { receivedAt: 'desc' }],
    take: 10,
  })
  for (const submission of submissions) {
    const stored = getSignedReportStorage(submission.metadata, format, variant)
    if (stored) return stored
  }
  return null
}

function shouldSkipSignedReportCandidate(filePath: string, format: 'pdf' | 'docx') {
  return format === 'pdf' && isGeneratedRenewistFallbackPdf(filePath)
}

async function hasRenewistReportSource(reportId: string) {
  const [report, version, submission] = await Promise.all([
    prisma.reportReview.findUnique({ where: { id: reportId }, select: { editedReportJson: true, aiReportJson: true } }),
    prisma.reportVersion.findFirst({ where: { reportReviewId: reportId, source: 'RENEWIST' }, select: { id: true } }),
    prisma.providerReportSubmission.findFirst({ where: { reportReviewId: reportId }, select: { id: true } }),
  ])
  return Boolean(version || submission || hasRenewistMarker(report?.editedReportJson) || hasRenewistMarker(report?.aiReportJson))
}

function hasRenewistMarker(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (record.renewist) return true
  if (typeof record.htmlReport === 'string' && /Renewist Signed Report/i.test(record.htmlReport)) return true
  if (typeof record.reportFilePath === 'string' && record.reportFilePath.toLowerCase().includes('renewist-reports')) return true
  const signedFiles = record.signedReportFiles ?? record.signedFiles
  if (!signedFiles || typeof signedFiles !== 'object' || Array.isArray(signedFiles)) return false
  const entries = Object.values(signedFiles as Record<string, unknown>).flatMap((entry) => Array.isArray(entry) ? entry : [entry])
  return entries.some((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
    const pathValue = (entry as Record<string, unknown>).path ?? (entry as Record<string, unknown>).filePath
    return typeof pathValue === 'string' && pathValue.toLowerCase().includes('renewist-reports')
  })
}

async function persistConvertedRenewistPdf(
  report: { id: string; editedReportJson: unknown },
  converted: { path: string; checksum: string; fileName: string; format?: string; field?: string },
  variant: ReportDownloadVariant = 'with-letterhead',
) {
  const storage = await storeObject({
    kind: 'provider-reports',
    keyParts: ['reports', report.id, 'renewist', 'converted', sanitizeFileName(converted.fileName || path.basename(converted.path))],
    body: fsSync.createReadStream(converted.path),
    contentType: 'application/pdf',
    localPath: converted.path,
  }).catch((error) => {
    console.warn(`Unable to upload converted Renewist PDF ${report.id} to S3:`, error instanceof Error ? error.message : error)
    return null
  })
  const edited = report.editedReportJson && typeof report.editedReportJson === 'object' && !Array.isArray(report.editedReportJson)
    ? report.editedReportJson as Record<string, unknown>
    : {}
  const signedReportFiles = edited.signedReportFiles && typeof edited.signedReportFiles === 'object' && !Array.isArray(edited.signedReportFiles)
    ? edited.signedReportFiles as Record<string, unknown>
    : {}
  const convertedEntry = {
    path: converted.path,
    checksum: converted.checksum,
    name: converted.fileName,
    format: converted.format ?? 'pdf',
    field: converted.field ?? (variant === 'without-letterhead' ? 'converted_without_letterhead_docx' : 'converted_from_docx'),
    storage,
  }
  const existingAll = Array.isArray(signedReportFiles.all) ? signedReportFiles.all as unknown[] : []
  const nextAll = [
    ...existingAll.filter((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return true
      const entryRecord = entry as Record<string, unknown>
      const entryPath = entryRecord.path ?? entryRecord.filePath
      const entryFormat = String(entryRecord.format ?? '').toLowerCase()
      return entryPath !== converted.path && !(entryFormat === 'pdf' && typeof entryPath === 'string' && isGeneratedRenewistFallbackPdf(entryPath))
    }),
    convertedEntry,
  ]
  await prisma.reportReview.update({
    where: { id: report.id },
    data: {
      editedReportJson: toPrismaJsonObject({
        ...edited,
        signedReportFiles: {
          ...signedReportFiles,
          [signedReportKey('pdf', variant)]: convertedEntry,
          all: nextAll,
        },
      }),
    },
  })
}

function resolveOwnedReportPdf(candidate: unknown) {
  return resolveOwnedReportFile(candidate, 'pdf')
}

function getSignedReportFilePath(value: unknown, format: 'pdf' | 'docx', variant: ReportDownloadVariant = 'with-letterhead') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const container = value as Record<string, unknown>
  const signedFiles = container.signedReportFiles ?? container.signedFiles
  if (!signedFiles || typeof signedFiles !== 'object' || Array.isArray(signedFiles)) return ''
  const entry = getSignedReportEntry(signedFiles as Record<string, unknown>, format, variant)
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return ''
  const entryPath = (entry as Record<string, unknown>).path
    ?? (entry as Record<string, unknown>).filePath
  return resolveOwnedReportFile(entryPath, format)
}

function getSignedReportStorage(value: unknown, format: 'pdf' | 'docx', variant: ReportDownloadVariant = 'with-letterhead'): StoredReportReference | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const container = value as Record<string, unknown>
  const signedFiles = container.signedReportFiles ?? container.signedFiles
  if (!signedFiles || typeof signedFiles !== 'object' || Array.isArray(signedFiles)) return null
  const entry = getSignedReportEntry(signedFiles as Record<string, unknown>, format, variant)
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
  const record = entry as Record<string, unknown>
  const storage = record.storage
  if (!storage || typeof storage !== 'object' || Array.isArray(storage)) return null
  const storageRecord = storage as Record<string, unknown>
  const bucket = storageRecord.bucket
  const key = storageRecord.key
  if (typeof bucket !== 'string' || typeof key !== 'string' || !bucket || !key) return null
  return {
    bucket,
    key,
    url: typeof storageRecord.url === 'string' ? storageRecord.url : undefined,
    name: typeof record.name === 'string' ? record.name : typeof record.fileName === 'string' ? record.fileName : undefined,
    format: typeof record.format === 'string' ? record.format : undefined,
  }
}

function getSignedReportEntry(signedFiles: Record<string, unknown>, format: 'pdf' | 'docx', variant: ReportDownloadVariant) {
  const direct = signedFiles[signedReportKey(format, variant)]
  if (direct) return direct
  const entries = Array.isArray(signedFiles.all) ? signedFiles.all : []
  return entries.find((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
    const record = entry as Record<string, unknown>
    const entryFormat = String(record.format ?? '').toLowerCase()
    if (entryFormat !== format) return false
    const field = String(record.field ?? '').toLowerCase()
    if (variant === 'without-letterhead') {
      return field === 'report_wlh' || field.includes('without_letterhead') || field.includes('without-letterhead')
    }
    return field === 'report' || field === 'report_file' || !field
  })
}

function getOriginalStudyStorage(value: unknown): StoredReportReference | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const storageContainer = record.storage && typeof record.storage === 'object' && !Array.isArray(record.storage)
    ? record.storage as Record<string, unknown>
    : record
  const originalStudy = storageContainer.originalStudy
  if (!originalStudy || typeof originalStudy !== 'object' || Array.isArray(originalStudy)) return null
  const storage = originalStudy as Record<string, unknown>
  const bucket = storage.bucket
  const key = storage.key
  if (typeof bucket !== 'string' || typeof key !== 'string' || !bucket || !key) return null
  return {
    bucket,
    key,
    url: typeof storage.url === 'string' ? storage.url : undefined,
    name: typeof storage.name === 'string' ? storage.name : undefined,
  }
}

function resolveOwnedReportFile(candidate: unknown, format: 'pdf' | 'docx') {
  if (typeof candidate !== 'string' || !candidate.toLowerCase().endsWith(`.${format}`)) return ''
  try {
    const realUploadsRoot = fsSync.realpathSync(uploadsPath)
    const realCandidate = fsSync.realpathSync(path.resolve(candidate))
    return isPathInside(realUploadsRoot, realCandidate) && fsSync.statSync(realCandidate).isFile() ? realCandidate : ''
  } catch {
    return ''
  }
}

async function deleteLocalUploadFile(candidate: unknown) {
  if (typeof candidate !== 'string' || !candidate.trim()) return
  try {
    const realUploadsRoot = fsSync.realpathSync(uploadsPath)
    const realCandidate = fsSync.realpathSync(path.resolve(candidate))
    if (!isPathInside(realUploadsRoot, realCandidate) || !fsSync.statSync(realCandidate).isFile()) return
    await fs.rm(realCandidate, { force: true })
  } catch (error) {
    console.warn(`Unable to remove local upload file ${candidate}:`, error instanceof Error ? error.message : error)
  }
}

function isGeneratedRenewistFallbackPdf(filePath: string) {
  if (!filePath.toLowerCase().endsWith('.pdf')) return false
  try {
    const buffer = fsSync.readFileSync(filePath, { encoding: null })
    const sample = buffer.subarray(0, Math.min(buffer.length, 1024 * 1024)).toString('latin1')
    const looksLikeOurFallback = /DecXpert AI-Assisted Radiology Report|Renewist Signed Report|SIGNED REPORT/i.test(sample)
    const tinySinglePage = buffer.length < 80 * 1024
    return looksLikeOurFallback && tinySinglePage
  } catch {
    return false
  }
}

function getDicomMetadataValue(value: unknown, key: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const metadata = (value as { dicomMetadata?: unknown }).dicomMetadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const found = (metadata as Record<string, unknown>)[key]
  return typeof found === 'string' && found.trim() ? found.trim() : null
}

function studyStorageKind(serviceType: ServiceType): StorageKind {
  if (serviceType.startsWith('ct')) return 'ct-studies'
  if (serviceType.startsWith('mri') || serviceType === 'mrcp' || serviceType.startsWith('mra')) return 'mri-studies'
  if (serviceType === 'mammography') return 'mammography-studies'
  if (serviceType.includes('xray')) return 'xray-studies'
  return 'original-studies'
}







































function isPathInside(root: string, candidate: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
}

async function getProcessingReportSetting(clientId: string, serviceName: string) {
  const exactSetting = await prisma.reportFormatSetting.findFirst({
    where: { clientId, serviceName },
  })
  if (exactSetting) return exactSetting

  const reviewEnabledSetting = await prisma.reportFormatSetting.findFirst({
    where: { clientId, radiologistReviewEnabled: true },
  })
  if (!reviewEnabledSetting) return null

  return {
    ...reviewEnabledSetting,
    id: `derived-${serviceName}`,
    serviceName,
    reportMode: 'Comprehensive',
    enabledSections: defaultReportSections,
  }
}

function applyReportTemplate<T extends Record<string, unknown>>(html: string, sections: T, setting: { reportMode?: string; enabledSections?: string[] } | null | undefined): { html: string; sections: T } {
  const enabled = new Set(getEnabledReportSections(setting))
  if (!setting || setting.reportMode !== 'Custom') return { html, sections }
  let nextHtml = html
  const nextSections = { ...sections } as T

  for (const [section, keys] of Object.entries(templateSectionKeyMap)) {
    if (enabled.has(section)) continue
    for (const key of keys) delete (nextSections as Record<string, unknown>)[key]
  }
  if (!enabled.has('AI Triage')) nextHtml = removeSectionByDataAttribute(nextHtml, 'AI Triage')
  for (const section of defaultReportSections.filter((item) => item !== 'AI Triage')) {
    if (!enabled.has(section)) nextHtml = removeReportContentSection(nextHtml, section)
  }
  return { html: nextHtml, sections: nextSections }
}

function removeReportContentSection(html: string, label: string) {
  return html.replace(new RegExp(`<h2\\b(?=[^>]*\\bdata-section="${escapeRegExp(label)}")[^>]*>[\\s\\S]*?<\\/h2>\\s*(?:<div class="section-body">[\\s\\S]*?<\\/div>\\s*)?`, 'gi'), '')
}

function removeSectionByDataAttribute(html: string, section: string) {
  return html.replace(new RegExp(`<[^>]+\\bdata-section="${escapeRegExp(section)}"[^>]*>[\\s\\S]*?<\\/[^>]+>\\s*`, 'gi'), '')
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || `file-${Date.now()}`
}

async function isPortListening(portNumber: number) {
  return new Promise<boolean>((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: portNumber })
    socket.setTimeout(700)
    socket.on('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.on('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.on('error', () => resolve(false))
  })
}

async function findStorescp() { return findExecutable('storescp'); }

async function findTool(fileName: string) { return findExecutable(fileName); }



async function ensureFirewallRule(_portNumber: number): Promise<'existing'> { return 'existing'; }



async function nextClientCode() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = crypto.randomBytes(4).toString('base64url').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 5)
    if (code.length !== 5) continue
    const existing = await prisma.client.findUnique({ where: { code } })
    if (!existing) return code
  }
  throw new Error('Unable to generate a unique 5-character client ID')
}

function normalizeHospitalSlug(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return normalized || `client-${crypto.randomBytes(3).toString('hex')}`
}

async function nextReportId(input: { clientCode: string; serviceCode: string; date?: Date; uniqueSegment?: string }) {
  const uniqueSegment = input.uniqueSegment
    ? input.uniqueSegment.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(-6)
    : ''
  let date = input.date ?? new Date()
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const reportId = `${input.clientCode}${input.serviceCode}${formatReportTimestamp(date)}${uniqueSegment}`
    const existing = await prisma.reportReview.findUnique({ where: { id: reportId } })
    if (!existing) return reportId
    date = new Date(date.getTime() + 1000)
  }
  throw new Error('Unable to generate a unique report ID')
}

function formatReportTimestamp(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${String(date.getFullYear()).slice(-2)}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function generatePortalPassword() {
  return `DXP-${crypto.randomBytes(3).toString('hex').toUpperCase()}-${crypto.randomBytes(3).toString('base64url')}`
}

function publicPortalBaseUrl() {
  return (process.env.PORTAL_BASE_URL || process.env.TELERADIOLOGY_CALLBACK_BASE_URL || `http://${host}:${port}`).replace(/\/+$/g, '')
}











function positiveIntegerEnv(name: string, fallback: number) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

function humanBytes(bytes: number) {
  const units = ['bytes', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`
}

const bridgeMaxStudyBytes = positiveIntegerEnv('BRIDGE_MAX_STUDY_BYTES', 4 * 1024 * 1024 * 1024)
const bridgeReceivingSchema = z.object({
  center_code: z.string().min(1).optional(),
  client_code: z.string().min(1).optional(),
  client_id: z.string().min(1).optional(),
  agent_id: z.string().optional(),
  agent_name: z.string().optional(),
  local_ip: z.string().optional(),
  local_port: z.coerce.number().int().positive().optional(),
  local_ae_title: z.string().optional(),
  metadata: z.unknown().optional(),
  study_instance_uid: z.string().min(1).optional(),
  patient_id: z.string().optional().nullable(),
  patient_name: z.string().optional().nullable(),
  patient_sex: z.string().optional().nullable(),
  patient_age: z.string().optional().nullable(),
  accession_number: z.string().optional().nullable(),
  study_date: z.string().optional().nullable(),
  study_time: z.string().optional().nullable(),
  study_description: z.string().optional().nullable(),
      body_part_examined: z.string().optional().nullable(),
      bodyPartExamined: z.string().optional().nullable(),
  modalities: z.union([z.array(z.string()), z.string()]).optional(),
  institution_name: z.string().optional().nullable(),
  referring_physician: z.string().optional().nullable(),
  series_count: z.coerce.number().int().min(0).optional(),
  instance_count: z.coerce.number().int().min(0).optional(),
  total_size_bytes: z.coerce.number().int().min(0).optional(),
  study_fingerprint: z.string().optional().nullable(),
})

type DirectBridgeStudyMetadata = {
  study_instance_uid: string
  patient_id?: string | null
  patient_name?: string | null
  patient_sex?: string | null
  patient_age?: string | null
  accession_number?: string | null
  study_date?: string | null
  study_time?: string | null
  study_description?: string | null
  body_part_examined?: string | null
  bodyPartExamined?: string | null
  modalities?: string[]
  institution_name?: string | null
  referring_physician?: string | null
  series_count?: number
  instance_count?: number
  total_size_bytes?: number
  study_fingerprint?: string | null
}

function parseMaybeJsonObject(value: unknown) {
  if (!value) return {}
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function stringValue(value: unknown) {
  if (value === null || value === undefined) return undefined
  const text = String(value).trim()
  return text || undefined
}

function bridgeCenterCode(input: Record<string, unknown>, req?: Request) {
  return stringValue(input.center_code)
    ?? stringValue(input.client_code)
    ?? stringValue(input.client_id)
    ?? stringValue(req?.query.center_code)
    ?? stringValue(req?.query.client_code)
    ?? stringValue(req?.query.client_id)
}

function findBridgeClient(centerCode: string) {
  return prisma.client.findFirst({
    where: { code: centerCode, kind: 'CENTER', status: 'ACTIVE', studySyncEnabled: true },
  })
}

function numberValue(value: unknown) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : undefined
}

function normalizeModalities(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim().toUpperCase()).filter(Boolean)
  const text = stringValue(value)
  if (!text) return []
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) return parsed.map((item) => String(item).trim().toUpperCase()).filter(Boolean)
  } catch {
    // Fall through to comma/pipe parsing.
  }
  return text.split(/[,|]/).map((item) => item.trim().toUpperCase()).filter(Boolean)
}

function normalizeDirectBridgeStudyMetadata(input: Record<string, unknown>, options: { requireStudyInstanceUid?: boolean } = {}): DirectBridgeStudyMetadata {
  const metadata = parseMaybeJsonObject(input.metadata)
  const field = (key: string) => metadata[key] ?? input[key]
  const studyInstanceUid = stringValue(field('study_instance_uid')) ?? stringValue(field('studyInstanceUid'))
  if (!studyInstanceUid && options.requireStudyInstanceUid !== false) throw new Error('study_instance_uid is required')
  return {
    study_instance_uid: studyInstanceUid ?? '',
    patient_id: stringValue(field('patient_id')) ?? stringValue(field('patientId')) ?? null,
    patient_name: stringValue(field('patient_name')) ?? stringValue(field('patientName')) ?? null,
    patient_sex: stringValue(field('patient_sex')) ?? stringValue(field('patientSex')) ?? null,
    patient_age: stringValue(field('patient_age')) ?? stringValue(field('patientAge')) ?? null,
    accession_number: stringValue(field('accession_number')) ?? stringValue(field('accessionNumber')) ?? null,
    study_date: stringValue(field('study_date')) ?? stringValue(field('studyDate')) ?? null,
    study_time: stringValue(field('study_time')) ?? stringValue(field('studyTime')) ?? null,
    study_description: stringValue(field('study_description')) ?? stringValue(field('studyDescription')) ?? null,
    modalities: classifyBreastXrayModalities(normalizeModalities(field('modalities') ?? field('modality')), stringValue(field('body_part_examined')) ?? stringValue(field('bodyPartExamined'))),
    institution_name: stringValue(field('institution_name')) ?? stringValue(field('institutionName')) ?? null,
    referring_physician: stringValue(field('referring_physician')) ?? stringValue(field('referringPhysician')) ?? null,
    series_count: numberValue(field('series_count') ?? field('seriesCount')) ?? 0,
    instance_count: numberValue(field('instance_count') ?? field('instanceCount')) ?? 0,
    total_size_bytes: numberValue(field('total_size_bytes') ?? field('totalSizeBytes')) ?? 0,
    study_fingerprint: stringValue(field('study_fingerprint')) ?? stringValue(field('studyFingerprint')) ?? null,
  }
}

function directBridgeStudyData(metadata: DirectBridgeStudyMetadata, source: {
  agentName?: string | null
  agent_name?: string | null
  localIp?: string | null
  local_ip?: string | null
  localPort?: number | null
  local_port?: number | null
  localAeTitle?: string | null
  local_ae_title?: string | null
}, availabilityStatus: string, workflowStatus: string) {
  return {
    agentName: source.agentName ?? source.agent_name ?? null,
    patientId: metadata.patient_id ?? null,
    patientName: metadata.patient_name ?? null,
    patientSex: metadata.patient_sex ?? null,
    patientAge: metadata.patient_age ?? null,
    accessionNumber: metadata.accession_number ?? null,
    studyDate: metadata.study_date ?? null,
    studyTime: metadata.study_time ?? null,
    studyDescription: metadata.study_description ?? null,
    modalities: metadata.modalities ?? [],
    institutionName: metadata.institution_name ?? null,
    referringPhysician: metadata.referring_physician ?? null,
    seriesCount: metadata.series_count ?? 0,
    instanceCount: metadata.instance_count ?? 0,
    totalSizeBytes: BigInt(metadata.total_size_bytes ?? 0),
    studyFingerprint: metadata.study_fingerprint ?? null,
    localIp: source.localIp ?? source.local_ip ?? null,
    localPort: source.localPort ?? source.local_port ?? null,
    localAeTitle: source.localAeTitle ?? source.local_ae_title ?? null,
    availabilityStatus,
    workflowStatus,
    firstDetectedAt: new Date(),
    lastSyncedAt: new Date(),
  }
}

function safeBridgeFileName(fileName: string) {
  const base = path.basename(fileName || 'upload.bin').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
  return base || `upload-${crypto.randomUUID()}.bin`
}

type ManualReportPdfFile = {
  path: string
  fileName: string
  checksum: string
  sizeBytes: number
  field: 'report' | 'report_wlh'
}

type ManualReportPdfUpload = {
  withLetterhead: ManualReportPdfFile
  withoutLetterhead?: ManualReportPdfFile
  reason?: string
}

function safeReportPdfFileName(fileName: string, fallback: string) {
  const base = path.basename(fileName || fallback).replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
  const normalized = base || fallback
  return normalized.toLowerCase().endsWith('.pdf') ? normalized : `${normalized}.pdf`
}

async function saveManualReportPdfUpload(req: Request, reportId: string): Promise<ManualReportPdfUpload> {
  const folder = path.join(uploadsPath, 'manual-report-pdfs', sanitizeFileName(reportId), crypto.randomUUID())
  await fs.mkdir(folder, { recursive: true })
  return new Promise((resolve, reject) => {
    const writes: Promise<void>[] = []
    const files: Partial<Record<'report' | 'report_wlh', ManualReportPdfFile>> = {}
    let reason = ''
    let failed = false
    const busboy = Busboy({ headers: req.headers, limits: { files: 2, fileSize: 50 * 1024 * 1024, fields: 5 } })
    const fail = (error: Error) => {
      if (failed) return
      failed = true
      req.unpipe(busboy)
      void fs.rm(folder, { recursive: true, force: true })
      reject(error)
    }
    busboy.on('field', (name, value) => {
      if (name === 'reason') reason = value.trim().slice(0, 1000)
    })
    busboy.on('file', (field, file, info) => {
      if (field !== 'report' && field !== 'report_wlh') {
        file.resume()
        return
      }
      if (!info.filename) {
        file.resume()
        return
      }
      if (files[field]) {
        file.resume()
        fail(new Error(`Upload only one ${field} file`))
        return
      }
      const fileName = safeReportPdfFileName(info.filename, field === 'report' ? 'report.pdf' : 'report-without-letterhead.pdf')
      if (!fileName.toLowerCase().endsWith('.pdf')) {
        file.resume()
        fail(new Error('Manual report uploads must be PDF files'))
        return
      }
      const hash = crypto.createHash('sha256')
      let sizeBytes = 0
      const filePath = path.join(folder, `${field}-${fileName}`)
      const output = fsSync.createWriteStream(filePath)
      file.on('data', (chunk: Buffer) => {
        sizeBytes += chunk.length
        hash.update(chunk)
      })
      file.on('limit', () => fail(new Error('Report PDF must be 50 MB or smaller')))
      file.on('error', fail)
      output.on('error', fail)
      file.pipe(output)
      writes.push(new Promise((resolveWrite, rejectWrite) => {
        output.on('finish', () => {
          files[field] = { path: filePath, fileName, checksum: hash.digest('hex'), sizeBytes, field }
          resolveWrite()
        })
        output.on('error', rejectWrite)
      }))
    })
    busboy.on('filesLimit', () => fail(new Error('Upload at most two PDFs: report and optional report_wlh')))
    busboy.on('error', fail)
    busboy.on('finish', async () => {
      try {
        await Promise.all(writes)
        if (failed) return
        if (!files.report || files.report.sizeBytes <= 0) throw new Error('Upload the report PDF with letterhead in field "report"')
        if (files.report_wlh && files.report_wlh.sizeBytes <= 0) throw new Error('The without-letterhead PDF is empty')
        resolve({ withLetterhead: files.report, withoutLetterhead: files.report_wlh, reason })
      } catch (error) {
        fail(error instanceof Error ? error : new Error('Unable to save manual report PDFs'))
      }
    })
    req.pipe(busboy)
  })
}

async function buildManualSignedReportFiles(reportId: string, upload: ManualReportPdfUpload) {
  const withLetterhead = await manualSignedReportEntry(reportId, upload.withLetterhead, 'pdf')
  const withoutLetterhead = upload.withoutLetterhead
    ? await manualSignedReportEntry(reportId, upload.withoutLetterhead, 'withoutLetterheadPdf')
    : null
  const all = [withLetterhead, withoutLetterhead].filter(Boolean)
  return {
    pdf: withLetterhead,
    ...(withoutLetterhead ? { withoutLetterheadPdf: withoutLetterhead } : {}),
    all,
  }
}

async function manualSignedReportEntry(reportId: string, file: ManualReportPdfFile, variant: 'pdf' | 'withoutLetterheadPdf') {
  const storage = await storeObject({
    kind: 'provider-reports',
    keyParts: ['reports', reportId, 'manual', variant, sanitizeFileName(file.fileName)],
    body: fsSync.createReadStream(file.path),
    contentType: 'application/pdf',
    localPath: file.path,
  }).catch((error) => {
    console.warn(`Unable to upload manual report PDF ${reportId} to S3:`, error instanceof Error ? error.message : error)
    return null
  })
  return {
    path: file.path,
    filePath: file.path,
    name: file.fileName,
    fileName: file.fileName,
    format: 'pdf',
    field: file.field,
    checksum: file.checksum,
    sizeBytes: file.sizeBytes,
    variant,
    source: 'MANUAL_SUPER_ADMIN',
    storage,
  }
}

function manualSignedReportHtml(report: { id: string; patientName: string | null; patientId: string | null; accession: string | null; modality: string | null; serviceName: string; generatedAt: Date }) {
  return `<section><h1>Signed Report Uploaded</h1><p>The final signed PDF report was manually uploaded by Superadmin.</p><table><tr><th>Report ID</th><td>${escapeHtml(report.id)}</td></tr><tr><th>Patient</th><td>${escapeHtml(report.patientName ?? '-')}</td></tr><tr><th>Patient ID</th><td>${escapeHtml(report.patientId ?? '-')}</td></tr><tr><th>Accession</th><td>${escapeHtml(report.accession ?? '-')}</td></tr><tr><th>Modality</th><td>${escapeHtml(report.modality ?? '-')}</td></tr><tr><th>Service</th><td>${escapeHtml(report.serviceName)}</td></tr></table></section>`
}

async function saveManualAvailableStudyUpload(req: Request) {
  const folder = path.join(uploadsPath, 'manual-available-studies', crypto.randomUUID())
  await fs.mkdir(folder, { recursive: true })
  return new Promise<{ filePath: string; uploadName: string; sizeBytes: number }>((resolve, reject) => {
    let uploadName = ''
    let filePath = ''
    let sizeBytes = 0
    let failed = false
    let writeComplete: Promise<void> | null = null
    const busboy = Busboy({ headers: req.headers, limits: { files: 1, fileSize: bridgeMaxStudyBytes, fields: 5 } })
    const fail = (error: Error) => {
      if (failed) return
      failed = true
      req.unpipe(busboy)
      void fs.rm(folder, { recursive: true, force: true })
      reject(error)
    }
    busboy.on('file', (_name, file, info) => {
      if (filePath) {
        file.resume()
        return
      }
      uploadName = safeBridgeFileName(info.filename || 'study.zip')
      filePath = path.join(folder, uploadName)
      const output = fsSync.createWriteStream(filePath)
      file.on('data', (chunk: Buffer) => { sizeBytes += chunk.length })
      file.on('limit', () => fail(new Error(`Study file exceeds the ${humanBytes(bridgeMaxStudyBytes)} upload limit`)))
      file.on('error', fail)
      output.on('error', fail)
      file.pipe(output)
      writeComplete = new Promise((resolveWrite, rejectWrite) => {
        output.on('finish', resolveWrite)
        output.on('error', rejectWrite)
      })
    })
    busboy.on('filesLimit', () => fail(new Error('Upload one study file at a time')))
    busboy.on('error', fail)
    busboy.on('finish', async () => {
      try {
        if (writeComplete) await writeComplete
        if (failed) return
        if (!filePath || sizeBytes === 0) throw new Error('Select a non-empty study file')
        resolve({ filePath, uploadName, sizeBytes })
      } catch (error) {
        fail(error instanceof Error ? error : new Error('Unable to save study file'))
      }
    })
    req.pipe(busboy)
  })
}

async function saveDirectBridgeStudyUpload(req: Request) {
  const folder = path.join(uploadsPath, 'bridge-studies', crypto.randomUUID())
  await fs.mkdir(folder, { recursive: true })
  return new Promise<{
    clientCode: string
    agentId?: string
    agentName?: string
    localIp?: string
    localPort?: number
    localAeTitle?: string
    metadata: DirectBridgeStudyMetadata
    filePath: string
    uploadName: string
    folder: string
    sizeBytes: number
  }>((resolve, reject) => {
    const fields: Record<string, string> = {}
    const writes: Promise<void>[] = []
    let uploadName = ''
    let filePath = ''
    let sizeBytes = 0
    let failed = false
    const busboy = Busboy({ headers: req.headers, limits: { files: 1, fileSize: bridgeMaxStudyBytes, fields: 80 } })
    const fail = (error: Error) => {
      if (failed) return
      failed = true
      req.unpipe(busboy)
      void fs.rm(folder, { recursive: true, force: true })
      reject(error)
    }
    busboy.on('field', (name, value) => { fields[name] = value })
    busboy.on('file', (_name, file, info) => {
      uploadName = safeBridgeFileName(info.filename || 'study.zip')
      filePath = path.join(folder, uploadName)
      const output = fsSync.createWriteStream(filePath)
      file.on('data', (chunk: Buffer) => { sizeBytes += chunk.length })
      file.on('limit', () => fail(new Error(`Study ZIP exceeds the ${humanBytes(bridgeMaxStudyBytes)} upload limit`)))
      file.on('error', fail)
      output.on('error', fail)
      file.pipe(output)
      writes.push(new Promise((resolveWrite, rejectWrite) => {
        output.on('finish', () => resolveWrite())
        output.on('error', rejectWrite)
      }))
    })
    busboy.on('error', fail)
    busboy.on('finish', async () => {
      try {
        await Promise.all(writes)
        if (failed) return
        if (!filePath) throw new Error('file is required')
        const clientCode = bridgeCenterCode(fields)
        if (!clientCode) throw new Error('center_code is required')
        const submittedMetadata = normalizeDirectBridgeStudyMetadata(fields, { requireStudyInstanceUid: false })
        const fileMetadata = await extractDicomStudyMetadata(filePath).catch(() => ({}))
        const metadata = mergeDirectBridgeDicomMetadata(submittedMetadata, fileMetadata)
        if (!metadata.study_instance_uid) throw new Error('study_instance_uid is required in Bridge fields or DICOM metadata')
        resolve({
          clientCode,
          agentId: stringValue(fields.agent_id),
          agentName: stringValue(fields.agent_name),
          localIp: stringValue(fields.local_ip),
          localPort: numberValue(fields.local_port),
          localAeTitle: stringValue(fields.local_ae_title),
          metadata,
          filePath,
          uploadName,
          folder,
          sizeBytes,
        })
      } catch (error) {
        fail(error instanceof Error ? error : new Error('Unable to save bridge study upload'))
      }
    })
    req.pipe(busboy)
  })
}

async function saveBridgeStudySubmission(req: Request, clientId: string, bridgeStudyId: string) {
  const folder = path.join(uploadsPath, 'bridge-studies', bridgeStudyId, 'attachments')
  await fs.mkdir(folder, { recursive: true })
  return new Promise<{ clinicalIndication: string; noClinicalIndication: boolean; serviceType?: string; priority: 'REGULAR' | 'URGENT'; attachments: Array<{ clientId: string; bridgeStudyId: string; originalName: string; storedName: string; filePath: string; mimeType?: string; sizeBytes: bigint; uploadedBy?: string }> }>((resolve, reject) => {
    const fields: Record<string, string> = {}
    const attachments: Array<{ clientId: string; bridgeStudyId: string; originalName: string; storedName: string; filePath: string; mimeType?: string; sizeBytes: bigint; uploadedBy?: string }> = []
    const writes: Promise<void>[] = []
    let failed = false
    const busboy = Busboy({ headers: req.headers, limits: { files: 5, fileSize: 512 * 1024 * 1024, fields: 10 } })
    const fail = (error: Error) => {
      if (failed) return
      failed = true
      req.unpipe(busboy)
      reject(error)
    }
    busboy.on('field', (name, value) => { fields[name] = value })
    busboy.on('filesLimit', () => fail(new Error('Upload a maximum of 5 supporting files')))
    busboy.on('file', (_name, file, info) => {
      if (!info.filename) {
        file.resume()
        return
      }
      const originalName = safeBridgeFileName(info.filename)
      const storedName = `${crypto.randomUUID()}-${originalName}`
      const filePath = path.join(folder, storedName)
      const output = fsSync.createWriteStream(filePath)
      let sizeBytes = 0
      file.on('data', (chunk: Buffer) => { sizeBytes += chunk.length })
      file.on('limit', () => fail(new Error(`${originalName} exceeds the 512 MB supporting file limit`)))
      file.on('error', fail)
      output.on('error', fail)
      file.pipe(output)
      writes.push(new Promise((resolveWrite, rejectWrite) => {
        output.on('finish', () => {
          attachments.push({ clientId, bridgeStudyId, originalName, storedName, filePath, mimeType: info.mimeType, sizeBytes: BigInt(sizeBytes), uploadedBy: req.user?.sub })
          resolveWrite()
        })
        output.on('error', rejectWrite)
      }))
    })
    busboy.on('error', fail)
    busboy.on('finish', async () => {
      try {
        await Promise.all(writes)
        if (failed) return
        const requestedArchiveFileIds = (() => {
          try {
            const parsed = JSON.parse(fields.patient_archive_file_ids ?? '[]')
            return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string').slice(0, 5) : []
          } catch {
            return []
          }
        })()
        const requestedReportIds = (() => {
          try {
            const parsed = JSON.parse(fields.patient_report_ids ?? '[]')
            return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string').slice(0, 5) : []
          } catch {
            return []
          }
        })()
        if (requestedArchiveFileIds.length + requestedReportIds.length + attachments.length > 5) throw new Error('Select a maximum of 5 supporting documents in total')
        if (requestedArchiveFileIds.length) {
          const profileFiles = await prisma.patientStudyArchiveFile.findMany({
            where: { id: { in: requestedArchiveFileIds }, role: { not: 'STUDY' }, archive: { clientId } },
          })
          if (profileFiles.length !== new Set(requestedArchiveFileIds).size) throw new Error('One or more selected patient documents are unavailable')
          if (attachments.length + profileFiles.length > 5) throw new Error('Select a maximum of 5 supporting documents in total')
          for (const profileFile of profileFiles) {
            if (!isPathInside(uploadsPath, profileFile.filePath) || !fsSync.existsSync(profileFile.filePath)) throw new Error(`${profileFile.originalName} is unavailable`)
            const originalName = safeBridgeFileName(profileFile.originalName)
            const storedName = `${crypto.randomUUID()}-${originalName}`
            const filePath = path.join(folder, storedName)
            await fs.copyFile(profileFile.filePath, filePath)
            attachments.push({ clientId, bridgeStudyId, originalName, storedName, filePath, mimeType: profileFile.mimeType ?? undefined, sizeBytes: profileFile.sizeBytes, uploadedBy: req.user?.sub })
          }
        }
        if (requestedReportIds.length) {
          const patientProfileId = stringValue(fields.patient_profile_id)
          if (!patientProfileId) throw new Error('Patient profile is required to attach previous reports')
          const previousReports = await prisma.reportReview.findMany({
            where: { id: { in: requestedReportIds }, clientId, patientProfileId, status: { in: ['APPROVED', 'PUSHED'] } },
          })
          if (previousReports.length !== new Set(requestedReportIds).size) throw new Error('One or more selected previous reports are unavailable')
          for (const report of previousReports) {
            const originalName = safeBridgeFileName(`${report.id}-previous-report.pdf`)
            const storedName = `${crypto.randomUUID()}-${originalName}`
            const filePath = path.join(folder, storedName)
            const existingPdf = await getExactSignedReportFilePath(report, 'pdf')
            if (existingPdf && isPathInside(uploadsPath, existingPdf) && fsSync.existsSync(existingPdf)) {
              await fs.copyFile(existingPdf, filePath)
            } else {
              if (await hasRenewistReportSource(report.id)) throw new Error(`Previous report ${report.id} is missing the exact Renewist signed PDF`)
              const html = getReportHtml(report)
              if (!html) throw new Error(`Previous report ${report.id} has no viewable document`)
              await renderHtmlReportPdf({ html, outputPath: filePath, workDir: folder })
            }
            const fileInfo = await fs.stat(filePath)
            attachments.push({ clientId, bridgeStudyId, originalName, storedName, filePath, mimeType: 'application/pdf', sizeBytes: BigInt(fileInfo.size), uploadedBy: req.user?.sub })
          }
        }
        const requestedPriority = String(fields.priority ?? '').trim().toUpperCase()
        resolve({
          clinicalIndication: stringValue(fields.clinical_indication ?? fields.clinicalIndication) ?? '',
          noClinicalIndication: ['1', 'true', 'yes', 'on'].includes(String(fields.no_clinical_indication ?? fields.noClinicalIndication ?? '').trim().toLowerCase()),
          serviceType: stringValue(fields.service_type ?? fields.serviceType),
          priority: requestedPriority === 'URGENT' ? 'URGENT' : 'REGULAR',
          attachments,
        })
      } catch (error) {
        fail(error instanceof Error ? error : new Error('Unable to save supporting files'))
      }
    })
    req.pipe(busboy)
  })
}

function bridgeStudyDicomMetadata(study: { studyInstanceUid: string; patientId?: string | null; patientName?: string | null; patientSex?: string | null; patientAge?: string | null; accessionNumber?: string | null; studyDate?: string | null; studyTime?: string | null; studyDescription?: string | null; modalities: string[] }) {
  return {
    studyInstanceUid: study.studyInstanceUid,
    patientId: study.patientId ?? undefined,
    patientName: study.patientName ?? undefined,
    patientSex: study.patientSex ?? undefined,
    patientAge: study.patientAge ?? undefined,
    accession: study.accessionNumber ?? undefined,
    studyDate: study.studyDate ?? undefined,
    studyTime: study.studyTime ?? undefined,
    studyDescription: study.studyDescription ?? undefined,
    modality: study.modalities[0] ?? undefined,
  }
}

function mergeDicomMetadata(base: DicomMetadata, extracted: DicomStudyMetadata): DicomMetadata {
  return {
    ...base,
    patientName: base.patientName ?? extracted.patientName,
    patientId: base.patientId ?? extracted.patientId,
    accession: base.accession ?? extracted.accession,
    patientSex: base.patientSex ?? extracted.patientSex,
    patientAge: base.patientAge ?? extracted.patientAge,
    patientBirthDate: base.patientBirthDate ?? extracted.patientBirthDate,
    studyInstanceUid: base.studyInstanceUid ?? extracted.studyInstanceUid,
    seriesInstanceUid: base.seriesInstanceUid ?? extracted.seriesInstanceUid,
    sopInstanceUid: base.sopInstanceUid ?? extracted.sopInstanceUid,
    studyDate: base.studyDate ?? extracted.studyDate,
    studyTime: base.studyTime ?? extracted.studyTime,
    modality: base.modality ?? extracted.modality,
    studyDescription: base.studyDescription ?? extracted.studyDescription,
    seriesDescription: base.seriesDescription ?? extracted.seriesDescription,
    protocolName: base.protocolName ?? extracted.protocolName,
    bodyPartExamined: base.bodyPartExamined ?? extracted.bodyPartExamined,
    referringPhysician: base.referringPhysician ?? extracted.referringPhysician,
  }
}

function metadataHasPatientIdentity(metadata: DicomMetadata) {
  return Boolean(
    metadata.patientId
    || metadata.patientName
    || metadata.patientSex
    || metadata.patientAge
    || metadata.studyDate
    || metadata.studyDescription
    || metadata.studyInstanceUid,
  )
}

function mergeDirectBridgeDicomMetadata(base: DirectBridgeStudyMetadata, extracted: DicomStudyMetadata): DirectBridgeStudyMetadata {
  const modality = extracted.modality?.toUpperCase()
  return {
    ...base,
    referring_physician: base.referring_physician ?? extracted.referringPhysician ?? null,
    study_instance_uid: base.study_instance_uid || extracted.studyInstanceUid || '',
    patient_id: base.patient_id ?? extracted.patientId ?? null,
    patient_name: base.patient_name ?? extracted.patientName ?? null,
    patient_sex: base.patient_sex ?? extracted.patientSex ?? null,
    patient_age: base.patient_age ?? extracted.patientAge ?? null,
    accession_number: base.accession_number ?? extracted.accession ?? null,
    study_date: base.study_date ?? extracted.studyDate ?? null,
    study_time: base.study_time ?? extracted.studyTime ?? null,
    study_description: base.study_description ?? extracted.studyDescription ?? extracted.seriesDescription ?? extracted.protocolName ?? null,
    modalities: classifyBreastXrayModalities(base.modalities?.length ? base.modalities : modality ? [modality] : [], extracted.bodyPartExamined),
  }
}

function bridgeStudyWithMetadata<T extends { modalities: string[]; studyDescription?: string | null }>(study: T, metadata: DicomStudyMetadata) {
  const modalities = Array.from(new Set([...study.modalities, metadata.modality].filter((value): value is string => Boolean(value)).map((value) => value.toUpperCase())))
  return {
    ...study,
    modalities: classifyBreastXrayModalities(modalities, metadata.bodyPartExamined),
    studyDescription: study.studyDescription ?? metadata.studyDescription ?? metadata.seriesDescription ?? metadata.protocolName ?? null,
  }
}

async function resolveBridgeStudyService(clientId: string, study: { modalities: string[]; studyDescription?: string | null }, requestedServiceType?: string) {
  await ensureMarengoServices(prisma, clientId)
  const requested = requestedServiceType ? parseServiceType(requestedServiceType) : null
  const services = await prisma.clientService.findMany({
    where: { clientId, status: 'ACTIVE' },
    include: { service: true },
    orderBy: { id: 'asc' },
  })
  const inferredServiceType = inferBridgeServiceType(study)
  const selected = services.find((item) => requested && serviceTypeForServiceName(item.service.name) === requested)
    ?? services.find((item) => inferredServiceType && serviceMatchesBridgeInference(serviceTypeForServiceName(item.service.name), inferredServiceType))
    ?? services.find((item) => inferredServiceType?.startsWith('ct-') && serviceTypeForServiceName(item.service.name) === 'ct')
    ?? services.find((item) => inferredServiceType?.startsWith('mri-') && serviceTypeForServiceName(item.service.name) === 'mri')
  if (!selected) return null
  return { serviceType: serviceTypeForServiceName(selected.service.name), workflowType: selected.workflowType }
}

async function buildStudySyncApiDetails(client: { id: string; code: string; name: string; studySyncEnabled: boolean }) {
  const baseUrl = publicPortalBaseUrl()
  const prefix = `${baseUrl}/api/v1/study-bridge`
  const services = await prisma.clientService.findMany({
    where: { clientId: client.id, status: { not: 'REVOKED' }, pacsConfig: { isNot: null } },
    include: { service: true, pacsConfig: true },
    orderBy: { service: { name: 'asc' } },
  })
  const dicomEndpoints = services.flatMap((item) => item.pacsConfig ? [{
    service: item.service.name,
    workflowType: item.workflowType,
    portalReceive: {
      ip: item.pacsConfig.ec2PublicIp,
      port: item.pacsConfig.receivingPort,
      aeTitle: item.pacsConfig.aeTitle,
      urgentPort: item.pacsConfig.urgentReceivingPort,
      urgentAeTitle: item.pacsConfig.urgentAeTitle,
    },
    reportPushTarget: {
      ip: item.pacsConfig.clientPacsIp,
      port: item.pacsConfig.clientPacsPort,
      aeTitle: item.pacsConfig.clientPacsAeTitle,
      format: item.pacsConfig.returnFormat,
    },
  }] : [])
  const primaryPacsConfig = services.find((item) => item.pacsConfig)?.pacsConfig ?? null
  const directPacs = primaryPacsConfig ? {
    incoming: {
      ip: primaryPacsConfig.ec2PublicIp,
      port: primaryPacsConfig.receivingPort,
      aeTitle: primaryPacsConfig.aeTitle,
    },
    outgoing: {
      ip: primaryPacsConfig.clientPacsIp,
      port: primaryPacsConfig.clientPacsPort,
      aeTitle: primaryPacsConfig.clientPacsAeTitle,
      format: primaryPacsConfig.returnFormat,
    },
    services: services.map((item) => item.service.name),
  } : null
  return {
    enabled: client.studySyncEnabled,
    centerCode: client.code,
    clientId: client.code,
    clientName: client.name,
    authentication: {
      type: 'Bearer token',
      registration: 'Use a Super Admin generated registration code. Agent access tokens are separate from portal login JWTs.',
      headers: ['Authorization: Bearer <agent_access_token>', 'X-Idempotency-Key: <uuid for write/retry-safe requests>'],
    },
    endpoints: {
      parkStudy: { method: 'POST', url: `${prefix}/studies/park`, body: { center_code: client.code, study_instance_uid: '<uid>', patient_id: '<mrn>', patient_name: '<name>', modalities: ['CT'], local_ip: '<bridge-ip>', local_port: 104, local_ae_title: '<ae-title>' }, result: 'Creates/updates Available study in the portal dashboard without starting AI processing.' },
      markReceiving: { method: 'POST', url: `${prefix}/studies/receiving`, body: { center_code: client.code, study_instance_uid: '<uid>', local_ip: '<bridge-ip>', local_port: 104, local_ae_title: '<ae-title>' } },
      uploadStudy: { method: 'POST', url: `${prefix}/studies/upload`, contentType: 'multipart/form-data', fileField: 'file', maxFileSize: '3 GB' },
      syncInventory: { method: 'POST', url: `${prefix}/studies/sync`, body: { center_code: client.code, agent_id: '<bridge-agent-id>', studies: [{ study_instance_uid: '<uid>', patient_id: '<mrn>', modalities: ['CT'] }] } },
      submitFromPortal: { method: 'POST', url: `${baseUrl}/api/client/study-sync/available-studies/{study_id}/submit`, note: 'Portal browser endpoint. Uses client JWT, not bridge token.' },
    },
    dicomEndpoints,
    directPacs,
    payloadNotes: {
      tenantScope: 'The bridge application sends center_code entered locally. The portal resolves the center from that code and requires bridge based integration to be enabled. client_code/client_id remain accepted only as legacy aliases.',
      bridgeEnabled: 'When bridge is enabled, bridge APIs park studies in the client Available study dashboard. AI processing starts only after the client submits that parked study from the portal.',
      bridgeDisabled: 'When bridge is disabled, configure the client PACS once to C-STORE all modalities to directPacs.incoming. Generated reports are pushed to directPacs.outgoing.',
      receivingStatus: 'Call markReceiving when C-STORE starts so the portal shows Receiving. Call parkStudy or uploadStudy when the study is complete; the portal then shows Available.',
      reportingStart: 'The client user opens Available study, adds clinical indication and up to 5 supporting files, then sends the uploaded study to the processing pipeline.',
    },
  }
}

async function requireBridgeToken(req: Request, res: Response) {
  const expectedTokens = getBridgeExpectedTokens()
  const presented = readBridgePresentedToken(req)
  if (!expectedTokens.length) {
    res.status(503).json({ error: { code: 'BRIDGE_TOKEN_NOT_CONFIGURED', message: 'Bridge API token is not configured on the portal' } })
    return false
  }
  if (!presented || !expectedTokens.includes(presented)) {
    res.status(401).json({ error: { code: 'INVALID_BRIDGE_TOKEN', message: 'Invalid bridge API token' } })
    return false
  }
  return true
}

function getBridgeExpectedToken() {
  return getBridgeExpectedTokens()[0] ?? ''
}

function getBridgeExpectedTokens() {
  return [
    process.env.BRIDGE_AGENT_API_TOKEN,
    ...(process.env.BRIDGE_AGENT_API_TOKENS ?? '').split(','),
    process.env.DECTROCEL_TELERAD_API_KEY,
    process.env.RENEWIST_API_KEY,
  ].map((value) => value?.trim()).filter((value): value is string => Boolean(value))
}

function readBridgePresentedToken(req: Request) {
  const authorization = typeof req.headers.authorization === 'string' ? req.headers.authorization.trim() : ''
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  const headerToken = [
    req.headers['x-bridge-token'],
    req.headers['x-api-key'],
    req.headers['api-key'],
    req.headers['x-api-token'],
    req.headers['x-auth-token'],
    authorization && !bearer ? authorization : undefined,
  ].map((value) => Array.isArray(value) ? value[0] : value)
    .map((value) => typeof value === 'string' ? value.trim() : '')
    .find(Boolean)
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body as Record<string, unknown> : {}
  const bodyToken = stringValue(body.bridge_token)
    ?? stringValue(body.bridgeToken)
    ?? stringValue(body.api_key)
    ?? stringValue(body.apiKey)
    ?? stringValue(body.token)
    ?? stringValue(body.registration_code)
  const queryToken = stringValue(req.query.bridge_token)
    ?? stringValue(req.query.api_key)
    ?? stringValue(req.query.token)
  return bearer || headerToken || bodyToken || queryToken || ''
}

function normalizeBridgeAvailability(value: string) {
  if (/locally_missing/i.test(value)) return 'LocallyMissing'
  if (/deleted/i.test(value)) return 'DeletedAtSource'
  if (/unknown/i.test(value)) return 'Unknown'
  return 'Available'
}

function normalizeBridgeStatusList(value: unknown, fallback: string[]) {
  const aliases: Record<string, string> = {
    pending: 'Pending',
    acknowledged: 'AgentAcknowledged',
    agentacknowledged: 'AgentAcknowledged',
    running: 'Running',
    sending: 'Sending',
    sent: 'Sent',
    completed: 'Completed',
    complete: 'Completed',
    failed: 'Failed',
    partiallysent: 'PartiallySent',
    partially_sent: 'PartiallySent',
    studyunavailable: 'StudyUnavailable',
    study_not_found: 'StudyUnavailable',
    dispatchqueued: 'DispatchQueued',
    available: 'Available',
  }
  const raw = String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean)
  const normalized = raw.map((item) => aliases[item.replace(/[\s_-]+/g, '').toLowerCase()] ?? aliases[item.toLowerCase()] ?? item)
  return normalized.length ? normalized : fallback
}

function bridgeStudyData(study: {
  patient_id?: string | null
  patient_name?: string | null
  patient_sex?: string | null
  patient_age?: string | null
  accession_number?: string | null
  study_date?: string | null
  study_time?: string | null
  study_description?: string | null
  body_part_examined?: string | null
  bodyPartExamined?: string | null
  modalities?: string[]
  institution_name?: string | null
  referring_physician?: string | null
  series_count?: number
  instance_count?: number
  total_size_bytes?: number
  study_fingerprint?: string | null
  first_detected_at?: string | null
  ready_at?: string | null
}, body: { agent_id: string; agent_name?: string }, availabilityStatus: string, workflowStatus: string) {
  return {
    agentName: body.agent_name ?? null,
    patientId: study.patient_id ?? null,
    patientName: study.patient_name ?? null,
    patientSex: study.patient_sex ?? null,
    patientAge: study.patient_age ?? null,
    accessionNumber: study.accession_number ?? null,
    studyDate: study.study_date ?? null,
    studyTime: study.study_time ?? null,
    studyDescription: study.study_description ?? null,
    modalities: classifyBreastXrayModalities(study.modalities ?? [], study.body_part_examined ?? study.bodyPartExamined),
    institutionName: study.institution_name ?? null,
    referringPhysician: study.referring_physician ?? null,
    seriesCount: study.series_count ?? 0,
    instanceCount: study.instance_count ?? 0,
    totalSizeBytes: BigInt(study.total_size_bytes ?? 0),
    studyFingerprint: study.study_fingerprint ?? null,
    availabilityStatus,
    workflowStatus,
    firstDetectedAt: study.first_detected_at ? new Date(study.first_detected_at) : null,
    readyAt: study.ready_at ? new Date(study.ready_at) : null,
    lastSyncedAt: new Date(),
  }
}

type BridgeBundleStudy = Omit<Parameters<typeof formatBridgeStudyForAdmin>[0], 'attachments'> & {
  archivePath?: string | null
  processingJob?: NonNullable<Parameters<typeof formatBridgeStudyForAdmin>[0]['processingJob']> & { uploadName?: string; uploadPath?: string | null; upstreamStatus?: unknown }
  attachments: Array<{ id: string; originalName: string; mimeType?: string | null; sizeBytes: bigint | number; createdAt: Date; filePath: string }>
}

type ProviderBundleAttachment = {
  id: string
  originalName: string
  mimeType?: string | null
  sizeBytes: bigint | number | string
  createdAt: Date
  filePath: string
}

type ProviderStudyBundle = {
  source: BundleStudySource
  publicStudyId: string
  clientId: string
  processingJobId: string
  bridgeStudyId: string | null
  dectrocelJobId: string
  archiveName: string
  archivePath: string
  clinicalIndication: string | null
  attachments: ProviderBundleAttachment[]
  metadata: Record<string, unknown>
}

async function getProviderStudyBundle(studyId: string, providerCode: string): Promise<ProviderStudyBundle | null> {
  const provider = await prisma.teleradiologyProvider.findUnique({ where: { code: providerCode }, select: { id: true, code: true, name: true } })
  if (!provider) return null
  const bridgeReference = await prisma.availableBridgeStudy.findUnique({ where: { id: studyId }, select: { processingJobId: true } })
  const processingIdentifiers = [...new Set([studyId, bridgeReference?.processingJobId].filter((value): value is string => Boolean(value)))]
  const mapping = await prisma.providerJobMapping.findFirst({
    where: {
      providerId: provider.id,
      OR: [
        { processingJobId: { in: processingIdentifiers } },
        { dectrocelJobId: { in: processingIdentifiers } },
        { providerJobId: studyId },
      ],
    },
    orderBy: { updatedAt: 'desc' },
  })
  if (!mapping) return null
  const processingJobId = mapping.processingJobId ?? mapping.dectrocelJobId
  const job = await prisma.processingJob.findUnique({
    where: { id: processingJobId },
    include: {
      client: { select: { id: true, code: true, name: true } },
      bridgeStudy: { include: { attachments: { orderBy: { createdAt: 'asc' } } } },
    },
  })
  if (!job) return null
  const report = mapping.reportReviewId
    ? await prisma.reportReview.findUnique({ where: { id: mapping.reportReviewId } })
    : null
  const bridgeStudy = job.bridgeStudy
  const queuedMetadata = extractQueuedMetadata(job.upstreamStatus)
  const clinicalIndication = bridgeStudy?.clinicalIndication
    ?? getClinicalIndication(job.upstreamStatus)
    ?? getClinicalIndication(report?.editedReportJson)
    ?? getClinicalIndication(report?.aiReportJson)
    ?? null
  const attachments: ProviderBundleAttachment[] = bridgeStudy?.attachments.map((attachment) => ({
    id: attachment.id,
    originalName: attachment.originalName,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    createdAt: attachment.createdAt,
    filePath: attachment.filePath,
  })) ?? getProviderBundleAttachmentReferences(job.upstreamStatus, job.createdAt)
  const modalities = bridgeStudy?.modalities?.length
    ? bridgeStudy.modalities
    : [report?.modality ?? queuedMetadata.modality].filter((value): value is string => Boolean(value))
  return {
    source: {
      id: bridgeStudy?.id ?? job.id,
      publicStudyId: bridgeStudy?.publicStudyId ?? mapping.dectrocelJobId,
      studyInstanceUid: bridgeStudy?.studyInstanceUid ?? mapping.studyInstanceUid ?? queuedMetadata.studyInstanceUid ?? '',
      modalities,
      archivePath: bridgeStudy?.archivePath ?? job.uploadPath,
      archiveName: bridgeStudy?.archiveName ?? job.uploadName,
      processingJob: { id: job.id, uploadName: job.uploadName, uploadPath: job.uploadPath, upstreamStatus: job.upstreamStatus },
    },
    publicStudyId: bridgeStudy?.publicStudyId ?? mapping.dectrocelJobId,
    clientId: job.clientId,
    processingJobId: job.id,
    bridgeStudyId: bridgeStudy?.id ?? null,
    dectrocelJobId: mapping.dectrocelJobId,
    archiveName: bridgeStudy?.archiveName ?? job.uploadName,
    archivePath: bridgeStudy?.archivePath ?? job.uploadPath,
    clinicalIndication,
    attachments,
    metadata: {
      provider: { code: provider.code, name: provider.name },
      mapping: {
        id: mapping.id,
        dectrocelJobId: mapping.dectrocelJobId,
        providerJobId: mapping.providerJobId,
        reportReviewId: mapping.reportReviewId,
        studyInstanceUid: mapping.studyInstanceUid,
        accessionNumber: mapping.accessionNumber,
        status: mapping.status,
        createdAt: mapping.createdAt,
        updatedAt: mapping.updatedAt,
      },
      client: job.client,
      study: {
        publicStudyId: bridgeStudy?.publicStudyId ?? mapping.dectrocelJobId,
        bridgeStudyId: bridgeStudy?.id ?? null,
        patientName: bridgeStudy?.patientName ?? report?.patientName ?? queuedMetadata.patientName ?? null,
        patientId: bridgeStudy?.patientId ?? report?.patientId ?? queuedMetadata.patientId ?? null,
        patientSex: bridgeStudy?.patientSex ?? queuedMetadata.patientSex ?? null,
        patientAge: bridgeStudy?.patientAge ?? queuedMetadata.patientAge ?? null,
        accessionNumber: bridgeStudy?.accessionNumber ?? report?.accession ?? mapping.accessionNumber ?? queuedMetadata.accession ?? null,
        studyInstanceUid: bridgeStudy?.studyInstanceUid ?? report?.studyUid ?? mapping.studyInstanceUid ?? queuedMetadata.studyInstanceUid ?? null,
        studyDate: bridgeStudy?.studyDate ?? queuedMetadata.studyDate ?? null,
        studyTime: bridgeStudy?.studyTime ?? queuedMetadata.studyTime ?? null,
        studyDescription: bridgeStudy?.studyDescription ?? queuedMetadata.studyDescription ?? null,
        modalities,
        clinicalIndication,
        imageCount: job.imageCount || bridgeStudy?.instanceCount || 0,
      },
      processing: {
        id: job.id,
        serviceType: job.serviceType,
        workflowType: job.workflowType,
        priority: job.priority,
        status: job.status,
        clinicalStatus: job.clinicalStatus,
        imageCount: job.imageCount,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        completedAt: job.completedAt,
      },
      files: {
        archiveName: bridgeStudy?.archiveName ?? job.uploadName,
        attachments: attachments.map((attachment) => ({
          id: attachment.id,
          originalName: attachment.originalName,
          mimeType: attachment.mimeType ?? null,
          sizeBytes: String(attachment.sizeBytes),
          createdAt: attachment.createdAt,
        })),
      },
    },
  }
}

function getProviderBundleAttachmentReferences(value: unknown, createdAt: Date): ProviderBundleAttachment[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const record = value as Record<string, unknown>
  const candidates = [record.clinicalIndicationAttachments, record.supportingFiles]
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue
    return candidate.flatMap((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return []
      const attachment = item as Record<string, unknown>
      if (typeof attachment.filePath !== 'string' || !attachment.filePath.trim()) return []
      const originalName = typeof attachment.originalName === 'string'
        ? attachment.originalName
        : typeof attachment.name === 'string'
          ? attachment.name
          : path.basename(attachment.filePath)
      return [{
        id: `processing-job-attachment-${index + 1}`,
        originalName,
        mimeType: typeof attachment.mimeType === 'string' ? attachment.mimeType : null,
        sizeBytes: typeof attachment.sizeBytes === 'string' || typeof attachment.sizeBytes === 'number' || typeof attachment.sizeBytes === 'bigint' ? attachment.sizeBytes : 0,
        createdAt,
        filePath: attachment.filePath,
      }]
    })
  }
  return []
}

async function resolveSafeBundleFile(candidate: string | null | undefined) {
  return resolveArchivePath(candidate, [uploadsPath, ...(process.env.LEGACY_UPLOAD_ROOTS || '').split(';').filter(Boolean)])
}

async function sendBridgeStudyBundle(res: Response, study: BridgeBundleStudy) {
  return sendStudyBundle(res, {
    source: {
      id: study.id, publicStudyId: study.publicStudyId, studyInstanceUid: study.studyInstanceUid,
      modalities: study.modalities, archivePath: study.archivePath, archiveName: study.archiveName,
      processingJob: study.processingJob ? {
        id: study.processingJob.id, uploadName: study.processingJob.uploadName ?? study.archiveName ?? '',
        uploadPath: study.processingJob.uploadPath, upstreamStatus: study.processingJob.upstreamStatus,
      } : null,
    },
    // Storage references are needed internally to fetch the archive, not in the downloaded metadata.
    metadata: formatBridgeStudyForAdmin({ ...study, processingJob: study.processingJob ? {
      id: study.processingJob.id, status: study.processingJob.status, clinicalStatus: study.processingJob.clinicalStatus,
      completedAt: study.processingJob.completedAt, priority: study.processingJob.priority,
    } : null }),
    clinicalIndication: study.clinicalIndication, attachments: study.attachments,
  })
}

async function sendProviderStudyBundle(res: Response, study: ProviderStudyBundle) {
  return sendStudyBundle(res, { source: study.source, metadata: study.metadata, clinicalIndication: study.clinicalIndication, attachments: study.attachments })
}

function formatBridgeCommandForAgent(command: {
  commandId: string
  clientId: string
  agentId: string
  type: string
  status: string
  payloadJson: unknown
  requestedAt: Date
  acknowledgedAt?: Date | null
  completedAt?: Date | null
}, clientCode: string) {
  return {
    id: command.commandId,
    command_id: command.commandId,
    center_code: clientCode,
    client_id: clientCode,
    agent_id: command.agentId,
    type: command.type === 'InventoryScan' ? 'inventory_scan' : command.type,
    command_type: command.type === 'InventoryScan' ? 'inventory_scan' : command.type,
    status: command.status,
    payload: command.payloadJson,
    requested_at: command.requestedAt,
    acknowledged_at: command.acknowledgedAt ?? null,
    completed_at: command.completedAt ?? null,
  }
}

function formatBridgeDispatchForAgent(dispatch: {
  requestId: string
  priority: string
  requestedAt: Date
  serviceType: string
}, study: {
  id: string
  publicStudyId: string
  studyInstanceUid: string
  patientId?: string | null
  patientName?: string | null
  accessionNumber?: string | null
  studyDescription?: string | null
}, clientCode: string) {
  return {
    request_id: dispatch.requestId,
    center_code: clientCode,
    client_id: clientCode,
    portal_study_id: study.id,
    public_study_id: study.publicStudyId,
    study_instance_uid: study.studyInstanceUid,
    patient_id: study.patientId,
    patient_name: study.patientName,
    accession_number: study.accessionNumber,
    study_description: study.studyDescription,
    service_type: dispatch.serviceType,
    priority: dispatch.priority,
    requested_at: dispatch.requestedAt,
  }
}

async function verifyCurrentUserPassword(req: Request) {
  const body = z.object({ password: z.string().min(1) }).safeParse(req.body)
  if (!body.success) return { ok: false as const, status: 400, message: 'Password confirmation is required' }
  const user = await prisma.user.findUnique({ where: { id: req.user!.sub }, select: { passwordHash: true, active: true } })
  if (!user?.active) return { ok: false as const, status: 401, message: 'User is not active' }
  const valid = await bcrypt.compare(body.data.password, user.passwordHash)
  if (!valid) return { ok: false as const, status: 401, message: 'Password confirmation failed' }
  return { ok: true as const }
}

async function auditDeprecatedPasswordView(req: Request, action: string, metadata: Record<string, unknown>) {
  await prisma.auditLog.create({
    data: {
      clientId: req.user?.clientId ?? null,
      actorUserId: req.user?.sub ?? null,
      action,
      metadata: { ...metadata, reason: 'Readable generated password storage is disabled' },
      ipAddress: req.ip,
    },
  }).catch((error) => console.error('Deprecated password-view audit failed', error))
}

async function saveSignatureImage(dataUrl: string) {
  const match = dataUrl.match(/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/)
  if (!match) throw new Error('Signature image must be PNG, JPG, or WEBP')

  const extension = match[1] === 'jpeg' ? 'jpg' : match[1]
  const buffer = Buffer.from(match[2], 'base64')
  if (buffer.length > 2 * 1024 * 1024) throw new Error('Signature image must be 2 MB or smaller')

  const folder = path.join(uploadsPath, 'signatures')
  await fs.mkdir(folder, { recursive: true })
  const fileName = `${crypto.randomUUID()}.${extension}`
  await fs.writeFile(path.join(folder, fileName), buffer)
  return `/uploads/signatures/${fileName}`
}

async function saveRadiologistDocument(dataUrl: string, originalName = 'radiologist-document') {
  const match = dataUrl.match(/^data:(image\/(?:png|jpe?g|webp)|application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document);base64,([A-Za-z0-9+/=]+)$/)
  if (!match) throw new Error('Document must be an image, PDF, DOC, or DOCX')

  const mime = match[1]
  const extension = mime === 'application/pdf'
    ? 'pdf'
    : mime === 'application/msword'
      ? 'doc'
      : mime.includes('wordprocessingml')
        ? 'docx'
        : mime.endsWith('jpeg')
          ? 'jpg'
          : mime.split('/')[1]
  const buffer = Buffer.from(match[2], 'base64')
  if (buffer.length > 8 * 1024 * 1024) throw new Error('Document must be 8 MB or smaller')

  const folder = path.join(uploadsPath, 'radiologist-documents')
  await fs.mkdir(folder, { recursive: true })
  const safeBase = sanitizeFileName(path.basename(originalName, path.extname(originalName)) || 'radiologist-document').slice(0, 80)
  const fileName = `${safeBase}-${crypto.randomUUID()}.${extension}`
  await fs.writeFile(path.join(folder, fileName), buffer)
  return `/uploads/radiologist-documents/${fileName}`
}

async function parsePatientStudyArchive(req: Request, folder: string) {
  await fs.mkdir(folder, { recursive: true })
  return new Promise<{
    fields: Record<string, string>
    files: Array<{ role: string; originalName: string; storedName: string; filePath: string; mimeType?: string; sizeBytes: bigint }>
  }>((resolve, reject) => {
    const fields: Record<string, string> = {}
    const files: Array<{ role: string; originalName: string; storedName: string; filePath: string; mimeType?: string; sizeBytes: bigint }> = []
    const writes: Promise<void>[] = []
    let failed = false
    const busboy = Busboy({ headers: req.headers, limits: { files: 12, fileSize: 3 * 1024 * 1024 * 1024, fields: 30 } })
    const fail = (error: Error) => { if (!failed) { failed = true; reject(error) } }
    busboy.on('field', (name, value) => { fields[name] = value })
    busboy.on('file', (fieldName, file, info) => {
      const role = fieldName === 'study' ? 'STUDY' : fieldName === 'report' ? 'REPORT' : 'ATTACHMENT'
      const originalName = sanitizeFileName(info.filename || `${role.toLowerCase()}.bin`)
      const storedName = `${crypto.randomUUID()}-${originalName}`
      const filePath = path.join(folder, storedName)
      let sizeBytes = 0
      const output = fsSync.createWriteStream(filePath)
      file.on('data', (chunk: Buffer) => { sizeBytes += chunk.length })
      file.on('limit', () => fail(new Error(`${originalName} exceeds the 3 GB file limit`)))
      writes.push(new Promise<void>((done, failedWrite) => {
        output.on('finish', () => { files.push({ role, originalName, storedName, filePath, mimeType: info.mimeType, sizeBytes: BigInt(sizeBytes) }); done() })
        output.on('error', failedWrite)
        file.on('error', failedWrite)
      }))
      file.pipe(output)
    })
    busboy.on('filesLimit', () => fail(new Error('Upload a maximum of 12 files per archived study')))
    busboy.on('error', (error) => fail(error instanceof Error ? error : new Error('Invalid archive upload')))
    busboy.on('finish', () => { Promise.all(writes).then(() => { if (!failed) resolve({ fields, files }) }).catch((error) => fail(error instanceof Error ? error : new Error('Unable to store archived files'))) })
    req.pipe(busboy)
  })
}

async function extractDocxParagraphs(filePath: string) {
  const xml = await new Promise<string>((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (error, zipFile) => {
      if (error || !zipFile) return reject(error ?? new Error('Unable to open DOCX report'))
      zipFile.readEntry()
      zipFile.on('entry', (entry) => {
        if (entry.fileName !== 'word/document.xml') { zipFile.readEntry(); return }
        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return reject(streamError ?? new Error('Unable to read DOCX report'))
          const chunks: Buffer[] = []
          stream.on('data', (chunk: Buffer) => chunks.push(chunk))
          stream.on('end', () => { zipFile.close(); resolve(Buffer.concat(chunks).toString('utf8')) })
          stream.on('error', reject)
        })
      })
      zipFile.on('end', () => reject(new Error('DOCX report content was not found')))
      zipFile.on('error', reject)
    })
  })
  const decode = (value: string) => value.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'")
  return xml.split(/<\/w:p>/i).map((paragraph) => decode(paragraph.replace(/<w:tab\s*\/>/gi, '\t').replace(/<w:br\s*\/>/gi, '\n').replace(/<[^>]+>/g, '')).trim()).filter(Boolean)
}


let shuttingDown = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of receiverProcesses.values()) child.kill('SIGTERM');
  httpServer.close(() => { void renewistSubmissionTail.finally(async () => { await closeRedis(); await prisma.$disconnect(); process.exit(0); }); });
  setTimeout(() => process.exit(1), 55000).unref();
});
