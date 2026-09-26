import type { Request, Response } from 'express'
import { getReportDetail } from '../services/reports.service'

type AuthorizedReport = { id: string; radiologistId: string | null; aiReportJson: unknown; editedReportJson: unknown }

export type ReportAccess = {
  /** Existing authorization helper: throws an Error with `status` when the caller may not open the report. */
  getAuthorizedReport: (req: Request) => Promise<AuthorizedReport>
  /** Radiologist-only visibility rule the dashboard list applies (preferred radiologist). */
  canRadiologistSeeReport: (req: Request, report: AuthorizedReport) => Promise<boolean>
}

export function reportsController(access: ReportAccess) {
  return {
    async detail(req: Request, res: Response) {
      res.setHeader('Cache-Control', 'private, no-store')
      try {
        const report = await access.getAuthorizedReport(req)
        if (req.user?.role === 'RADIOLOGIST' && !await access.canRadiologistSeeReport(req, report)) {
          return res.status(403).json({ message: 'Report is assigned to another radiologist' })
        }
        res.json(await getReportDetail(report))
      } catch (error) {
        const status = (error as Error & { status?: number }).status ?? 404
        res.status(status).json({ message: status === 404 ? 'Report is not available' : error instanceof Error ? error.message : 'Report is not available' })
      }
    },
  }
}
