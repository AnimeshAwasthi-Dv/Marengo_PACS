/**
 * Decides whether a study opens in the in-app QuickView or the external DICOM viewer.
 * Rule: CT, MR, PET and NM always use the
 * external viewer; only small 2D studies may use QuickView.
 */
export type ViewerMode = 'quick' | 'external'
export type ViewerDecision = { mode: ViewerMode; reason: string }
export type QuickViewConfig = { enabled: boolean; maxBytes: number }

const DEFAULT_MAX_BYTES = 150 * 1024 * 1024

const QUICK_MODALITIES = new Set(['CR', 'DX', 'DR', 'MG', 'US', 'XA', 'RF', 'IO', 'PX', 'OT', 'SC'])
const EXTERNAL_ONLY_MODALITIES = new Set(['CT', 'MR', 'PT', 'NM'])

// Portal service names and free-text modality values mapped to DICOM modality codes.
const MODALITY_ALIASES: Record<string, string> = {
  MRI: 'MR', PET: 'PT', 'PET-CT': 'PT', PETCT: 'PT', XRAY: 'DX', 'X-RAY': 'DX', 'X RAY': 'DX', CXR: 'DX',
  MAMMOGRAPHY: 'MG', MAMMO: 'MG', ULTRASOUND: 'US', USG: 'US', SONOGRAPHY: 'US', 'NUCLEAR MEDICINE': 'NM',
}

export function normalizeModality(value: string | null | undefined) {
  const cleaned = (value ?? '').trim().toUpperCase()
  if (!cleaned) return null
  return MODALITY_ALIASES[cleaned] ?? cleaned
}

export function quickViewConfig(env: NodeJS.ProcessEnv = process.env): QuickViewConfig {
  const maxBytes = Number(env.QUICKVIEW_MAX_BYTES)
  return { enabled: env.QUICKVIEW_ENABLED === 'true', maxBytes: Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : DEFAULT_MAX_BYTES }
}

export function chooseViewerMode(
  input: { modalities: Array<string | null | undefined>; sizeBytes: number | bigint | null | undefined; forceExternal?: boolean },
  config: QuickViewConfig = quickViewConfig(),
): ViewerDecision {
  if (!config.enabled) return { mode: 'external', reason: 'QuickView is disabled' }
  if (input.forceExternal) return { mode: 'external', reason: 'Full viewer requested' }
  // Values like "CT\SR" or "DX,OT" can come from DICOM multi-value fields or bridge metadata.
  const modalities = [...new Set(input.modalities.flatMap(value => (value ?? '').split(/[\\,/]/)).map(normalizeModality).filter((value): value is string => Boolean(value)))]
  if (!modalities.length) return { mode: 'external', reason: 'Modality is unknown' }
  const externalOnly = modalities.find(modality => EXTERNAL_ONLY_MODALITIES.has(modality))
  if (externalOnly) return { mode: 'external', reason: `${externalOnly} studies always use the full DICOM viewer` }
  const unsupported = modalities.find(modality => !QUICK_MODALITIES.has(modality))
  if (unsupported) return { mode: 'external', reason: `${unsupported} is not supported by QuickView` }
  const size = input.sizeBytes == null ? 0 : Number(input.sizeBytes)
  if (!size || size < 0) return { mode: 'external', reason: 'Study size is unknown' }
  if (size > config.maxBytes) return { mode: 'external', reason: 'Study is larger than the QuickView limit' }
  return { mode: 'quick', reason: 'Small 2D study' }
}
