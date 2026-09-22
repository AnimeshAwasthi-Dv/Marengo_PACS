import { createHmac, timingSafeEqual } from 'node:crypto';

export function scopedShareToken(reportId: string, secret: string, includeViewer: boolean) {
  const payload = `s1.${Buffer.from(reportId).toString('base64url')}.${includeViewer ? 'images' : 'report'}`;
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}

export function scopedShareReportId(token: string) {
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 's1' || !['images', 'report'].includes(parts[2])) return null;
  return Buffer.from(parts[1], 'base64url').toString('utf8');
}

export function verifyShareScope(token: string, reportId: string, secret: string) {
  if (scopedShareReportId(token) !== reportId) return null;
  const includeViewer = token.split('.')[2] === 'images';
  const expected = Buffer.from(scopedShareToken(reportId, secret, includeViewer));
  const actual = Buffer.from(token);
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? { includeViewer } : null;
}
