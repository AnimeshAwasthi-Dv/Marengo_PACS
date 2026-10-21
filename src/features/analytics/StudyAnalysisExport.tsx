import { useState } from 'react';
import { Download } from 'lucide-react';

const modalities = ['X-Ray', 'CT', 'MRI'];

export function StudyAnalysisExport({ token, from, to }: { token: string; from: string; to: string }) {
  const [selected, setSelected] = useState(modalities);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const invalidRange = !from || !to || from > to || Date.parse(to) - Date.parse(from) >= 366 * 86400000;

  async function download() {
    setDownloading(true); setError('');
    try {
      const query = new URLSearchParams({ from, to, modalities: selected.join(',') });
      const response = await fetch(`/api/workspace/analytics/study-analysis.xlsx?${query}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.message || 'Unable to download study analysis. Please try again.');
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url; link.download = `marengo-study-analysis-${from}-to-${to}.xlsx`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setError(err instanceof Error ? err.message : 'Export failed.'); }
    finally { setDownloading(false); }
  }

  return <section className="pw-analysis-export" aria-labelledby="study-analysis-heading">
    <div><h2 id="study-analysis-heading">Modality summary</h2>
      <p>Download one Excel sheet with reported totals, duty-hour counts, average TAT, and SLA results for your center.</p>
      <p>Uses the From and To dates above, including both full days in IST. Choose the modalities for this export below.</p>
    </div>
    <div className="pw-analysis-controls">
      <fieldset disabled={downloading}><legend>Modalities to include</legend>{modalities.map(modality => <label key={modality}>
        <input type="checkbox" checked={selected.includes(modality)} onChange={event => setSelected(current => event.target.checked ? [...current, modality] : current.filter(value => value !== modality))}/>{modality}
      </label>)}</fieldset>
      <button disabled={downloading || invalidRange || !selected.length} onClick={() => void download()}><Download size={15}/>{downloading ? 'Preparing Excel…' : 'Download summary Excel'}</button>
    </div>
    {!selected.length && <p role="status">Select at least one modality.</p>}
    {invalidRange && <p role="status">Select a valid date range of 1 to 366 days above.</p>}
    {error && <p className="pw-alert" role="alert">{error}</p>}
  </section>;
}
