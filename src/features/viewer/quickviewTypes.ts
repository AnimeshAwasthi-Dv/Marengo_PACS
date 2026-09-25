import type { ProbeValue, RegionStats } from './quickviewPixels';
import type { Line, Note, Point } from './quickviewMath';

export type ManifestInstance = {
  index: number; sopInstanceUid: string; instanceNumber: number | null; rows: number; columns: number; frames: number;
  windowCenter: number | null; windowWidth: number | null; photometricInterpretation: string | null; sizeBytes: number;
  pixelSpacing: [number, number] | null; patientOrientation: [string, string] | null; sliceThickness: number | null;
};
export type ManifestSeries = { seriesInstanceUid: string; seriesNumber: number | null; description: string | null; modality: string | null; instances: ManifestInstance[] };
export type Manifest = {
  studyInstanceUid: string | null; patientName: string | null; patientId: string | null; patientSex: string | null; patientAge: string | null;
  studyDate: string | null; studyDescription: string | null; modalities: string[]; instanceCount: number; series: ManifestSeries[];
};
export type Tool = 'window' | 'pan' | 'zoom' | 'length' | 'note' | 'angle' | 'rect' | 'ellipse' | 'probe';
export type WindowLevel = { width: number; center: number };
export type Overlay =
  | { kind: 'line'; line: Line }
  | { kind: 'note'; note: Note }
  | { kind: 'angle'; points: [Point, Point, Point] }
  | { kind: 'rect' | 'ellipse'; id: number; from: Point; to: Point; stats?: RegionStats | null }
  | { kind: 'probe'; id: number; at: Point; probe?: ProbeValue | null };
export type Layout = '1x1' | '1x2' | '2x1' | '2x2';

/** What the active viewport reports up to the shell (status bar, preset, tags, Undo). */
export type ViewportReport = { instance?: ManifestInstance; playing: boolean; canCine: boolean };

/** Actions the shell's toolbar and More menu run on the active viewport. */
export type ViewportHandle = {
  invert(): void; rotate(): void; flipH(): void; flipV(): void; reset(): void; togglePlay(): void; cancelDrafts(): void;
};

export function seriesTitle(series: ManifestSeries) {
  return series.description || (series.seriesNumber !== null ? `Series ${series.seriesNumber}` : 'Series');
}

export function layoutSize(layout: Layout) {
  const [rows, columns] = layout.split('x').map(Number);
  return { rows, columns, count: rows * columns };
}
