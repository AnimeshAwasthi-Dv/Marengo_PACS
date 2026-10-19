import { createHash } from 'node:crypto';

export function reportInstanceUid(reportId: string, content: Uint8Array, format: string) {
  const digest = createHash('sha256').update(reportId).update('\0').update(format).update('\0').update(content).digest('hex').slice(0, 32);
  return `2.25.${BigInt(`0x${digest}`).toString()}`;
}
