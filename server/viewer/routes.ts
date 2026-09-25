import type { Express, Request, RequestHandler, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { externalViewerSession } from './externalViewer';
import type { QuickViewKind, ViewerTarget } from '../models/quickview.model';
import { decideViewerMode } from '../services/quickview.service';
import { registerQuickViewRoutes } from '../routers/quickview.router';

// Authorization remains in the existing domain services. Every entry point resolves an authorized
// ViewerTarget first; both the viewer session and the QuickView data endpoints use that same check.
type Dependencies = {
  prisma: PrismaClient;
  requireAuth: RequestHandler;
  requireRadiologist: RequestHandler;
  accessibleClientIds: (req: any) => Promise<string[] | null>;
  workspaceStudyScope: (req: any) => Promise<any>;
  getAccessibleProcessingJob: (id: string, user: any) => Promise<any>;
  extractQueuedMetadata: (value: any) => any;
  publicSharedReport: (token: string, requireViewer?: boolean) => Promise<any>;
  getAuthorizedReport: (req: any) => Promise<any>;
  canRadiologistAccessReport: (profile: any, report: any) => Promise<boolean>;
  isGroupRadiologistProfile: (profile: any) => Promise<boolean>;
  getDicomMetadataValue: (value: unknown, key: string) => string | null;
  createBridgeStudyViewerUrl?: (studyId: string, req: any) => Promise<string | null> | string | null;
  decideViewerMode?: typeof decideViewerMode;
};

type Resolved = { target: ViewerTarget; reportId?: string } | { status: number; message: string };

function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

function reportProcessingJobId(report: { aiReportJson?: unknown; editedReportJson?: unknown }) {
  for (const value of [report.aiReportJson, report.editedReportJson]) {
    const job = value && typeof value === 'object' ? (value as { processingJob?: { id?: unknown } }).processingJob : null;
    if (job && typeof job.id === 'string' && job.id) return job.id;
  }
  return null;
}

export function registerExternalViewerRoutes(app: Express, dependencies: Dependencies) {
  const { prisma, requireAuth, requireRadiologist, accessibleClientIds, workspaceStudyScope, getAccessibleProcessingJob, extractQueuedMetadata, publicSharedReport, getAuthorizedReport, canRadiologistAccessReport, isGroupRadiologistProfile, getDicomMetadataValue, createBridgeStudyViewerUrl } = dependencies;
  const decide = dependencies.decideViewerMode ?? decideViewerMode;

  function reportTarget(report: { id: string; clientId: string; studyUid?: string | null; modality?: string | null; aiReportJson?: unknown; editedReportJson?: unknown }): ViewerTarget {
    const studyInstanceUid = report.studyUid || getDicomMetadataValue(report.editedReportJson, 'studyInstanceUid') || getDicomMetadataValue(report.aiReportJson, 'studyInstanceUid');
    return { type: 'report', id: report.id, clientId: report.clientId, studyInstanceUid, modality: report.modality ?? null, processingJobId: reportProcessingJobId(report) };
  }

  const resolvers: Record<QuickViewKind, (id: string, req: Request) => Promise<Resolved>> = {
    archive: async (id, req) => {
      const archive = await prisma.patientStudyArchive.findUnique({ where: { id } });
      const ids = await accessibleClientIds(req);
      if (!archive || (ids !== null && !ids.includes(archive.clientId))) return { status: 404, message: 'Archived study was not found' };
      return { target: { type: 'archive', id: archive.id, clientId: archive.clientId, studyInstanceUid: archive.studyInstanceUid, modality: archive.modality ?? null } };
    },
    'bridge-study': async (id, req) => {
      const study = await prisma.availableBridgeStudy.findFirst({ where: { id, ...await workspaceStudyScope(req) } });
      if (!study) return { status: 404, message: 'Study not found' };
      return { target: { type: 'bridge-study', id: study.id, clientId: study.clientId, studyInstanceUid: study.studyInstanceUid } };
    },
    public: async (token) => {
      const report = await publicSharedReport(token, true);
      if (!report) return { status: 404, message: 'This shared report link is invalid or no longer available.' };
      return { target: reportTarget(report), reportId: report.id };
    },
    job: async (id, req) => {
      const job = await getAccessibleProcessingJob(id, req.user!);
      if (!job) return { status: 404, message: 'Study was not found' };
      const metadata = extractQueuedMetadata(job.upstreamStatus);
      return { target: { type: 'job', id: job.id, clientId: job.clientId, studyInstanceUid: metadata.studyInstanceUid ?? null, modality: metadata.modality ?? null } };
    },
    report: async (id, req) => {
      // getAuthorizedReport reads req.params.reportId, so give it a view of the request with that param.
      const report = await getAuthorizedReport(Object.assign(Object.create(req), { params: { ...req.params, reportId: id } }));
      return { target: reportTarget(report), reportId: report.id };
    },
    'radiologist-report': async (id, req) => {
      const profile = await prisma.radiologistProfile.findUniqueOrThrow({ where: { userId: req.user!.sub } });
      const report = await prisma.reportReview.findUniqueOrThrow({ where: { id } });
      if (!(await canRadiologistAccessReport(profile, report)) || (!(await isGroupRadiologistProfile(profile)) && report.radiologistId && report.radiologistId !== profile.id)) return { status: 403, message: 'Report cannot be opened' };
      return { target: reportTarget(report), reportId: report.id };
    },
  };

  async function resolveTarget(kind: QuickViewKind, id: string, req: Request) {
    const resolved = await resolvers[kind](id, req);
    if ('status' in resolved) throw httpError(resolved.status, resolved.message);
    return resolved;
  }

  function sendError(res: Response, error: unknown) {
    const status = typeof (error as { status?: number }).status === 'number' ? (error as { status: number }).status : 503;
    res.status(status).json({ enabled: false, message: status === 503 ? 'Unable to open the external viewer' : (error as Error).message });
  }

  /** Picks QuickView for small 2D studies; otherwise the existing external viewer flow runs unchanged. */
  function viewerSession(kind: QuickViewKind, param: string, external: (resolved: { target: ViewerTarget; reportId?: string }, req: Request) => Promise<Record<string, unknown>>): RequestHandler {
    return async (req, res) => {
      res.setHeader('Cache-Control', 'private, no-store');
      try {
        const id = String(req.params[param]);
        const resolved = await resolveTarget(kind, id, req);
        const decision = await decide(resolved.target, req.query.viewer === 'full');
        if (decision.mode === 'quick') {
          return res.json({ enabled: true, mode: 'quick', quickViewUrl: `/api/quickview/${kind}/${encodeURIComponent(id)}`, studyInstanceUid: resolved.target.studyInstanceUid });
        }
        res.json({ ...await external(resolved, req), mode: 'external' });
      } catch (error) {
        sendError(res, error);
      }
    };
  }

  // Prefer the linked bridge study viewer import when one exists; otherwise use the URL template.
  async function sessionForUid(studyInstanceUid: string | null | undefined, clientId: string, req: Request, reportId?: string) {
    if (createBridgeStudyViewerUrl && studyInstanceUid) {
      const linked = await prisma.availableBridgeStudy.findFirst({ where: { clientId, studyInstanceUid }, select: { id: true } });
      if (linked) { const viewerUrl = await createBridgeStudyViewerUrl(linked.id, req); if (viewerUrl) return { enabled: true, viewerUrl, studyInstanceUid }; }
    }
    return externalViewerSession({ studyInstanceUid, reportId });
  }

  const templateSession = async ({ target, reportId }: { target: ViewerTarget; reportId?: string }, req: Request) =>
    sessionForUid(target.studyInstanceUid, target.clientId, req, reportId);

  app.get('/api/patient-study-archives/:archiveId/viewer-session', requireAuth, viewerSession('archive', 'archiveId', templateSession));

  app.get('/api/client/study-sync/available-studies/:studyId/viewer-session', requireAuth, viewerSession('bridge-study', 'studyId', async ({ target }, req) => {
    if (createBridgeStudyViewerUrl) {
      const viewerUrl = await createBridgeStudyViewerUrl(target.id, req);
      if (!viewerUrl) return { enabled: false, message: 'The study record exists, but its original DICOM archive could not be found in configured storage. Restore or re-upload the original study archive to open images.' };
      return { enabled: true, viewerUrl, studyInstanceUid: target.studyInstanceUid };
    }
    return externalViewerSession({ studyInstanceUid: target.studyInstanceUid });
  }));

  app.get('/api/public/reports/:token/viewer-session', viewerSession('public', 'token', templateSession));

  app.get('/api/processing-jobs/:jobId/viewer-session', requireAuth, viewerSession('job', 'jobId', templateSession));

  app.get('/api/reports/:reportId/viewer-session', requireAuth, viewerSession('report', 'reportId', templateSession));

  app.get('/api/radiologist/reports/:reportId/viewer-session', requireAuth, requireRadiologist, viewerSession('radiologist-report', 'reportId', templateSession));

  registerQuickViewRoutes(app, { requireAuth, requireRadiologist, resolveTarget });
}
