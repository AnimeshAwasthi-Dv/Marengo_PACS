/**
 * Pixel values and DICOM tags for the QuickView measurement tools (probe, rectangle/ellipse ROI, DICOM tags).
 * dcmjs-imaging doesn't export decoded values, but after render() it keeps each frame's pixel pipeline
 * (stored values, width, height) in `pixelPipelineCache.cache` (a Map keyed by frame). This module reads it
 * defensively: if a library upgrade changes that shape, the tools report "not available" instead of breaking.
 */

type PipelineLike = { data?: ArrayLike<number>; width?: number; height?: number; getComponents?: () => number };
type ImageLike = {
  render(options: { frame: number; renderOverlays?: boolean }): unknown;
  getElement(name: string): unknown;
  pixelPipelineCache?: { cache?: Map<number, PipelineLike> };
};

export type PixelAccess = { width: number; height: number; components: number; slope: number; intercept: number; data: ArrayLike<number> };
export type RegionShape = { kind: 'rect' | 'ellipse'; x0: number; y0: number; x1: number; y1: number };
export type RegionStats = { count: number; mean: number; sd: number; min: number; max: number; luminance: boolean };
export type ProbeValue = { x: number; y: number; value?: number; rgb?: [number, number, number] };
export type TagRow = { tag: string; name: string; vr: string; value: string };

function numberElement(image: ImageLike, name: string, fallback: number) {
  const raw = image.getElement(name);
  const value = Array.isArray(raw) ? Number(raw[0]) : Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/** Stored pixel values of one frame, plus the rescale that turns them into modality values. */
export function pixelAccess(image: ImageLike, frame: number): PixelAccess | null {
  const cache = image.pixelPipelineCache?.cache;
  if (!(cache instanceof Map)) return null;
  if (!cache.has(frame)) image.render({ frame, renderOverlays: false });
  const pipeline = cache.get(frame);
  if (!pipeline?.data || !pipeline.width || !pipeline.height) return null;
  const components = typeof pipeline.getComponents === 'function' ? pipeline.getComponents() : pipeline.data.length === pipeline.width * pipeline.height ? 1 : 3;
  if (pipeline.data.length < pipeline.width * pipeline.height * components) return null;
  return { width: pipeline.width, height: pipeline.height, components, slope: numberElement(image, 'RescaleSlope', 1), intercept: numberElement(image, 'RescaleIntercept', 0), data: pipeline.data };
}

function sample(access: PixelAccess, x: number, y: number) {
  const i = y * access.width + x;
  if (access.components === 1) return access.data[i] * access.slope + access.intercept;
  const o = i * access.components;
  // Colour images (e.g. ultrasound): statistics use luminance.
  return 0.299 * access.data[o] + 0.587 * access.data[o + 1] + 0.114 * access.data[o + 2];
}

export function regionStats(access: PixelAccess, shape: RegionShape): RegionStats | null {
  const left = Math.max(0, Math.floor(Math.min(shape.x0, shape.x1)));
  const right = Math.min(access.width - 1, Math.ceil(Math.max(shape.x0, shape.x1)));
  const top = Math.max(0, Math.floor(Math.min(shape.y0, shape.y1)));
  const bottom = Math.min(access.height - 1, Math.ceil(Math.max(shape.y0, shape.y1)));
  const cx = (shape.x0 + shape.x1) / 2, cy = (shape.y0 + shape.y1) / 2;
  const rx = Math.abs(shape.x1 - shape.x0) / 2, ry = Math.abs(shape.y1 - shape.y0) / 2;
  let count = 0, sum = 0, sumSquares = 0, min = Infinity, max = -Infinity;
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      if (shape.kind === 'ellipse') {
        if (!rx || !ry) continue;
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy > 1) continue;
      }
      const value = sample(access, x, y);
      count++; sum += value; sumSquares += value * value;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  if (!count) return null;
  const mean = sum / count;
  return { count, mean, sd: Math.sqrt(Math.max(0, sumSquares / count - mean * mean)), min, max, luminance: access.components !== 1 };
}

export function probeValue(access: PixelAccess, x: number, y: number): ProbeValue | null {
  const px = Math.floor(x), py = Math.floor(y);
  if (px < 0 || py < 0 || px >= access.width || py >= access.height) return null;
  if (access.components === 1) return { x: px, y: py, value: sample(access, px, py) };
  const o = (py * access.width + px) * access.components;
  return { x: px, y: py, rgb: [access.data[o], access.data[o + 1], access.data[o + 2]] };
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof ArrayBuffer) return `<binary, ${value.byteLength} bytes>`;
  if (ArrayBuffer.isView(value)) return `<binary, ${value.byteLength} bytes>`;
  if (Array.isArray(value)) {
    if (value.some(item => item instanceof ArrayBuffer || ArrayBuffer.isView(item))) return `<binary, ${value.reduce((sum, item) => sum + ((item as ArrayBuffer).byteLength ?? 0), 0)} bytes>`;
    if (value.some(item => item && typeof item === 'object' && !('Alphabetic' in (item as object)))) return `Sequence (${value.length} item${value.length === 1 ? '' : 's'})`;
    return value.map(formatValue).join('\\');
  }
  if (typeof value === 'object') {
    const alphabetic = (value as { Alphabetic?: unknown }).Alphabetic;
    return typeof alphabetic === 'string' ? alphabetic : JSON.stringify(value).slice(0, 200);
  }
  return String(value);
}

/** Readable tag list for the "DICOM tags" panel, sorted by tag. Pixel data is summarised, not dumped. */
export function tagRows(elements: Record<string, unknown>, nameMap: Record<string, { tag?: string; vr?: string }>): TagRow[] {
  return Object.entries(elements)
    .filter(([name]) => !name.startsWith('_'))
    .map(([name, value]) => {
      const entry = nameMap[name];
      const vr = entry?.vr ?? '';
      const text = name === 'PixelData' ? '<pixel data>' : formatValue(value);
      return { tag: entry?.tag ?? name, name, vr, value: text.length > 300 ? `${text.slice(0, 300)}…` : text };
    })
    .sort((a, b) => a.tag.localeCompare(b.tag));
}
