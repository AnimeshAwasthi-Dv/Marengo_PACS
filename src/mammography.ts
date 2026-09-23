const xrayModalities = new Set(['DX', 'CR', 'XR', 'XRAY', 'X-RAY']);

// Classify the portal worklist without changing the original DICOM files.
export function classifyBreastXrayModalities(modalities: string[], bodyPartExamined?: string | null) {
  const normalized = modalities.map(value => value.trim().toUpperCase());
  if (bodyPartExamined?.replace(/\0/g, '').trim().toUpperCase() !== 'BREAST') return normalized;
  return [...new Set(normalized.map(value => xrayModalities.has(value) ? 'MG' : value))];
}
