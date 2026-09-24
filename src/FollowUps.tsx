import { useEffect, useState } from 'react';
import { api } from './lib/api';
import { useLiveRefresh } from './useLiveRefresh';
import { istTimestamp } from './pacsWorklist';
type Patient = { id: string; name: string; patientIdentifier: string; client?: { name: string } };
type FollowUp = { id: string; patient?: Patient; followUpDate: string; reason: string; status: string };
export function FollowUpsView({ token, notice }: { token: string; notice: (message: string) => void }) {
  const [items, setItems] = useState<FollowUp[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [revision, setRevision] = useState(0);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientId, setPatientId] = useState('');
  const [due, setDue] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useLiveRefresh(async signal => {
    try { const rows = await api<FollowUp[]>(`/api/follow-ups?status=${status}`, token, { signal }); if (!signal.aborted) { setItems(rows); setLoaded(true); setError(''); } }
    catch (e) { if (!signal.aborted) setError((e as Error).message); throw e; }
  }, { refreshKey: `${status}:${revision}`, intervalMs: 15000 });
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => void api<{ items: Patient[] }>(`/api/patients?q=${encodeURIComponent(query)}`, token, { signal: controller.signal }).then(data => setPatients(data.items)).catch(e => { if (!controller.signal.aborted) setError(e.message); }), 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, open, token]);
  async function update(id: string, next: string) {
    setBusy(true); setError('');
    try { await api(`/api/follow-ups/${id}`, token, { method: 'PATCH', body: JSON.stringify({ status: next }) }); setRevision(n => n + 1); notice('Follow-up updated.'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function create(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await api('/api/follow-ups', token, { method: 'POST', body: JSON.stringify({ patientId, followUpDate: new Date(due + ':00+05:30').toISOString(), reason, status: 'SCHEDULED' }) }); setOpen(false); setReason(''); setDue(''); setPatientId(''); setRevision(n => n + 1); notice('Follow-up created.'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="soft-card p-5"><div className="pw-heading"><h2>Patient follow-ups</h2><button onClick={() => setOpen(value => !value)}>Add follow-up</button></div>
    {error && <p className="pw-alert" role="alert">{error}</p>}
    {open && <form className="pw-user-form" onSubmit={event => void create(event)}><label className="pw-field">Find patient<input value={query} onChange={event => { setQuery(event.target.value); setPatientId(''); }} placeholder="Name or patient ID"/></label><label className="pw-field">Patient<select required value={patientId} onChange={event => setPatientId(event.target.value)}><option value="">Select patient</option>{patients.map(patient => <option key={patient.id} value={patient.id}>{patient.name} / {patient.patientIdentifier} / {patient.client?.name}</option>)}</select></label><label className="pw-field">Follow-up time (IST)<input required type="datetime-local" value={due} onChange={event => setDue(event.target.value)}/></label><label className="pw-field">Reason<input required maxLength={1000} value={reason} onChange={event => setReason(event.target.value)}/></label><button disabled={busy}>Create follow-up</button></form>}
    <label className="pw-field">Status<select value={status} onChange={event => setStatus(event.target.value)}><option value="">All</option>{['PENDING','SCHEDULED','OVERDUE','COMPLETED','CANCELLED'].map(value => <option key={value}>{value}</option>)}</select></label>
    <div className="pw-table-scroll"><table className="pw-data-table"><thead><tr><th>Patient</th><th>Due (IST)</th><th>Reason</th><th>Status</th><th>Update</th></tr></thead><tbody>{items.map(item => <tr key={item.id}><td>{item.patient?.name}<small>{item.patient?.patientIdentifier}</small></td><td>{istTimestamp(item.followUpDate).full}</td><td>{item.reason}</td><td>{item.status}</td><td><select aria-label={`Update follow-up for ${item.patient?.name}`} disabled={busy} value={item.status} onChange={event => void update(item.id,event.target.value)}>{['PENDING','SCHEDULED','OVERDUE','COMPLETED','CANCELLED'].map(value => <option key={value}>{value}</option>)}</select></td></tr>)}{!items.length && <tr><td colSpan={5}>{loaded ? 'No follow-ups in this selection. Use Add follow-up to schedule one.' : 'Loading follow-ups...'}</td></tr>}</tbody></table></div>
  </section>;
}
