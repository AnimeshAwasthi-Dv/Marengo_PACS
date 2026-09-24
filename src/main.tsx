import { StrictMode, Suspense, lazy, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './elite-ui.css'
import './ui-polish.css'
import LoginView from './LoginView'
const App = lazy(() => import('./App'))
function PortalEntry() {
  const [authenticated, setAuthenticated] = useState(() => Boolean(localStorage.getItem('decxpert_portal_token')))
  const publicRoute = /^\/(shared|study-status)\//.test(window.location.pathname)
  return authenticated || publicRoute ? <App /> : <LoginView onLogin={() => setAuthenticated(true)} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<div role="status" className="p-6 text-slate-600">Loading portal…</div>}><PortalEntry /></Suspense>
  </StrictMode>,
)
