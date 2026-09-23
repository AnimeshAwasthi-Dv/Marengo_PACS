import 'dotenv/config'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import type { NextFunction, Request, Response } from 'express'
import { prisma } from './db'

const jwtSecret = process.env.JWT_SECRET?.trim()
if (!jwtSecret) throw new Error('JWT_SECRET must be configured before the API starts')

type ClientPortalRole = 'FRONT_DESK' | 'TECHNICIAN' | 'MANAGER' | 'IT_TEAM'
const readOnlyEnvAdminSub = 'readonly-env-admin'

function readOnlyEnvAdminMatches(userId: string, legacyEmail: string, password: string) {
  if (process.env.DATABASE_READ_ONLY !== 'true') return false
  const adminPassword = process.env.ADMIN_PASSWORD
  if (!adminPassword || password !== adminPassword) return false
  const adminUserId = process.env.ADMIN_USER_ID?.trim().toLowerCase() || 'admin'
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  const loginId = (userId || legacyEmail).trim().toLowerCase()
  return loginId === adminUserId || Boolean(adminEmail && loginId === adminEmail)
}

function readonlyEnvAdminResponse() {
  const token = jwt.sign({ sub: readOnlyEnvAdminSub, role: 'SUPER_ADMIN', readOnlyEnvAdmin: true }, jwtSecret, { expiresIn: '8h' })
  return {
    token,
    user: {
      id: readOnlyEnvAdminSub,
      userId: process.env.ADMIN_USER_ID?.trim() || 'admin',
      name: 'Read-only Administrator',
      email: process.env.ADMIN_EMAIL?.trim().toLowerCase() || 'admin@example.com',
      role: 'SUPER_ADMIN' as const,
      clientId: null,
      providerCode: null,
      portalRole: null,
    },
  }
}

async function getPortalRole(userId: string, role: string): Promise<ClientPortalRole | null> {
  if (role !== 'CLIENT_USER') return null
  const rows = await prisma.$queryRaw<Array<{ portalRole: string | null }>>`
    SELECT "portalRole" FROM "users" WHERE "id" = ${userId} LIMIT 1
  `
  const value = rows[0]?.portalRole
  return value === 'FRONT_DESK' || value === 'TECHNICIAN' || value === 'MANAGER' || value === 'IT_TEAM'
    ? value
    : 'IT_TEAM'
}

export async function login(req: Request, res: Response) {
  const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : ''
  const legacyEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  if ((!userId && !legacyEmail) || !password) return res.status(400).json({ message: 'User ID and password are required' })
  if (readOnlyEnvAdminMatches(userId, legacyEmail, password)) return res.json(readonlyEnvAdminResponse())
  // Email fallback keeps pre-migration accounts usable while administrators distribute their new user IDs.
  const user = await prisma.user.findFirst({
    where: userId ? { OR: [{ userId: { equals: userId, mode: 'insensitive' } }, { email: { equals: userId, mode: 'insensitive' } }] } : { email: { equals: legacyEmail, mode: 'insensitive' } },
    include: { client: true },
  })

  if (!user || !user.active || !(await bcrypt.compare(password, user.passwordHash))) {
    if (readOnlyEnvAdminMatches(userId, legacyEmail, password)) return res.json(readonlyEnvAdminResponse())
    return res.status(401).json({ message: 'Invalid credentials' })
  }

  if (user.client?.status === 'BLOCKED') {
    return res.status(403).json({ message: 'Client is blocked' })
  }

  const portalRole = await getPortalRole(user.id, user.role)
  const token = jwt.sign({ sub: user.id, role: user.role, clientId: user.clientId, providerCode: user.providerCode, portalRole }, jwtSecret, { expiresIn: '8h' })
  return res.json({
    token,
    user: { id: user.id, userId: user.userId, name: user.name, email: user.email, role: user.role, clientId: user.clientId, providerCode: user.providerCode, portalRole },
  })
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined

  if (!token) return res.status(401).json({ message: 'Missing bearer token' })

  try {
    const payload = jwt.verify(token, jwtSecret) as { sub: string; role: string; clientId?: string; providerCode?: string; portalRole?: string | null; readOnlyEnvAdmin?: boolean }
    if (process.env.DATABASE_READ_ONLY === 'true' && payload.readOnlyEnvAdmin === true && payload.sub === readOnlyEnvAdminSub && payload.role === 'SUPER_ADMIN') {
      req.user = { sub: payload.sub, role: 'SUPER_ADMIN' }
      return next()
    }
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, clientId: true, providerCode: true, active: true, client: { select: { status: true } } },
    })
    if (!user?.active || user.client?.status === 'BLOCKED') return res.status(401).json({ message: 'Account is inactive' })
    if (user.role !== payload.role || user.clientId !== (payload.clientId ?? null) || user.providerCode !== (payload.providerCode ?? null)) {
      return res.status(401).json({ message: 'Session permissions have changed. Please sign in again.' })
    }
    const portalRole = await getPortalRole(user.id, user.role)
    req.user = { sub: user.id, role: user.role, clientId: user.clientId ?? undefined, providerCode: user.providerCode ?? undefined, portalRole: portalRole ?? undefined }
    return next()
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' })
  }
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== 'SUPER_ADMIN') return res.status(403).json({ message: 'Super Admin role required' })
  return next()
}

export function requireClientUser(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== 'CLIENT_USER' || !req.user.clientId) return res.status(403).json({ message: 'Client role required' })
  return next()
}

export function requireRadiologist(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== 'RADIOLOGIST') return res.status(403).json({ message: 'Radiologist role required' })
  return next()
}

export function requireProviderAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== 'PROVIDER_ADMIN' || !req.user.providerCode) return res.status(403).json({ message: 'Provider admin role required' })
  return next()
}

export function requireProviderStaff(req: Request, res: Response, next: NextFunction) {
  if (!['PROVIDER_ADMIN', 'PROVIDER_MANAGER'].includes(req.user?.role ?? '') || !req.user?.providerCode) {
    return res.status(403).json({ message: 'Provider staff role required' })
  }
  return next()
}
