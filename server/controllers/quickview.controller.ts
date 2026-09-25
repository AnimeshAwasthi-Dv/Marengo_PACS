import type { Request, RequestHandler, Response } from 'express'
import type { QuickViewKind, ViewerTarget } from '../models/quickview.model'
import { exportQuickViewStudy, getQuickViewManifest, getQuickViewPreview, openQuickViewInstance } from '../services/quickview.service'

export type ResolveViewerTarget = (kind: QuickViewKind, id: string, req: Request) => Promise<{ target: ViewerTarget }>

export const QUICKVIEW_KINDS: readonly QuickViewKind[] = ['bridge-study', 'job', 'report', 'radiologist-report', 'archive', 'public']

export function isQuickViewKind(value: string): value is QuickViewKind {
  return (QUICKVIEW_KINDS as readonly string[]).includes(value)
}

function sendError(res: Response, error: unknown) {
  const status = typeof (error as { status?: number }).status === 'number' ? (error as { status: number }).status : 500
  if (status === 500) console.error('QuickView request failed', error)
  if (!res.headersSent) res.status(status).json({ message: status === 500 ? 'Unable to load this study in QuickView' : (error as Error).message })
}

export function quickViewController(resolveTarget: ResolveViewerTarget, getManifest = getQuickViewManifest, openInstance = openQuickViewInstance, getPreview = getQuickViewPreview, exportStudy = exportQuickViewStudy) {
  const manifest: RequestHandler = async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store')
    try {
      const { target } = await resolveTarget(req.params.kind as QuickViewKind, String(req.params.id), req)
      const result = await getManifest(target)
      if (!result) return res.status(404).json({ message: 'This study cannot be shown in QuickView. Open it in the full viewer.' })
      res.json(result)
    } catch (error) {
      sendError(res, error)
    }
  }

  const instance: RequestHandler = async (req, res) => {
    try {
      const index = Number(req.params.index)
      if (!Number.isInteger(index) || index < 0) return res.status(400).json({ message: 'Invalid image index' })
      const { target } = await resolveTarget(req.params.kind as QuickViewKind, String(req.params.id), req)
      const opened = await openInstance(target, index)
      if (!opened) return res.status(404).json({ message: 'Image not found' })
      res.setHeader('Content-Type', 'application/dicom')
      res.setHeader('Content-Length', String(opened.sizeBytes))
      // Images never change for a given SOP instance; allow the browser to reuse them for the session.
      res.setHeader('Cache-Control', 'private, max-age=3600')
      res.setHeader('ETag', `"${opened.sopInstanceUid}"`)
      if (req.headers['if-none-match'] === `"${opened.sopInstanceUid}"`) {
        opened.stream.destroy()
        return res.status(304).end()
      }
      opened.stream.on('error', error => { sendError(res, error); res.destroy() })
      res.on('close', () => opened.stream.destroy())
      opened.stream.pipe(res)
    } catch (error) {
      sendError(res, error)
    }
  }

  const preview: RequestHandler = async (req, res) => {
    try {
      const index = Number(req.params.index)
      if (!Number.isInteger(index) || index < 0) return res.status(400).json({ message: 'Invalid image index' })
      const { target } = await resolveTarget(req.params.kind as QuickViewKind, String(req.params.id), req)
      const result = await getPreview(target, index)
      if (!result) return res.status(404).json({ message: 'Preview not available' })
      res.setHeader('Content-Type', 'image/jpeg')
      res.setHeader('Cache-Control', 'private, max-age=3600')
      res.setHeader('ETag', `"p-${result.sopInstanceUid}"`)
      if (req.headers['if-none-match'] === `"p-${result.sopInstanceUid}"`) return res.status(304).end()
      res.end(result.jpeg)
    } catch (error) {
      sendError(res, error)
    }
  }

  const exportZip: RequestHandler = async (req, res) => {
    try {
      const { target } = await resolveTarget(req.params.kind as QuickViewKind, String(req.params.id), req)
      const result = await exportStudy(target)
      if (!result) return res.status(404).json({ message: 'This study cannot be exported from QuickView' })
      res.setHeader('Content-Type', 'application/zip')
      res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`)
      res.setHeader('Cache-Control', 'private, no-store')
      result.stream.on('error', error => { sendError(res, error); res.destroy() })
      res.on('close', () => { if (!res.writableFinished) (result.stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.() })
      result.stream.pipe(res)
    } catch (error) {
      sendError(res, error)
    }
  }

  return { manifest, instance, preview, export: exportZip }
}
