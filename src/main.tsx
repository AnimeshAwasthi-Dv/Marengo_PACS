import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './elite-ui.css'
import './ui-polish.css'
import './pacs-workspace.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<div role="status" className="p-6 text-slate-600">Loading portal…</div>}><App /></Suspense>
  </StrictMode>,
)
