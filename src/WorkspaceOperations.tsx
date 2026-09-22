import { useState } from 'react';
import { Activity, BarChart3, CalendarDays, ChevronLeft, ChevronRight, Download, RefreshCw } from 'lucide-react';
import { BarChart, Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLiveRefresh } from './useLiveRefresh';

type StudyRow = {
  id: string; center: string; patient: string; patientId: string; accession: string; modality: string; description: string;
  received: string | null; processed: string | null; reported: string | null; tatSeconds: number | null; demo: boolean;
  service?: string; units?: number | null; amountMinor?: number | null; currency?: string; billingStatus?: string; invoice?: string;
};
type Statistics = {
  rows: StudyRow[]; daily: { day: string; received: number; processed: number; reported: number }[];
  totals: { received: number; processed: number; reported: number; averageTatSeconds: number | null; tatSampleSize: number };
  total: number; page: number; pageSize: number; centers: { id: string; name: string }[]; charges: { currency: string; amountMinor: number }[];
  unrecorded: number; updatedAt: string;
};
const istDay = (date: Date) => new Date(+date + 19800000).toISOString().slice(0, 10);
const timestamp = (value: string | null) => value ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value)) : '-';
const duration = (seconds: number | null) => seconds === null ? '-' : `${Math.floor(seconds / 3600).toString().padStart(2, '0')}:${Math.floor(seconds / 60 % 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
const money = (amount: number, currency: string) => new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(amount / 100);

async function request<T>(path: string, token: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` }, signal, cache: 'no-store' });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.message || 'Unable to load this view.');
  return data as T;
}

export function WorkspaceStatistics({ token, mode }: { token: string; mode: 'analytics' | 'billing' }) {
  const [from, setFrom] = useState(istDay(new Date(Date.now() - 6 * 86400000)));
  const [to, setTo] = useState(istDay(new Date()));
  const [centerId, setCenterId] = useState('');
  const [page, setPage] = useState(1);
  const [preset, setPreset] = useState('7');
  const [view, setView] = useState<'studies' | 'daily'>('studies');
  const [result, setResult] = useState<{ key: string; data: Statistics } | null>(null);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const query = new URLSearchParams({ from, to, centerId, page: String(page) }).toString();
  const key = `${mode}?${query}`;
  const data = result?.key === key ? result.data : null;
  useLiveRefresh(async signal => {
    try {
      const data = await request<Statistics>(`/api/workspace/${key}`, token, signal);
      if (!signal.aborted) { setResult({ key, data }); setError(''); }
    } catch (err) { if (!signal.aborted) setError(err instanceof Error ? err.message : 'Automatic updates interrupted.'); throw err; }
  }, { refreshKey: `${key}:${refresh}`, intervalMs: 15000, enabled: Boolean(from && to) });
  async function download(type: 'studies' | 'daily' = 'studies', exportMode = mode) {
    setDownloading(true); setError('');
    try {
      const response = await fetch(`/api/workspace/${exportMode}?${query}&format=csv&export=${type}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error((await response.json()).message || 'Export failed.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = `marengo-${exportMode}-${type}-${from}-${to}.csv`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setError(err instanceof Error ? err.message : 'Export failed.'); }
    finally { setDownloading(false); }
  }
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return <>
    <header className="pw-heading"><div><div className="pw-breadcrumb">{mode === 'analytics' ? 'Operations / Analytics' : 'Management / Billing'}</div><h1>{mode === 'analytics' ? 'Study analytics' : 'Billing & usage'}</h1></div><button aria-label="Refresh statistics" title="Refresh statistics" onClick={() => setRefresh(n => n + 1)}><RefreshCw size={15}/>Refresh</button></header>
    <div className="pw-toolbar pw-stats-toolbar"><label><CalendarDays size={15}/>From <input aria-label="From date IST" type="date" value={from} max={to} onChange={e => { setFrom(e.target.value); setPreset('custom'); setPage(1); }}/></label><label>To <input aria-label="To date IST" type="date" value={to} min={from} onChange={e => { setTo(e.target.value); setPreset('custom'); setPage(1); }}/><span>IST</span></label>
      <select aria-label="Statistics date preset" value={preset} onChange={e => { setPreset(e.target.value); const days = Number(e.target.value); setFrom(istDay(new Date(Date.now() - (days - 1) * 86400000))); setTo(istDay(new Date())); setPage(1); }}><option value="custom" disabled>Custom range</option><option value="1">Today</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select>
      {(result?.data.centers.length ?? 0) > 1 && <select aria-label="Statistics center" value={centerId} onChange={e => { setCenterId(e.target.value); setPage(1); }}><option value="">All linked centers</option>{result?.data.centers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
      <div className="pw-stats-exports"><button disabled={!data || downloading} onClick={() => void download('studies')}><Download size={15}/>{mode === 'billing' ? 'Billing CSV' : 'Study TAT CSV'}</button><button disabled={!data || downloading} onClick={() => void download('daily', 'analytics')}><Download size={15}/>{mode === 'billing' ? 'Usage CSV' : 'Daily totals CSV'}</button></div>
    </div>
    {error && <div className="pw-alert" role="alert">{error}{data && ' Showing the last received data.'}</div>}
    {!data ? <div className="pw-empty" role="status">{error ? 'Statistics unavailable for this selection.' : 'Loading statistics...'}</div> : <>
      <section className="pw-metric-strip" aria-label="Period totals"><div><span>Received studies</span><strong>{data.totals.received.toLocaleString()}</strong></div><div><span>Processed studies</span><strong>{data.totals.processed.toLocaleString()}</strong></div><div><span>Finalized reports</span><strong>{data.totals.reported.toLocaleString()}</strong></div><div><span>Average TAT</span><strong>{duration(data.totals.averageTatSeconds)}</strong><small>{data.totals.tatSampleSize} completed studies</small></div>{mode === 'billing' && <div><span>Recorded charges</span><strong className="pw-charge-total">{data.charges.length ? data.charges.map(c => money(c.amountMinor, c.currency)).join(' / ') : '-'}</strong><small>{data.unrecorded} studies without a billing record</small></div>}</section>
      {mode === 'analytics' && <div className="pw-stats-switch" role="tablist" aria-label="Analytics view"><button role="tab" aria-selected={view === 'studies'} className={view === 'studies' ? 'active' : ''} onClick={() => setView('studies')}>Study TAT</button><button role="tab" aria-selected={view === 'daily'} className={view === 'daily' ? 'active' : ''} onClick={() => setView('daily')}><BarChart3 size={15}/>Daily activity</button></div>}
      {mode === 'analytics' && view === 'daily' ? <div className="pw-stats-scroll"><div className="pw-chart-legend"><span><i style={{ background: '#75a5ef' }}/>Received</span><span><i style={{ background: '#d8b778' }}/>Processed</span><span><i style={{ background: '#66c4ac' }}/>Reported</span></div><div className="pw-stats-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.daily} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}><CartesianGrid stroke="#343b46" vertical={false}/><XAxis dataKey="day" tick={{ fill: '#a1aab9', fontSize: 11 }} tickFormatter={day => String(day).slice(5)}/><YAxis allowDecimals={false} tick={{ fill: '#a1aab9', fontSize: 11 }}/><Tooltip contentStyle={{ background: '#252b34', border: '1px solid #485465', color: '#edf0f5' }}/><Bar dataKey="received" fill="#75a5ef" name="Received" isAnimationActive={false}/><Bar dataKey="processed" fill="#d8b778" name="Processed" isAnimationActive={false}/><Bar dataKey="reported" fill="#66c4ac" name="Reported" isAnimationActive={false}/></BarChart></ResponsiveContainer></div><table className="pw-data-table pw-daily-table"><thead><tr><th>Date (IST)</th><th>Received</th><th>Processed</th><th>Reported</th></tr></thead><tbody>{data.daily.map(d => <tr key={d.day}><td>{d.day}</td><td>{d.received}</td><td>{d.processed}</td><td>{d.reported}</td></tr>)}</tbody></table></div>
      : <div className="pw-table-scroll"><table className="pw-data-table pw-stats-table"><thead><tr><th>Patient / ID</th><th>Center</th><th>Accession</th><th>Study</th>{mode === 'billing' ? <><th>Processed (IST)</th><th>Units</th><th>Amount</th><th>Billing status</th><th>Invoice</th></> : <><th>Received (IST)</th><th>Processed (IST)</th><th>Reported (IST)</th><th>TAT duration</th></>}</tr></thead><tbody>{data.rows.map(row => <tr key={row.id}><td><strong>{row.patient || '-'}</strong><small>{row.patientId || '-'}{row.demo ? ' / Demo' : ''}</small></td><td>{row.center}</td><td>{row.accession || '-'}</td><td>{row.description || row.modality || '-'}</td>{mode === 'billing' ? <><td>{timestamp(row.processed)}</td><td>{row.units ?? '-'}</td><td>{row.amountMinor != null && row.currency ? money(row.amountMinor, row.currency) : '-'}</td><td><span className={`pw-status ${row.billingStatus === 'NOT_RECORDED' ? 'available' : 'reported'}`}>{row.billingStatus?.replaceAll('_', ' ')}</span></td><td>{row.invoice || '-'}</td></> : <><td>{timestamp(row.received)}</td><td>{timestamp(row.processed)}</td><td>{timestamp(row.reported)}</td><td className="pw-duration">{duration(row.tatSeconds)}</td></>}</tr>)}{!data.rows.length && <tr><td colSpan={mode === 'billing' ? 9 : 8}><div className="pw-empty">No {mode === 'billing' ? 'processed studies' : 'study activity'} in this period</div></td></tr>}</tbody></table></div>}
      <footer className="pw-footer"><span>{data.total.toLocaleString()} {mode === 'billing' ? 'usage lines' : 'studies'}<span className="pw-updated">Updated {timestamp(data.updatedAt)} IST</span></span>{(mode === 'billing' || view === 'studies') && <div className="pw-pagination"><button aria-label="Previous statistics page" disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}><ChevronLeft size={16}/></button><span>{data.page} / {pages}</span><button aria-label="Next statistics page" disabled={data.page >= pages} onClick={() => setPage(data.page + 1)}><ChevronRight size={16}/></button></div>}</footer>
    </>}
  </>;
}

type Health = { rows: { id: string; service: string; center: string; status: string; detail: string; observedAt: string | null }[]; updatedAt: string };
export function WorkspaceHealthcheck({ token }: { token: string }) {
  const [data, setData] = useState<Health | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useLiveRefresh(async signal => {
    try { const result = await request<Health>('/api/workspace/healthcheck', token, signal); if (!signal.aborted) { setData(result); setError(''); } }
    catch (err) { if (!signal.aborted) setError(err instanceof Error ? err.message : 'Healthcheck unavailable.'); throw err; }
  }, { refreshKey: String(refresh), intervalMs: 15000 });
  return <><header className="pw-heading"><div><div className="pw-breadcrumb">Operations / Healthcheck</div><h1>Service health</h1></div><button onClick={() => setRefresh(n => n + 1)}><RefreshCw size={15}/>Refresh</button></header>{error && <div className="pw-alert" role="alert">{error}{data && ' Last observations are shown below.'}</div>}<div className="pw-table-scroll"><table className="pw-data-table pw-health-table"><thead><tr><th>Service</th><th>Center</th><th>Status</th><th>Observation</th><th>Observed (IST)</th></tr></thead><tbody>{data?.rows.map(row => <tr key={row.id}><td><span className="pw-service-name"><Activity size={16}/><strong>{row.service}</strong></span></td><td>{row.center}</td><td><span className={`pw-status ${row.status === 'Healthy' ? 'reported' : row.status === 'Needs attention' || row.status === 'Expired' ? 'failed' : 'available'}`}>{row.status}</span></td><td>{row.detail}</td><td>{timestamp(row.observedAt)}</td></tr>)}{!data && <tr><td colSpan={5}><div className="pw-empty">{error ? 'Healthcheck unavailable' : 'Checking services...'}</div></td></tr>}</tbody></table></div><footer className="pw-footer">{data ? `Last checked ${timestamp(data.updatedAt)} IST` : 'Connecting'}</footer></>;
}
