import { createRef, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Activity, Box, Download, Ellipsis, FileText, Gauge, Grid2x2, Keyboard, Layers, List, Move, PanelLeftClose, PanelLeftOpen, Pause, Play, Ruler, RotateCw, ScanLine, Search, Square, Target, Trash2, Type, Undo2 } from 'lucide-react';
import { QuickViewDecoder } from './quickviewDecoder';
import { FlipHorizontalIcon, FlipVerticalIcon } from './quickviewIcons';
import { formatAgeSex, formatDicomDate } from './quickviewMath';
import type { TagRow } from './quickviewPixels';
import { QuickViewViewport } from './QuickViewViewport';
import { layoutSize, seriesTitle, type Layout, type Manifest, type Overlay, type Tool, type ViewportHandle, type ViewportReport, type WindowLevel } from './quickviewTypes';
import './quickview.css';

// Touch screens: one finger pans (like any photo viewer); contrast is one tap away on the Window tool.
const TOUCH_FIRST = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
const FPS_OPTIONS = [5, 10, 15, 20, 30];
const LAYOUTS: Layout[] = ['1x1', '1x2', '2x1', '2x2'];

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read preview'));
    reader.readAsDataURL(blob);
  });
}

function ToolButton({ icon, label, title, active, disabled, className, onClick }: { icon: ReactNode; label: string; title?: string; active?: boolean; disabled?: boolean; className?: string; onClick: () => void }) {
  return <button type="button" className={`qv-tool${active ? ' active' : ''}${className ? ` ${className}` : ''}`} title={title ?? label} aria-label={title ?? label} aria-pressed={active} disabled={disabled} onClick={onClick}>
    {icon}<span className="qv-tool-label">{label}</span>
  </button>;
}

/**
 * In-app viewer for small 2D studies (X-ray, mammography, ultrasound). It looks and works like the DecXpert
 * full viewer; the difference is only how the study loads: a lightweight in-app loader (server preview
 * first, then full resolution decoded in a Web Worker) instead of importing the study into the viewer
 * service. If the study can't be shown here, it hands over to the full viewer automatically.
 */
export default function QuickViewPane({ baseUrl, token, onOpenFull }: { baseUrl: string; token?: string; onOpenFull: () => void }) {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [failed, setFailed] = useState(false);
  const [decoder, setDecoder] = useState<QuickViewDecoder | null>(null);
  const [tool, setTool] = useState<Tool>(TOUCH_FIRST ? 'pan' : 'window');
  const [previews, setPreviews] = useState<Record<number, string>>({});
  const [fullReady, setFullReady] = useState<Record<number, true>>({});
  // Measurements and notes per image, in the order drawn (Undo removes the last one).
  const [overlays, setOverlays] = useState<Record<number, Overlay[]>>({});
  const [presets, setPresets] = useState<Record<number, string>>({});
  const [moreOpen, setMoreOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [tagsPanel, setTagsPanel] = useState<{ rows: TagRow[] | null; filter: string; error?: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelMode, setPanelMode] = useState<'tile' | 'list'>('tile');
  const [renderMs, setRenderMs] = useState(0);
  const [layout, setLayout] = useState<Layout>('1x1');
  const [fps, setFps] = useState(10);
  const [viewportSeries, setViewportSeries] = useState<number[]>([0]);
  const [activeViewport, setActiveViewport] = useState(0);
  // Latest state of every viewport; the toolbar, Undo, Tags and Cine use the active one's.
  const [reports, setReports] = useState<ViewportReport[]>([]);
  const moreRef = useRef<HTMLDivElement | null>(null);
  const windowsRef = useRef(new Map<number, WindowLevel>());
  const viewportRefs = useRef<RefObject<ViewportHandle | null>[]>([]);

  const headers = useMemo<Record<string, string>>(() => {
    const values: Record<string, string> = {};
    if (token) values.Authorization = `Bearer ${token}`;
    return values;
  }, [token]);

  const { rows, columns, count } = layoutSize(layout);
  while (viewportRefs.current.length < 4) viewportRefs.current.push(createRef<ViewportHandle>());
  const activeHandle = () => viewportRefs.current[activeViewport]?.current;

  const fetchInstance = useCallback(async (index: number) => {
    const response = await fetch(`${baseUrl}/instances/${index}`, { headers });
    if (!response.ok) throw new Error('Unable to download this image');
    return response.arrayBuffer();
  }, [baseUrl, headers]);

  const previewRequests = useRef(new Map<number, Promise<void>>());
  // Returns a promise that settles once the preview has arrived (or failed); never rejects.
  const ensurePreview = useCallback((index: number) => {
    const existing = previewRequests.current.get(index);
    if (existing) return existing;
    const request = fetch(`${baseUrl}/instances/${index}/preview`, { headers })
      .then(async response => {
        if (!response.ok) return;
        // data: URLs, because the portal CSP allows img-src 'self' data: but not blob:.
        const url = await blobToDataUrl(await response.blob());
        setPreviews(current => ({ ...current, [index]: url }));
      })
      .catch(() => { previewRequests.current.delete(index); });
    previewRequests.current.set(index, request);
    return request;
  }, [baseUrl, headers]);

  useEffect(() => {
    const created = new QuickViewDecoder();
    setDecoder(created);
    return () => created.dispose();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setManifest(null);
    setFailed(false);
    fetch(`${baseUrl}/manifest`, { headers, signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Unable to load this study');
        setManifest(await response.json() as Manifest);
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [baseUrl, headers]);

  // A study QuickView can't show opens in the full viewer instead; there is no separate button for it.
  useEffect(() => { if (failed) onOpenFull(); }, [failed, onOpenFull]);

  // Tiles show the first image of every series.
  useEffect(() => { manifest?.series.forEach(item => { if (item.instances[0]) void ensurePreview(item.instances[0].index); }); }, [manifest, ensurePreview]);

  // Changing the layout fills new viewports with the next series, like the full viewer.
  const changeLayout = (next: Layout) => {
    const size = layoutSize(next).count;
    const total = manifest?.series.length ?? 1;
    setViewportSeries(current => Array.from({ length: size }, (_, index) => current[index] ?? (current[0] + index) % total));
    setActiveViewport(current => Math.min(current, size - 1));
    setLayout(next);
  };

  const selectSeries = (index: number) => setViewportSeries(current => current.map((value, position) => (position === activeViewport ? index : value)));
  const stepSeries = (viewport: number, delta: number) => setViewportSeries(current => current.map((value, position) => (position === viewport ? Math.max(0, Math.min((manifest?.series.length ?? 1) - 1, value + delta)) : value)));

  const onRendered = useCallback((index: number, ms: number) => {
    setRenderMs(ms);
    setFullReady(current => (current[index] ? current : { ...current, [index]: true }));
  }, []);
  const reportHandlers = useMemo(() => [0, 1, 2, 3].map(position => (next: ViewportReport) => setReports(current => {
    const copy = [...current];
    copy[position] = next;
    return copy;
  })), []);
  const report: ViewportReport = reports[activeViewport] ?? { playing: false, canCine: false };

  const undo = () => {
    const index = report.instance?.index;
    if (index === undefined) return;
    setOverlays(current => ({ ...current, [index]: (current[index] ?? []).slice(0, -1) }));
  };

  const clearOverlays = () => {
    const index = report.instance?.index;
    if (index !== undefined) setOverlays(current => ({ ...current, [index]: [] }));
    activeHandle()?.cancelDrafts();
  };

  const chooseTool = (next: Tool) => { setTool(next); setMoreOpen(false); };

  const exportStudy = async () => {
    setMoreOpen(false);
    setExporting(true);
    try {
      const response = await fetch(`${baseUrl}/export`, { headers });
      if (!response.ok) throw new Error('Export failed');
      const name = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '')?.[1] ?? 'study.zip';
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      window.alert('Unable to export this study.');
    } finally {
      setExporting(false);
    }
  };

  const openTags = () => {
    setMoreOpen(false);
    const index = report.instance?.index;
    if (index === undefined || !decoder) return;
    setTagsPanel({ rows: null, filter: '' });
    decoder.load(index, () => fetchInstance(index))
      .then(() => decoder.tags(index))
      .then(rows => setTagsPanel(current => current && { ...current, rows }), () => setTagsPanel(current => current && { ...current, rows: [], error: 'Tags are not available for this image' }));
  };

  // The More menu closes on any outside click or Escape, like the full viewer's.
  useEffect(() => {
    if (!moreOpen) return;
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !moreRef.current?.contains(event.target as Node)) { setMoreOpen(false); setKeysOpen(false); }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, [moreOpen]);

  if (!manifest) return <section className="qv-shell"><div className="qv-message" role="status"><p>Loading study…</p></div></section>;

  const modality = manifest.modalities.join(', ') || manifest.series[0]?.modality || '';
  const activeSeries = viewportSeries[activeViewport] ?? 0;
  const estimatedMb = Object.keys(fullReady).reduce((sum, key) => {
    const item = manifest.series.flatMap(entry => entry.instances).find(entry => entry.index === Number(key));
    return sum + (item ? item.rows * item.columns * 4 * Math.max(1, item.frames) : 0);
  }, 0) / 1024 / 1024;
  const actionButtons = (className?: string) => <>
    <ToolButton className={className} icon={<Undo2/>} label="Undo" title="Undo last annotation or measurement (Ctrl+Z)" onClick={undo}/>
    <ToolButton className={className} icon={<Box/>} label="MPR" title="3D MPR" disabled onClick={() => undefined}/>
    <ToolButton className={className} icon={report.playing ? <Pause/> : <Play/>} label="Cine" title="Cine" active={report.playing} onClick={() => activeHandle()?.togglePlay()}/>
  </>;

  return <section className="qv-shell">
    <header className="qv-patient-header">
      <div className="qv-brand"><strong>DecXpert Viewer</strong><span>Diagnostic workstation</span></div>
      <div className="qv-patient"><strong>{manifest.patientName || 'Unknown patient'}</strong><span>{manifest.patientId}</span></div>
      <div className="qv-study"><span>{formatAgeSex(manifest.patientAge, manifest.patientSex)}</span><span>{manifest.studyDescription}</span></div>
      <div className="qv-modality"><span>{formatDicomDate(manifest.studyDate)}</span><strong>{modality}</strong></div>
    </header>

    <div className="qv-toolbar" role="toolbar" aria-label="Viewer tools">
      <div className="qv-tool-group">
        <ToolButton icon={<Gauge/>} label="Window" title="Window / Level" active={tool === 'window'} onClick={() => setTool('window')}/>
        <ToolButton icon={<Move/>} label="Pan" active={tool === 'pan'} onClick={() => setTool('pan')}/>
        <ToolButton icon={<Search/>} label="Zoom" active={tool === 'zoom'} onClick={() => setTool('zoom')}/>
        <ToolButton icon={<Ruler/>} label="Length" active={tool === 'length'} onClick={() => setTool('length')}/>
        <ToolButton icon={<Type/>} label="Note" title="Annotation" active={tool === 'note'} onClick={() => setTool('note')}/>
      </div>
      <div className="qv-tool-group qv-tool-actions" ref={moreRef}>
        {actionButtons('qv-toolbar-action')}
        <ToolButton icon={<Ellipsis/>} label="More" title="More tools" active={moreOpen} onClick={() => { setMoreOpen(current => !current); setKeysOpen(false); }}/>
        {moreOpen && <div className="qv-more-menu" role="menu" aria-label="More tools">
          {/* Phones: Undo, MPR and Cine move from the toolbar into the menu, as in the full viewer. */}
          <div className="qv-menu-section qv-menu-actions"><span className="qv-menu-title">Actions</span><div className="qv-menu-grid">{actionButtons()}</div></div>
          <div className="qv-menu-section"><span className="qv-menu-title">Tools</span><div className="qv-menu-grid">
            <ToolButton icon={<ScanLine/>} label="Angle" active={tool === 'angle'} onClick={() => chooseTool('angle')}/>
            <ToolButton icon={<Square/>} label="Rect" title="Rectangle ROI" active={tool === 'rect'} onClick={() => chooseTool('rect')}/>
            <ToolButton icon={<Square/>} label="Ellipse" title="Ellipse ROI" active={tool === 'ellipse'} onClick={() => chooseTool('ellipse')}/>
            <ToolButton icon={<Target/>} label="Probe" active={tool === 'probe'} onClick={() => chooseTool('probe')}/>
          </div></div>
          <div className="qv-menu-section"><span className="qv-menu-title">Image</span><div className="qv-menu-grid">
            <ToolButton icon={<Activity/>} label="Invert" onClick={() => activeHandle()?.invert()}/>
            <ToolButton icon={<RotateCw/>} label="Rotate" title="Rotate 90" onClick={() => activeHandle()?.rotate()}/>
            <ToolButton icon={<FlipHorizontalIcon/>} label="Flip H" title="Flip Horizontal" onClick={() => activeHandle()?.flipH()}/>
            <ToolButton icon={<FlipVerticalIcon/>} label="Flip V" title="Flip Vertical" onClick={() => activeHandle()?.flipV()}/>
            <ToolButton icon={<Undo2/>} label="Reset" title="Reset view" onClick={() => activeHandle()?.reset()}/>
            <ToolButton icon={<Trash2/>} label="Clear" title="Clear overlays" onClick={clearOverlays}/>
          </div></div>
          <div className="qv-menu-section qv-menu-row">
            <label htmlFor="qv-fps">FPS</label>
            <select id="qv-fps" title="Cine FPS" value={fps} onChange={event => setFps(Number(event.target.value))}>{FPS_OPTIONS.map(value => <option key={value} value={value}>{value}</option>)}</select>
            <label htmlFor="qv-layout">Layout</label>
            <select id="qv-layout" title="Layout" value={layout} onChange={event => changeLayout(event.target.value as Layout)}>{LAYOUTS.map(value => <option key={value} value={value}>{value}</option>)}</select>
          </div>
          <div className="qv-menu-section"><div className="qv-menu-grid">
            <ToolButton icon={<Download/>} label="Export" title="Export study" disabled={exporting} onClick={() => void exportStudy()}/>
            <ToolButton icon={<FileText/>} label="Tags" title="DICOM tags" onClick={openTags}/>
            <ToolButton icon={<Keyboard/>} label="Keys" title="Keyboard shortcuts" active={keysOpen} onClick={() => setKeysOpen(current => !current)}/>
          </div>
          {keysOpen && <dl className="qv-shortcuts">
            <dt>↑ ↓ / wheel</dt><dd>Previous / next image</dd><dt>← →</dt><dd>Previous / next series</dd>
            <dt>Ctrl + wheel</dt><dd>Zoom</dd><dt>I</dt><dd>Invert</dd><dt>R</dt><dd>Reset view</dd><dt>Ctrl + Z</dt><dd>Undo</dd><dt>Esc</dt><dd>Cancel</dd>
          </dl>}</div>
        </div>}
      </div>
    </div>

    <div className="qv-workstation">
      <aside className={`qv-series-panel${panelOpen ? '' : ' collapsed'}`} aria-label="Series">
        <div className="qv-series-header">
          {panelOpen && <div className="qv-series-header-main">
            <span className="qv-panel-title"><Layers/>Series</span>
            <div className="qv-view-toggle">
              <button type="button" className={panelMode === 'list' ? 'active' : ''} aria-label="List view" onClick={() => setPanelMode('list')}><List size={16}/></button>
              <button type="button" className={panelMode === 'tile' ? 'active' : ''} aria-label="Tile view" onClick={() => setPanelMode('tile')}><Grid2x2 size={16}/></button>
            </div>
          </div>}
          <button type="button" className="qv-icon-button" aria-label={panelOpen ? 'Hide series panel' : 'Show series panel'} onClick={() => setPanelOpen(current => !current)}>
            {panelOpen ? <PanelLeftClose size={16}/> : <PanelLeftOpen size={16}/>}
          </button>
        </div>
        {panelOpen && <div className={`qv-series-strip${panelMode === 'list' ? ' list' : ''}`}>
          {manifest.series.map((item, index) => {
            const first = item.instances[0];
            return <button key={item.seriesInstanceUid} type="button" className={`qv-series-tile${index === activeSeries ? ' selected' : ''}`} onClick={() => selectSeries(index)} title={seriesTitle(item)}>
              <div className="qv-series-preview">
                {first && previews[first.index] ? <img src={previews[first.index]} alt=""/> : null}
                <span className="qv-series-count">{item.instances.length}</span>
              </div>
              <div className="qv-series-info">
                {item.modality && <span className="qv-series-modality">{item.modality}</span>}
                <strong>{seriesTitle(item)}</strong>
                <span className="qv-series-meta">S:{item.seriesNumber ?? '-'} - {item.instances.length} image{item.instances.length === 1 ? '' : 's'}</span>
              </div>
            </button>;
          })}
        </div>}
      </aside>

      <div className="qv-viewport-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
        {Array.from({ length: count }, (_, position) => <QuickViewViewport key={position} ref={viewportRefs.current[position]}
          manifest={manifest} seriesIndex={viewportSeries[position] ?? 0} onSeriesStep={delta => stepSeries(position, delta)}
          active={position === activeViewport} multi={count > 1} onActivate={() => setActiveViewport(position)}
          decoder={decoder} fetchInstance={fetchInstance} ensurePreview={ensurePreview} previews={previews} tool={tool} fps={fps}
          overlays={overlays} setOverlays={setOverlays} presets={presets} setPresets={setPresets} windowsRef={windowsRef}
          onReport={reportHandlers[position]} onRendered={onRendered}/>)}
        <span className="qv-connected">Connected</span>
        {tagsPanel && <div className="qv-tags-panel" role="dialog" aria-label="DICOM tags" onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
          <div className="qv-tags-head">
            <strong>DICOM tags</strong>
            <input aria-label="Filter tags" placeholder="Filter by name, tag or value" value={tagsPanel.filter} onChange={event => setTagsPanel(current => current && { ...current, filter: event.target.value })}/>
            <button type="button" className="qv-tool" aria-label="Close DICOM tags" onClick={() => setTagsPanel(null)}>Close</button>
          </div>
          <div className="qv-tags-body">
            {!tagsPanel.rows ? <p>Loading tags…</p> : tagsPanel.error ? <p>{tagsPanel.error}</p> : <table>
              <tbody>{tagsPanel.rows.filter(row => `${row.tag} ${row.name} ${row.value}`.toLowerCase().includes(tagsPanel.filter.toLowerCase())).map(row => <tr key={row.tag + row.name}>
                <td className="qv-tag-id">{row.tag}</td><td>{row.name}</td><td className="qv-tag-vr">{row.vr}</td><td className="qv-tag-value">{row.value}</td>
              </tr>)}</tbody>
            </table>}
          </div>
        </div>}
      </div>
    </div>

    <footer className="qv-status-bar">
      <span>Connected study</span>
      <span>Images loaded on demand</span>
      <span>{Object.keys(fullReady).length} frames cached</span>
      <span>{estimatedMb.toFixed(1)} MB estimated</span>
      <span>Render {renderMs.toFixed(1)} ms</span>
    </footer>
  </section>;
}
