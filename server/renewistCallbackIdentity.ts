import { createHash } from 'node:crypto';

export function renewistCallbackIdentity(fields: Record<string, unknown>) {
  // Omit temporary upload paths and server-generated timestamps: both change on retries.
  const identity = { job: fields.dectrocel_job_id, providerJob: fields.renewist_job_id, version: fields.report_version, status: fields.report_status ?? fields.provider_status, checksum: fields.reportChecksum ?? fields.report_checksum, findings: fields.findings, impression: fields.impression, comments: fields.comments };
  return `callback-${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;
}
