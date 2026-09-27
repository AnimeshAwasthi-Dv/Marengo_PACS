import type { Prisma, PrismaClient } from '@prisma/client'
import { getDeploymentFeatures } from './deploymentProfile'

type DbClient = PrismaClient | Prisma.TransactionClient
export type NotificationOrganization = 'DECTROCEL' | 'RENEWIST' | 'CLIENT' | 'RADIOLOGIST'

export type DomainNotificationInput = {
  eventType: string
  aggregateType: string
  aggregateId: string
  idempotencyKey: string
  clientId?: string | null
  patientRef?: string | null
  stage?: string | null
  status: string
  title: string
  message: string
  category: string
  organizations: NotificationOrganization[]
  recipientUserIds?: string[]
  metadata?: Record<string, unknown>
  occurredAt?: Date
}

export async function createDomainNotification(db: DbClient, input: DomainNotificationInput) {
  if (!getDeploymentFeatures().notifications) return null
  const execute = async (tx: Prisma.TransactionClient) => {
    const event = await tx.notificationEvent.upsert({
      where: { idempotencyKey: input.idempotencyKey },
      update: {},
      create: {
        eventType: input.eventType,
        category: input.category,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        clientId: input.clientId ?? null,
        patientRef: maskPatientReference(input.patientRef),
        stage: input.stage ?? null,
        status: input.status,
        title: input.title,
        message: input.message,
        metadata: jsonObject(input.metadata ?? {}),
        idempotencyKey: input.idempotencyKey,
        occurredAt: input.occurredAt ?? new Date(),
      },
    })

    const recipients = await resolvePortalRecipients(tx, input)
    if (recipients.length) {
      await tx.notificationDelivery.createMany({
        data: recipients.map((recipient) => ({
          eventId: event.id,
          clientId: input.clientId ?? null,
          recipientUserId: recipient.userId,
          recipientOrganization: recipient.organization,
          recipientKey: `user:${recipient.userId}`,
          channel: 'IN_APP',
          status: 'DELIVERED',
          deliveredAt: new Date(),
        })),
        skipDuplicates: true,
      })
    }

    return event
  }
  return '$transaction' in db ? db.$transaction(execute) : execute(db)
}

async function resolvePortalRecipients(db: DbClient, input: DomainNotificationInput) {
  const filters: Prisma.UserWhereInput[] = []
  if (input.organizations.includes('DECTROCEL')) filters.push({ role: 'SUPER_ADMIN' })
  if (input.organizations.includes('RENEWIST')) filters.push({ role: { in: ['PROVIDER_ADMIN', 'PROVIDER_MANAGER'] }, providerCode: 'RENEWIST' })
  if (input.organizations.includes('CLIENT') && input.clientId) {
    const client = await db.client.findUnique({ where: { id: input.clientId }, select: { parentClientId: true } })
    filters.push({ role: 'CLIENT_USER', clientId: { in: [input.clientId, client?.parentClientId].filter((id): id is string => Boolean(id)) } })
  }
  if (input.organizations.includes('RADIOLOGIST') && input.recipientUserIds?.length) filters.push({ role: 'RADIOLOGIST', id: { in: input.recipientUserIds } })
  if (input.recipientUserIds?.length) filters.push({ id: { in: input.recipientUserIds } })
  if (!filters.length) return []
  const users = await db.user.findMany({ where: { active: true, OR: filters }, select: { id: true, role: true, providerCode: true } })
  return users.map((user) => ({
    userId: user.id,
    organization: user.role === 'SUPER_ADMIN' ? 'DECTROCEL' : user.providerCode || (user.role === 'RADIOLOGIST' ? 'RADIOLOGIST' : 'CLIENT'),
  }))
}

export function maskPatientReference(value?: string | null) {
  if (!value) return null
  const normalized = value.trim()
  if (normalized.length <= 4) return normalized
  return `${'*'.repeat(Math.min(8, normalized.length - 4))}${normalized.slice(-4)}`
}

export function isWhitelistRecipientEligible(recipient: {
  active: boolean
  verificationStatus: string
  consentStatus: string
  phoneE164?: string | null
  notificationCategories: string[]
}, category: string) {
  return recipient.active
    && recipient.verificationStatus === 'VERIFIED'
    && ['OPTED_IN', 'APPROVED', 'ACTIVE'].includes(recipient.consentStatus)
    && Boolean(recipient.phoneE164)
    && (recipient.notificationCategories.includes('ALL') || recipient.notificationCategories.includes(category))
}

function jsonObject(value: Record<string, unknown>): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject
}
