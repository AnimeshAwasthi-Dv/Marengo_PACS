import type { Prisma } from '@prisma/client'
import { formatBridgeStudyForAdmin, formatWorklistRow, type WorklistReport } from '../lib/bridgeStudyFormat'
import {
  findChangedStudyIds, findFullStudyPage, findReportsForStudies, findStudyDetail, findWorklistStudyPage, type StudyScope,
} from '../queries/worklist.queries'
import { coalesceWorklistRead, type WorklistQuery } from '../worklistQuery'

// Above this many changed studies an incremental refresh is no cheaper than a full one.
const CHANGE_LIMIT = 2000
// Rows written just before the previous `asOf` may commit after it; re-read a small overlap.
const SYNC_OVERLAP_MS = 5_000

/** Prefer the report from the study's own center, and a finalized report over a draft. */
export function reportsByStudy(reports: WorklistReport[]) {
  const byUid = new Map<string, WorklistReport[]>()
  for (const report of reports) {
    if (!report.studyUid) continue
    byUid.set(report.studyUid, [...(byUid.get(report.studyUid) ?? []), report])
  }
  return (study: { studyInstanceUid: string; clientId: string }) => {
    const matches = byUid.get(study.studyInstanceUid) ?? []
    const own = matches.filter(report => report.clientId === study.clientId)
    const pool = own.length ? own : matches
    return pool.find(report => report.status === 'APPROVED' || report.status === 'PUSHED') ?? pool[0] ?? null
  }
}

export function listStudies(scope: StudyScope, query: WorklistQuery) {
  return coalesceWorklistRead(JSON.stringify({ scope, query }), async () => {
    const asOf = new Date()
    const filters: Prisma.AvailableBridgeStudyWhereInput[] = []
    if (query.status) filters.push({ workflowStatus: query.status })
    if (query.modality) filters.push({ modalities: { has: query.modality } })
    if (query.q) {
      filters.push({
        OR: [
          { patientId: { contains: query.q, mode: 'insensitive' } },
          { patientName: { contains: query.q, mode: 'insensitive' } },
          { accessionNumber: { contains: query.q, mode: 'insensitive' } },
          { studyDescription: { contains: query.q, mode: 'insensitive' } },
        ],
      })
    }
    let resync = false
    if (query.updatedSince) {
      const since = new Date(query.updatedSince.getTime() - SYNC_OVERLAP_MS)
      // A study also counts as changed when its processing job or report changed.
      const changed = await findChangedStudyIds(scope, since, CHANGE_LIMIT)
      if (changed && !changed.length) return { studies: [], incremental: true, resync, asOf: asOf.toISOString(), nextCursor: null }
      resync = !changed
      filters.push(changed ? { id: { in: changed } } : { updatedAt: { gt: since } })
    } else if (!query.includeProcessed) {
      filters.push({ processingJobId: null })
    }
    const where: Prisma.AvailableBridgeStudyWhereInput = { ...scope, AND: filters }

    const page = <T extends { id: string }>(rows: T[]) => {
      const hasMore = rows.length > query.take
      const studies = hasMore ? rows.slice(0, query.take) : rows
      return { studies, nextCursor: hasMore ? studies.at(-1)?.id ?? null : null }
    }
    const base = { incremental: Boolean(query.updatedSince), resync, asOf: asOf.toISOString() }

    if (query.view === 'full') {
      const { studies, nextCursor } = page(await findFullStudyPage(where, query.cursor, query.take))
      return { ...base, studies: studies.map(formatBridgeStudyForAdmin), nextCursor }
    }
    const { studies, nextCursor } = page(await findWorklistStudyPage(where, query.cursor, query.take))
    const reportFor = reportsByStudy(await findReportsForStudies(scope, [...new Set(studies.map(study => study.studyInstanceUid))]))
    return { ...base, studies: studies.map(study => formatWorklistRow(study, reportFor(study))), nextCursor }
  })
}

export async function getStudyDetail(scope: StudyScope, studyId: string) {
  const study = await findStudyDetail(scope, studyId)
  return study ? formatBridgeStudyForAdmin(study) : null
}
