const istDate = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
const istTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

export function worklistPriority(value?: string | null) {
  return value?.trim().toUpperCase() === 'URGENT' ? 'URGENT' as const : 'REGULAR' as const;
}

export function worklistModality(value: string) {
  const code = value.trim().toUpperCase().replace(/[ _-]/g, '');
  if (['XR', 'XRAY', 'CR', 'DX'].includes(code)) return 'XR';
  if (code === 'MRI') return 'MR';
  if (code === 'NMR') return 'NM';
  return code;
}

export function worklistModalityLabel(code: string) {
  return code === 'XR' ? 'X-ray' : code === 'MR' ? 'MRI' : code === 'NM' ? 'Nuclear medicine' : code === 'SPECIALXRAY' ? 'Special x-ray' : code;
}

type FacetRow = { receivedAt?: string | null; study: { modalities?: string[] }; state: 'AVAILABLE' | 'REPORTING' | 'REPORTED'; priority: 'REGULAR' | 'URGENT'; needsAttention: boolean };

export function worklistFacets<T extends FacetRow>(rows: T[], range: 'ALL' | 'TODAY' | 'WEEK', modality: string, now: number) {
  const dayMs = 86400000;
  const offset = 19800000;
  const todayStart = Math.floor((now + offset) / dayMs) * dayMs - offset;
  const start = todayStart - (range === 'WEEK' ? 6 * dayMs : 0);
  const dateRows = rows.filter(row => {
    if (range === 'ALL') return true;
    const received = Date.parse(row.receivedAt ?? '');
    return received >= start && received < todayStart + dayMs;
  });
  const modalityCounts: Record<string, number> = {};
  for (const row of dateRows) for (const code of new Set((row.study.modalities ?? []).map(worklistModality).filter(Boolean))) modalityCounts[code] = (modalityCounts[code] ?? 0) + 1;
  const scopedRows = modality === 'ALL' ? dateRows : dateRows.filter(row => (row.study.modalities ?? []).some(code => worklistModality(code) === worklistModality(modality)));
  const counts = { ALL: scopedRows.length, AVAILABLE: 0, REPORTING: 0, REPORTED: 0, URGENT: 0, FAILED: 0 };
  for (const row of scopedRows) {
    counts[row.state]++;
    if (row.priority === 'URGENT') counts.URGENT++;
    if (row.needsAttention) counts.FAILED++;
  }
  return { scopedRows, counts, modalityCounts, receivedCount: dateRows.length };
}

export function istTimestamp(value?: string | null) {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return { date: '-', time: '', full: '-' };
  return { date: istDate.format(date), time: istTime.format(date), full: `${istDate.format(date)} ${istTime.format(date)} IST` };
}

export function worklistDuration(received?: string | null, processed?: string | null, now = Date.now()) {
  if (!received) return '-';
  const start = new Date(received).getTime();
  const end = processed ? new Date(processed).getTime() : now;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '-';
  const seconds = Math.floor((end - start) / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map((value) => String(value).padStart(2, '0')).join(':');
}

export function worklistStatus(input: { reportStatus?: string | null; workflowStatus: string; processingJobId?: string | null; submittedAt?: string | null }) {
  const workflow = input.workflowStatus.trim().toLowerCase().replace(/[ -]+/g, '_');
  if (['APPROVED', 'PUSHED'].includes(input.reportStatus ?? '') || ['reported', 'pacs_sent', 'sent_to_pacs', 'report_delivered'].includes(workflow)) return 'REPORTED' as const;
  if (input.processingJobId || input.submittedAt || /processing|radiology|renewist|submitted|queued/.test(workflow)) return 'REPORTING' as const;
  return 'AVAILABLE' as const;
}
