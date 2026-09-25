import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { PORTAL_TOKEN_KEY } from '../../lib/session';
import { isPublicViewerSession, isViewerSessionPath } from './viewerLinks';

type ViewerSession = { enabled: boolean; mode?: 'quick' | 'external'; viewerUrl?: string; quickViewUrl?: string; message?: string };

const QuickViewPane = lazy(() => import('./QuickViewPane'));

function Message({ text }: { text: string }) {
  return <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, background: '#05070a', color: '#d9e4ef', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', textAlign: 'center' }}>
    <div style={{ display: 'grid', gap: 12 }}><p style={{ margin: 0 }}>{text}</p><a href="/" style={{ color: '#7ed6ff' }}>Back to the portal</a></div>
  </main>;
}

/**
 * Target of "Open viewer in a new tab" (/viewer?session=<viewer-session endpoint>). It asks the server for
 * the viewer exactly like the in-portal pane: QuickView studies open here full-screen, everything else
 * (CT, MR, …) redirects to the external DICOM viewer, just as the old link did.
 */
export default function ViewerPage() {
  const endpoint = new URLSearchParams(window.location.search).get('session');
  const valid = isViewerSessionPath(endpoint);
  const token = localStorage.getItem(PORTAL_TOKEN_KEY) ?? '';
  const needsLogin = valid && !token && !isPublicViewerSession(endpoint);
  const [session, setSession] = useState<ViewerSession | null>(null);
  const [error, setError] = useState('');

  const open = useCallback(async (full: boolean) => {
    if (!valid || needsLogin) return;
    setSession(null);
    setError('');
    try {
      const response = await fetch(full ? `${endpoint}?viewer=full` : endpoint, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      const data = await response.json() as ViewerSession;
      if (!response.ok) throw new Error(data.message || 'Unable to open this study');
      // External studies go straight to the full DICOM viewer, like the previous new-tab link.
      if (data.enabled && data.mode !== 'quick' && data.viewerUrl) { window.location.replace(data.viewerUrl); return; }
      setSession(data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to open this study');
    }
  }, [endpoint, needsLogin, token, valid]);

  useEffect(() => { void open(false); }, [open]);

  if (!valid) return <Message text="This viewer link is not valid." />;
  if (needsLogin) return <Message text="Please sign in to the portal, then open the study again." />;
  if (error) return <Message text={error} />;
  if (session && !session.enabled) return <Message text={session.message || 'This study cannot be opened.'} />;
  if (!session?.quickViewUrl) return <Message text="Opening study viewer…" />;
  return <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: '#05070a' }}>
    <Suspense fallback={<Message text="Opening study viewer…" />}>
      <QuickViewPane baseUrl={session.quickViewUrl} token={token || undefined} onOpenFull={() => void open(true)} />
    </Suspense>
  </div>;
}
