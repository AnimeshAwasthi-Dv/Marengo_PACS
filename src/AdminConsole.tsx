import { useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Eye, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';
import { useLiveRefresh } from './useLiveRefresh';
import './admin-console.css';
import { WorkspaceDrawer } from './WorkspaceDrawer';

type Study = { id: string; patient: string; patientId: string; accession: string; center: string; description: string; modality: string; status: string; jobStatus: string; received: string; updatedAt: string };
type Evidence = { id: string; at: string; source: string; action: string; actor: string; actorId?: string; requestId?: string; httpStatus?: number; storedHash?: string; exportSha256: string; details: unknown };
type EvidenceResult = { rows: Evidence[]; total: number; page: number; sources: string[]; statuses: string[]; study: { updatedAt: string; workflowStatus: string } | null };
const day = (offset = 0) => new Date(Date.now() + 19800000 - offset * 86400000).toISOString().slice(0, 10);
const stamp = (value: string) => new Date(value).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false });
async function request<T>(path: string, token: string, signal?: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(`/api/admin/console/${path}`, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, signal, cache: 'no-store', ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Request failed.');
  return data;
}

export function AdminEvidence({ token, study, onClose }: { token: string; study?: Study; onClose?: () => void }) {
  const [from, setFrom] = useState(day(6));
  const [to, setTo] = useState(day());
  const [q, setQ] = useState('');
  const [source, setSource] = useState('');
  const [page, setPage] = useState(1);
  const [version, refresh] = useState(0);
  const [result, setResult] = useState<{ key: string; data: EvidenceResult } | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Evidence | null>(null);
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const query = new URLSearchParams({ from, to, q, source, page: String(page), studyId: study?.id ?? '' }).toString();
  const data = result?.key === query ? result.data : null;
  useLiveRefresh(async signal => { try { const data = await request<EvidenceResult>(`evidence?${query}`, token, signal); if (!signal.aborted) { setResult({ key: query, data }); setError(''); } } catch (e) { if (!signal.aborted) setError((e as Error).message); throw e; } }, { refreshKey: `${query}:${version}`, intervalMs: 15000 });
  async function download() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/admin/console/evidence?${query}&format=csv`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error((await response.json()).message);
      const url = URL.createObjectURL(await response.blob()); const a = document.createElement('a'); a.href = url; a.download = `marengo-evidence-${from}-${to}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('CSV exported with recorded timestamps, identifiers, redacted JSON and verification hashes.');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function correct() {
    if (!study || !data?.study || !window.confirm(`Change portal status to ${status}? This will be recorded in the audit log and will not update Renewist.`)) return;
    setBusy(true); setError('');
    try { const result = await request<{ message: string }>(`studies/${study.id}/status`, token, undefined, { status, reason, expectedUpdatedAt: data.study.updatedAt }); setNotice(result.message); setStatus(''); setReason(''); refresh(v => v + 1); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="ac-evidence">
    <header className="pw-heading"><div><div className="pw-breadcrumb">Administration / {study ? 'Study evidence' : 'Audit logs'}</div><h1>{study ? study.patient || study.id : 'Audit & integration evidence'}</h1>{study && <p>{study.center} · {study.accession || study.id}</p>}</div><div className="ac-actions"><button onClick={() => refresh(v => v + 1)} title="Refresh evidence" aria-label="Refresh evidence"><RefreshCw size={16}/></button><button disabled={busy || !data} onClick={() => void download()}><Download size={16}/>Export CSV</button>{onClose && <button aria-label="Close evidence" title="Close evidence" onClick={onClose}><X size={17}/></button>}</div></header>
    <div className="pw-toolbar ac-filters"><label>From <input aria-label="Audit from IST" type="date" value={from} max={to} onChange={e => { setFrom(e.target.value); setPage(1); }}/></label><label>To <input aria-label="Audit to IST" type="date" value={to} min={from} onChange={e => { setTo(e.target.value); setPage(1); }}/></label><span>IST</span><label><Search size={15}/><input aria-label="Search audit evidence" placeholder="Action, request ID, actor ID, JSON..." value={q} onChange={e => { setQ(e.target.value); setPage(1); }}/></label><select aria-label="Evidence source" value={source} onChange={e => { setSource(e.target.value); setPage(1); }}><option value="">All sources</option>{result?.data.sources.map(s => <option key={s}>{s}</option>)}</select></div>
    {study && <form className="ac-correction" onSubmit={e => { e.preventDefault(); void correct(); }}><strong>Portal status: {data?.study?.workflowStatus ?? study.status}</strong><select aria-label="Correct study status" required value={status} onChange={e => setStatus(e.target.value)}><option value="">Change status...</option>{data?.statuses.map(s => <option key={s}>{s}</option>)}</select><input aria-label="Reason for status correction" required minLength={10} maxLength={2000} value={reason} placeholder="Required reason for correction" onChange={e => setReason(e.target.value)}/><button type="submit" disabled={busy || !data || !status || reason.trim().length < 10}><ShieldCheck size={15}/>Apply correction</button></form>}
    {error && <div className="pw-alert" role="alert">{error}</div>}{notice && <div className="pw-alert success" role="status">{notice}</div>}
    <div className="ac-records"><div className="pw-table-scroll"><table className="pw-data-table ac-audit-table"><thead><tr><th>Timestamp (IST)</th><th>Source</th><th>Action / transition</th><th>Actor</th><th>HTTP</th><th>Record / request</th><th/></tr></thead><tbody>{data?.rows.map(r => <tr key={`${r.source}:${r.id}`} className={selected?.id === r.id ? 'ac-selected' : ''}><td>{stamp(r.at)}</td><td>{r.source}</td><td>{r.action}</td><td>{r.actor}</td><td>{r.httpStatus ?? '-'}</td><td><span className="ac-id" title={r.requestId ?? r.id}>{r.requestId ?? r.id}</span></td><td><button aria-label={`Inspect ${r.id}`} onClick={() => setSelected(r)}><Eye size={14}/>Inspect</button></td></tr>)}{!data?.rows.length && <tr><td colSpan={7}><div className="pw-empty">{data ? 'No recorded evidence in this date range.' : error ? 'Evidence unavailable.' : 'Loading evidence...'}</div></td></tr>}</tbody></table></div>
    {selected && <WorkspaceDrawer title="Recorded evidence" onClose={() => setSelected(null)}><div className="ac-json ac-json-drawer"><dl><dt>Record ID</dt><dd>{selected.id}</dd><dt>Timestamp UTC</dt><dd>{selected.at}</dd><dt>Recorded request hash</dt><dd>{selected.storedHash || 'Not recorded'}</dd><dt>Redacted export SHA-256</dt><dd>{selected.exportSha256}</dd></dl><pre>{JSON.stringify(selected.details, null, 2)}</pre></div></WorkspaceDrawer>}</div>
    <footer className="pw-footer"><span>{data?.total ?? 0} records · Credentials and binary content redacted</span><div className="pw-pagination"><button aria-label="Previous evidence page" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft size={16}/></button><span>{page} / {Math.max(1, Math.ceil((data?.total ?? 0) / 50))}</span><button aria-label="Next evidence page" disabled={!data || page * 50 >= data.total} onClick={() => setPage(p => p + 1)}><ChevronRight size={16}/></button></div></footer>
  </section>;
}

export function AdminConsole({ token, onNavigate }: { token: string; onNavigate: (tab: string) => void }) {
  const [q, setQ] = useState(''); const [centerId, setCenter] = useState(''); const [page, setPage] = useState(1); const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<{ rows: Study[]; total: number; centers: { id: string; name: string }[] } | null>(null);
  const [error, setError] = useState(''); const [study, setStudy] = useState<Study | null>(null);
  const query = new URLSearchParams({ q, centerId, page: String(page) }).toString();
  useLiveRefresh(async signal => { try { const incoming = await request<NonNullable<typeof data>>(`studies?${query}`, token, signal); if (!signal.aborted) { setData(incoming); setError(''); } } catch (e) { if (!signal.aborted) setError((e as Error).message); throw e; } }, { refreshKey: `${query}:${refresh}`, intervalMs: 15000 });
  return <>
    {study && <WorkspaceDrawer title="Study details & evidence" wide fill onClose={() => { setStudy(null); setRefresh(v => v + 1); }}><AdminEvidence key={study.id} token={token} study={study}/></WorkspaceDrawer>}
    <header className="pw-heading"><div><div className="pw-breadcrumb">Administration / Overview</div><h1>Study operations</h1></div><button title="Refresh studies" aria-label="Refresh studies" onClick={() => setRefresh(v => v + 1)}><RefreshCw size={16}/></button></header>
    <section className="pw-metric-strip"><div><span>Authorized centers</span><strong>{data?.centers.length ?? '-'}</strong></div><div><span>Matching studies</span><strong>{data?.total ?? '-'}</strong></div><div><span>Access management</span><div className="ac-actions"><button onClick={() => onNavigate('Group Admins')}>Group admins</button><button onClick={() => onNavigate('Radiologists')}>Radiologists</button></div></div><div><span>Governance</span><div className="ac-actions"><button onClick={() => onNavigate('Audit Logs')}>Audit logs</button><button onClick={() => onNavigate('Healthcheck')}>Healthcheck</button></div></div></section>
    <div className="pw-toolbar ac-filters"><label><Search size={16}/><input aria-label="Search admin studies" placeholder="Patient, ID, accession, study UID..." value={q} onChange={e => { setQ(e.target.value); setPage(1); }}/></label><select aria-label="Admin center" value={centerId} onChange={e => { setCenter(e.target.value); setPage(1); }}><option value="">All authorized centers</option>{data?.centers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
    {error && <div className="pw-alert" role="alert">{error}</div>}
    <div className="pw-table-scroll"><table className="pw-data-table ac-study-table"><thead><tr><th>Patient / ID</th><th>Center</th><th>Accession</th><th>Study</th><th>Portal status</th><th>Job status</th><th>Updated (IST)</th><th>Action</th></tr></thead><tbody>{data?.rows.map(s => <tr key={s.id}><td><strong>{s.patient || '-'}</strong><small>{s.patientId || '-'}</small></td><td>{s.center}</td><td>{s.accession || '-'}</td><td>{s.modality}<small>{s.description}</small></td><td>{s.status}</td><td>{s.jobStatus || '-'}</td><td>{stamp(s.updatedAt)}</td><td><button onClick={() => setStudy(s)}><Eye size={14}/>Details & evidence</button></td></tr>)}{!data?.rows.length && <tr><td colSpan={8}><div className="pw-empty">{data ? 'No matching studies.' : 'Loading studies...'}</div></td></tr>}</tbody></table></div>
    <footer className="pw-footer"><span>{data?.total ?? 0} studies</span><div className="pw-pagination"><button aria-label="Previous admin page" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft size={16}/></button><span>{page} / {Math.max(1, Math.ceil((data?.total ?? 0) / 30))}</span><button aria-label="Next admin page" disabled={!data || page * 30 >= data.total} onClick={() => setPage(p => p + 1)}><ChevronRight size={16}/></button></div></footer>
  </>;
}
