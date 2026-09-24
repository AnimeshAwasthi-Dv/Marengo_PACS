import { collectServiceHealth } from './serviceHealth';
import { Router } from 'express';
import { prisma } from './db';
import { requireAuth } from './auth';
import { marengoTariff } from './marengoTariff';
import { studyTracking } from './studyTracking';
import { setWorklistPriority } from './worklistPriority';
import { redisNamespace } from './redisCache';
import { requireWorkspaceCapability, workspaceAccess } from './workspaceAccess';
import { csvDocument, durationSeconds, istTimestamp, statisticsRange, summarizeStudies, type StatisticsRow } from './workspaceStatistics';
import { recordBillingEvent, repriceUninvoicedZeroBillingTransactions } from './billing';
import { serviceNameForType } from './uploadPipeline';

export const workspaceRouter = Router();
workspaceRouter.use(requireAuth);
workspaceRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
const MAX_ROWS = 50000;
const iso = (date?: Date | null) => date?.toISOString() ?? null;
const within = (date: string | null, range: ReturnType<typeof statisticsRange>) => date && Date.parse(date) >= +range.start && Date.parse(date) < +range.end;
const scoped = (ids: string[] | null) => ids === null ? {} : { clientId: { in: ids } };
const jsonObject = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const nested = (value: unknown, ...path: string[]) => path.reduce<unknown>((current, key) => jsonObject(current)[key], value);
const numberOrNull = (value: unknown) => {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
};
const textOrNull = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
type BillingTransactionRow = { id: string; processingJobId: string | null; clientId: string; serviceName: string; units: number; unitPriceMinor: number; amountMinor: number; currency: string; status: string; invoice: { invoiceNumber: string } | null };
const xrayBillableUnits = (serviceName: string | null | undefined, imageCount: number | null | undefined) => /x-?ray/i.test(serviceName ?? '') ? Math.max(1, imageCount || 1) : 1;

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

workspaceRouter.post('/studies/:studyId/terminate-processing', async (req, res, next) => {
  try {
    if (req.user!.role !== 'SUPER_ADMIN') return res.status(403).json({ message: 'Only super administrators can terminate processing.' });
    const reason = typeof req.body?.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim() : 'Super admin terminated processing for repush';
    const result = await prisma.$transaction(async tx => {
      const study = await tx.availableBridgeStudy.findUnique({ where: { id: String(req.params.studyId) }, include: { processingJob: true } });
      if (!study) throw Object.assign(new Error('Study not found.'), { status: 404 });
      if (!study.processingJobId || !study.processingJob) throw Object.assign(new Error('This study is not currently linked to a processing job.'), { status: 409 });
      const finalReport = await tx.reportReview.findFirst({ where: { clientId: study.clientId, studyUid: study.studyInstanceUid, status: { in: ['APPROVED', 'PUSHED'] } }, select: { id: true, status: true } });
      if (finalReport || /reportgenerated|reported|completed/i.test(study.workflowStatus)) throw Object.assign(new Error('Reported studies cannot be terminated for repush.'), { status: 409 });
      const previous = { workflowStatus: study.workflowStatus, submittedAt: study.submittedAt, processingJobId: study.processingJobId, jobStatus: study.processingJob.status, jobClinicalStatus: study.processingJob.clinicalStatus };
      await tx.processingJob.update({
        where: { id: study.processingJobId },
        data: {
          status: 'cancelled',
          clinicalStatus: 'CANCELLED',
          error: reason,
          completedAt: new Date(),
        },
      });
      await tx.availableBridgeStudy.update({
        where: { id: study.id },
        data: {
          processingJobId: null,
          workflowStatus: 'Available',
          selectedAt: null,
          submittedAt: null,
        },
      });
      await tx.providerJobMapping.updateMany({ where: { processingJobId: study.processingJobId }, data: { status: 'CANCELLED' } });
      await tx.jobStatusHistory.create({
        data: {
          processingJobId: study.processingJobId,
          actorUserId: req.user!.sub,
          sourceSystem: 'SUPER_ADMIN',
          previousStatus: study.processingJob.status,
          newStatus: 'cancelled',
          reason,
          technicalDetails: { studyId: study.id, previous, next: { workflowStatus: 'Available', processingJobId: null }, repushAllowed: true },
        },
      });
      await tx.auditLog.create({
        data: {
          clientId: study.clientId,
          actorUserId: req.user!.sub,
          action: 'SUPER_ADMIN_PROCESSING_TERMINATED_FOR_REPUSH',
          metadata: { studyId: study.id, publicStudyId: study.publicStudyId, processingJobId: study.processingJobId, previous, reason },
        },
      });
      return { studyId: study.id, previousProcessingJobId: study.processingJobId };
    }, { isolationLevel: 'Serializable' });
    res.json({ ...result, status: 'Available', message: 'Processing terminated. The study can now be sent for reporting again.' });
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) return res.status(Number(error.status)).json({ message: (error as Error).message });
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

async function collectStatistics(clientIds: string[] | null, range: ReturnType<typeof statisticsRange>, basis: 'activity' | 'received' = 'activity') {
  const scope = scoped(clientIds);
  const period = { gte: range.start, lt: range.end };
  const reportSelect = { id: true, clientId: true, studyUid: true, approvedAt: true, pushedAt: true, generatedAt: true, patientName: true, patientId: true, accession: true, modality: true, serviceName: true, editedReportJson: true, client: { select: { name: true } } } as const;
  const periodReports = await prisma.reportReview.findMany({ where: { ...scope, status: { in: ['APPROVED', 'PUSHED'] }, OR: [{ approvedAt: period }, { approvedAt: null, pushedAt: period }, { approvedAt: null, pushedAt: null, generatedAt: period }] }, select: reportSelect, take: MAX_ROWS + 1 });
  const studies = await prisma.availableBridgeStudy.findMany({
    where: { ...scope, OR: [{ firstDetectedAt: period }, { firstDetectedAt: null, createdAt: period }, { processingJob: { completedAt: period } }, { studyInstanceUid: { in: periodReports.flatMap(r => r.studyUid ? [r.studyUid] : []) } }] },
    select: { id: true, clientId: true, studyInstanceUid: true, patientName: true, patientId: true, accessionNumber: true, modalities: true, studyDescription: true, firstDetectedAt: true, createdAt: true, submittedAt: true,
      client: { select: { name: true } }, processingJob: { select: { id: true, completedAt: true, status: true, demoMode: true, serviceType: true, workflowType: true, priority: true, imageCount: true } } }, take: MAX_ROWS + 1,
  });
  const finalReports = studies.length ? await prisma.reportReview.findMany({ where: { ...scope, status: { in: ['APPROVED', 'PUSHED'] }, studyUid: { in: studies.map(s => s.studyInstanceUid) } }, select: reportSelect, take: MAX_ROWS + 1, orderBy: { generatedAt: 'desc' } }) : [];
  const jobs = await prisma.processingJob.findMany({ where: { ...scope, bridgeStudy: null, OR: [{ createdAt: period }, { completedAt: period }] }, select: { id: true, clientId: true, serviceType: true, workflowType: true, priority: true, imageCount: true, createdAt: true, completedAt: true, status: true, demoMode: true, client: { select: { name: true } }, patient: { select: { name: true, patientIdentifier: true } } }, take: MAX_ROWS + 1 });
  if ([periodReports, studies, finalReports, jobs].some(rows => rows.length > MAX_ROWS)) throw Object.assign(new Error('Too many records. Please select a shorter date range.'), { status: 422 });
  const reportMap = new Map<string, typeof finalReports[number]>();
  for (const report of [...finalReports, ...periodReports]) {
    const key = `${report.clientId}:${report.studyUid}`;
    if (report.studyUid && !reportMap.has(key)) reportMap.set(key, report);
  }
  const reportIds = [...new Set([...finalReports, ...periodReports].map(r => r.id))];
  const submissionAndAuditRows = reportIds.length ? await Promise.all([
    prisma.providerReportSubmission.findMany({ where: { reportReviewId: { in: reportIds } }, select: { reportReviewId: true, metadata: true, processedAt: true, reportVersion: true }, orderBy: { processedAt: 'desc' }, take: MAX_ROWS + 1 }),
    prisma.reportAuditLog.findMany({ where: { reportId: { in: reportIds }, action: 'RENEWIST_REPORTED_REPORT_REPLACED' }, select: { reportId: true, createdAt: true, metadata: true }, orderBy: { createdAt: 'asc' }, take: MAX_ROWS + 1 }),
  ]) : null;
  const submissions = submissionAndAuditRows?.[0] ?? [];
  const replacementAudits = submissionAndAuditRows?.[1] ?? [];
  const submissionMap = new Map<string, typeof submissions>();
  for (const submission of submissions) {
    const entries = submissionMap.get(submission.reportReviewId ?? '') ?? []; entries.push(submission); submissionMap.set(submission.reportReviewId ?? '', entries);
  }
  const replacementMap = new Map<string, typeof replacementAudits>();
  for (const audit of replacementAudits) {
    const entries = replacementMap.get(audit.reportId) ?? []; entries.push(audit); replacementMap.set(audit.reportId, entries);
  }
  const tbScore = (report?: typeof finalReports[number]) => {
    if (!report) return null;
    return numberOrNull(nested(report.editedReportJson, 'renewist', 'tbScore'))
      ?? numberOrNull(nested(report.editedReportJson, 'renewist', 'metadataJson', 'tb_score'))
      ?? numberOrNull(submissionMap.get(report.id)?.map(s => numberOrNull(nested(s.metadata, 'tbScore')) ?? numberOrNull(nested(s.metadata, 'metadataJson', 'tb_score'))).find(value => value !== null));
  };
  const replacementInfo = (report?: typeof finalReports[number]) => {
    const audits = report ? replacementMap.get(report.id) ?? [] : [];
    return {
      count: audits.length,
      history: audits.map((audit, index) => {
        const reason = textOrNull(nested(audit.metadata, 'reportedReplacement', 'updateReason')) ?? textOrNull(nested(audit.metadata, 'updateReason')) ?? textOrNull(nested(audit.metadata, 'replacement', 'reason')) ?? 'No reason supplied';
        return `${index + 1}. ${istTimestamp(audit.createdAt.toISOString())}: ${reason}`;
      }).join(' | '),
    };
  };
  // Only successful completions count as processed; failed attempts can have completedAt too.
  const processedAt = (job: { completedAt: Date | null; status: string } | null) => job && !/fail|error|cancel/i.test(job.status) ? iso(job.completedAt) : null;
  const rows: StatisticsRow[] = studies.map(study => {
    const report = reportMap.get(`${study.clientId}:${study.studyInstanceUid}`);
    const received = iso(study.firstDetectedAt ?? study.createdAt);
    const reported = report ? iso(report.approvedAt ?? report.pushedAt ?? report.generatedAt) : null;
    const replacement = replacementInfo(report);
    const billingServiceName = study.processingJob ? serviceNameForType(study.processingJob.serviceType) : null;
    return { id: study.id, clientId: study.clientId, center: study.client.name, patient: study.patientName ?? '', patientId: study.patientId ?? '', accession: study.accessionNumber ?? '', modality: study.modalities.join(', '), description: study.studyDescription ?? '', studyUid: study.studyInstanceUid, jobId: study.processingJob?.id ?? null, demo: study.processingJob?.demoMode ?? false,
      billingServiceName, billingUnits: xrayBillableUnits(billingServiceName, study.processingJob?.imageCount), workflowType: study.processingJob?.workflowType ?? null, priority: study.processingJob?.priority ?? null,
      received, processed: processedAt(study.processingJob), reported, tatSeconds: durationSeconds(iso(study.submittedAt), reported), tbScore: tbScore(report), replacementCount: replacement.count, replacementHistory: replacement.history };
  });
  for (const job of jobs) {
    const billingServiceName = serviceNameForType(job.serviceType);
    rows.push({ id: job.id, clientId: job.clientId, center: job.client.name, patient: job.patient?.name ?? '', patientId: job.patient?.patientIdentifier ?? '', accession: '', modality: '', description: job.serviceType, studyUid: null, jobId: job.id, demo: job.demoMode, billingServiceName, billingUnits: xrayBillableUnits(billingServiceName, job.imageCount), workflowType: job.workflowType ?? null, priority: job.priority ?? null, received: iso(job.createdAt), processed: processedAt(job), reported: null, tatSeconds: null });
  }
  const linked = new Set(rows.filter(r => r.studyUid).map(r => `${r.clientId}:${r.studyUid}`));
  for (const report of periodReports) if (!report.studyUid || !linked.has(`${report.clientId}:${report.studyUid}`)) {
    const replacement = replacementInfo(report);
    rows.push({ id: report.id, clientId: report.clientId, center: report.client.name, patient: report.patientName ?? '', patientId: report.patientId ?? '', accession: report.accession ?? '', modality: report.modality ?? '', description: report.serviceName, studyUid: report.studyUid, jobId: null, demo: false, received: null, processed: null, reported: iso(report.approvedAt ?? report.pushedAt ?? report.generatedAt), tatSeconds: null, tbScore: tbScore(report), replacementCount: replacement.count, replacementHistory: replacement.history });
    if (report.studyUid) linked.add(`${report.clientId}:${report.studyUid}`);
  }
  const periodRows = basis === 'received' ? rows.filter(row => within(row.received, range)) : rows.filter(row => within(row.received, range) || within(row.processed, range) || within(row.reported, range));
  periodRows.sort((a, b) => (b.received ?? b.reported ?? '').localeCompare(a.received ?? a.reported ?? ''));
  return { rows: periodRows, ...summarizeStudies(periodRows, periodReports.map(r => ({ at: iso(r.approvedAt ?? r.pushedAt ?? r.generatedAt)! })), range) };
}

workspaceRouter.get('/users', requireWorkspaceCapability('manageUsers'), async (req, res) => {
  const access: Awaited<ReturnType<typeof workspaceAccess>> = res.locals.workspaceAccess;
  const centers = await prisma.client.findMany({ where: { kind: 'CENTER', ...(access.clientIds === null ? {} : { id: { in: access.clientIds } }) }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  const users = await prisma.user.findMany({ where: { role: 'CLIENT_USER', clientId: { in: centers.map(c => c.id) } }, select: { id: true, userId: true, name: true, email: true, portalRole: true, role: true, active: true, clientId: true }, orderBy: { name: 'asc' } });
  res.json({ centers, users });
});

async function billingTransactionsForRows(clientIds: string[] | null, rows: StatisticsRow[]) {
  const jobIds = rows.flatMap(r => r.jobId ? [r.jobId] : []);
  if (!jobIds.length) return [];
  return prisma.studyBillingTransaction.findMany({ where: { ...scoped(clientIds), processingJobId: { in: jobIds } }, select: { id: true, processingJobId: true, clientId: true, serviceName: true, units: true, unitPriceMinor: true, amountMinor: true, currency: true, status: true, invoice: { select: { invoiceNumber: true } } } });
}

async function reconcileMissingBillingRows(clientIds: string[] | null, rows: StatisticsRow[], existing: BillingTransactionRow[]) {
  const billed = new Set(existing.flatMap(transaction => transaction.processingJobId ? [transaction.processingJobId] : []));
  const missing = rows.filter(row => row.jobId && row.processed && !row.demo && !billed.has(row.jobId));
  let transactions = existing;
  let repaired = 0;
  if (missing.length) {
    for (const row of missing) {
      if (!row.jobId) continue;
      try {
        await recordBillingEvent({
          clientId: row.clientId,
          processingJobId: row.jobId,
          studyId: row.id,
          serviceName: row.billingServiceName || row.description || 'Unknown study',
          workflowType: row.workflowType || 'AI_ONLY',
          units: Math.max(1, row.billingUnits ?? 1),
          studyUid: row.studyUid ?? undefined,
          modality: row.modality || undefined,
          priority: row.priority,
          assignedServiceName: row.description || row.billingServiceName || null,
        });
        repaired++;
      } catch (error) {
        console.error(`Billing reconciliation failed for job ${row.jobId}`, error);
      }
    }
    if (repaired) transactions = await billingTransactionsForRows(clientIds, rows);
  }
  const repriced = await repriceUninvoicedZeroBillingTransactions(rows.flatMap(row => row.jobId ? [row.jobId] : []));
  return repriced ? billingTransactionsForRows(clientIds, rows) : transactions;
}

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
    let result = await collectStatistics(ids, range, view === 'analytics' ? 'received' : 'activity');
    const modalities = [...new Set(result.rows.flatMap(row => row.modality.split(',').map(value => value.trim()).filter(Boolean)))].sort();
    const modality = String(req.query.modality ?? '').trim().toUpperCase();
    if (modality) {
      const rows = result.rows.filter(row => row.modality.split(',').some(value => value.trim().toUpperCase() === modality));
      result = { rows, ...summarizeStudies(rows, rows.flatMap(row => row.reported ? [{ at: row.reported }] : []), range) };
    }
    const centers = await prisma.client.findMany({ where: access.clientIds === null ? {} : { id: { in: access.clientIds } }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
    const processedRows = result.rows.filter(row => within(row.processed, range));
    const transactions = view === 'billing' ? await reconcileMissingBillingRows(ids, processedRows, await billingTransactionsForRows(ids, processedRows)) : [];
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
        ['Center', 'Patient', 'Patient ID', 'Accession', 'Modality', 'Study', 'Current status', 'Received IST', 'Processed IST', 'Reported IST', 'TAT seconds', 'TAT minutes', 'TB score', 'Report replaced', 'Replacement count', 'Replacement history', 'Demo'],
        ...result.rows.map(r => [r.center, r.patient, r.patientId, r.accession, r.modality, r.description, r.reported ? 'Reported' : r.processed ? 'Processed' : 'Available', istTimestamp(r.received), istTimestamp(r.processed), istTimestamp(r.reported), r.tatSeconds, r.tatSeconds === null ? '' : Math.round((r.tatSeconds / 60) * 100) / 100, r.tbScore ?? '', (r.replacementCount ?? 0) > 0 ? 'Yes' : 'No', r.replacementCount ?? 0, r.replacementHistory ?? '', r.demo]),
        [], ['Average TAT seconds', result.totals.averageTatSeconds], ['Average TAT minutes', result.totals.averageTatSeconds === null ? '' : Math.round((result.totals.averageTatSeconds / 60) * 100) / 100], ['Completed TAT sample', result.totals.tatSampleSize], ['Average TB score', result.totals.averageTbScore], ['TB score sample', result.totals.tbScoreSampleSize], ['Reports replaced after reported', result.totals.reportsReplaced],
      ];
      await prisma.auditLog.create({ data: { actorUserId: req.user!.sub, clientId: req.user!.clientId, action: `WORKSPACE_${view.toUpperCase()}_EXPORTED`, metadata: { from: range.from, to: range.to, records: data.length - 1 } } });
      return res.type('text/csv').attachment(`marengo-${view}-${range.from}-${range.to}.csv`).send(csvDocument(data));
    }
    const rows = view === 'billing' ? billingRows : result.rows;
    const page = Math.min(Math.max(1, Math.ceil(rows.length / 50)), Math.max(1, Number.parseInt(String(req.query.page ?? 1), 10) || 1));
    res.json({ ...result, modalities, tatDaily: result.daily.map(day => { const samples = result.rows.filter(row => row.reported && row.tatSeconds !== null && new Date(Date.parse(row.reported) + 19800000).toISOString().slice(0, 10) === day.day); return { day: day.day, minutes: samples.length ? samples.reduce((sum, row) => sum + row.tatSeconds!, 0) / samples.length / 60 : null, samples: samples.length }; }), rows: rows.slice((page - 1) * 50, page * 50), total: rows.length, page, pageSize: 50, centers, charges, unrecorded: billingRows.filter(r => r.billingStatus === 'NOT_RECORDED').length, from: range.from, to: range.to, updatedAt: new Date().toISOString() });
  } catch (error) {
    if (error instanceof Error && 'status' in error && error.status === 422) return res.status(422).json({ message: error.message });
    next(error);
  }
});

workspaceRouter.get('/healthcheck', requireWorkspaceCapability('healthcheck'), async (_req, res) => {
  const access: Awaited<ReturnType<typeof workspaceAccess>> = res.locals.workspaceAccess;
  res.json(await collectServiceHealth(access.clientIds));
});
