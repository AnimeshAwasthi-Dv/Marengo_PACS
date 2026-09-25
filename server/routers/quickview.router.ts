import type { Express, RequestHandler } from 'express'
import { isQuickViewKind, quickViewController, type ResolveViewerTarget } from '../controllers/quickview.controller'

type Dependencies = {
  requireAuth: RequestHandler
  requireRadiologist: RequestHandler
  resolveTarget: ResolveViewerTarget
}

/** QuickView data endpoints. Each kind uses the same guards as its viewer-session route. */
export function registerQuickViewRoutes(app: Express, { requireAuth, requireRadiologist, resolveTarget }: Dependencies) {
  const controller = quickViewController(resolveTarget)
  const guard: RequestHandler = (req, res, next) => {
    const kind = String(req.params.kind)
    if (!isQuickViewKind(kind)) return res.status(404).json({ message: 'API route not found' })
    if (kind === 'public') return next()
    return requireAuth(req, res, (error?: unknown) => {
      if (error) return next(error)
      if (kind === 'radiologist-report') return requireRadiologist(req, res, next)
      next()
    })
  }
  app.get('/api/quickview/:kind/:id/manifest', guard, controller.manifest)
  app.get('/api/quickview/:kind/:id/instances/:index', guard, controller.instance)
  app.get('/api/quickview/:kind/:id/instances/:index/preview', guard, controller.preview)
  app.get('/api/quickview/:kind/:id/export', guard, controller.export)
}
