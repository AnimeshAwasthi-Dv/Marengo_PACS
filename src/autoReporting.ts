import { modalityCode } from './modalities';
import { isSpecialXrayStudy } from './specialXray';

export const AUTO_REPORTING_DELAY_MS = 5 * 60 * 1000;
export const XRAY_AUTO_REPORTING_DELAY_MS = 3 * 60 * 1000;

export function autoReportingModality(study: { modalities: string[]; studyDescription?: string | null }) {
  if (isSpecialXrayStudy(study)) return 'SPECIALXRAY';
  const codes = study.modalities.map(modalityCode);
  return ['MG', 'PT', 'CT', 'MR', 'US', 'SPECIALXRAY', 'XR'].find(code => codes.includes(code));
}

export function autoReportingEnabled(enabled: string[], study: { modalities: string[]; studyDescription?: string | null }) {
  const modality = autoReportingModality(study);
  return Boolean(modality && enabled.includes(modality));
}

/** Allow three minutes for routine X-ray clinical details and five for other enabled studies. */
export function autoReportingDelayMs(study: { modalities: string[]; studyDescription?: string | null }) {
  if (autoReportingModality(study) === 'XR') return XRAY_AUTO_REPORTING_DELAY_MS;
  return AUTO_REPORTING_DELAY_MS;
}

export function autoReportingCountdown(dueAt: string, now: number) {
  const seconds = Math.max(0, Math.ceil((Date.parse(dueAt) - now) / 1000));
  return seconds > 0 ? `Auto-send in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : 'Auto-send pending';
}
