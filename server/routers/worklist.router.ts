import type { Express, RequestHandler } from 'express'
import { worklistController, type ResolveStudyScope } from '../controllers/worklist.controller'

type Dependencies = {
  requireAuth: RequestHandler
  studyScope: ResolveStudyScope
}

/** Worklist data: slim paged rows (`view=worklist`), incremental refresh (`updatedSince`) and per-study detail. */
export function registerWorklistRoutes(app: Express, { requireAuth, studyScope }: Dependencies) {
  const controller = worklistController(studyScope)
  app.get('/api/client/study-sync/available-studies', requireAuth, controller.list)
  app.get('/api/client/study-sync/available-studies/:studyId', requireAuth, controller.detail)
}
