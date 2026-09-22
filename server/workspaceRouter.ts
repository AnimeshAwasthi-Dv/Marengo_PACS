import { Router } from 'express';
import { prisma } from './db';
import { requireAuth } from './auth';
import { marengoTariff } from './marengoTariff';
import { studyTracking } from './studyTracking';
import { telegramConfig, telegramAlertConfig } from './telegramPolicy';
import { setWorklistPriority } from './worklistPriority';
import { redisPing } from './redisCache';
import { requireWorkspaceCapability, workspaceAccess } from './workspaceAccess';
import { csvDocument, durationSeconds, istTimestamp, statisticsRange, summarizeStudies, type StatisticsRow } from './workspaceStatistics';

export const workspaceRouter = Router();
workspaceRouter.use(requireAuth);
workspaceRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
const MAX_ROWS = 50000;
const iso = (date?: Date | null) => date?.toISOString() ?? null;
const within = (date: string | null, range: ReturnType<typeof statisticsRange>) => date && Date.parse(date) >= +range.start && Date.parse(date) < +range.end;
const scoped = (ids: string[] | null) => ids === null ? {} : { clientId: { in: ids } };

workspaceRouter.post(['/studies/:studyId/mark-urgent', '/studies/:studyId/priority'], async (req, res, next) => {
  try {
    const access = await workspaceAccess(req);
    if (!access.permissions.submit) return res.status(403).json({ message: 'Your role cannot change study priority.' });
    const priority = req.path.endsWith('/mark-urgent') ? 'URGENT' : req.body?.priority;
    if (priority !== 'URGENT' && priority !== 'REGULAR') return res.status(400).json({ message: 'Priority must be URGENT or REGULAR.' });
    res.json(await setWorklistPriority(String(req.params.studyId), access.clientIds, req.user!.sub, priority));
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) return res.status(Number(error.status)).json({ message: (error as Error).message });
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2034') return res.status(409).json({ message: 'Study changed during this update. Refresh and try again.' });
    next(error);
  }
});

workspaceRouter.get('/study-status/:jobId', async (req, res) => {
  const access = await workspaceAccess(req);
  const result = await studyTracking(String(req.params.jobId), access.clientIds);
  if (!result) return res.status(404).json({ message: 'Study not found or outside your center access.' });
  res.json(result);
});

workspaceRouter.get('/tariff', requireWorkspaceCapability('billing'), async (req, res) => {
  if (req.query.format === 'csv') {
    await prisma.auditLog.create({ data: { actorUserId: req.user!.sub, clientId: req.user!.clientId, action: 'MARENGO_TARIFF_EXPORTED', metadata: { tariffId: marengoTariff.id, status: marengoTariff.status } } });
    return res.type('text/csv').attachment('marengo-dectrocel-tariff-draft.csv').send(csvDocument([
      ['Modality', 'Body part', 'Studies', 'New Dectrocel (INR)', 'Unit', 'Charge type', 'Status', 'Effective from', 'Notes'],
      ...marengoTariff.rates.map(rate => [rate.modality, rate.bodyPart, rate.studies, rate.amountMinor / 100, rate.unit, rate.chargeType, marengoTariff.status, 'Pending confirmation', rate.note ?? '']),
    ]));
  }
  res.json(marengoTariff);
});

async function collectStatistics(clientIds: string[] | null, range: ReturnType<typeof statisticsRange>) {
  const scope = scoped(clientIds);
  const period = { gte: range.start, lt: range.end };
  const reportSelect = { id: true, clientId: true, studyUid: true, approvedAt: true, pushedAt: true, generatedAt: true, patientName: true, patientId: true, accession: true, modality: true, serviceName: true, client: { select: { name: true } } } as const;
  const periodReports = await prisma.reportReview.findMany({ where: { ...scope, status: { in: ['APPROVED', 'PUSHED'] }, OR: [{ approvedAt: period }, { approvedAt: null, pushedAt: period }, { approvedAt: null, pushedAt: null, generatedAt: period }] }, select: reportSelect, take: MAX_ROWS + 1 });
  const studies = await prisma.availableBridgeStudy.findMany({
    where: { ...scope, OR: [{ firstDetectedAt: period }, { firstDetectedAt: null, createdAt: period }, { processingJob: { completedAt: period } }, { studyInstanceUid: { in: periodReports.flatMap(r => r.studyUid ? [r.studyUid] : []) } }] },
    select: { id: true, clientId: true, studyInstanceUid: true, patientName: true, patientId: true, accessionNumber: true, modalities: true, studyDescription: true, firstDetectedAt: true, createdAt: true,
      client: { select: { name: true } }, processingJob: { select: { id: true, completedAt: true, status: true, demoMode: true } } }, take: MAX_ROWS + 1,
  });
  const finalReports = studies.length ? await prisma.reportReview.findMany({ where: { ...scope, status: { in: ['APPROVED', 'PUSHED'] }, studyUid: { in: studies.map(s => s.studyInstanceUid) } }, select: reportSelect, take: MAX_ROWS + 1, orderBy: { generatedAt: 'desc' } }) : [];
  const jobs = await prisma.processingJob.findMany({ where: { ...scope, bridgeStudy: null, OR: [{ createdAt: period }, { completedAt: period }] }, select: { id: true, clientId: true, serviceType: true, createdAt: true, completedAt: true, status: true, demoMode: true, client: { select: { name: true } }, patient: { select: { name: true, patientIdentifier: true } } }, take: MAX_ROWS + 1 });
  if ([periodReports, studies, finalReports, jobs].some(rows => rows.length > MAX_ROWS)) throw Object.assign(new Error('Too many records. Please select a shorter date range.'), { status: 422 });
  const reportMap = new Map<string, typeof finalReports[number]>();
  for (const report of [...finalReports, ...periodReports]) {
    const key = `${report.clientId}:${report.studyUid}`;
    if (report.studyUid && !reportMap.has(key)) reportMap.set(key, report);
  }
  // Only successful completions count as processed; failed attempts can have completedAt too.
  const processedAt = (job: { completedAt: Date | null; status: string } | null) => job && !/fail|error|cancel/i.test(job.status) ? iso(job.completedAt) : null;
  const rows: StatisticsRow[] = studies.map(study => {
    const report = reportMap.get(`${study.clientId}:${study.studyInstanceUid}`);
    const received = iso(study.firstDetectedAt ?? study.createdAt);
    const reported = report ? iso(report.approvedAt ?? report.pushedAt ?? report.generatedAt) : null;
    return { id: study.id, clientId: study.clientId, center: study.client.name, patient: study.patientName ?? '', patientId: study.patientId ?? '', accession: study.accessionNumber ?? '', modality: study.modalities.join(', '), description: study.studyDescription ?? '', studyUid: study.studyInstanceUid, jobId: study.processingJob?.id ?? null, demo: study.processingJob?.demoMode ?? false,
      received, processed: processedAt(study.processingJob), reported, tatSeconds: durationSeconds(received, reported) };
  });
  for (const job of jobs) rows.push({ id: job.id, clientId: job.clientId, center: job.client.name, patient: job.patient?.name ?? '', patientId: job.patient?.patientIdentifier ?? '', accession: '', modality: '', description: job.serviceType, studyUid: null, jobId: job.id, demo: job.demoMode, received: iso(job.createdAt), processed: processedAt(job), reported: null, tatSeconds: null });
  const linked = new Set(rows.filter(r => r.studyUid).map(r => `${r.clientId}:${r.studyUid}`));
  for (const report of periodReports) if (!report.studyUid || !linked.has(`${report.clientId}:${report.studyUid}`)) {
    rows.push({ id: report.id, clientId: report.clientId, center: report.client.name, patient: report.patientName ?? '', patientId: report.patientId ?? '', accession: report.accession ?? '', modality: report.modality ?? '', description: report.serviceName, studyUid: report.studyUid, jobId: null, demo: false, received: null, processed: null, reported: iso(report.approvedAt ?? report.pushedAt ?? report.generatedAt), tatSeconds: null });
    if (report.studyUid) linked.add(`${report.clientId}:${report.studyUid}`);
  }
  const periodRows = rows.filter(row => within(row.received, range) || within(row.processed, range) || within(row.reported, range));
  periodRows.sort((a, b) => (b.received ?? b.reported ?? '').localeCompare(a.received ?? a.reported ?? ''));
  return { rows: periodRows, ...summarizeStudies(periodRows, periodReports.map(r => ({ at: iso(r.approvedAt ?? r.pushedAt ?? r.generatedAt)! })), range) };
}

workspaceRouter.get('/users', requireWorkspaceCapability('manageUsers'), async (req, res) => {
  const access: Awaited<ReturnType<typeof workspaceAccess>> = res.locals.workspaceAccess;
  const centers = await prisma.client.findMany({ where: { kind: 'CENTER', ...(access.clientIds === null ? {} : { id: { in: access.clientIds } }) }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  const users = await prisma.user.findMany({ where: { role: 'CLIENT_USER', clientId: { in: centers.map(c => c.id) } }, select: { id: true, userId: true, name: true, email: true, portalRole: true, role: true, active: true, clientId: true }, orderBy: { name: 'asc' } });
  res.json({ centers, users });
});

for (const view of ['analytics', 'billing'] as const) workspaceRouter.get(`/${view}`, requireWorkspaceCapability(view), async (req, res, next) => {
  try {
    let range: ReturnType<typeof statisticsRange>;
    try { range = statisticsRange(req.query.from ? String(req.query.from) : undefined, req.query.to ? String(req.query.to) : undefined); }
    catch (error) { return res.status(400).json({ message: (error as Error).message }); }
    const access: Awaited<ReturnType<typeof workspaceAccess>> = res.locals.workspaceAccess;
    let ids = access.clientIds;
    if (req.query.centerId) {
      const centerId = String(req.query.centerId);
      if (ids !== null && !ids.includes(centerId)) return res.status(403).json({ message: 'Center is outside your account scope.' });
      ids = [centerId];
    }
    const result = await collectStatistics(ids, range);
    const centers = await prisma.client.findMany({ where: access.clientIds === null ? {} : { id: { in: access.clientIds } }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
    const processedRows = result.rows.filter(row => within(row.processed, range));
    const transactions = view === 'billing' ? await prisma.studyBillingTransaction.findMany({ where: { ...scoped(ids), processingJobId: { in: processedRows.flatMap(r => r.jobId ? [r.jobId] : []) } }, select: { id: true, processingJobId: true, clientId: true, serviceName: true, units: true, unitPriceMinor: true, amountMinor: true, currency: true, status: true, invoice: { select: { invoiceNumber: true } } } }) : [];
    const transactionMap = new Map<string, typeof transactions>();
    for (const transaction of transactions) {
      const key = `${transaction.clientId}:${transaction.processingJobId}`;
      const entries = transactionMap.get(key) ?? []; entries.push(transaction); transactionMap.set(key, entries);
    }
    const billingRows = processedRows.flatMap(row => {
      const charges = transactionMap.get(`${row.clientId}:${row.jobId}`) ?? [];
      return charges.length ? charges.map(t => ({ ...row, id: `${row.id}:${t.id}`, service: t.serviceName, units: t.units, unitPriceMinor: t.unitPriceMinor, amountMinor: t.amountMinor, currency: t.currency, billingStatus: t.status, invoice: t.invoice?.invoiceNumber ?? '' })) : [{ ...row, service: row.description, units: null, unitPriceMinor: null, amountMinor: null, currency: '', billingStatus: row.demo ? 'DEMO' : 'NOT_RECORDED', invoice: '' }];
    });
    const charges = [...new Set(transactions.map(t => t.currency))].map(currency => ({ currency, amountMinor: transactions.filter(t => t.currency === currency).reduce((sum, t) => sum + t.amountMinor, 0) }));
    if (req.query.format === 'csv') {
      const data: unknown[][] = view === 'billing' ? [
        ['Center', 'Patient', 'Patient ID', 'Accession', 'Study', 'Processed IST', 'Service', 'Units', 'Unit price', 'Amount', 'Currency', 'Billing status', 'Invoice'],
        ...billingRows.map(r => [r.center, r.patient, r.patientId, r.accession, r.description, istTimestamp(r.processed), r.service, r.units, r.unitPriceMinor === null ? '' : r.unitPriceMinor / 100, r.amountMinor === null ? '' : r.amountMinor / 100, r.currency, r.billingStatus, r.invoice]),
      ] : req.query.export === 'daily' ? [
        ['Date IST', 'Received studies', 'Processed studies', 'Finalized reports'], ...result.daily.map(d => [d.day, d.received, d.processed, d.reported]),
        [], ['Average TAT seconds', result.totals.averageTatSeconds], ['Completed TAT sample', result.totals.tatSampleSize],
      ] : [
        ['Center', 'Patient', 'Patient ID', 'Accession', 'Modality', 'Study', 'Received IST', 'Processed IST', 'Reported IST', 'TAT seconds', 'Demo'],
        ...result.rows.map(r => [r.center, r.patient, r.patientId, r.accession, r.modality, r.description, istTimestamp(r.received), istTimestamp(r.processed), istTimestamp(r.reported), r.tatSeconds, r.demo]),
      ];
      await prisma.auditLog.create({ data: { actorUserId: req.user!.sub, clientId: req.user!.clientId, action: `WORKSPACE_${view.toUpperCase()}_EXPORTED`, metadata: { from: range.from, to: range.to, records: data.length - 1 } } });
      return res.type('text/csv').attachment(`marengo-${view}-${range.from}-${range.to}.csv`).send(csvDocument(data));
    }
    const rows = view === 'billing' ? billingRows : result.rows;
    const page = Math.min(Math.max(1, Math.ceil(rows.length / 50)), Math.max(1, Number.parseInt(String(req.query.page ?? 1), 10) || 1));
    res.json({ ...result, rows: rows.slice((page - 1) * 50, page * 50), total: rows.length, page, pageSize: 50, centers, charges, unrecorded: billingRows.filter(r => r.billingStatus === 'NOT_RECORDED').length, from: range.from, to: range.to, updatedAt: new Date().toISOString() });
  } catch (error) {
    if (error instanceof Error && 'status' in error && error.status === 422) return res.status(422).json({ message: error.message });
    next(error);
  }
});

workspaceRouter.get('/healthcheck', requireWorkspaceCapability('healthcheck'), async (_req, res) => {
  const access: Awaited<ReturnType<typeof workspaceAccess>> = res.locals.workspaceAccess;
  const scope = scoped(access.clientIds);
  const started = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  const rows = [
    { id: 'api', service: 'Portal API', center: 'Shared platform', status: 'Healthy', detail: 'Authenticated request completed', observedAt: new Date().toISOString() },
    { id: 'database', service: 'Database', center: 'Shared platform', status: 'Healthy', detail: `Read probe completed in ${Date.now() - started} ms`, observedAt: new Date().toISOString() },
  ];
  const cacheConfigured = Boolean(process.env.REDIS_URL?.trim() || process.env.REDIS_HOST);
  const telegram = telegramConfig();
  const tatAlerts = telegramAlertConfig();
  rows.push({ id: 'telegram-tat', service: 'Telegram near-breach alerts', center: 'Scoped Marengo centers', status: !tatAlerts.enabled ? 'Disabled' : tatAlerts.missing.length ? 'Not configured' : 'Configured', detail: !tatAlerts.enabled ? 'Near-breach sending disabled' : tatAlerts.missing.length ? `Missing: ${tatAlerts.missing.join(', ')}` : `Warn ${tatAlerts.leadMinutes} minutes before TAT; configuration only, not a connectivity probe`, observedAt: null });
  const telegramEvents = await prisma.notificationOutbox.findMany({ where: { eventType: 'TELEGRAM_STUDY_PROCESSING', ...(access.clientIds === null ? {} : { OR: access.clientIds.map(id => ({ payload: { path: ['clientId'], equals: id } })) }) }, orderBy: { createdAt: 'desc' }, take: 100 });
  rows.push({ id: 'telegram', service: 'Telegram study alerts', center: 'Scoped centers', status: !telegram.enabled ? 'Disabled' : telegram.missing.length ? 'Not configured' : telegramEvents.some(e => ['FAILED', 'DEAD'].includes(e.status)) ? 'Needs attention' : 'Configured', detail: !telegram.enabled ? 'Sending disabled; no Telegram messages will be sent' : telegram.missing.length ? `Missing: ${telegram.missing.join(', ')}` : `${telegramEvents.filter(e => e.status === 'SENT').length} sent / ${telegramEvents.filter(e => ['PENDING', 'SENDING'].includes(e.status)).length} queued / ${telegramEvents.filter(e => ['FAILED', 'DEAD'].includes(e.status)).length} failed (latest 100); not a connectivity probe`, observedAt: iso(telegramEvents[0]?.processedAt) });
  const cacheOk = cacheConfigured && await redisPing();
  rows.push({ id: 'cache', service: 'Redis cache', center: 'Shared platform', status: !cacheConfigured ? 'Not configured' : cacheOk ? 'Healthy' : 'Needs attention', detail: !cacheConfigured ? 'Optional cache; database-backed live updates remain available' : cacheOk ? 'PING probe completed' : 'PING probe failed; database fallback active', observedAt: new Date().toISOString() });
  const services = await prisma.clientService.findMany({ where: scope, select: { id: true, status: true, validFrom: true, validUntil: true, client: { select: { name: true } }, service: { select: { name: true, enabled: true } }, pacsConfig: { select: { id: true } } } });
  for (const s of services) rows.push({ id: s.id, service: s.service.name, center: s.client.name, status: s.status !== 'ACTIVE' || !s.service.enabled ? 'Disabled' : s.validUntil < new Date() ? 'Expired' : s.validFrom > new Date() ? 'Not started' : 'Enabled', detail: s.pacsConfig ? 'PACS configured; network connectivity not verified' : 'PACS endpoint not configured', observedAt: new Date().toISOString() });
  const centers = await prisma.client.findMany({ where: access.clientIds === null ? { kind: 'CENTER' } : { id: { in: access.clientIds }, kind: 'CENTER' }, select: { id: true, name: true, studySyncEnabled: true } });
  for (const center of centers) {
    const latest = await prisma.availableBridgeStudy.findFirst({ where: { clientId: center.id }, orderBy: { lastSyncedAt: 'desc' }, select: { lastSyncedAt: true } });
    rows.push({ id: `${center.id}:sync`, service: 'Study synchronization', center: center.name, status: !center.studySyncEnabled ? 'Disabled' : latest ? 'Observed' : 'No activity', detail: 'Last study sync observation; not an agent heartbeat', observedAt: iso(latest?.lastSyncedAt) });
    const jobs = await prisma.processingJob.groupBy({ by: ['status'], where: { clientId: center.id, updatedAt: { gte: new Date(Date.now() - 86400000) } }, _count: { _all: true } });
    rows.push({ id: `${center.id}:jobs`, service: 'Processing activity (24h)', center: center.name, status: jobs.some(j => /fail|error/i.test(j.status)) ? 'Needs attention' : jobs.length ? 'Observed' : 'No activity', detail: jobs.map(j => `${j.status}: ${j._count._all}`).join(' / ') || 'No job updates in the last 24 hours', observedAt: new Date().toISOString() });
    const reports = await prisma.reportReview.findMany({ where: { clientId: center.id }, select: { id: true } });
    const delivery = await prisma.pacsReturnJob.findFirst({ where: { reportReviewId: { in: reports.map(r => r.id) } }, orderBy: { updatedAt: 'desc' }, select: { status: true, updatedAt: true, acknowledgedAt: true } });
    rows.push({ id: `${center.id}:delivery`, service: 'PACS report delivery', center: center.name, status: delivery ? /fail|error/i.test(delivery.status) ? 'Needs attention' : 'Observed' : 'No activity', detail: delivery ? `Latest delivery: ${delivery.status}${delivery.acknowledgedAt ? ' / acknowledged' : ''}` : 'No delivery attempts recorded', observedAt: iso(delivery?.updatedAt) });
  }
  res.json({ rows, updatedAt: new Date().toISOString() });
});
