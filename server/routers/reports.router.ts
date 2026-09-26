import type { Express, RequestHandler } from 'express'
import { reportsController, type ReportAccess } from '../controllers/reports.controller'

type Dependencies = ReportAccess & { requireAuth: RequestHandler }

/** Report detail for every role: list payloads carry only a JSON summary, this returns the full report. */
export function registerReportRoutes(app: Express, { requireAuth, ...access }: Dependencies) {
  const controller = reportsController(access)
  app.get('/api/reports/:reportId', requireAuth, controller.detail)
}
