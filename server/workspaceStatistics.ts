const DAY = 86400000;
const IST_OFFSET = 19800000;
export const istDay = (value: Date | string) => new Date(new Date(value).getTime() + IST_OFFSET).toISOString().slice(0, 10);
export const istTimestamp = (value: string | null) => value ? new Date(new Date(value).getTime() + IST_OFFSET).toISOString().slice(0, 19).replace('T', ' ') + ' IST' : '';

export function statisticsRange(from?: string, to?: string, now = new Date()) {
  const endDay = to || istDay(now);
  const startDay = from || istDay(new Date(now.getTime() - 6 * DAY));
  for (const day of [startDay, endDay]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day) throw new Error('Use valid YYYY-MM-DD dates.');
  }
  const start = new Date(`${startDay}T00:00:00+05:30`);
  const end = new Date(new Date(`${endDay}T00:00:00+05:30`).getTime() + DAY);
  if (end <= start || end.getTime() - start.getTime() > 366 * DAY) throw new Error('Select a date range of 1 to 366 days.');
  return { start, end, from: startDay, to: endDay };
}

export type StatisticsRow = {
  id: string; clientId: string; center: string; patient: string; patientId: string; accession: string;
  modality: string; description: string; studyUid: string | null; jobId: string | null; demo: boolean;
  received: string | null; processed: string | null; reported: string | null; tatSeconds: number | null;
};

export function durationSeconds(start: string | null, end: string | null) {
  if (!start || !end) return null;
  const duration = (Date.parse(end) - Date.parse(start)) / 1000;
  return Number.isFinite(duration) && duration >= 0 ? Math.floor(duration) : null;
}

export function summarizeStudies(rows: StatisticsRow[], reports: { at: string }[], range: ReturnType<typeof statisticsRange>) {
  const daily = new Map<string, { day: string; received: number; processed: number; reported: number }>();
  for (let t = range.start.getTime(); t < range.end.getTime(); t += DAY) {
    const day = istDay(new Date(t)); daily.set(day, { day, received: 0, processed: 0, reported: 0 });
  }
  const inRange = (at: string | null) => at && Date.parse(at) >= +range.start && Date.parse(at) < +range.end;
  const durations: number[] = [];
  for (const row of rows) {
    if (inRange(row.received)) daily.get(istDay(row.received!))!.received++;
    if (inRange(row.processed)) daily.get(istDay(row.processed!))!.processed++;
    if (inRange(row.reported) && row.tatSeconds !== null) durations.push(row.tatSeconds);
  }
  for (const report of reports) if (inRange(report.at)) daily.get(istDay(report.at))!.reported++;
  const days = [...daily.values()];
  return {
    daily: days,
    totals: { received: days.reduce((s, d) => s + d.received, 0), processed: days.reduce((s, d) => s + d.processed, 0), reported: days.reduce((s, d) => s + d.reported, 0),
      averageTatSeconds: durations.length ? Math.round(durations.reduce((s, n) => s + n, 0) / durations.length) : null, tatSampleSize: durations.length },
  };
}

export function csvDocument(rows: unknown[][]) {
  const cell = (value: unknown) => {
    let text = value == null ? '' : String(value);
    if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n');
}
