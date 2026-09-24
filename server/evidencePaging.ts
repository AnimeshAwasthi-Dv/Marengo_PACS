import { Prisma } from '@prisma/client';
import { prisma } from './db';

// Page identifiers in PostgreSQL before loading/redacting the larger payloads.
export async function evidencePage(start: Date, end: Date, page: number, source: string, query: string) {
  const definitions = [
    ['audit_logs', 'createdAt', "'Audit log'", 'audit'],
    ['job_status_history', 'createdAt', 't."sourceSystem"', 'history'],
    ['provider_api_requests', 'createdAt', "'Renewist ' || t.direction", 'request'],
    ['provider_report_submissions', 'receivedAt', "'Renewist report submission'", 'submission'],
    ['pacs_return_jobs', 'updatedAt', "'PACS delivery snapshot'", 'delivery'],
    ['report_versions', 'createdAt', "'Report version'", 'version'],
    ['report_audit_logs', 'createdAt', "'Report audit'", 'reportAudit'],
  ];
  const union = Prisma.join(definitions.map(([table, date, label, kind]) => Prisma.sql`
    SELECT t.id, t.${Prisma.raw('"' + date + '"')} AS at, ${kind}::text AS kind, ${Prisma.raw(label)} AS source
    FROM ${Prisma.raw('"' + table + '"')} t
    WHERE t.${Prisma.raw('"' + date + '"')} >= ${start} AND t.${Prisma.raw('"' + date + '"')} < ${end}
      AND (${source} = '' OR ${Prisma.raw(label)} = ${source})
      AND (${query} = '' OR to_jsonb(t)::text ILIKE ${'%' + query.replace(/[\\%_]/g, '\\$&') + '%'})
  `), ' UNION ALL ');
  const rows = await prisma.$queryRaw<{ id: string; kind: string; source: string; total: bigint }[]>(Prisma.sql`
    SELECT *, count(*) OVER() AS total FROM (${union}) evidence ORDER BY at DESC, id ASC, kind ASC LIMIT 50 OFFSET ${(page - 1) * 50}
  `);
  return { rows, total: Number(rows[0]?.total ?? 0), ids: (kind: string) => rows.filter(row => row.kind === kind).map(row => row.id) };
}
