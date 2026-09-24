import { useState } from 'react';
import { WorkspaceDrawer } from './WorkspaceDrawer';
import { api } from './lib/api';
import { useLiveRefresh } from './useLiveRefresh';

type Incident = { id: string; service: string; center: string; status: string; detail: string; observedStatus: string; openedAt: string; lastObservedAt: string; acknowledgedAt: string | null; acknowledgedBy: string | null; resolvedAt: string | null; resolvedBy: string | null; resolution: string | null; reminderCount: number };
type Event = { id: string; event: string; actor: string; detail: string; createdAt: string };
type Result = { rows: Incident[]; total: number; page: number; monitor: { enabled: boolean; telegramConfigured: boolean; lastCheckAt: string | null; lastTickAt: string | null; lastError: string | null } };
const when = (value: string | null) => value ? new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—';
export default function TechnicalAlerts({ token }: { token: string }) {
  const [data, setData] = useState<Result | null>(null);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Incident | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useLiveRefresh(async signal => {
    try { const result = await api<Result>(`/api/technical-alerts?status=${status}&page=${page}`, token, { signal }); if (!signal.aborted) { setData(result); setSelected(current => current ? result.rows.find(row => row.id === current.id) ?? current : null); setError(''); } }
    catch (e) { if (!signal.aborted) setError((e as Error).message); throw e; }
  }, { refreshKey: `${status}:${page}:${revision}`, intervalMs: 15000 });
  async function open(row: Incident) {
    setSelected(row); setEvents([]); setNote(''); setBusy(true);
    try { setEvents(await api<Event[]>(`/api/technical-alerts/${row.id}/events`, token)); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function resolve() {
    if (!selected || !window.confirm('Mark this technical breakdown as resolved with the entered note?')) return;
    setBusy(true);
    try { await api(`/api/technical-alerts/${selected.id}/resolve`, token, { method: 'POST', body: JSON.stringify({ resolution: note }) }); setSelected(null); setRevision(value => value + 1); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function checkNow() {
    setBusy(true); setError('');
    try { await api('/api/technical-alerts/check-now', token, { method: 'POST' }); setRevision(value => value + 1); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <><header className="pw-heading"><div><div className="pw-breadcrumb">Super Admin / Operations</div><h1>Technical Alerts</h1></div><div><button disabled={busy || !data?.monitor.enabled} onClick={() => void checkNow()}>Check services now</button><button onClick={() => setRevision(value => value + 1)}>Refresh</button></div></header>
    <p className="pw-help">Services checked every 15 minutes. Telegram reminders repeat every 2 minutes until a member taps the Noted button or replies “Noted” to the alert. Recovery does not close a breakdown; Super Admin resolution is required.</p>
    <p className="pw-help">WhatsApp and the 19 excluded PACS endpoints do not generate alerts. Reporting goes directly to Renewist; AI endpoints are not monitored.</p>
    {error && <div role="alert" className="pw-alert">{error}</div>}
    {data && <div className="ta-monitor"><strong>{data.monitor.enabled ? 'Monitoring enabled' : 'Monitoring paused'}</strong><p>Telegram: {data.monitor.telegramConfigured ? 'Configured' : 'Setup required'} · Last health check: {when(data.monitor.lastCheckAt)} IST · Worker: {when(data.monitor.lastTickAt)} IST</p>{data.monitor.enabled && (!data.monitor.lastTickAt || Date.now() - Date.parse(data.monitor.lastTickAt) > 120000) && <p role="alert">Monitor heartbeat is stale. Check the running worker.</p>}{data.monitor.lastError && <p role="alert">{data.monitor.lastError}</p>}</div>}
    <label className="pw-field">Incident status<select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">All incidents</option><option value="OPEN">Awaiting acknowledgment</option><option value="ACKNOWLEDGED">Acknowledged</option><option value="RESOLVED">Resolved</option></select></label>
    <div className="pw-table-scroll"><table className="pw-data-table"><thead><tr><th>Service / location</th><th>Incident</th><th>Latest health</th><th>Opened (IST)</th><th>Acknowledged by</th><th>Alerts sent</th><th>Action</th></tr></thead><tbody>{data?.rows.map(row => <tr key={row.id}><td><strong>{row.service}</strong><p>{row.center}</p></td><td>{row.status}</td><td>{row.observedStatus}<p>{row.detail}</p></td><td>{when(row.openedAt)}</td><td>{row.acknowledgedBy || (row.status === 'RESOLVED' ? 'Closed by configuration' : 'Awaiting Noted')}<p>{when(row.acknowledgedAt)}</p></td><td>{row.reminderCount}</td><td><button disabled={busy} onClick={() => void open(row)}>{row.status === 'ACKNOWLEDGED' ? 'Review & resolve' : 'View log'}</button></td></tr>)}{!data?.rows.length && <tr><td colSpan={7}>{data ? 'No technical incidents in this selection.' : 'Loading incidents...'}</td></tr>}</tbody></table></div>
    <footer className="pw-footer"><span>{data?.total ?? 0} incidents</span><button disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {page}</span><button disabled={!data || page * 50 >= data.total} onClick={() => setPage(value => value + 1)}>Next</button></footer>
    {selected && <WorkspaceDrawer title={selected.service + ' - incident details'} onClose={() => setSelected(null)} wide>
      <div className="ta-details">
        {error && <div className="pw-alert" role="alert">{error}</div>}
        <div className="ta-summary"><strong>{selected.status}</strong><p>{selected.center}</p><p>{selected.detail}</p><small>Incident {selected.id}</small></div>
        <section className="ta-resolution">
          <h3>Resolution</h3>
          {selected.status === 'ACKNOWLEDGED' ? <>
            <p>Acknowledged by {selected.acknowledgedBy} at {when(selected.acknowledgedAt)} IST. Reminders have stopped.</p>
            <label className="pw-field">Resolution note<textarea rows={3} minLength={5} maxLength={2000} value={note} onChange={e => setNote(e.target.value)} placeholder="Describe the repair and verification performed"/></label>
            <button className="pw-primary" disabled={busy || note.trim().length < 5} onClick={() => void resolve()}>{busy ? 'Please wait...' : 'Mark resolved'}</button>
            {note.trim().length < 5 && <p className="pw-help">Enter a resolution note of at least 5 characters to enable Mark resolved.</p>}
          </> : selected.status === 'RESOLVED' ? <><strong>Already resolved</strong><p>{selected.resolution}</p><p>{selected.resolvedBy} - {when(selected.resolvedAt)} IST</p></> : <><p>Tap Noted on the Telegram alert to acknowledge this incident first.</p><button disabled>Mark resolved - acknowledgment required</button></>}
        </section>
        <h3>Incident history</h3>
        {busy && !events.length ? <p role="status">Loading log...</p> : <ol className="ta-timeline">{events.map(event => <li key={event.id}><div><strong>{event.event.replaceAll('_', ' ')}</strong><time>{when(event.createdAt)} IST</time></div><p>{event.detail}</p><small>{event.actor}</small></li>)}</ol>}
        <p className="pw-help">Latest 200 log entries shown.</p>
      </div>
    </WorkspaceDrawer>}
  </>;
}
