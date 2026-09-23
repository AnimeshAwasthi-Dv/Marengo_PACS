export type ViewerContext = { studyInstanceUid?: string | null; reportId?: string | null };

function cleanEnvValue(value: string | undefined) {
  const trimmed = value?.trim() ?? '';
  return trimmed === "''" || trimmed === '""' ? '' : trimmed;
}

function configuredViewerTemplate() {
  const explicitTemplate = cleanEnvValue(process.env.EXTERNAL_VIEWER_URL_TEMPLATE);
  if (explicitTemplate) return explicitTemplate;
  return '';
}

export function externalViewerSession(context: ViewerContext, template = configuredViewerTemplate()) {
  if (!template) return { enabled: false, message: 'The external DICOM viewer has not been configured yet.' };
  if (!context.studyInstanceUid || !/^\d+(\.\d+)+$/.test(context.studyInstanceUid) || context.studyInstanceUid.length > 64) {
    return { enabled: false, message: 'This study does not have a valid DICOM study UID yet.' };
  }
  if (!template.includes('{studyInstanceUid}')) throw new Error('EXTERNAL_VIEWER_URL_TEMPLATE must contain {studyInstanceUid}');
  if (/\{(?!studyInstanceUid\}|reportId\})[^}]*\}/.test(template)) throw new Error('Unsupported external viewer URL placeholder');
  if (template.includes('{reportId}') && !context.reportId) return { enabled: false, message: 'This viewer configuration requires a report for the study.' };
  const url = new URL(template.replaceAll('{studyInstanceUid}', encodeURIComponent(context.studyInstanceUid)).replaceAll('{reportId}', encodeURIComponent(context.reportId ?? '')));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('External viewer URL must be HTTP(S) without embedded credentials');
  return { enabled: true, viewerUrl: url.toString(), studyInstanceUid: context.studyInstanceUid };
}

export function externalViewerOrigin() {
  const template = configuredViewerTemplate();
  const viewerBaseUrl = cleanEnvValue(process.env.DICOM_VIEWER_API_URL);
  if (!template) return viewerBaseUrl ? new URL(viewerBaseUrl).origin : null;
  // Validate the same configuration used by study links before adding it to CSP.
  const session = externalViewerSession({ studyInstanceUid: '1.2.3', reportId: 'configuration-check' }, template);
  return session.enabled && session.viewerUrl ? new URL(session.viewerUrl).origin : null;
}
