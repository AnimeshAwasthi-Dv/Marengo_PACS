import { modalityCode } from './modalities';
import { isSpecialXrayStudy } from './specialXray';

export const AUTO_REPORTING_DELAY_MS = 5 * 60 * 1000;

export function autoReportingModality(study: { modalities: string[]; studyDescription?: string | null }) {
  if (isSpecialXrayStudy(study)) return 'SPECIALXRAY';
  const codes = study.modalities.map(modalityCode);
  return ['MG', 'PT', 'CT', 'MR', 'US', 'SPECIALXRAY', 'XR'].find(code => codes.includes(code));
}

export function autoReportingEnabled(enabled: string[], study: { modalities: string[]; studyDescription?: string | null }) {
  const modality = autoReportingModality(study);
  return Boolean(modality && enabled.includes(modality));
}

/** Routine X-rays are safe to send immediately; other enabled studies retain the clinical-details window. */
export function autoReportingDelayMs(study: { modalities: string[]; studyDescription?: string | null }) {
  if (autoReportingModality(study) === 'XR') return 0;
  return AUTO_REPORTING_DELAY_MS;
}

export function autoReportingCountdown(dueAt: string, now: number) {
  const seconds = Math.max(0, Math.ceil((Date.parse(dueAt) - now) / 1000));
  return seconds > 0 ? `Auto-send in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : 'Auto-send pending';
}
