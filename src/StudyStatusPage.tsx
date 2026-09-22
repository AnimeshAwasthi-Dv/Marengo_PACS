import { useEffect, useState } from 'react';
import { ArrowLeft, Clock3, FileJson, LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import { useLiveRefresh } from './useLiveRefresh';
import './study-status.css';

type Tracking = {
  id: string; center: string; patientName: string | null; accession: string | null; modality: string; priority: string;
  status: string; processingStatus: string; startedAt: string; completedAt: string | null; targetSeconds: number | null; dueAt: string | null; serverTime: string;
  notification: { status: string; attempts: number; sentAt: string | null } | null;
  exchanges: { id: string; direction: string; at: string; httpStatus: number | null; body: unknown }[];
};
const timestamp = (value: string | null) => value ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value)) + ' IST' : '-';
const duration = (seconds: number) => {
  const total = Math.max(0, Math.floor(Math.abs(seconds)));
  return `${Math.floor(total / 3600).toString().padStart(2, '0')}:${Math.floor(total / 60 % 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
};

export function StudyStatusPage({ token, jobId, onLogout }: { token: string; jobId: string; onLogout: () => void }) {
  const [result, setResult] = useState<{ data: Tracking; fetchedAt: number } | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useLiveRefresh(async signal => {
    try {
      const response = await fetch(`/api/workspace/study-status/${encodeURIComponent(jobId)}`, { headers: { Authorization: `Bearer ${token}` }, signal, cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) {
        if ([401, 403, 404].includes(response.status)) setResult(null);
        throw new Error(body.message ?? 'Unable to load study status.');
      }
      if (!signal.aborted) { setResult({ data: body, fetchedAt: Date.now() }); setError(''); }
    } catch (err) { if (!signal.aborted) setError(err instanceof Error ? err.message : 'Study updates interrupted.'); throw err; }
  }, { refreshKey: `${jobId}:${refresh}` });
  const data = result?.data;
  const current = data && result ? Date.parse(data.serverTime) + Math.max(0, now - result.fetchedAt) : now;
  const end = data?.completedAt ? Date.parse(data.completedAt) : current;
  const remaining = data?.dueAt ? (Date.parse(data.dueAt) - end) / 1000 : null;
  const elapsed = data ? (end - Date.parse(data.startedAt)) / 1000 : 0;
  return <main className="study-tracking">
    <header className="st-header"><a href="/" className="st-brand">Marengo Asia Hospitals<span>Study tracking</span></a><div><a href="/" className="st-button"><ArrowLeft size={16}/> Worklist</a><button className="st-button" onClick={onLogout} title="Sign out" aria-label="Sign out"><LogOut size={16}/></button></div></header>
    <section className="st-content">
      <div className="st-heading"><div><p>{data?.center ?? 'Radiology workspace'}</p><h1>Study status</h1></div><button className="st-button" onClick={() => setRefresh(v => v + 1)}><RefreshCw size={16}/> Refresh</button></div>
      {error && <p role="alert" className="st-error">{error}</p>}
      {!data && !error && <p role="status">Loading study status...</p>}
      {data && <>
        <section className="st-summary"><div><span className="st-label">Patient</span><h2>{data.patientName ?? 'Patient details pending'}</h2><p>Accession {data.accession ?? '-'} / {data.modality}</p></div><div><span className={`st-status ${data.status === 'Reported' ? 'is-complete' : ''}`}>{data.status}</span><p className={data.priority === 'Urgent' ? 'st-urgent' : 'st-routine'}>{data.priority}</p></div></section>
        <section className="st-timing" aria-label="Turnaround time">
          <div><span className="st-label"><Clock3 size={15}/> {data.completedAt ? 'Final TAT' : 'Elapsed TAT'}</span><strong>{duration(elapsed)}</strong><small>Since sent for processing</small></div>
          <div className={remaining !== null && remaining < 0 ? 'st-overdue' : ''}><span className="st-label">{data.completedAt ? remaining !== null && remaining < 0 ? 'Completed over target' : 'Target margin' : remaining !== null && remaining < 0 ? 'Overdue' : 'Time remaining'}</span><strong>{remaining === null ? 'Not configured' : duration(remaining)}</strong><small>{data.targetSeconds === null ? 'Awaiting modality SLA' : `${data.targetSeconds / 60} minute target`}</small></div>
          <dl><div><dt>Submitted</dt><dd>{timestamp(data.startedAt)}</dd></div><div><dt>Due</dt><dd>{timestamp(data.dueAt)}</dd></div><div><dt>Reported</dt><dd>{timestamp(data.completedAt)}</dd></div></dl>
        </section>
        <section className="st-exchanges"><div className="st-heading"><h2><FileJson size={18}/> Integration responses</h2><span>{data.exchanges.length} recorded</span></div>
          {!data.exchanges.length && <p className="st-muted">No integration response recorded yet.</p>}
          {data.exchanges.map((exchange, index) => <details key={exchange.id} open={index === 0}><summary><span>{exchange.direction}</span><small>{timestamp(exchange.at)}{exchange.httpStatus ? ` / HTTP ${exchange.httpStatus}` : ''}</small></summary><pre>{JSON.stringify(exchange.body, null, 2)}</pre></details>)}
        </section>
        <dl className="st-meta"><div><dt>Processing state</dt><dd>{data.processingStatus}</dd></div><div><dt>Study reference</dt><dd>{data.id}</dd></div><div><dt>Telegram delivery</dt><dd>{data.notification ? `${data.notification.status} / ${data.notification.attempts} attempts` : 'Not queued'}</dd></div></dl>
      </>}
    </section>
    <footer className="st-footer"><span><ShieldCheck size={14}/> Authorized center access</span><span>{data ? `Updated ${timestamp(data.serverTime)}` : 'Marengo radiology'}</span></footer>
  </main>;
}
