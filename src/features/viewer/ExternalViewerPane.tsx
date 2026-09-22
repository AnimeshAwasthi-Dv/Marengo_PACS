import { useEffect, useState } from 'react';

type ViewerSession = { enabled: boolean; viewerUrl?: string; message?: string };

/** The remote application owns image rendering and its own authentication. */
export function ExternalViewerPane({ endpoint, token }: { endpoint: string; token?: string }) {
  const [session, setSession] = useState<ViewerSession | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setSession(null);
    setError('');
    void fetch(endpoint, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: controller.signal })
      .then(async response => {
        const data = await response.json() as ViewerSession;
        if (!response.ok) throw new Error(data.message || 'Unable to open the external viewer');
        if (!controller.signal.aborted) setSession(data);
      })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Unable to open the external viewer'); });
    return () => controller.abort();
  }, [endpoint, token]);

  if (!session?.enabled || !session.viewerUrl) return <section className="grid h-full min-h-64 place-items-center bg-slate-950 p-6 text-center text-slate-100" role="status">
    <p>{error || session?.message || 'Opening study viewer…'}</p>
  </section>;
  return <section className="flex h-full min-h-0 flex-col bg-slate-950">
    <div className="px-3 py-2 text-right"><a href={session.viewerUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-sky-300">Open viewer in a new tab ↗</a></div>
    <iframe className="min-h-[60vh] w-full flex-1 border-0" src={session.viewerUrl} title="External DICOM viewer" referrerPolicy="no-referrer" allowFullScreen />
  </section>;
}
