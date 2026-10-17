import type { PrismaClient } from '@prisma/client';
import type { RequestHandler } from 'express';
import { statisticsRange } from './workspaceStatistics';
import { studyAnalysisWorkbook } from './studyAnalysisWorkbook';

export const analysisModalities = ['X-Ray', 'CT', 'MRI'] as const;
export type AnalysisModality = typeof analysisModalities[number];
const thresholds: Record<AnalysisModality, number> = { 'X-Ray': 70, CT: 120, MRI: 180 };
const MAX_STUDIES = 50000;
type Center = { id: string; name: string; code: string; location: string | null; kind: string };
export type AnalysisStudy = {
  id: string; clientId: string; accessionNumber: string | null; studyInstanceUid: string | null;
  modalities: string[]; studyDescription: string | null; firstDetectedAt: Date | null;
  readyAt: Date | null; submittedAt: Date | null; createdAt: Date; updatedAt: Date;
  reportStatus: string | null; approvedAt: Date | null;
};
const finalized = (row: AnalysisStudy) => ['APPROVED', 'PUSHED', 'REPORTED'].includes(row.reportStatus?.trim().toUpperCase() ?? '');

export function classifyAnalysisModality(row: Pick<AnalysisStudy, 'modalities' | 'studyDescription'>): AnalysisModality | null {
  const codes = row.modalities.map(code => code.trim().toUpperCase()).filter(Boolean);
  if (codes.some(code => ['MR', 'MRI'].includes(code))) return 'MRI';
  if (codes.includes('CT')) return 'CT';
  if (codes.some(code => ['XR', 'CR', 'DX'].includes(code))) return 'X-Ray';
  if (codes.some(code => !['SC', 'SR', 'OT', 'PR', 'KO', 'DOC'].includes(code))) return null;
  const description = (row.studyDescription ?? '').toLowerCase();
  if (/\b(mri?|magnetic resonance)\b/.test(description)) return 'MRI';
  if (/\b(ct|computed tomography)\b/.test(description)) return 'CT';
  return ['x-ray', 'xray', 'x ray', 'radiograph'].some(term => description.includes(term)) ? 'X-Ray' : null;
}

// Python's round uses ties-to-even; keep the source report's displayed minute totals.
function roundEven(value: number) {
  const floor = Math.floor(value);
  return value - floor === 0.5 ? floor + floor % 2 : Math.round(value);
}

export function analysisMetrics(rows: AnalysisStudy[], modalities: readonly AnalysisModality[], technicalExemptions: ReadonlySet<string> = new Set()) {
  const unique = new Map<string, AnalysisStudy>();
  for (const row of rows) {
    if (!classifyAnalysisModality(row)) continue;
    const accession = row.accessionNumber?.trim().toUpperCase();
    const key = JSON.stringify([row.clientId, accession ? 'accession' : row.studyInstanceUid ? 'uid' : 'id', accession || row.studyInstanceUid || row.id]);
    const previous = unique.get(key);
    if (!previous) { unique.set(key, row); continue; }
    const preferNew = Number(finalized(row)) > Number(finalized(previous)) || (finalized(row) === finalized(previous) && +row.updatedAt > +previous.updatedAt);
    const [preferred, other] = preferNew ? [row, previous] : [previous, row];
    unique.set(key, { ...preferred, studyDescription: preferred.studyDescription || other.studyDescription, modalities: preferred.modalities.length ? preferred.modalities : other.modalities });
  }
  // Aggregate once instead of copying/filtering the full cohort for every selected modality.
  const totals = new Map(modalities.map(modality => [modality, { count: 0, onDuty: 0, breaches: 0, portable: 0, tatSum: 0, tatCount: 0 }]));
  for (const row of unique.values()) {
    if (!finalized(row)) continue;
    const modality = classifyAnalysisModality(row);
    const total = modality && totals.get(modality);
    if (!total) continue;
    total.count++;
    const received = row.firstDetectedAt ?? row.readyAt ?? row.submittedAt ?? row.createdAt;
    const local = new Date(+received + 19800000);
    const duty = local.getUTCHours() >= 9 && local.getUTCHours() < 18;
    if (duty) total.onDuty++;
    const description = (row.studyDescription ?? '').toLowerCase();
    if (modality === 'X-Ray' && ['portable', 'port xray', 'port x-ray', 'port x ray', 'bedside'].some(term => description.includes(term))) total.portable++;
    const elapsed = row.submittedAt && row.approvedAt ? +row.approvedAt - +row.submittedAt : null;
    if (elapsed !== null && elapsed >= 0) {
      total.tatSum += Math.round(elapsed / 600) / 100;
      total.tatCount++;
      if (duty && local.toISOString().slice(0, 10) >= '2026-09-28' && !technicalExemptions.has(row.accessionNumber?.trim() ?? '') && elapsed >= thresholds[modality] * 60000) total.breaches++;
    }
  }
  return modalities.map(modality => {
    const { count, onDuty, portable, breaches, tatSum, tatCount } = totals.get(modality)!;
    const average = tatCount ? roundEven(tatSum / tatCount) : null;
    const achieved = count - breaches;
    return {
      modality,
      values: [count, modality === 'X-Ray' ? portable : 'N/A', modality === 'X-Ray' ? count - portable : 'N/A',
        count - onDuty, onDuty, average === null ? 'N/A' : average >= 60 ? `${Math.floor(average / 60)}h ${average % 60}m` : `${average}m`,
        achieved, breaches, `${(count ? achieved / count * 100 : 0).toFixed(2)}%`],
    };
  });
}

export function parseAnalysisSelection(query: Record<string, unknown>) {
  if (typeof query.from !== 'string' || typeof query.to !== 'string' || !query.from || !query.to) throw new Error('Select both reporting dates.');
  const range = statisticsRange(query.from, query.to);
  if (typeof query.modalities !== 'string') throw new Error('Select at least one modality.');
  const requested = query.modalities.split(',');
  if (!requested.length || requested.some(value => !analysisModalities.includes(value as AnalysisModality))) throw new Error('Choose X-Ray, CT, or MRI.');
  return { range, modalities: analysisModalities.filter(value => requested.includes(value)) };
}

export function createStudyAnalysisHandler(db: Pick<PrismaClient, 'client' | '$queryRaw' | 'auditLog'>): RequestHandler {
  return async (req, res, next) => {
    try {
      // Never accept a tenant scope from the browser, including for group accounts.
      if (req.user?.role !== 'CLIENT_USER' || !req.user.clientId) return res.status(403).json({ message: 'This export requires a center account.' });
      const clientId = req.user.clientId;
      if ((req.query.centerId !== undefined && req.query.centerId !== clientId) || req.query.clientId !== undefined) return res.status(403).json({ message: 'You can only export your own center.' });
      const center: Center | null = await db.client.findUnique({ where: { id: clientId }, select: { id: true, name: true, code: true, location: true, kind: true } });
      if (!center || center.kind !== 'CENTER') return res.status(403).json({ message: 'This export requires a center account.' });
      let selection: ReturnType<typeof parseAnalysisSelection>;
      try { selection = parseAnalysisSelection(req.query); }
      catch (error) { return res.status(400).json({ message: (error as Error).message }); }
      const { range, modalities } = selection;
      // Match ana.py: receipt window, latest relevant report, and same-center joins.
      const rows = await db.$queryRaw<AnalysisStudy[]>`
        WITH candidates AS MATERIALIZED (
          SELECT s."id", s."clientId", s."accessionNumber", s."studyInstanceUid", s."modalities", s."studyDescription",
            s."firstDetectedAt", s."readyAt", s."submittedAt", s."createdAt", s."updatedAt"
          FROM "available_bridge_studies" s
          WHERE s."clientId" = ${clientId}
            AND COALESCE(s."firstDetectedAt", s."createdAt") >= ${range.start}
            AND COALESCE(s."firstDetectedAt", s."createdAt") < ${range.end}
          ORDER BY COALESCE(s."firstDetectedAt", s."createdAt") ASC, s."id" ASC
          LIMIT ${MAX_STUDIES + 1}
        )
        SELECT s."id", s."clientId", s."accessionNumber", s."studyInstanceUid", s."modalities", s."studyDescription",
          s."firstDetectedAt", s."readyAt", s."submittedAt", s."createdAt", s."updatedAt",
          r."status" AS "reportStatus", r."approvedAt"
        FROM candidates s
        LEFT JOIN LATERAL (
          SELECT r."status", r."approvedAt" FROM "report_reviews" r
          WHERE r."clientId" = s."clientId"
            AND (r."studyUid" = s."studyInstanceUid" OR (r."accession" IS NOT NULL AND s."accessionNumber" IS NOT NULL AND r."accession" = s."accessionNumber"))
          ORDER BY r."pushedAt" DESC NULLS LAST, r."approvedAt" DESC NULLS LAST, r."reviewedAt" DESC NULLS LAST,
            r."updatedAt" DESC NULLS LAST, r."createdAt" DESC NULLS LAST
          LIMIT 1
        ) r ON TRUE
        ORDER BY COALESCE(s."firstDetectedAt", s."createdAt") ASC, s."id" ASC
      `;
      if (rows.length > MAX_STUDIES) return res.status(422).json({ message: 'This period contains more than 50,000 studies. Select a shorter date range.' });
      // The source script's one-off technical exemption belongs to Ahmedabad only.
      const exemptions = /ahmedabad/i.test([center.name, center.code, center.location].join(' ')) ? new Set(['3275071']) : new Set<string>();
      const columns = analysisMetrics(rows, modalities, exemptions);
      const workbook = await studyAnalysisWorkbook({ center, range, columns, thresholds, hasTechnicalExemptions: exemptions.size > 0 });
      await db.auditLog.create({ data: { actorUserId: req.user.sub, clientId, action: 'WORKSPACE_STUDY_ANALYSIS_EXPORTED', metadata: { from: range.from, to: range.to, modalities, studies: columns.reduce((sum, column) => sum + Number(column.values[0]), 0) } } });
      res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .attachment(`marengo-study-analysis-${range.from}-to-${range.to}.xlsx`).send(workbook);
    } catch (error) { next(error); }
  };
}
