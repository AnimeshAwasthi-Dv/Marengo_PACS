import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Dispatch, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent, type SetStateAction } from 'react';
import type { QuickViewDecoder } from './quickviewDecoder';
import { angleAt, formatArea, lineLength, orientationMarkers, pinchChange, stageToImage, WINDOW_PRESETS, type Line, type Point, type View } from './quickviewMath';
import type { RegionStats } from './quickviewPixels';
import { seriesTitle, type Manifest, type ManifestInstance, type Overlay, type Tool, type ViewportHandle, type ViewportReport, type WindowLevel } from './quickviewTypes';

const INITIAL_VIEW: View = { zoom: 1, panX: 0, panY: 0, rotation: 0, flip: false, flipV: false, invert: false };
const PREVIEW_HEAD_START_MS = 1500;
const DOUBLE_TAP_MS = 300;
const DRAG_TOOLS: Tool[] = ['length', 'rect', 'ellipse'];
let nextOverlayId = 1;

function statLines(overlay: { kind: 'rect' | 'ellipse'; from: Point; to: Point; stats?: RegionStats | null }, spacing: [number, number] | null | undefined) {
  const w = Math.abs(overlay.to.x - overlay.from.x), h = Math.abs(overlay.to.y - overlay.from.y);
  const lines = [formatArea(overlay.kind === 'rect' ? w * h : Math.PI * (w / 2) * (h / 2), spacing)];
  if (overlay.stats === undefined) lines.push('Measuring…');
  else if (!overlay.stats) lines.push('Values not available');
  else {
    const stats = overlay.stats;
    lines.push(`Mean ${stats.mean.toFixed(1)} · SD ${stats.sd.toFixed(1)}${stats.luminance ? ' (luminance)' : ''}`, `Min ${stats.min.toFixed(0)} · Max ${stats.max.toFixed(0)}`);
  }
  return lines;
}

type Props = {
  manifest: Manifest;
  seriesIndex: number;
  onSeriesStep: (delta: number) => void;
  active: boolean;
  multi: boolean;
  onActivate: () => void;
  decoder: QuickViewDecoder | null;
  fetchInstance: (index: number) => Promise<ArrayBuffer>;
  ensurePreview: (index: number) => Promise<void>;
  previews: Record<number, string>;
  tool: Tool;
  fps: number;
  overlays: Record<number, Overlay[]>;
  setOverlays: Dispatch<SetStateAction<Record<number, Overlay[]>>>;
  presets: Record<number, string>;
  setPresets: Dispatch<SetStateAction<Record<number, string>>>;
  windowsRef: MutableRefObject<Map<number, WindowLevel>>;
  onReport: (report: ViewportReport) => void;
  onRendered: (index: number, renderMs: number) => void;
};

/**
 * One image viewport: its own series, image, frame, zoom/pan/rotation, window/level and gestures.
 * The shell shows one to four of these (Layout 1x1, 1x2, 2x1, 2x2); toolbar and menu act on the active one.
 */
export const QuickViewViewport = forwardRef<ViewportHandle, Props>(function QuickViewViewport(props, ref) {
  const { manifest, seriesIndex, onSeriesStep, active, multi, onActivate, decoder, fetchInstance, ensurePreview, previews, tool, fps, overlays, setOverlays, presets, setPresets, windowsRef, onReport, onRendered } = props;
  const [imageIndex, setImageIndex] = useState(0);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [view, setView] = useState<View>(INITIAL_VIEW);
  const [status, setStatus] = useState('');
  const [windowLevel, setWindowLevel] = useState<WindowLevel | null>(null);
  const [painted, setPainted] = useState<number | null>(null);
  const [draft, setDraft] = useState<Line | null>(null);
  const [regionDraft, setRegionDraft] = useState<{ kind: 'rect' | 'ellipse'; from: Point; to: Point } | null>(null);
  const [angleDraft, setAngleDraft] = useState<{ points: Point[]; hover: Point | null } | null>(null);
  const [noteDraft, setNoteDraft] = useState<{ at: Point; x: number; y: number; text: string } | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const renderState = useRef({ inFlight: false, queued: false });
  const dragRef = useRef<{ x: number; y: number; view: View; windowLevel: WindowLevel | null; tool: Tool; start?: Point; end?: Point } | null>(null);
  // Active fingers/pointers, a two-finger gesture in progress, and the last tap (for double-tap to fit).
  const pointersRef = useRef(new Map<number, Point>());
  const pinchRef = useRef<{ start: [Point, Point]; view: View } | null>(null);
  const lastTapRef = useRef({ time: 0, moved: false });

  const series = manifest.series[seriesIndex];
  const instance: ManifestInstance | undefined = series?.instances[Math.min(imageIndex, (series?.instances.length ?? 1) - 1)];
  const frames = instance?.frames ?? 1;
  const imageCount = series?.instances.length ?? 0;
  const canCine = frames > 1 || imageCount > 1;
  const imageSize = instance ? { width: instance.columns, height: instance.rows } : null;

  // A new series starts at its first image.
  useEffect(() => { setImageIndex(0); setFrame(0); }, [seriesIndex]);

  useEffect(() => { onReport({ instance, playing, canCine }); }, [instance, playing, canCine, onReport]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) => setBox({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  // draw() always renders whatever is current when it runs, so queued redraws never paint a stale image.
  const latest = useRef<{ instance?: ManifestInstance; frame: number }>({ frame: 0 });
  const drawRef = useRef<() => Promise<void>>(async () => undefined);
  useLayoutEffect(() => { latest.current = { instance, frame }; }, [instance, frame]);

  const draw = useCallback(async () => {
    const target = latest.current.instance;
    if (!decoder || !target) return;
    if (renderState.current.inFlight) { renderState.current.queued = true; return; }
    renderState.current.inFlight = true;
    const index = target.index;
    const isCurrent = () => latest.current.instance?.index === index;
    try {
      // Let the small preview win the network first; the full image download starts right after it.
      await Promise.race([ensurePreview(index), new Promise(resolve => setTimeout(resolve, PREVIEW_HEAD_START_MS))]);
      if (!isCurrent()) return;
      await decoder.load(index, () => fetchInstance(index));
      if (!isCurrent()) return;
      const chosen = windowsRef.current.get(index);
      const started = performance.now();
      const rendered = await decoder.render(index, Math.min(latest.current.frame, target.frames - 1), chosen?.width, chosen?.center);
      if (!isCurrent()) return;
      const canvas = canvasRef.current;
      if (canvas) {
        if (canvas.width !== rendered.width) canvas.width = rendered.width;
        if (canvas.height !== rendered.height) canvas.height = rendered.height;
        canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(rendered.pixels), rendered.width, rendered.height), 0, 0);
      }
      onRendered(index, performance.now() - started);
      setWindowLevel(rendered.windowWidth !== undefined && rendered.windowCenter !== undefined ? { width: rendered.windowWidth, center: rendered.windowCenter } : null);
      setPainted(index);
      setStatus('');
    } catch (reason) {
      if (isCurrent()) setStatus(reason instanceof Error ? reason.message : 'Unable to show this image');
    } finally {
      renderState.current.inFlight = false;
      if (renderState.current.queued) { renderState.current.queued = false; void drawRef.current(); }
    }
  }, [decoder, fetchInstance, ensurePreview, windowsRef, onRendered]);
  useLayoutEffect(() => { drawRef.current = draw; }, [draw]);

  useEffect(() => { if (instance) void draw(); }, [instance, frame, draw]);

  // Previews of the open series make scrubbing instant; full images download on demand plus neighbours.
  useEffect(() => { series?.instances.forEach(item => void ensurePreview(item.index)); }, [series, ensurePreview]);

  useEffect(() => {
    if (!decoder || !series || !instance || painted !== instance.index) return;
    const position = series.instances.indexOf(instance);
    for (const neighbour of [series.instances[position + 1], series.instances[position - 1]]) {
      if (neighbour) void decoder.load(neighbour.index, () => fetchInstance(neighbour.index)).catch(() => undefined);
    }
  }, [decoder, series, instance, painted, fetchInstance]);

  // Cine plays a multi-frame clip, or steps through the images of the series, at the chosen FPS.
  useEffect(() => {
    if (!playing || !canCine) return;
    const timer = window.setInterval(() => {
      if (frames > 1) setFrame(current => (current + 1) % frames);
      else setImageIndex(current => (current + 1) % imageCount);
    }, 1000 / Math.max(1, fps));
    return () => window.clearInterval(timer);
  }, [playing, canCine, frames, imageCount, fps]);

  const step = useCallback((delta: number) => {
    if (frames > 1) { setPlaying(false); setFrame(current => Math.max(0, Math.min(frames - 1, current + delta))); return; }
    setImageIndex(current => Math.max(0, Math.min(imageCount - 1, current + delta)));
    setDraft(null);
  }, [frames, imageCount]);

  const resetView = useCallback(() => {
    setView(INITIAL_VIEW);
    if (instance) {
      windowsRef.current.delete(instance.index);
      setPresets(current => { const next = { ...current }; delete next[instance.index]; return next; });
    }
    void draw();
  }, [instance, draw, windowsRef, setPresets]);

  const cancelDrafts = useCallback(() => { setDraft(null); setNoteDraft(null); setAngleDraft(null); setRegionDraft(null); }, []);

  useImperativeHandle(ref, () => ({
    invert: () => setView(current => ({ ...current, invert: !current.invert })),
    rotate: () => setView(current => ({ ...current, rotation: (current.rotation + 90) % 360 })),
    flipH: () => setView(current => ({ ...current, flip: !current.flip })),
    flipV: () => setView(current => ({ ...current, flipV: !current.flipV })),
    reset: resetView,
    // Like the full viewer, Cine always toggles (active + pause icon); it animates when there is more than one image or frame.
    togglePlay: () => setPlaying(current => !current),
    cancelDrafts,
  }), [resetView, cancelDrafts]);

  // Leaving a drawing tool mid-way drops the unfinished shape.
  useEffect(() => { cancelDrafts(); }, [tool, cancelDrafts]);

  const applyPreset = (name: string) => {
    if (!instance || !(name in WINDOW_PRESETS)) return;
    windowsRef.current.set(instance.index, WINDOW_PRESETS[name]);
    setPresets(current => ({ ...current, [instance.index]: name }));
    void draw();
  };

  const addOverlay = (index: number, overlay: Overlay) => setOverlays(current => ({ ...current, [index]: [...(current[index] ?? []), overlay] }));
  const updateOverlay = (index: number, id: number, patch: Partial<Overlay>) => setOverlays(current => ({
    ...current, [index]: (current[index] ?? []).map(item => ('id' in item && item.id === id ? { ...item, ...patch } as Overlay : item)),
  }));

  /** Region statistics and probe values come from the decoder worker, using real (rescaled) pixel values. */
  const measureRegion = (index: number, kind: 'rect' | 'ellipse', from: Point, to: Point) => {
    const id = nextOverlayId++;
    addOverlay(index, { kind, id, from, to });
    decoder?.stats(index, Math.min(frame, frames - 1), { kind, x0: from.x, y0: from.y, x1: to.x, y1: to.y })
      .then(stats => updateOverlay(index, id, { stats }), () => updateOverlay(index, id, { stats: null }));
  };

  const probeAt = (index: number, at: Point) => {
    const id = nextOverlayId++;
    addOverlay(index, { kind: 'probe', id, at });
    decoder?.probe(index, Math.min(frame, frames - 1), at.x, at.y)
      .then(probe => updateOverlay(index, id, { probe }), () => updateOverlay(index, id, { probe: null }));
  };

  const commitNote = () => {
    const pending = noteDraft;
    setNoteDraft(null);
    if (!pending || !instance || !pending.text.trim()) return;
    addOverlay(instance.index, { kind: 'note', note: { at: pending.at, text: pending.text.trim() } });
  };

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) setView(current => ({ ...current, zoom: Math.max(0.1, Math.min(20, current.zoom * (event.deltaY < 0 ? 1.1 : 0.9))) }));
      else step(event.deltaY > 0 ? 1 : -1);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [step]);

  const rotated = view.rotation % 180 !== 0;
  const fit = imageSize && box.width && box.height
    ? Math.min(box.width / (rotated ? imageSize.height : imageSize.width), box.height / (rotated ? imageSize.width : imageSize.height))
    : 1;
  const scale = fit * view.zoom;
  const showFull = instance !== undefined && painted === instance.index;
  const canAdjust = showFull && windowLevel !== null;

  const toImagePoint = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return stageToImage({ x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 }, view, scale, imageSize ?? { width: 1, height: 1 });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    onActivate();
    event.currentTarget.focus();
    // Capture can throw if the pointer was already released (very quick taps); the gesture still works without it.
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* not capturable */ }
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size === 2) {
      // A second finger turns any single-finger action into pinch-zoom / two-finger pan.
      const [a, b] = [...pointersRef.current.values()];
      pinchRef.current = { start: [a, b], view };
      dragRef.current = null;
      setDraft(null);
      setRegionDraft(null);
      return;
    }
    if (pointersRef.current.size > 2) return;
    lastTapRef.current.moved = false;
    const activeTool: Tool = event.button === 1 ? 'pan' : event.button === 2 ? 'zoom' : tool;
    if (activeTool === 'note') {
      // Note: type text where the image was clicked; Enter places it, Escape cancels.
      // preventDefault stops the browser's mousedown from moving focus back to the image, which would
      // blur the new text box (and discard the empty note) before the user can type.
      event.preventDefault();
      commitNote();
      const rect = event.currentTarget.getBoundingClientRect();
      setNoteDraft({ at: toImagePoint(event), x: event.clientX - rect.left, y: event.clientY - rect.top, text: '' });
      pointersRef.current.delete(event.pointerId);
      return;
    }
    if (activeTool === 'probe' && instance) { probeAt(instance.index, toImagePoint(event)); pointersRef.current.delete(event.pointerId); return; }
    if (activeTool === 'angle' && instance) {
      // Angle: click the first arm, the vertex, then the second arm.
      const point = toImagePoint(event);
      const points = [...(angleDraft?.points ?? []), point];
      if (points.length === 3) { addOverlay(instance.index, { kind: 'angle', points: [points[0], points[1], points[2]] }); setAngleDraft(null); }
      else setAngleDraft({ points, hover: point });
      pointersRef.current.delete(event.pointerId);
      return;
    }
    const start = DRAG_TOOLS.includes(activeTool) ? toImagePoint(event) : undefined;
    if (start && activeTool === 'length') setDraft({ from: start, to: start });
    if (start && (activeTool === 'rect' || activeTool === 'ellipse')) setRegionDraft({ kind: activeTool, from: start, to: start });
    dragRef.current = { x: event.clientX, y: event.clientY, view, windowLevel, tool: activeTool, start };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointersRef.current.has(event.pointerId)) pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pinch = pinchRef.current;
    if (pinch && pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()];
      const change = pinchChange(pinch.start, [a, b]);
      setView({ ...pinch.view, zoom: Math.max(0.1, Math.min(20, pinch.view.zoom * change.scale)), panX: pinch.view.panX + change.dx, panY: pinch.view.panY + change.dy });
      return;
    }
    if (angleDraft && tool === 'angle') { setAngleDraft({ ...angleDraft, hover: toImagePoint(event) }); return; }
    const drag = dragRef.current;
    if (!drag || !instance) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) lastTapRef.current.moved = true;
    if (drag.tool === 'pan') setView({ ...drag.view, panX: drag.view.panX + dx, panY: drag.view.panY + dy });
    else if (drag.tool === 'zoom') setView({ ...drag.view, zoom: Math.max(0.1, Math.min(20, drag.view.zoom * Math.exp(-dy / 200))) });
    else if (DRAG_TOOLS.includes(drag.tool) && drag.start) {
      // Kept in the ref too: pointerup may arrive before React re-renders with the latest draft.
      drag.end = toImagePoint(event);
      if (drag.tool === 'length') setDraft({ from: drag.start, to: drag.end });
      else setRegionDraft({ kind: drag.tool as 'rect' | 'ellipse', from: drag.start, to: drag.end });
    }
    else if (drag.tool === 'window' && drag.windowLevel && canAdjust) {
      const sensitivity = Math.max(0.5, drag.windowLevel.width / 400);
      const next = { width: Math.max(1, drag.windowLevel.width + dx * sensitivity), center: drag.windowLevel.center + dy * sensitivity };
      windowsRef.current.set(instance.index, next);
      if (presets[instance.index]) setPresets(current => { const copy = { ...current }; delete copy[instance.index]; return copy; });
      setWindowLevel(next);
      void draw();
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pinchRef.current) {
      // Lifting one finger ends the gesture; the other finger must lift before a new action starts.
      if (pointersRef.current.size < 2) pinchRef.current = null;
      dragRef.current = null;
      return;
    }
    const drag = dragRef.current;
    dragRef.current = null;
    // Double-tap (touch) fits the image back to the screen.
    if (event.pointerType === 'touch' && drag && !lastTapRef.current.moved && !DRAG_TOOLS.includes(drag.tool)) {
      const now = Date.now();
      if (now - lastTapRef.current.time < DOUBLE_TAP_MS) { setView(current => ({ ...INITIAL_VIEW, invert: current.invert })); lastTapRef.current.time = 0; }
      else lastTapRef.current.time = now;
    }
    if (drag?.tool === 'length' && drag.start && drag.end && instance && Math.hypot(drag.end.x - drag.start.x, drag.end.y - drag.start.y) > 2) {
      addOverlay(instance.index, { kind: 'line', line: { from: drag.start, to: drag.end } });
    }
    if ((drag?.tool === 'rect' || drag?.tool === 'ellipse') && drag.start && drag.end && instance && Math.abs(drag.end.x - drag.start.x) > 2 && Math.abs(drag.end.y - drag.start.y) > 2) {
      measureRegion(instance.index, drag.tool, drag.start, drag.end);
    }
    setDraft(null);
    setRegionDraft(null);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (['ArrowDown', 'PageDown'].includes(event.key)) { event.preventDefault(); step(1); }
    else if (['ArrowUp', 'PageUp'].includes(event.key)) { event.preventDefault(); step(-1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); onSeriesStep(1); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); onSeriesStep(-1); }
    else if (event.key.toLowerCase() === 'i') setView(current => ({ ...current, invert: !current.invert }));
    else if (event.key.toLowerCase() === 'r') resetView();
    else if (event.key === 'Escape') cancelDrafts();
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && instance) {
      event.preventDefault();
      setOverlays(current => ({ ...current, [instance.index]: (current[instance.index] ?? []).slice(0, -1) }));
    }
  };

  const markers = orientationMarkers(instance?.patientOrientation, view);
  const imageOverlays = instance ? overlays[instance.index] ?? [] : [];
  const lines = [...imageOverlays.flatMap(item => item.kind === 'line' ? [item.line] : []), ...(draft ? [draft] : [])];
  const notes = imageOverlays.flatMap(item => item.kind === 'note' ? [item.note] : []);
  const regions = imageOverlays.flatMap(item => item.kind === 'rect' || item.kind === 'ellipse' ? [item] : []);
  const angles = imageOverlays.flatMap(item => item.kind === 'angle' ? [item.points as Point[]] : []);
  const probes = imageOverlays.flatMap(item => item.kind === 'probe' ? [item] : []);
  const stroke = Math.max(1, 1.5 / scale);
  // Keep text readable when the image is flipped: mirror it back around its own anchor.
  const unflip = (x: number, y: number) => (view.flip || view.flipV ? `translate(${x} ${y}) scale(${view.flip ? -1 : 1} ${view.flipV ? -1 : 1}) translate(${-x} ${-y})` : undefined);
  const layerStyle = imageSize ? {
    width: imageSize.width, height: imageSize.height,
    transform: `translate(-50%, -50%) translate(${view.panX}px, ${view.panY}px) rotate(${view.rotation}deg) scale(${scale}) scale(${view.flip ? -1 : 1}, ${view.flipV ? -1 : 1})`,
    filter: view.invert ? 'invert(1)' : undefined,
  } : undefined;

  return <div ref={stageRef} className={`qv-viewport-stage${multi && active ? ' active' : ''}`} data-tool={tool} tabIndex={0} onKeyDown={onKeyDown} onContextMenu={event => event.preventDefault()}
    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
    aria-label="Study image. Arrow keys change image or series, I inverts, R resets.">
    {layerStyle && <div className="qv-image-layer" style={layerStyle}>
      {!showFull && instance && previews[instance.index] && <img src={previews[instance.index]} alt=""/>}
      <canvas ref={canvasRef} style={{ visibility: showFull ? 'visible' : 'hidden' }}/>
      <svg className="qv-measure" viewBox={`0 0 ${imageSize!.width} ${imageSize!.height}`} width={imageSize!.width} height={imageSize!.height}>
        {lines.map((line, index) => <g key={index}>
          <line x1={line.from.x} y1={line.from.y} x2={line.to.x} y2={line.to.y} strokeWidth={stroke}/>
          <circle cx={line.from.x} cy={line.from.y} r={stroke * 2}/><circle cx={line.to.x} cy={line.to.y} r={stroke * 2}/>
          <text x={line.to.x + 8 / scale} y={line.to.y - 8 / scale} fontSize={13 / scale} strokeWidth={3 / scale}
            transform={unflip(line.to.x + 8 / scale, line.to.y - 8 / scale)}>{lineLength(line, instance?.pixelSpacing)}</text>
        </g>)}
        {notes.map((note, index) => <text key={`note-${index}`} className="qv-note" x={note.at.x} y={note.at.y} fontSize={14 / scale} strokeWidth={3 / scale} transform={unflip(note.at.x, note.at.y)}>{note.text}</text>)}
        {[...regions, ...(regionDraft ? [{ ...regionDraft, id: -1, stats: undefined }] : [])].map(region => {
          const x = Math.min(region.from.x, region.to.x), y = Math.min(region.from.y, region.to.y);
          const w = Math.abs(region.to.x - region.from.x), h = Math.abs(region.to.y - region.from.y);
          const labelX = x + w + 6 / scale, labelY = y + h;
          return <g key={`region-${region.id}`}>
            {region.kind === 'rect' ? <rect x={x} y={y} width={w} height={h} strokeWidth={stroke}/> : <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} strokeWidth={stroke}/>}
            {region.id !== -1 && statLines(region, instance?.pixelSpacing).map((text, line) => <text key={line} x={labelX} y={labelY + line * 16 / scale} fontSize={13 / scale} strokeWidth={3 / scale} transform={unflip(labelX, labelY + line * 16 / scale)}>{text}</text>)}
          </g>;
        })}
        {[...angles, ...(angleDraft ? [[...angleDraft.points, ...(angleDraft.hover ? [angleDraft.hover] : [])]] : [])].map((points, index) => <g key={`angle-${index}`}>
          <polyline points={points.map(point => `${point.x},${point.y}`).join(' ')} strokeWidth={stroke} fill="none"/>
          {points.map((point, dot) => <circle key={dot} cx={point.x} cy={point.y} r={stroke * 2}/>)}
          {points.length === 3 && <text x={points[1].x + 8 / scale} y={points[1].y - 8 / scale} fontSize={13 / scale} strokeWidth={3 / scale} transform={unflip(points[1].x + 8 / scale, points[1].y - 8 / scale)}>{`${angleAt(points[0], points[1], points[2]).toFixed(1)}°`}</text>}
        </g>)}
        {probes.map(probe => <g key={`probe-${probe.id}`}>
          <circle cx={probe.at.x} cy={probe.at.y} r={stroke * 3} fill="none" strokeWidth={stroke}/>
          <text x={probe.at.x + 8 / scale} y={probe.at.y - 8 / scale} fontSize={13 / scale} strokeWidth={3 / scale} transform={unflip(probe.at.x + 8 / scale, probe.at.y - 8 / scale)}>
            {probe.probe === undefined ? '…' : !probe.probe ? 'n/a' : probe.probe.rgb ? `(${probe.probe.x}, ${probe.probe.y}) RGB ${probe.probe.rgb.join(', ')}` : `(${probe.probe.x}, ${probe.probe.y}) ${probe.probe.value?.toFixed(1)}`}
          </text>
        </g>)}
      </svg>
    </div>}

    <div className="qv-ov top-left"><span>{manifest.patientName || 'Unknown patient'}</span><span>{manifest.patientId}</span></div>
    <div className="qv-ov top-right"><span>{series?.modality ?? manifest.modalities.join(', ')}</span><span>{series ? seriesTitle(series) : ''}</span></div>
    <div className="qv-ov bottom-left">
      <span>{windowLevel ? `WW ${Math.round(windowLevel.width)} WL ${Math.round(windowLevel.center)}` : 'WW -- WL --'}</span>
      <span>{view.zoom.toFixed(2)}x</span>
      <span>{frames > 1 ? `${frame + 1} / ${frames}` : `${Math.min(imageIndex, imageCount - 1) + 1} / ${imageCount}`}</span>
    </div>
    <div className="qv-ov bottom-right">
      <span>Thk {instance?.sliceThickness ?? '--'}</span>
      <span>Spacing {instance?.pixelSpacing ? `${instance.pixelSpacing[0]} x ${instance.pixelSpacing[1]}` : '--'}</span>
    </div>
    {markers && <>
      <span className="qv-orientation top">{markers.top}</span><span className="qv-orientation bottom">{markers.bottom}</span>
      <span className="qv-orientation left">{markers.left}</span><span className="qv-orientation right">{markers.right}</span>
    </>}
    <div className="qv-viewport-controls" onPointerDown={event => event.stopPropagation()}>
      <select className="qv-preset" aria-label="Window preset" value={instance ? presets[instance.index] ?? '' : ''} disabled={!canAdjust} onChange={event => applyPreset(event.target.value)}>
        <option value="">Preset</option>
        {Object.keys(WINDOW_PRESETS).map(name => <option key={name} value={name}>{name}</option>)}
      </select>
    </div>
    {(frames > 1 || imageCount > 1) && <div className="qv-scrubber" onPointerDown={event => event.stopPropagation()}>
      <span>1</span>
      <input type="range" aria-label={frames > 1 ? 'Frame' : 'Image'} min={0} max={(frames > 1 ? frames : imageCount) - 1}
        value={frames > 1 ? frame : Math.min(imageIndex, imageCount - 1)}
        onChange={event => { const value = Number(event.target.value); if (frames > 1) { setPlaying(false); setFrame(value); } else setImageIndex(value); }}/>
      <span>{frames > 1 ? frames : imageCount}</span>
    </div>}
    {noteDraft && <input className="qv-note-input" autoFocus aria-label="Annotation text" placeholder="Type a note, Enter to place" value={noteDraft.text}
      style={{ left: Math.max(8, Math.min(noteDraft.x, box.width - 232)), top: Math.max(8, Math.min(noteDraft.y, box.height - 40)) }} onPointerDown={event => event.stopPropagation()}
      onChange={event => setNoteDraft(current => current && { ...current, text: event.target.value })}
      onKeyDown={event => { event.stopPropagation(); if (event.key === 'Enter') commitNote(); else if (event.key === 'Escape') setNoteDraft(null); }}
      onBlur={commitNote}/>}
    {!showFull && <span className="qv-resolution">{instance && previews[instance.index] ? 'Preview · loading full resolution…' : 'Loading…'}</span>}
    {status && <div className="qv-stage-status" role="status">{status}</div>}
  </div>;
});
