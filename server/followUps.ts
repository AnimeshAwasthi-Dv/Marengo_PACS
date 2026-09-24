import type { Prisma } from '@prisma/client';
export function followUpStatusFilter(status: string, now: Date): Prisma.PatientFollowUpWhereInput {
  if (status === 'OVERDUE') return { OR: [{ status: 'OVERDUE' }, { status: { in: ['PENDING', 'SCHEDULED'] }, followUpDate: { lt: now } }] };
  if (status === 'PENDING' || status === 'SCHEDULED') return { status, followUpDate: { gte: now } };
  return status ? { status } : {};
}
