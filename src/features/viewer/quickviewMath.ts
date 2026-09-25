export type View = { zoom: number; panX: number; panY: number; rotation: number; flip: boolean; flipV?: boolean; invert: boolean };
/** Text placed on the image with the Note tool, in image pixel coordinates. */
export type Note = { at: Point; text: string };
export type Point = { x: number; y: number };
export type Line = { from: Point; to: Point };
export type Markers = { top: string; right: string; bottom: string; left: string };

const OPPOSITE: Record<string, string> = { L: 'R', R: 'L', A: 'P', P: 'A', H: 'F', F: 'H' };

function opposite(direction: string) {
  return direction.split('').map(letter => OPPOSITE[letter] ?? letter).join('');
}

/**
 * Orientation labels from DICOM PatientOrientation [row direction, column direction], following the
 * on-screen flip and rotation. Returns null when the file doesn't say, rather than guessing.
 */
export function orientationMarkers(orientation: [string, string] | null | undefined, view: Pick<View, 'rotation' | 'flip' | 'flipV'>): Markers | null {
  if (!orientation) return null;
  const [rowDirection, columnDirection] = orientation;
  let markers: Markers = { top: opposite(columnDirection), right: rowDirection, bottom: columnDirection, left: opposite(rowDirection) };
  if (view.flip) markers = { ...markers, left: markers.right, right: markers.left };
  if (view.flipV) markers = { ...markers, top: markers.bottom, bottom: markers.top };
  for (let turns = ((view.rotation / 90) % 4 + 4) % 4; turns > 0; turns -= 1) {
    markers = { top: markers.left, right: markers.top, bottom: markers.right, left: markers.bottom };
  }
  return markers;
}

/** Maps a point on the stage (relative to its centre) back to image pixel coordinates. */
export function stageToImage(point: Point, view: View, scale: number, image: { width: number; height: number }): Point {
  let x = point.x - view.panX;
  let y = point.y - view.panY;
  const radians = (-view.rotation * Math.PI) / 180;
  [x, y] = [x * Math.cos(radians) - y * Math.sin(radians), x * Math.sin(radians) + y * Math.cos(radians)];
  x /= scale;
  y /= scale;
  if (view.flip) x = -x;
  if (view.flipV) y = -y;
  return { x: x + image.width / 2, y: y + image.height / 2 };
}

/** Length in mm when pixel spacing is known ([row spacing, column spacing]), otherwise in pixels. */
export function lineLength(line: Line, pixelSpacing: [number, number] | null | undefined) {
  const dx = line.to.x - line.from.x;
  const dy = line.to.y - line.from.y;
  if (pixelSpacing) {
    const mm = Math.hypot(dx * pixelSpacing[1], dy * pixelSpacing[0]);
    return mm >= 100 ? `${(mm / 10).toFixed(1)} cm` : `${mm.toFixed(1)} mm`;
  }
  return `${Math.hypot(dx, dy).toFixed(0)} px`;
}

export function formatDicomDate(value: string | null | undefined) {
  return value && /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : value ?? '';
}

/** "041Y" / "M" → "41Y/M", matching the full viewer's header. */
export function formatAgeSex(age: string | null | undefined, sex: string | null | undefined) {
  const cleanAge = age?.replace(/^0+(?=\d)/, '') ?? '';
  return [cleanAge, sex ?? ''].filter(Boolean).join('/');
}

// Same list as the full DecXpert viewer's Preset menu.
export const WINDOW_PRESETS: Record<string, { width: number; center: number }> = {
  '8-bit': { width: 256, center: 128 },
  '12-bit': { width: 4096, center: 2048 },
  '16-bit': { width: 65536, center: 32768 },
};

/**
 * Two-finger gesture: how far the fingers spread (zoom factor) and how far their midpoint moved (pan),
 * relative to where the gesture started.
 */
export function pinchChange(start: [Point, Point], now: [Point, Point]) {
  const distance = (pair: [Point, Point]) => Math.hypot(pair[1].x - pair[0].x, pair[1].y - pair[0].y);
  const midpoint = (pair: [Point, Point]) => ({ x: (pair[0].x + pair[1].x) / 2, y: (pair[0].y + pair[1].y) / 2 });
  const startDistance = distance(start);
  const scale = startDistance > 0 ? distance(now) / startDistance : 1;
  const from = midpoint(start);
  const to = midpoint(now);
  return { scale, dx: to.x - from.x, dy: to.y - from.y };
}

/** Angle at vertex b between rays b→a and b→c, in degrees. */
export function angleAt(a: Point, b: Point, c: Point) {
  const v1 = Math.atan2(a.y - b.y, a.x - b.x), v2 = Math.atan2(c.y - b.y, c.x - b.x);
  let degrees = Math.abs((v1 - v2) * 180 / Math.PI);
  if (degrees > 180) degrees = 360 - degrees;
  return degrees;
}

export function formatArea(areaPx: number, spacing: [number, number] | null | undefined) {
  if (!spacing) return `Area ${Math.round(areaPx)} px²`;
  const mm2 = areaPx * spacing[0] * spacing[1];
  return mm2 >= 100 ? `Area ${(mm2 / 100).toFixed(2)} cm²` : `Area ${mm2.toFixed(1)} mm²`;
}
