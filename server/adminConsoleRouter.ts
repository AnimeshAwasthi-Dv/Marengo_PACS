import { evidencePage } from './evidencePaging';
import { Router } from 'express';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { requireAuth, requireSuperAdmin } from './auth';
import { adminStatuses, correctStudyStatus, evidenceRecord } from './adminEvidence';
import { csvDocument, istTimestamp, statisticsRange } from './workspaceStatistics';

export const adminConsoleRouter = Router();
adminConsoleRouter.use(requireAuth, requireSuperAdmin);
adminConsoleRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

adminConsoleRouter.get('/studies', async (req, res) => {
  const q = String(req.query.q ?? '').slice(0, 150);
  const page = Math.min(100000, Math.max(1, Math.floor(Number(req.query.page) || 1)));
  const where: Prisma.AvailableBridgeStudyWhereInput = { ...(req.query.centerId ? { clientId: String(req.query.centerId) } : {}), ...(q ? { OR: ['patientName', 'patientId', 'accessionNumber', 'studyInstanceUid', 'studyDescription'].map(field => ({ [field]: { contains: q, mode: 'insensitive' } })) } : {}) };
  const rows = await prisma.availableBridgeStudy.findMany({ where, include: { client: { select: { name: true } }, processingJob: { select: { status: true } } }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * 30, take: 30 });
  const centers = await prisma.client.findMany({ where: { kind: 'CENTER' }, select: { id: true, name: true } });
  res.json({ rows: rows.map(s => ({ id: s.id, patient: s.patientName, patientId: s.patientId, accession: s.accessionNumber, center: s.client.name, description: s.studyDescription, modality: s.modalities.join(', '), status: s.workflowStatus, jobStatus: s.processingJob?.status, received: s.createdAt, updatedAt: s.updatedAt })), total: await prisma.availableBridgeStudy.count({ where }), page, centers, statuses: adminStatuses });
});

adminConsoleRouter.post('/studies/:id/status', async (req, res, next) => {
  try {
    const { status, reason, expectedUpdatedAt } = req.body ?? {};
    if (![status, reason, expectedUpdatedAt].every(v => typeof v === 'string')) return res.status(400).json({ message: 'Status, reason and record version are required.' });
    res.json(await correctStudyStatus(String(req.params.id), { status, reason, expectedUpdatedAt }, req.user!.sub, req.ip));
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) return res.status(Number(error.status)).json({ message: (error as Error).message });
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2034') return res.status(409).json({ message: 'Concurrent update detected. Refresh and retry.' });
    next(error);
  }
});

adminConsoleRouter.get('/evidence', async (req, res) => {
  let range;
  try { range = statisticsRange(req.query.from ? String(req.query.from) : undefined, req.query.to ? String(req.query.to) : undefined); }
  catch (error) { return res.status(400).json({ message: (error as Error).message }); }
  const studyId = String(req.query.studyId ?? '');
  const study = studyId ? await prisma.availableBridgeStudy.findUnique({ where: { id: studyId }, select: { id: true, clientId: true, processingJobId: true, studyInstanceUid: true, updatedAt: true, workflowStatus: true } }) : null;
  if (studyId && !study) return res.status(404).json({ message: 'Study not found.' });
  const mappings = study ? await prisma.providerJobMapping.findMany({ where: { OR: [{ studyInstanceUid: study.studyInstanceUid }, ...(study.processingJobId ? [{ processingJobId: study.processingJobId }] : [])] } }) : [];
  const reportIds = study ? (await prisma.reportReview.findMany({ where: { clientId: study.clientId, studyUid: study.studyInstanceUid }, select: { id: true } })).map(r => r.id) : [];
  const createdAt = { gte: range.start, lt: range.end };
  const cap = 10001;
  const requestedPage = Math.min(100000, Math.max(1, Math.floor(Number(req.query.page) || 1)));
  const indexedPage = !study && req.query.format !== 'csv' ? await evidencePage(range.start, range.end, requestedPage, String(req.query.source ?? ''), String(req.query.q ?? '').slice(0, 150)) : null;
  const pageIds = (kind: string) => indexedPage ? { id: { in: indexedPage.ids(kind) } } : {};
  const auditWhere: Prisma.AuditLogWhereInput = { createdAt, ...(study ? { clientId: study.clientId, OR: [{ metadata: { path: ['studyId'], equals: study.id } }, ...(study.processingJobId ? [{ metadata: { path: ['processingJobId'], equals: study.processingJobId } }] : [])] } : {}) };
  const historyWhere: Prisma.JobStatusHistoryWhereInput = { createdAt, ...(study ? { OR: [...(study.processingJobId ? [{ processingJobId: study.processingJobId }] : []), { reportReviewId: { in: reportIds } }] } : {}) };
  const requestWhere: Prisma.ProviderApiRequestWhereInput = { createdAt, ...(study ? { OR: mappings.flatMap(m => [{ idempotencyKey: m.dectrocelJobId }, { metadata: { path: ['dectrocelJobId'], equals: m.dectrocelJobId } }, { metadata: { path: ['dectrocel_job_id'], equals: m.dectrocelJobId } }]) } : {}) };
  const audits = await prisma.auditLog.findMany({ where: { ...auditWhere, ...pageIds('audit') }, orderBy: { createdAt: 'desc' }, take: cap });
  const history = await prisma.jobStatusHistory.findMany({ where: { ...historyWhere, ...pageIds('history') }, orderBy: { createdAt: 'desc' }, take: cap });
  const requests = await prisma.providerApiRequest.findMany({ where: { ...requestWhere, ...pageIds('request') }, orderBy: { createdAt: 'desc' }, take: cap });
  const submissions = await prisma.providerReportSubmission.findMany({ where: { ...pageIds('submission'), receivedAt: createdAt, ...(study ? { OR: [{ reportReviewId: { in: reportIds } }, { dectrocelJobId: { in: mappings.map(m => m.dectrocelJobId) } }] } : {}) }, orderBy: { receivedAt: 'desc' }, take: cap });
  const deliveries = await prisma.pacsReturnJob.findMany({ where: { ...pageIds('delivery'), updatedAt: createdAt, ...(study ? { reportReviewId: { in: reportIds } } : {}) }, orderBy: { updatedAt: 'desc' }, take: cap });
  const versions = await prisma.reportVersion.findMany({ where: { ...pageIds('version'), createdAt, ...(study ? { reportReviewId: { in: reportIds } } : {}) }, select: { id: true, reportReviewId: true, version: true, status: true, source: true, checksum: true, immutable: true, metadata: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: cap });
  const reportAudits = await prisma.reportAuditLog.findMany({ where: { ...pageIds('reportAudit'), createdAt, ...(study ? { reportId: { in: reportIds } } : {}) }, orderBy: { createdAt: 'desc' }, take: cap });
  if ([audits, history, requests, submissions, deliveries, versions, reportAudits].some(rows => rows.length === cap)) return res.status(413).json({ message: 'Too many records. Narrow the date range or select a study; no partial export was generated.' });
  let rows = [
    ...audits.map(a => evidenceRecord({ id: a.id, source: 'Audit log', at: a.createdAt, action: a.action, actorId: a.actorUserId, centerId: a.clientId, details: { ipAddress: a.ipAddress, metadata: a.metadata } })),
    ...history.map(h => evidenceRecord({ id: h.id, source: h.sourceSystem, at: h.createdAt, action: `${h.previousStatus ?? '-'} -> ${h.newStatus}`, actorId: h.actorUserId, requestId: h.relatedRequestId, details: { reason: h.reason, processingJobId: h.processingJobId, reportReviewId: h.reportReviewId, providerStatus: h.relatedProviderStatus, payload: h.technicalDetails } })),
    ...requests.map(r => evidenceRecord({ id: r.id, source: `Renewist ${r.direction}`, at: r.createdAt, action: r.status, requestId: r.requestId, httpStatus: r.responseCode, storedHash: r.requestHash, details: { endpoint: r.endpoint, authenticated: r.authenticated, idempotencyKey: r.idempotencyKey, metadata: r.metadata } })),
    ...submissions.map(s => evidenceRecord({ id: s.id, source: 'Renewist report submission', at: s.receivedAt, action: s.reportStatus, requestId: s.requestId, details: { dectrocelJobId: s.dectrocelJobId, renewistJobId: s.renewistJobId, reportReviewId: s.reportReviewId, reportFormat: s.reportFormat, reportType: s.reportType, reportVersion: s.reportVersion, reportChecksum: s.reportChecksum, processedAt: s.processedAt?.toISOString(), error: s.processingError, metadata: s.metadata } })),
    ...deliveries.map(d => evidenceRecord({ id: d.id, source: 'PACS delivery snapshot', at: d.updatedAt, action: d.status, details: { reportReviewId: d.reportReviewId, attempts: d.attempts, acknowledgedAt: d.acknowledgedAt?.toISOString(), lastAttemptAt: d.lastAttemptAt?.toISOString(), errorCode: d.errorCode, errorMessage: d.errorMessage, result: d.deliveryResult } })),
    ...versions.map(v => evidenceRecord({ id: v.id, source: 'Report version', at: v.createdAt, action: `${v.status} / version ${v.version}`, details: { reportReviewId: v.reportReviewId, origin: v.source, version: v.version, reportChecksum: v.checksum, applicationImmutableFlag: v.immutable, metadata: v.metadata } })),
    ...reportAudits.map(a => evidenceRecord({ id: a.id, source: 'Report audit', at: a.createdAt, action: a.action, actorId: a.actorUserId, details: { reportId: a.reportId, metadata: a.metadata } })),
  ].sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  const q = String(req.query.q ?? '').toLowerCase().slice(0, 150);
  const source = String(req.query.source ?? '');
  const sources = [...new Set(rows.map(r => r.source))].sort();
  if (source) rows = rows.filter(r => r.source === source);
  if (q && !indexedPage) rows = rows.filter(r => JSON.stringify(r).toLowerCase().includes(q));
  const actors = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.flatMap(r => r.actorId ? [r.actorId] : []))] } }, select: { id: true, name: true } });
  const names = new Map(actors.map(a => [a.id, a.name]));
  const named = rows.map(r => ({ ...r, actor: r.actorId ? names.get(r.actorId) ?? 'Unknown/deleted user' : 'System / not recorded' }));
  if (req.query.format === 'csv') {
    const content = csvDocument([['Timestamp (IST)', 'Timestamp (UTC)', 'Source', 'Action / transition', 'Actor', 'Actor ID', 'Center ID', 'Record ID', 'Request ID', 'HTTP status', 'Stored request hash (original scope)', 'Export record SHA-256 (redacted)', 'Recorded details (JSON)'], ...named.map(r => [istTimestamp(r.at), r.at, r.source, r.action, r.actor, r.actorId, r.centerId, r.id, r.requestId, r.httpStatus, r.storedHash, r.exportSha256, JSON.stringify(r.details)])]);
    const digest = createHash('sha256').update(content, 'utf8').digest('hex');
    await prisma.auditLog.create({ data: { actorUserId: req.user!.sub, ipAddress: req.ip, action: 'ADMIN_EVIDENCE_EXPORTED', metadata: { studyId: studyId || null, from: range.from, to: range.to, source, query: q, rows: named.length, csvBytesSha256: digest } } });
    res.setHeader('X-Evidence-SHA256', digest);
    return res.type('text/csv').attachment(`marengo-audit-${range.from}-${range.to}.csv`).send(content);
  }
  const page = Math.min(100000, Math.max(1, Math.floor(Number(req.query.page) || 1)));
  res.json({ rows: indexedPage ? named : named.slice((page - 1) * 50, page * 50), total: indexedPage?.total ?? named.length, page, sources, study, statuses: adminStatuses, generatedAt: new Date().toISOString() });
});
