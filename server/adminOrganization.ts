import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Express, Request, RequestHandler, Response } from 'express'
import type { Prisma } from '@prisma/client'
import { ZodError } from 'zod'
import { requireAuth, requireSuperAdmin } from './auth'
import {
  accountStatusSchema,
  adminRadiologistCreateSchema,
  adminRadiologistScopeSchema,
  groupAdminCreateSchema,
  managedRadiologistScope,
  passwordConfirmationSchema,
  type AdminRadiologistScope,
} from './adminOrganizationContracts'
import { prisma } from './db'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const uploadsPath = path.resolve(__dirname, '..', 'uploads')
const renewistProviderCode = 'RENEWIST'
const portalUserSelect = {
  id: true,
  userId: true,
  email: true,
  name: true,
  role: true,
  clientId: true,
  providerCode: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const

function userIdForEmail(email: string) {
  const prefix = email.split('@')[0]!.toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 40) || 'user'
  return `${prefix}-${crypto.createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 6)}`
}

type MarengoGroup = {
  id: string
  code: string
  name: string
  kind: 'GROUP'
  status: 'ACTIVE' | 'BLOCKED'
}

class AdminOrganizationError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export function registerAdminOrganizationRoutes(app: Express) {
  const secured = [requireAuth, requireSuperAdmin] as const

  app.get('/api/admin/group-admins', ...secured, adminHandler(async (_req, res) => {
    const group = await findMarengoGroup()
    const groupAdmins = await prisma.user.findMany({
      where: { role: 'CLIENT_USER', clientId: group.id },
      select: portalUserSelect,
      orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
    })
    res.json({ group, groupAdmins, admins: groupAdmins })
  }))

  app.post('/api/admin/group-admins', ...secured, adminHandler(async (req, res) => {
    const body = groupAdminCreateSchema.parse(req.body)
    const group = await findMarengoGroup()
    await assertEmailIsAvailable(body.email)

    const temporaryPassword = generatePortalPassword()
    const passwordHash = await bcrypt.hash(temporaryPassword, 12)
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          userId: userIdForEmail(body.email),
          name: body.name,
          email: body.email,
          passwordHash,
          lastGeneratedPassword: null,
          role: 'CLIENT_USER',
          clientId: group.id,
          providerCode: null,
          active: true,
        },
        select: portalUserSelect,
      })
      await tx.auditLog.create({
        data: {
          clientId: group.id,
          actorUserId: req.user!.sub,
          action: 'MARENGO_GROUP_ADMIN_CREATED',
          metadata: { userId: created.id, email: created.email },
          ipAddress: req.ip,
        },
      })
      return created
    })

    setCredentialResponseHeaders(res)
    res.status(201).json({ group, user, temporaryPassword })
  }))

  app.patch('/api/admin/group-admins/:userId/status', ...secured, adminHandler(async (req, res) => {
    const body = accountStatusSchema.parse(req.body)
    const group = await findMarengoGroup()
    const existing = await findGroupAdmin(group.id, String(req.params.userId))
    if (!body.active) await assertAnotherActiveGroupAdmin(group.id, existing.id)

    const user = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: existing.id },
        data: { active: body.active },
        select: portalUserSelect,
      })
      await tx.auditLog.create({
        data: {
          clientId: group.id,
          actorUserId: req.user!.sub,
          action: body.active ? 'MARENGO_GROUP_ADMIN_ACTIVATED' : 'MARENGO_GROUP_ADMIN_DEACTIVATED',
          metadata: { userId: updated.id, email: updated.email },
          ipAddress: req.ip,
        },
      })
      return updated
    })
    res.json({ user })
  }))

  app.post('/api/admin/group-admins/:userId/reset-password', ...secured, adminHandler(async (req, res) => {
    const group = await findMarengoGroup()
    const existing = await findGroupAdmin(group.id, String(req.params.userId))
    const temporaryPassword = generatePortalPassword()
    const passwordHash = await bcrypt.hash(temporaryPassword, 12)
    const user = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: existing.id },
        data: { passwordHash, lastGeneratedPassword: null },
        select: portalUserSelect,
      })
      await tx.auditLog.create({
        data: {
          clientId: group.id,
          actorUserId: req.user!.sub,
          action: 'MARENGO_GROUP_ADMIN_PASSWORD_RESET',
          metadata: { userId: updated.id, email: updated.email },
          ipAddress: req.ip,
        },
      })
      return updated
    })

    setCredentialResponseHeaders(res)
    res.json({ user, temporaryPassword })
  }))

  app.delete('/api/admin/group-admins/:userId', ...secured, adminHandler(async (req, res) => {
    await verifySuperAdminPassword(req)
    const group = await findMarengoGroup()
    const existing = await findGroupAdmin(group.id, String(req.params.userId))
    await assertAnotherActiveGroupAdmin(group.id, existing.id)
    await assertGroupAdminHasNoProtectedHistory(existing.id)

    await prisma.$transaction(async (tx) => {
      await tx.user.delete({ where: { id: existing.id } })
      await tx.auditLog.create({
        data: {
          clientId: group.id,
          actorUserId: req.user!.sub,
          action: 'MARENGO_GROUP_ADMIN_DELETED',
          metadata: { userId: existing.id, email: existing.email },
          ipAddress: req.ip,
        },
      })
    })
    res.json({ deleted: true, userId: existing.id })
  }))

  app.get('/api/admin/radiologists', ...secured, adminHandler(async (req, res) => {
    const group = await findMarengoGroup()
    const parsedScope = req.query.scope
      ? adminRadiologistScopeSchema.safeParse(String(req.query.scope).toUpperCase())
      : null
    if (parsedScope && !parsedScope.success) throw new AdminOrganizationError(400, 'Scope must be MARENGO_GROUP or RENEWIST')
    const requestedScope = parsedScope?.success ? parsedScope.data : null
    const where = radiologistScopeWhere(group.id, requestedScope)
    const profiles = await prisma.radiologistProfile.findMany({
      where,
      include: {
        client: { select: { id: true, code: true, name: true, kind: true } },
        user: { select: portalUserSelect },
        _count: { select: { reportReviews: true, callBookings: true, availabilitySlots: true } },
      },
      orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
    })
    const radiologists = profiles.map((profile) => ({
      ...profile,
      scope: managedRadiologistScope(profile, group.id),
      accessActive: profile.active && profile.user.active,
    }))
    res.json({ radiologists })
  }))

  app.get('/api/admin/radiologists/:radiologistId/document', ...secured, adminHandler(async (req, res) => {
    const group = await findMarengoGroup()
    const existing = await findManagedRadiologist(group.id, String(req.params.radiologistId))
    if (!existing.documentUrl) throw new AdminOrganizationError(404, 'No document has been uploaded for this radiologist')

    const documentPath = await resolveManagedUpload(existing.documentUrl, 'radiologist-documents')
    await prisma.auditLog.create({
      data: {
        clientId: existing.clientId,
        actorUserId: req.user!.sub,
        action: 'ADMIN_RADIOLOGIST_DOCUMENT_DOWNLOADED',
        metadata: { radiologistId: existing.id, fileName: existing.documentName },
        ipAddress: req.ip,
      },
    })
    res.download(documentPath, existing.documentName || path.basename(documentPath))
  }))

  app.post('/api/admin/radiologists', ...secured, adminHandler(async (req, res) => {
    const body = adminRadiologistCreateSchema.parse(req.body)
    const group = await findMarengoGroup()
    const target = await resolveRadiologistTarget(body.scope, group)
    await assertEmailIsAvailable(body.email)

    const savedPaths: string[] = []
    try {
      let signatureImageUrl = body.signatureImageUrl
      if (body.signatureImageData) {
        const signature = await saveSignatureImage(body.signatureImageData)
        signatureImageUrl = signature.publicPath
        savedPaths.push(signature.filePath)
      }
      let documentUrl: string | null = null
      let documentName: string | null = null
      if (body.documentData) {
        const document = await saveRadiologistDocument(body.documentData, body.documentName)
        documentUrl = document.publicPath
        documentName = document.documentName
        savedPaths.push(document.filePath)
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
            clientId: target.clientId,
            providerCode: target.providerCode,
            active: true,
          },
          select: portalUserSelect,
        })
        const profile = await tx.radiologistProfile.create({
          data: {
            fullName: body.fullName,
            email: body.email,
            phone: body.phone || null,
            qualification: body.qualification,
            medicalRegistrationNumber: body.medicalRegistrationNumber,
            organisationName: body.organisationName || target.organisationName,
            signatureImageUrl: signatureImageUrl || null,
            documentUrl,
            documentName,
            active: true,
            userId: user.id,
            clientId: target.clientId,
            providerCode: target.providerCode,
            managerUserId: null,
          },
          include: { user: { select: portalUserSelect } },
        })
        await tx.auditLog.create({
          data: {
            clientId: target.clientId,
            actorUserId: req.user!.sub,
            action: body.scope === 'MARENGO_GROUP' ? 'ADMIN_GROUP_RADIOLOGIST_CREATED' : 'ADMIN_RENEWIST_RADIOLOGIST_CREATED',
            metadata: { radiologistId: profile.id, userId: user.id, email: user.email, scope: body.scope },
            ipAddress: req.ip,
          },
        })
        return { profile: { ...profile, scope: body.scope, accessActive: true }, user }
      })

      setCredentialResponseHeaders(res)
      res.status(201).json({ ...result, temporaryPassword })
    } catch (error) {
      await Promise.all(savedPaths.map((filePath) => fs.rm(filePath, { force: true }).catch(() => undefined)))
      throw error
    }
  }))

  app.patch('/api/admin/radiologists/:radiologistId/status', ...secured, adminHandler(async (req, res) => {
    const body = accountStatusSchema.parse(req.body)
    const group = await findMarengoGroup()
    const existing = await findManagedRadiologist(group.id, String(req.params.radiologistId))
    const scope = managedRadiologistScope(existing, group.id)!

    const profile = await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: existing.userId }, data: { active: body.active } })
      const updated = await tx.radiologistProfile.update({
        where: { id: existing.id },
        data: { active: body.active },
        include: { user: { select: portalUserSelect }, client: { select: { id: true, code: true, name: true, kind: true } } },
      })
      await tx.auditLog.create({
        data: {
          clientId: updated.clientId,
          actorUserId: req.user!.sub,
          action: body.active ? 'ADMIN_RADIOLOGIST_ACTIVATED' : 'ADMIN_RADIOLOGIST_DEACTIVATED',
          metadata: { radiologistId: updated.id, email: updated.email, scope },
          ipAddress: req.ip,
        },
      })
      return { ...updated, scope, accessActive: body.active }
    })
    res.json({ profile })
  }))

  app.post('/api/admin/radiologists/:radiologistId/reset-password', ...secured, adminHandler(async (req, res) => {
    const group = await findMarengoGroup()
    const existing = await findManagedRadiologist(group.id, String(req.params.radiologistId))
    const scope = managedRadiologistScope(existing, group.id)!
    const temporaryPassword = generatePortalPassword()
    const passwordHash = await bcrypt.hash(temporaryPassword, 12)
    const user = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: existing.userId },
        data: { passwordHash, lastGeneratedPassword: null },
        select: portalUserSelect,
      })
      await tx.auditLog.create({
        data: {
          clientId: existing.clientId,
          actorUserId: req.user!.sub,
          action: 'ADMIN_RADIOLOGIST_PASSWORD_RESET',
          metadata: { radiologistId: existing.id, email: updated.email, scope },
          ipAddress: req.ip,
        },
      })
      return updated
    })

    setCredentialResponseHeaders(res)
    res.json({ user, temporaryPassword })
  }))

  app.delete('/api/admin/radiologists/:radiologistId', ...secured, adminHandler(async (req, res) => {
    await verifySuperAdminPassword(req)
    const group = await findMarengoGroup()
    const existing = await findManagedRadiologist(group.id, String(req.params.radiologistId))
    const scope = managedRadiologistScope(existing, group.id)!
    await assertRadiologistHasNoProtectedHistory(existing.id, existing.userId)

    await prisma.$transaction(async (tx) => {
      await tx.radiologistProfile.delete({ where: { id: existing.id } })
      await tx.user.delete({ where: { id: existing.userId } })
      await tx.auditLog.create({
        data: {
          clientId: existing.clientId,
          actorUserId: req.user!.sub,
          action: 'ADMIN_RADIOLOGIST_DELETED',
          metadata: { radiologistId: existing.id, userId: existing.userId, email: existing.email, scope },
          ipAddress: req.ip,
        },
      })
    })
    res.json({ deleted: true, radiologistId: existing.id })
  }))
}

function adminHandler(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return async (req: Request, res: Response) => {
    try {
      await handler(req, res)
    } catch (error) {
      sendAdminError(res, error)
    }
  }
}

function sendAdminError(res: Response, error: unknown) {
  if (error instanceof AdminOrganizationError) return res.status(error.status).json({ message: error.message })
  if (error instanceof ZodError) {
    return res.status(400).json({ message: 'Invalid request', issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) })
  }
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
  if (code === 'P2002') return res.status(409).json({ message: 'That email address is already assigned to another portal account' })
  if (code === 'P2025') return res.status(404).json({ message: 'The requested account was not found' })
  console.error('Super Admin organization management request failed', error)
  return res.status(500).json({ message: 'Unable to complete the administration request' })
}

async function findMarengoGroup(): Promise<MarengoGroup> {
  const preferred = await prisma.client.findUnique({
    where: { code: 'MARENGO' },
    select: { id: true, code: true, name: true, kind: true, status: true },
  })
  if (preferred) {
    if (preferred.kind !== 'GROUP') throw new AdminOrganizationError(409, 'The MARENGO workspace is not configured as a group')
    return { ...preferred, kind: 'GROUP' }
  }

  const groups = await prisma.client.findMany({
    where: { kind: 'GROUP' },
    select: { id: true, code: true, name: true, kind: true, status: true },
    orderBy: { createdAt: 'asc' },
    take: 2,
  })
  if (!groups.length) throw new AdminOrganizationError(409, 'The Marengo group workspace has not been configured')
  if (groups.length > 1) throw new AdminOrganizationError(409, 'Multiple group workspaces exist; configure the primary MARENGO group before managing accounts')
  return { ...groups[0], kind: 'GROUP' }
}

async function findGroupAdmin(groupId: string, userId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, role: 'CLIENT_USER', clientId: groupId },
    select: portalUserSelect,
  })
  if (!user) throw new AdminOrganizationError(404, 'Marengo Group Admin was not found')
  return user
}

async function assertEmailIsAvailable(email: string) {
  const existing = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } })
  if (existing) throw new AdminOrganizationError(409, 'That email address is already assigned to another portal account')
}

async function assertAnotherActiveGroupAdmin(groupId: string, excludedUserId: string) {
  const otherActiveAdmins = await prisma.user.count({
    where: { role: 'CLIENT_USER', clientId: groupId, active: true, id: { not: excludedUserId } },
  })
  if (!otherActiveAdmins) throw new AdminOrganizationError(409, 'Create or activate another Marengo Group Admin before removing access from this account')
}

async function assertGroupAdminHasNoProtectedHistory(userId: string) {
  const [managedRadiologists, reportAuditActions, createdAvailability, bookingActions] = await Promise.all([
    prisma.radiologistProfile.count({ where: { managerUserId: userId } }),
    prisma.reportAuditLog.count({ where: { actorUserId: userId } }),
    prisma.radiologistAvailability.count({ where: { createdByUserId: userId } }),
    prisma.reportCallBooking.count({ where: { OR: [{ managerAcceptedByUserId: userId }, { radiologistAcceptedByUserId: userId }] } }),
  ])
  if (managedRadiologists + reportAuditActions + createdAvailability + bookingActions > 0) {
    throw new AdminOrganizationError(409, 'This account has protected clinical history. Deactivate it instead of deleting it.')
  }
}

function radiologistScopeWhere(groupId: string, scope: AdminRadiologistScope | null): Prisma.RadiologistProfileWhereInput {
  const groupScope: Prisma.RadiologistProfileWhereInput = { clientId: groupId, providerCode: null }
  const renewistScope: Prisma.RadiologistProfileWhereInput = { clientId: null, providerCode: renewistProviderCode }
  if (scope === 'MARENGO_GROUP') return groupScope
  if (scope === 'RENEWIST') return renewistScope
  return { OR: [groupScope, renewistScope] }
}

async function resolveRadiologistTarget(scope: AdminRadiologistScope, group: MarengoGroup) {
  if (scope === 'MARENGO_GROUP') {
    return { clientId: group.id, providerCode: null, organisationName: group.name }
  }
  const provider = await prisma.teleradiologyProvider.findUnique({
    where: { code: renewistProviderCode },
    select: { code: true, name: true, active: true },
  })
  if (!provider) throw new AdminOrganizationError(409, 'The Renewist provider workspace has not been configured')
  if (!provider.active) throw new AdminOrganizationError(409, 'The Renewist provider workspace is inactive')
  return { clientId: null, providerCode: provider.code, organisationName: provider.name }
}

async function findManagedRadiologist(groupId: string, radiologistId: string) {
  const profile = await prisma.radiologistProfile.findUnique({
    where: { id: radiologistId },
    include: { user: { select: portalUserSelect } },
  })
  if (!profile || !managedRadiologistScope(profile, groupId)) {
    throw new AdminOrganizationError(404, 'Managed Marengo or Renewist radiologist was not found')
  }
  return profile
}

async function assertRadiologistHasNoProtectedHistory(radiologistId: string, userId: string) {
  const [reports, calls, availability, reportAuditActions, bookingActions, managedRadiologists] = await Promise.all([
    prisma.reportReview.count({ where: { radiologistId } }),
    prisma.reportCallBooking.count({ where: { radiologistId } }),
    prisma.radiologistAvailability.count({ where: { radiologistId } }),
    prisma.reportAuditLog.count({ where: { actorUserId: userId } }),
    prisma.reportCallBooking.count({ where: { OR: [{ managerAcceptedByUserId: userId }, { radiologistAcceptedByUserId: userId }] } }),
    prisma.radiologistProfile.count({ where: { managerUserId: userId } }),
  ])
  if (reports + calls + availability + reportAuditActions + bookingActions + managedRadiologists > 0) {
    throw new AdminOrganizationError(409, 'This radiologist has protected clinical history. Deactivate the account instead of deleting it.')
  }
}

async function verifySuperAdminPassword(req: Request) {
  const body = passwordConfirmationSchema.safeParse(req.body)
  if (!body.success) throw new AdminOrganizationError(400, 'Password confirmation is required')
  const currentUser = await prisma.user.findFirst({
    where: { id: req.user!.sub, role: 'SUPER_ADMIN', active: true },
    select: { passwordHash: true },
  })
  if (!currentUser || !(await bcrypt.compare(body.data.password, currentUser.passwordHash))) {
    throw new AdminOrganizationError(401, 'Password confirmation failed')
  }
}

function generatePortalPassword() {
  return `DXP-${crypto.randomBytes(3).toString('hex').toUpperCase()}-${crypto.randomBytes(3).toString('base64url')}`
}

function setCredentialResponseHeaders(res: Response) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  res.setHeader('Pragma', 'no-cache')
}

async function saveSignatureImage(dataUrl: string) {
  const match = dataUrl.match(/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/)
  if (!match) throw new AdminOrganizationError(400, 'Signature image must be PNG, JPG, or WEBP')
  const extension = match[1] === 'jpeg' ? 'jpg' : match[1]
  const buffer = Buffer.from(match[2], 'base64')
  if (!buffer.length || buffer.length > 2 * 1024 * 1024) throw new AdminOrganizationError(400, 'Signature image must be 2 MB or smaller')

  const folder = path.join(uploadsPath, 'signatures')
  await fs.mkdir(folder, { recursive: true })
  const fileName = `${crypto.randomUUID()}.${extension}`
  const filePath = path.join(folder, fileName)
  await fs.writeFile(filePath, buffer)
  return { publicPath: `/uploads/signatures/${fileName}`, filePath }
}

async function saveRadiologistDocument(dataUrl: string, originalName = 'radiologist-document') {
  const match = dataUrl.match(/^data:(image\/(?:png|jpe?g|webp)|application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document);base64,([A-Za-z0-9+/=]+)$/)
  if (!match) throw new AdminOrganizationError(400, 'Document must be an image, PDF, DOC, or DOCX')
  const buffer = Buffer.from(match[2], 'base64')
  if (!buffer.length || buffer.length > 8 * 1024 * 1024) throw new AdminOrganizationError(400, 'Document must be 8 MB or smaller')

  const extensionByMime: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/webp': '.webp',
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  }
  const extension = extensionByMime[match[1]]
  const cleanName = sanitizeFileName(originalName || 'radiologist-document')
  const baseName = sanitizeFileName(path.basename(cleanName, path.extname(cleanName)) || 'radiologist-document').slice(0, 80)
  const fileName = `${baseName}-${crypto.randomUUID()}${extension}`
  const folder = path.join(uploadsPath, 'radiologist-documents')
  await fs.mkdir(folder, { recursive: true })
  const filePath = path.join(folder, fileName)
  await fs.writeFile(filePath, buffer)
  return { publicPath: `/uploads/radiologist-documents/${fileName}`, filePath, documentName: `${baseName}${extension}` }
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._ -]+/g, '_').replace(/\.{2,}/g, '.').trim() || 'file'
}

async function resolveManagedUpload(publicPath: string, expectedFolder: string) {
  const normalizedPublicPath = publicPath.replace(/\\/g, '/')
  const expectedPrefix = `/uploads/${expectedFolder}/`
  if (!normalizedPublicPath.startsWith(expectedPrefix)) throw new AdminOrganizationError(404, 'Uploaded file was not found')

  const expectedRoot = await fs.realpath(path.join(uploadsPath, expectedFolder)).catch(() => '')
  const candidate = await fs.realpath(path.join(uploadsPath, normalizedPublicPath.slice('/uploads/'.length))).catch(() => '')
  if (!expectedRoot || !candidate || (candidate !== expectedRoot && !candidate.startsWith(`${expectedRoot}${path.sep}`))) {
    throw new AdminOrganizationError(404, 'Uploaded file was not found')
  }
  return candidate
}
