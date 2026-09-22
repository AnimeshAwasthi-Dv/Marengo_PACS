import type { Express, RequestHandler } from 'express';
import type { PrismaClient } from '@prisma/client';
import { externalViewerSession } from './externalViewer';

// Authorization remains in the existing domain services; this adapter never reads DICOM pixels.
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
};
export function registerExternalViewerRoutes(app: Express, dependencies: Dependencies) {
  const { prisma, requireAuth, requireRadiologist, accessibleClientIds, workspaceStudyScope, getAccessibleProcessingJob, extractQueuedMetadata, publicSharedReport, getAuthorizedReport, canRadiologistAccessReport, isGroupRadiologistProfile, getDicomMetadataValue } = dependencies;
app.get("/api/patient-study-archives/:archiveId/viewer-session", requireAuth, async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const archive = await prisma.patientStudyArchive.findUnique({ where: { id: String(req.params.archiveId) } });
    const ids = await accessibleClientIds(req);
    if (!archive || (ids !== null && !ids.includes(archive.clientId))) return res.status(404).json({ enabled: false, message: 'Archived study was not found' });
    res.json(externalViewerSession({ studyInstanceUid: archive.studyInstanceUid }));
  } catch (error) {
    const status = typeof (error as { status?: number }).status === 'number' ? (error as { status: number }).status : 503;
    res.status(status).json({ enabled: false, message: status === 503 ? 'Unable to open the external viewer' : (error as Error).message });
  }
});

app.get("/api/client/study-sync/available-studies/:studyId/viewer-session", requireAuth, async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const study = await prisma.availableBridgeStudy.findFirst({ where: { id: String(req.params.studyId), ...await workspaceStudyScope(req) } });
    if (!study) return res.status(404).json({ enabled: false, message: 'Study not found' });
    res.json(externalViewerSession({ studyInstanceUid: study.studyInstanceUid }));
  } catch (error) {
    const status = typeof (error as { status?: number }).status === 'number' ? (error as { status: number }).status : 503;
    res.status(status).json({ enabled: false, message: status === 503 ? 'Unable to open the external viewer' : (error as Error).message });
  }
});

app.get("/api/public/reports/:token/viewer-session", async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const report = await publicSharedReport(String(req.params.token), true);
    if (!report) return res.status(404).json({ enabled: false, message: 'This shared report link is invalid or no longer available.' });
    const studyInstanceUid = report.studyUid || getDicomMetadataValue(report.editedReportJson, 'studyInstanceUid') || getDicomMetadataValue(report.aiReportJson, 'studyInstanceUid');
    res.json(externalViewerSession({ studyInstanceUid, reportId: report.id }));
  } catch (error) {
    const status = typeof (error as { status?: number }).status === 'number' ? (error as { status: number }).status : 503;
    res.status(status).json({ enabled: false, message: status === 503 ? 'Unable to open the external viewer' : (error as Error).message });
  }
});

app.get("/api/processing-jobs/:jobId/viewer-session", requireAuth, async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const job = await getAccessibleProcessingJob(String(req.params.jobId), req.user!);
    if (!job) return res.status(404).json({ enabled: false, message: 'Study was not found' });
    const metadata = extractQueuedMetadata(job.upstreamStatus);
    res.json(externalViewerSession({ studyInstanceUid: metadata.studyInstanceUid }));
  } catch (error) {
    const status = typeof (error as { status?: number }).status === 'number' ? (error as { status: number }).status : 503;
    res.status(status).json({ enabled: false, message: status === 503 ? 'Unable to open the external viewer' : (error as Error).message });
  }
});

app.get("/api/reports/:reportId/viewer-session", requireAuth, async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const report = await getAuthorizedReport(req);
    const studyInstanceUid = report.studyUid || getDicomMetadataValue(report.editedReportJson, 'studyInstanceUid') || getDicomMetadataValue(report.aiReportJson, 'studyInstanceUid');
    res.json(externalViewerSession({ studyInstanceUid, reportId: report.id }));
  } catch (error) {
    const status = typeof (error as { status?: number }).status === 'number' ? (error as { status: number }).status : 503;
    res.status(status).json({ enabled: false, message: status === 503 ? 'Unable to open the external viewer' : (error as Error).message });
  }
});

app.get("/api/radiologist/reports/:reportId/viewer-session", requireAuth, requireRadiologist, async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const profile = await prisma.radiologistProfile.findUniqueOrThrow({ where: { userId: req.user!.sub } });
    const report = await prisma.reportReview.findUniqueOrThrow({ where: { id: String(req.params.reportId) } });
    if (!(await canRadiologistAccessReport(profile, report)) || (!(await isGroupRadiologistProfile(profile)) && report.radiologistId && report.radiologistId !== profile.id)) return res.status(403).json({ enabled: false, message: 'Report cannot be opened' });
    const studyInstanceUid = report.studyUid || getDicomMetadataValue(report.editedReportJson, 'studyInstanceUid') || getDicomMetadataValue(report.aiReportJson, 'studyInstanceUid');
    res.json(externalViewerSession({ studyInstanceUid, reportId: report.id }));
  } catch (error) {
    const status = typeof (error as { status?: number }).status === 'number' ? (error as { status: number }).status : 503;
    res.status(status).json({ enabled: false, message: status === 503 ? 'Unable to open the external viewer' : (error as Error).message });
  }
});
}
