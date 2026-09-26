import { useEffect, useState } from 'react';
import { loadFullReport } from './lib/fullReport';
import type { ReportReview } from './types/portal';

/** The full report (with its JSON) for a list row; `report` is null while it loads. */
export function useFullReport(report: ReportReview, token: string): { report: ReportReview | null; error: string } {
  const { id, updatedAt, jsonPartial } = report;
  const key = `${id}:${updatedAt}`;
  const [state, setState] = useState<{ key: string; report: ReportReview | null; error: string }>({ key: '', report: null, error: '' });
  useEffect(() => {
    if (!jsonPartial) return;
    let cancelled = false;
    loadFullReport({ id, updatedAt, jsonPartial }, token)
      .then((full) => { if (!cancelled) setState({ key, report: full as ReportReview, error: '' }); })
      .catch((error) => { if (!cancelled) setState({ key, report: null, error: error instanceof Error ? error.message : 'Report is not available.' }); });
    return () => { cancelled = true; };
  }, [id, updatedAt, jsonPartial, key, token]);
  if (!jsonPartial) return { report, error: '' };
  return state.key === key ? { report: state.report, error: state.error } : { report: null, error: '' };
}
