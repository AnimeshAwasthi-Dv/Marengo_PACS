export type StudyClassificationInput = { modalities: string[]; studyDescription?: string | null };

// Investigation names/codes supplied for the Marengo special X-ray worklist.
export function hasSpecialXrayDescription(description?: string | null) {
  const text = (description ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return /\b(?:12317|12326|12328|2721[2-9]|2722[0-4])\b/.test(text)
    || /\b(?:barium|micturating|retrograde genitourethrogram|ascending urethrogram|contrast swallow|dye study|fistulogram|fluoro screening|flu(?:oro|ro)scopy guidance|oral water soluble contrast study|special x ray|special xray)\b/.test(text)
    || /\b(?:m\s*c\s*u|r\s*g\s*u|a\s*u\s*g|i\s*v\s*u)\b/.test(text);
}

export function isSpecialXrayStudy(study: StudyClassificationInput) {
  const modalities = study.modalities.map(value => value.trim().toUpperCase());
  if (modalities.some(value => ['CT', 'MR', 'MRI', 'US', 'PT', 'MG', 'NM'].includes(value))) return false;
  const xray = modalities.some(value => ['DX', 'CR', 'XR', 'XRAY', 'X-RAY', 'RF'].includes(value));
  return (xray || modalities.length === 0 || /\bx[ -]?ray\b/i.test(study.studyDescription ?? ''))
    && hasSpecialXrayDescription(study.studyDescription);
}

export function holdSpecialXrayForManualSubmission(study: StudyClassificationInput, serviceType?: string) {
  return serviceType === 'special-xray-contrast-media' || isSpecialXrayStudy(study);
}
