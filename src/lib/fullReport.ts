import { api } from './api';
import type { ReportReview } from '../types/portal';

// Dashboard lists carry only a summary of each report's JSON (`jsonPartial`).
// Screens that show report text load the full report here, once per report version.
const loaded = new Map<string, Promise<ReportReview>>();
const MAX_CACHED = 50;

type ReportRef = Pick<ReportReview, 'id' | 'updatedAt'> & { jsonPartial?: boolean };

export function loadFullReport<T extends ReportRef>(report: T, token: string): Promise<T | ReportReview> {
  if (!report.jsonPartial) return Promise.resolve(report);
  const key = `${report.id}:${report.updatedAt}`;
  let pending = loaded.get(key);
  if (!pending) {
    pending = api<ReportReview>(`/api/reports/${encodeURIComponent(report.id)}`, token, { cache: 'no-store' });
    pending.catch(() => loaded.delete(key));
    loaded.set(key, pending);
    if (loaded.size > MAX_CACHED) loaded.delete(loaded.keys().next().value!);
  }
  return pending;
}

/** HTML of the final (edited) report, falling back to the AI draft. */
export function reportHtml(report: Pick<ReportReview, 'aiReportJson' | 'editedReportJson'>, version: 'final' | 'initial' | 'best' = 'best') {
  const initial = report.aiReportJson?.htmlReport;
  const final = report.editedReportJson?.htmlReport;
  return String((version === 'initial' ? initial : version === 'final' ? final : final ?? initial) ?? '');
}

/**
 * Open report HTML in a new tab. The tab opens synchronously (inside the click) so popup
 * blockers allow it, and is filled once the full report has loaded.
 */
export async function openReportHtml(report: ReportRef, token: string, version: 'final' | 'initial' | 'best', onMissing: (message: string) => void) {
  const tab = window.open('', '_blank');
  try {
    const html = reportHtml(await loadFullReport(report, token) as ReportReview, version);
    if (!html) { tab?.close(); onMissing(`${version === 'initial' ? 'Initial' : 'Final'} report HTML is not available.`); return; }
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    if (tab) tab.location.href = url; else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    tab?.close();
    onMissing(error instanceof Error ? error.message : 'Report is not available.');
  }
}
