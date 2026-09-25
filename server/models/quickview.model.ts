/**
 * A study the caller is already authorized to open. Each viewer entry point resolves one of these
 * with the existing authorization helpers before any QuickView work happens.
 */
export type ViewerTarget =
  | { type: 'bridge-study'; id: string; clientId: string; studyInstanceUid: string | null }
  | { type: 'job'; id: string; clientId: string; studyInstanceUid: string | null; modality: string | null }
  | { type: 'report'; id: string; clientId: string; studyInstanceUid: string | null; modality: string | null; processingJobId: string | null }
  | { type: 'archive'; id: string; clientId: string; studyInstanceUid: string | null; modality: string | null }

/** URL segment used by the QuickView data endpoints for each entry point. */
export type QuickViewKind = 'bridge-study' | 'job' | 'report' | 'radiologist-report' | 'archive' | 'public'

export type QuickViewInstance = {
  index: number
  sopInstanceUid: string
  instanceNumber: number | null
  rows: number
  columns: number
  frames: number
  windowCenter: number | null
  windowWidth: number | null
  photometricInterpretation: string | null
  transferSyntaxUid: string | null
  sizeBytes: number
  pixelSpacing: [number, number] | null
  patientOrientation: [string, string] | null
  sliceThickness: number | null
}

export type QuickViewSeries = {
  seriesInstanceUid: string
  seriesNumber: number | null
  description: string | null
  modality: string | null
  instances: QuickViewInstance[]
}

export type QuickViewManifest = {
  studyInstanceUid: string | null
  patientName: string | null
  patientId: string | null
  studyDate: string | null
  studyDescription: string | null
  patientSex: string | null
  patientAge: string | null
  modalities: string[]
  instanceCount: number
  series: QuickViewSeries[]
}
