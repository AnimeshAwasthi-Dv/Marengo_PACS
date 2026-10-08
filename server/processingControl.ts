import { prisma } from './db';

const active = new Map<string, AbortController>();
export function beginProcessing(id: string) {
  const controller = new AbortController();
  active.set(id, controller);
  return { signal: controller.signal, finish: () => { if (active.get(id) === controller) active.delete(id); } };
}
export function abortProcessing(id: string) {
  active.get(id)?.abort(new Error('Study processing terminated by administrator'));
}
export async function assertProcessingActive(id: string) {
  const job = await prisma.processingJob.findUnique({ where: { id }, select: { status: true } });
  if (!job || ['cancelled', 'completed', 'sent_to_pacs'].includes(job.status)) throw new Error('Study processing has been terminated or finalized');
}

export async function assertStudyNotDeleted(clientId: string, studyInstanceUid: string) {
  const deleted = await prisma.deletedPortalStudy.findUnique({ where: { clientId_studyInstanceUid: { clientId, studyInstanceUid } } });
  if (deleted) throw Object.assign(new Error('This study was deleted by an administrator and cannot be reimported automatically'), { status: 410 });
}
