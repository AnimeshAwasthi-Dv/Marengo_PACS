import { Prisma } from '@prisma/client'
import { prisma } from '../db'

/** Columns and relations list views need on a report row, without the report JSON. */
export const reportListOmit = { aiReportJson: true, editedReportJson: true } as const
export const reportClientSelect = { id: true, name: true, code: true } as const
export const reportRadiologistSelect = { id: true, fullName: true, userId: true, clientId: true, providerCode: true } as const
export const activeCallBookingStatuses = ['REQUESTED', 'MANAGER_ACCEPTED', 'RADIOLOGIST_ACCEPTED', 'BOOKED']

export type ReportJsonSummary = { aiReportJson: Prisma.JsonObject; editedReportJson: Prisma.JsonObject }

// Builds, inside Postgres, a tiny copy of a report JSON column holding only the keys list
// views read: modality, processing job link, preferred radiologist and exam metadata.
// The full JSON (about 18 KB per report, mostly report HTML) never leaves the database.
export function reportJsonSummarySql(column: 'aiReportJson' | 'editedReportJson') {
  const c = Prisma.raw(`"${column}"`)
  return Prisma.sql`jsonb_strip_nulls(jsonb_build_object(
    'modality', ${c}->'modality',
    'processingJobId', ${c}->'processingJobId',
    'processingJob', jsonb_build_object('id', ${c}#>'{processingJob,id}'),
    'workflow', jsonb_build_object('preferredRadiologistId', ${c}#>'{workflow,preferredRadiologistId}'),
    'study', jsonb_build_object('dicomMetadata', jsonb_build_object(
      'modality', ${c}#>'{study,dicomMetadata,modality}',
      'studyDescription', ${c}#>'{study,dicomMetadata,studyDescription}',
      'bodyPartExamined', ${c}#>'{study,dicomMetadata,bodyPartExamined}',
      'protocolName', ${c}#>'{study,dicomMetadata,protocolName}'
    ))
  ))`
}

const SUMMARY_BATCH = 1000

export async function findReportJsonSummaries(reportIds: string[]) {
  const summaries = new Map<string, ReportJsonSummary>()
  const ids = [...new Set(reportIds)]
  for (let offset = 0; offset < ids.length; offset += SUMMARY_BATCH) {
    const batch = ids.slice(offset, offset + SUMMARY_BATCH)
    const rows = await prisma.$queryRaw<Array<{ id: string } & ReportJsonSummary>>(Prisma.sql`
      SELECT id, ${reportJsonSummarySql('aiReportJson')} AS "aiReportJson", ${reportJsonSummarySql('editedReportJson')} AS "editedReportJson"
      FROM report_reviews WHERE id IN (${Prisma.join(batch)})`)
    for (const row of rows) summaries.set(row.id, { aiReportJson: row.aiReportJson, editedReportJson: row.editedReportJson })
  }
  return summaries
}

/** Relations shown with a single opened report (the report itself comes from `getAuthorizedReport`). */
export function findReportDetailRelations(reportId: string) {
  return prisma.reportReview.findUnique({
    where: { id: reportId },
    select: {
      client: { select: reportClientSelect },
      radiologist: { select: reportRadiologistSelect },
      callBookings: { where: { status: { in: activeCallBookingStatuses } }, orderBy: { slotStart: 'asc' }, take: 5 },
    },
  })
}
