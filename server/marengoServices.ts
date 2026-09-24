import type { Prisma, PrismaClient } from '@prisma/client';
export async function ensureMarengoServices(db: PrismaClient | Prisma.TransactionClient, clientId: string) {
  const client = await db.client.findUnique({ where: { id: clientId }, select: { code: true, parentClient: { select: { code: true } } } });
  if (!client || !(client.code.startsWith('MARENGO') || client.parentClient?.code === 'MARENGO')) return;
  const services = await db.service.findMany({ where: { enabled: true }, select: { id: true } });
  await db.clientService.createMany({ data: services.map(service => ({ clientId, serviceId: service.id, status: 'ACTIVE' as const, workflowType: 'TELERADIOLOGY_ONLY', validUntil: new Date('2099-12-31T23:59:59Z') })), skipDuplicates: true });
}
