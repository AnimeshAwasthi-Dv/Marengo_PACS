import { lazy, Suspense, useEffect, useState } from 'react';
import { newTabViewerLink } from './viewerLinks';

type ViewerSession = { enabled: boolean; mode?: 'quick' | 'external'; viewerUrl?: string; quickViewUrl?: string; message?: string };

// Loaded only when a study actually opens in QuickView, so the decoder never weighs on other pages.
const QuickViewPane = lazy(() => import('./QuickViewPane'));

function withFullViewer(endpoint: string) {
  return `${endpoint}${endpoint.includes('?') ? '&' : '?'}viewer=full`;
}

/**
 * Opens a study. The server decides the viewer: small 2D studies (X-ray, mammography, ultrasound) open in
 * the in-app QuickView; CT, MR and everything else open in the external DICOM viewer, which owns its own
 * rendering and authentication. Both use the same frame (new-tab link row + viewer) so the image area is
 * identical, and the new-tab link applies the same per-study choice.
 */
export function ExternalViewerPane({ endpoint, token }: { endpoint: string; token?: string }) {
  const [session, setSession] = useState<ViewerSession | null>(null);
  const [error, setError] = useState('');
  // Falling back to the full viewer (QuickView could not load the study) applies only to that study.
  const [fullViewerFor, setFullViewerFor] = useState<string | null>(null);
  const url = fullViewerFor === endpoint ? withFullViewer(endpoint) : endpoint;

  useEffect(() => {
    const controller = new AbortController();
    setSession(null);
    setError('');
    void fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: controller.signal })
      .then(async response => {
        const data = await response.json() as ViewerSession;
        if (!response.ok) throw new Error(data.message || 'Unable to open the external viewer');
        if (!controller.signal.aborted) setSession(data);
      })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Unable to open the external viewer'); });
    return () => controller.abort();
  }, [url, token]);

  const loading = <section className="grid h-full min-h-64 place-items-center bg-slate-950 p-6 text-center text-slate-100" role="status">
    <p>{error || session?.message || 'Opening study viewer…'}</p>
  </section>;

  const quick = session?.enabled && session.mode === 'quick' && session.quickViewUrl ? session.quickViewUrl : null;
  if (!quick && (!session?.enabled || !session.viewerUrl)) return loading;
  return <section className="flex h-full min-h-0 flex-col bg-slate-950">
    <div className="px-3 py-2 text-right"><a href={quick ? newTabViewerLink(endpoint) : session!.viewerUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-sky-300">Open viewer in a new tab ↗</a></div>
    {quick
      ? <div className="flex min-h-[60vh] w-full flex-1 flex-col"><Suspense fallback={loading}><QuickViewPane baseUrl={quick} token={token} onOpenFull={() => setFullViewerFor(endpoint)} /></Suspense></div>
      : <iframe className="min-h-[60vh] w-full flex-1 border-0" src={session!.viewerUrl} title="External DICOM viewer" referrerPolicy="no-referrer" allowFullScreen />}
  </section>;
}
