import type { Request, Response } from 'express'
import { z } from 'zod'
import type { StudyScope } from '../queries/worklist.queries'
import { getStudyDetail, listStudies } from '../services/worklist.service'
import { parseWorklistQuery } from '../worklistQuery'

export type ResolveStudyScope = (req: Request) => Promise<StudyScope>

const studyParams = z.object({ studyId: z.string().min(1).max(64) })

function noStore(res: Response) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
}

export function worklistController(studyScope: ResolveStudyScope) {
  return {
    async list(req: Request, res: Response) {
      noStore(res)
      const query = parseWorklistQuery(req.query)
      res.json(await listStudies(await studyScope(req), query))
    },
    async detail(req: Request, res: Response) {
      res.setHeader('Cache-Control', 'private, no-store')
      const { studyId } = studyParams.parse(req.params)
      const study = await getStudyDetail(await studyScope(req), studyId)
      if (!study) return res.status(404).json({ message: 'Study was not found for this client' })
      res.json({ study })
    },
  }
}
