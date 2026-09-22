import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, BookOpen, CreditCard, Download, Search, Settings2 } from 'lucide-react';
import { WorkspaceStatistics } from './WorkspaceOperations';
import { useLiveRefresh } from './useLiveRefresh';
import type { MarengoTariff, MarengoTariffRate } from './marengoTariffTypes';

const chargeLabels: Record<MarengoTariffRate['chargeType'], string> = {
  BASE: 'Base study', ADDITIONAL_VIEW: 'Additional view', ADDITIONAL_STUDY: 'Additional study', PROTOCOL: 'Protocol', ADD_ON: 'Add-on',
};
const rateFormat = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

function WorkspaceTariff({ token }: { token: string }) {
  const [tariff, setTariff] = useState<MarengoTariff | null>(null);
  const [query, setQuery] = useState('');
  const [modality, setModality] = useState('ALL');
  const [chargeType, setChargeType] = useState('ALL');
  const [error, setError] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [sortAscending, setSortAscending] = useState<boolean | null>(null);
  useLiveRefresh(async signal => {
    try {
      const response = await fetch('/api/workspace/tariff', { headers: { Authorization: `Bearer ${token}` }, signal, cache: 'no-store' });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) throw new Error(data?.message || 'Tariff unavailable.');
      if (!signal.aborted) { setTariff(data); setError(''); }
    } catch (err) { if (!signal.aborted) setError(err instanceof Error ? err.message : 'Tariff unavailable.'); throw err; }
  }, { intervalMs: 30000 });

  async function exportRates() {
    setDownloading(true); setDownloadError('');
    try {
      const response = await fetch('/api/workspace/tariff?format=csv', { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('Unable to download the rate card.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = 'marengo-dectrocel-tariff-draft.csv'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setDownloadError(err instanceof Error ? err.message : 'Download failed.'); }
    finally { setDownloading(false); }
  }
  const filtered = (tariff?.rates ?? []).filter(rate => (modality === 'ALL' || rate.modality === modality)
    && (chargeType === 'ALL' || rate.chargeType === chargeType)
    && [rate.modality, rate.bodyPart, rate.studies, rate.note].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
  if (sortAscending !== null) filtered.sort((a, b) => (a.amountMinor - b.amountMinor) * (sortAscending ? 1 : -1));
  const hasFilters = query || modality !== 'ALL' || chargeType !== 'ALL';
  return <>
    <header className="pw-heading"><div><div className="pw-breadcrumb">Marengo / Billing / Rate card</div><h1>Dectrocel tariff <span>{tariff?.rates.length ?? 0}</span></h1></div><button aria-label="Download rate card" title="Download rate card" disabled={!tariff || downloading} onClick={() => void exportRates()}><Download size={15}/><span className="pw-tariff-download-label">{downloading ? 'Exporting...' : 'Download rate card'}</span></button></header>
    <div className="pw-toolbar pw-tariff-toolbar"><label className="pw-search"><Search size={16}/><input aria-label="Search tariff" placeholder="Search study, body part, modality..." value={query} onChange={e => setQuery(e.target.value)}/></label><select aria-label="Tariff modality" value={modality} onChange={e => setModality(e.target.value)}><option value="ALL">All modalities</option>{['X RAY', 'CT', 'MRI', 'NMR'].map(item => <option key={item}>{item}</option>)}</select><select aria-label="Tariff charge type" value={chargeType} onChange={e => setChargeType(e.target.value)}><option value="ALL">All charge types</option>{Object.entries(chargeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>{hasFilters && <button onClick={() => { setQuery(''); setModality('ALL'); setChargeType('ALL'); }}>Clear filters</button>}</div>
    {(error || downloadError) && <div className="pw-alert" role="alert">{error || downloadError}</div>}
    {tariff && <div className="pw-tariff-state"><span className="pw-status available">Draft</span><span>Effective date pending</span><details><summary>Pending confirmations <b>{tariff.pendingConfirmations.length}</b></summary><ul>{tariff.pendingConfirmations.map(note => <li key={note}>{note}</li>)}</ul></details></div>}
    <div className="pw-table-scroll"><table className="pw-data-table pw-tariff-table">
      <colgroup><col style={{ width: 92 }}/><col style={{ width: 180 }}/><col/><col style={{ width: 140 }}/><col style={{ width: 126 }}/></colgroup>
      <thead><tr><th>Modality</th><th>Body part / Category</th><th>Studies</th><th>Billing unit</th><th aria-sort={sortAscending === null ? 'none' : sortAscending ? 'ascending' : 'descending'}><button title="Sort by rate" onClick={() => setSortAscending(value => value === null ? true : !value)}>Rate<span className="pw-tariff-currency"> (INR)</span>{sortAscending === null ? <ArrowUpDown size={13}/> : sortAscending ? <ArrowUp size={13}/> : <ArrowDown size={13}/>}</button></th></tr></thead>
      <tbody>{filtered.map(rate => <tr key={rate.id} data-rate-id={rate.id}>
        <td><span className="pw-modality">{rate.modality}</span></td>
        <td><strong>{rate.bodyPart}</strong><small>{rate.unit}</small><details className="pw-tariff-mobile-studies"><summary>Studies</summary><p>{rate.studies}</p>{rate.note && <small className="pw-tariff-note">{rate.note}</small>}</details></td>
        <td>{rate.studies}{rate.note && <small className="pw-tariff-note">{rate.note}</small>}</td><td>{rate.unit}</td>
        <td className="pw-tariff-price">{rateFormat.format(rate.amountMinor / 100)}</td>
      </tr>)}{!filtered.length && <tr><td colSpan={5}><div className="pw-empty">{!tariff ? error ? 'Tariff unavailable' : 'Loading tariff...' : 'No matching rates'}</div></td></tr>}</tbody>
    </table></div>
    <footer className="pw-footer"><span>{filtered.length} / {tariff?.rates.length ?? 0} rates</span><span>INR</span><span className="pw-tariff-footer-note">Not applied to invoices</span></footer>
  </>;
}

export function WorkspaceBilling({ token, adminContent }: { token: string; adminContent?: ReactNode }) {
  const [tab, setTab] = useState<'ledger' | 'tariff' | 'admin'>(adminContent ? 'admin' : 'ledger');
  return <><nav className="pw-billing-tabs" aria-label="Billing views"><button className={tab === 'ledger' ? 'active' : ''} aria-pressed={tab === 'ledger'} onClick={() => setTab('ledger')}><CreditCard size={15}/>Usage & charges</button><button className={tab === 'tariff' ? 'active' : ''} aria-pressed={tab === 'tariff'} onClick={() => setTab('tariff')}><BookOpen size={15}/>Dectrocel tariff</button>{adminContent && <button className={tab === 'admin' ? 'active' : ''} aria-pressed={tab === 'admin'} onClick={() => setTab('admin')}><Settings2 size={15}/>Invoices & settings</button>}</nav>{tab === 'tariff' ? <WorkspaceTariff token={token}/> : tab === 'ledger' ? <WorkspaceStatistics mode="billing" token={token}/> : <div className="pw-legacy">{adminContent}</div>}</>;
}
