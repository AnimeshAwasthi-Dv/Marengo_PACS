import type { NextFunction, Request, Response } from 'express';

/**
 * One image runs as one of these roles (PROCESS_ROLE). `all` is the original single process.
 * - api:    portal and integration HTTP; no timers, receivers or study submission. Can run several copies.
 * - ingest: Bridge HTTP endpoints, DICOM receivers, inbound scan, Bridge upload sweeps. One copy (fixed ports,
 *           in-memory commit guards).
 * - worker: every other background process (submission, dispatch, PACS return, recovery, messaging, invoices,
 *           viewer pre-import, archive maintenance, technical monitor). One copy until a durable queue replaces
 *           the in-process submission limiter. Serves only /api/health.
 */
export type ProcessRole = 'all' | 'api' | 'ingest' | 'worker';

export function processRole(value = process.env.PROCESS_ROLE): ProcessRole {
  const role = value?.trim().toLowerCase() || 'all';
  if (role === 'all' || role === 'api' || role === 'ingest' || role === 'worker') return role;
  throw new Error(`Unknown PROCESS_ROLE "${value}". Use all, api, ingest or worker.`);
}

export const roleRunsIngest = (role: ProcessRole) => role === 'all' || role === 'ingest';
export const roleRunsWorkers = (role: ProcessRole) => role === 'all' || role === 'worker';

// Every Bridge agent path family, matched case-insensitively like Express routing.
const bridgePath = /^\/api\/v1\/(bridge|study-bridge|study-agents)(\/|$)/i;
const healthPath = /^\/api\/health(\/|$)/i;

export function isBridgePath(path: string) { return bridgePath.test(path); }

/** Which role serves a request path. Caddy routes the same way; this guard catches a misroute. */
export function roleServesPath(role: ProcessRole, path: string) {
  if (role === 'all' || healthPath.test(path)) return true;
  if (role === 'ingest') return isBridgePath(path);
  if (role === 'api') return !isBridgePath(path);
  return false;
}

export function processRoleGuard(role: ProcessRole) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (roleServesPath(role, req.path)) return next();
    // 503 + Retry-After: Bridge and other clients retry instead of treating the study as rejected.
    res.set('Retry-After', '30');
    return res.status(503).json({ error: { code: 'WRONG_SERVICE', message: `This ${role} service does not serve ${req.path}`, retryable: true } });
  };
}
