import { findReportDetailRelations, findReportJsonSummaries } from '../queries/reports.queries'

/**
 * Replace each list row's report JSON with a small summary (see `findReportJsonSummaries`).
 * Rows are marked `jsonPartial`; screens that show the report text fetch `GET /api/reports/:id`.
 * Pass rows loaded with `omit: reportListOmit`.
 */
export async function withReportSummaries<T extends { id: string }>(reports: T[]) {
  const summaries = await findReportJsonSummaries(reports.map(report => report.id))
  return reports.map(report => ({
    ...report,
    aiReportJson: summaries.get(report.id)?.aiReportJson ?? {},
    editedReportJson: summaries.get(report.id)?.editedReportJson ?? {},
    jsonPartial: true as const,
  }))
}

/** Full report for one already-authorized report, with the relations its detail views show. */
export async function getReportDetail<T extends { id: string }>(report: T) {
  const relations = await findReportDetailRelations(report.id)
  return { ...report, ...relations }
}
