import crypto from 'node:crypto'
import { prisma } from './db'

const start = Number(process.env.PACS_PORT_START ?? 5000)
const end = Number(process.env.PACS_PORT_END ?? 5999)
const maxAeTitleLength = 16

export async function allocatePacsEndpoint(clientCode: string, serviceName: string) {
  const usedPorts = await getUsedDicomPorts()
  const availablePorts = Array.from({ length: end - start + 1 }, (_, index) => start + index).filter((port) => !usedPorts.has(port))
  const availablePort = availablePorts[0]
  const urgentPort = availablePorts[1]

  if (!availablePort) throw new Error('No available DICOM receiving ports')
  if (!urgentPort) throw new Error('No available urgent DICOM receiving ports')

  const suffix = crypto.randomBytes(2).toString('hex').toUpperCase()
  const serviceCode = serviceName.toUpperCase().includes('CT') ? 'CT' : serviceName.toUpperCase().includes('MRI') || serviceName.toUpperCase().includes('MR') ? 'MR' : 'XR'
  const aeClientCode = clientCode.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 4)
  const ec2PublicIp = process.env.EC2_PUBLIC_IP
  if (!ec2PublicIp) throw new Error('EC2_PUBLIC_IP must be configured before assigning PACS endpoints')
  return {
    ec2PublicIp,
    receivingPort: availablePort,
    aeTitle: normalizeAeTitle(`DX${aeClientCode}${serviceCode}${suffix}`),
    urgentReceivingPort: urgentPort,
    urgentAeTitle: normalizeAeTitle(`DX${aeClientCode}${serviceCode}U${suffix}`),
  }
}

export async function allocateAdditionalPacsEndpoint(clientCode: string, serviceName: string, priority: 'REGULAR' | 'URGENT' = 'REGULAR') {
  const usedPorts = await getUsedDicomPorts()
  const usedAeTitles = await getUsedAeTitles()
  const receivingPort = Array.from({ length: end - start + 1 }, (_, index) => start + index).find((port) => !usedPorts.has(port))
  if (!receivingPort) throw new Error('No available DICOM receiving ports')
  const suffix = String(receivingPort).slice(-4)
  const serviceCode = serviceName.toUpperCase().includes('CT') ? 'CT' : serviceName.toUpperCase().includes('MRI') || serviceName.toUpperCase().includes('MR') ? 'MR' : 'XR'
  const aeClientCode = clientCode.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 4)
  let aeTitle = normalizeAeTitle(`DX${aeClientCode}${serviceCode}${priority === 'URGENT' ? 'U' : 'A'}${suffix}`)
  let attempt = 1
  while (usedAeTitles.has(aeTitle)) aeTitle = normalizeAeTitle(`DX${aeClientCode}${serviceCode}${priority === 'URGENT' ? 'U' : 'A'}${suffix}${attempt++}`)
  return { id: crypto.randomUUID(), receivingPort, aeTitle, priority }
}

export function normalizeAeTitle(value: string, fallback = 'DECXPERT') {
  const normalized = String(value || fallback)
    .replace(/[^A-Z0-9_ -]/gi, '')
    .trim()
    .toUpperCase()
    .slice(0, maxAeTitleLength)
  return normalized || fallback.slice(0, maxAeTitleLength)
}

async function getUsedDicomPorts() {
  const used = await prisma.pacsConfig.findMany({ select: { receivingPort: true, urgentReceivingPort: true, extraEndpoints: true } })
  return new Set(used.flatMap((item) => [
    item.receivingPort,
    item.urgentReceivingPort,
    ...readExtraEndpointPorts(item.extraEndpoints),
  ]).filter((port): port is number => typeof port === 'number'))
}

async function getUsedAeTitles() {
  const used = await prisma.pacsConfig.findMany({ select: { aeTitle: true, urgentAeTitle: true, extraEndpoints: true } })
  return new Set(used.flatMap((item) => [
    item.aeTitle,
    item.urgentAeTitle,
    ...readExtraEndpointAeTitles(item.extraEndpoints),
  ]).filter((title): title is string => typeof title === 'string' && Boolean(title)))
}

function readExtraEndpointPorts(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => typeof item === 'object' && item ? Number((item as Record<string, unknown>).receivingPort) : NaN).filter(Number.isFinite)
    : []
}

function readExtraEndpointAeTitles(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => typeof item === 'object' && item ? String((item as Record<string, unknown>).aeTitle ?? '') : '').filter(Boolean)
    : []
}

export function isTeleradiologyWorkflow(workflowType?: string | null) {
  return workflowType === 'TELERADIOLOGY_ONLY' || workflowType === 'AI_TELERADIOLOGY'
}

export async function getTeleradiologyBillingPauseReason(clientId: string) {
  const cutoff = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000)
  const invoice = await prisma.invoice.findFirst({
    where: {
      clientId,
      status: { notIn: ['PAID', 'VOID'] },
      OR: [
        { issuedAt: { lte: cutoff } },
        { issuedAt: null, createdAt: { lte: cutoff } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    select: { invoiceNumber: true },
  })
  return invoice
    ? `Teleradiology services are paused because invoice ${invoice.invoiceNumber} is unpaid for more than 15 days.`
    : ''
}

export async function validatePacsProcessing(receivingPort: number, aeTitle: string) {
  const directConfig = await prisma.pacsConfig.findFirst({
    where: { OR: [{ receivingPort }, { urgentReceivingPort: receivingPort }] },
    include: { client: true, clientService: { include: { service: true } } },
  })
  const config = directConfig ?? (await prisma.pacsConfig.findMany({
    include: { client: true, clientService: { include: { service: true } } },
  })).find((item) => getExtraEndpoints(item.extraEndpoints).some((endpoint) => endpoint.receivingPort === receivingPort))

  const extraEndpoint = getExtraEndpoints(config?.extraEndpoints).find((endpoint) => endpoint.receivingPort === receivingPort)
  const expectedAeTitle = extraEndpoint?.aeTitle ?? (config?.urgentReceivingPort === receivingPort ? config.urgentAeTitle : config?.aeTitle)
  if (!config || expectedAeTitle !== normalizeAeTitle(aeTitle)) return { allowed: false, reason: 'AE title or receiving port mismatch' }
  if (config.client.status === 'BLOCKED') return { allowed: false, reason: 'Client blocked' }
  if (config.clientService.status !== 'ACTIVE') return { allowed: false, reason: 'Service not active' }
  if (!isTeleradiologyWorkflow(config.clientService.workflowType)) {
    if (config.clientService.validUntil < new Date()) return { allowed: false, reason: 'Service expired' }
    if (config.clientService.credits - config.clientService.usedCredits <= 0) return { allowed: false, reason: 'Insufficient credits' }
  }

  return { allowed: true, config }
}

function getExtraEndpoints(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const endpoint = item as Record<string, unknown>
    const receivingPort = Number(endpoint.receivingPort)
    const aeTitle = normalizeAeTitle(String(endpoint.aeTitle ?? ''))
    if (!Number.isInteger(receivingPort) || !aeTitle) return []
    return [{ receivingPort, aeTitle }]
  })
}
