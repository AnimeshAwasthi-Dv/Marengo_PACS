import { useState } from 'react';
import { api } from './lib/api';
export function ProcessingActions({ study, token, reload }: { study?: { id?: string; clinicalIndication?: string | null; priority?: string | null } | null; token: string; reload: () => Promise<void> }) {
  const [originalStudy] = useState(study);
  study = originalStudy ?? study;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [terminated, setTerminated] = useState(false);
  if (!study?.id) return <p className="pw-help">No linked worklist study is available for these actions.</p>;
  async function act() {
    if (!study?.id) return;
    const reason = terminated ? '' : window.prompt('Reason for terminating this processing job:');
    if (!terminated && !reason?.trim()) return;
    if (terminated && !window.confirm('Send this study for reporting again?')) return;
    setBusy(true); setError('');
    try {
      if (!terminated) { await api(`/api/workspace/studies/${study.id}/terminate-processing`, token, { method: 'POST', body: JSON.stringify({ reason }) }); setTerminated(true); }
      else {
        const body = new FormData(); body.append('clinical_indication', study.clinicalIndication || ''); body.append('no_clinical_indication', String(!study.clinicalIndication)); body.append('priority', study.priority || 'REGULAR');
        const response = await fetch(`/api/client/study-sync/available-studies/${study.id}/submit`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body });
        const data = await response.json(); if (!response.ok) throw new Error(data.message || 'Repush failed'); setTerminated(false);
      }
      await reload();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="pw-processing-actions">{error && <p className="pw-alert" role="alert">{error}</p>}<p className="pw-help">{terminated ? 'Processing terminated. The study is available to repush.' : 'Terminate the current job before sending the study again. Finalized reports are protected.'}</p><button className={terminated ? 'pw-primary' : 'pw-danger'} disabled={busy} onClick={() => void act()}>{busy ? 'Working...' : terminated ? 'Repush study' : 'Terminate processing'}</button></div>;
}
