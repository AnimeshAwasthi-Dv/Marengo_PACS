import { createContext, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export const WorkspaceDrawerContext = createContext(false);
const openDrawers: HTMLElement[] = [];

export function WorkspaceDrawer({ title, children, onClose, wide = false, fill = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean; fill?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const panel = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    openDrawers.push(panel);
    panel.focus();
    const keydown = (event: KeyboardEvent) => {
      if (openDrawers.at(-1) !== panel) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeRef.current(); return; }
      if (event.key !== 'Tab') return;
      const controls = Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')).filter(el => el.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); panel.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel)) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', keydown, true);
    return () => { openDrawers.splice(openDrawers.indexOf(panel), 1); window.removeEventListener('keydown', keydown, true); if (previous?.isConnected) previous.focus(); };
  }, []);
  return createPortal(<div className="pw-overlay pw-shared-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`pw-drawer pw-shared-drawer${wide ? ' pw-shared-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
      <header className="pw-drawer-header"><h2>{title}</h2><button aria-label={`Close ${title}`} title="Close" onClick={onClose}><X size={18}/></button></header>
      <div className={fill ? 'pw-shared-fill' : 'pw-drawer-body pw-legacy'}>{children}</div>
      <footer className="pw-drawer-footer"><button onClick={onClose}>Close</button></footer>
    </section>
  </div>, document.querySelector('.pacs-workspace') ?? document.body);
}
