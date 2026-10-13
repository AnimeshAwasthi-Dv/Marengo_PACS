import { randomUUID } from 'node:crypto';
import { prisma } from './db';

export class LeaseBusyError extends Error {
  constructor(key: string) { super(`Work ${key} is already in progress`); }
}

/** Takes a named lease, or returns null when another owner holds an unexpired one. */
export async function tryAcquireLease(key: string, ttlMs: number) {
  const owner = randomUUID();
  const rows = await prisma.$queryRaw<Array<{ owner: string }>>`
    INSERT INTO work_leases ("key", owner, "lockedUntil") VALUES (${key}, ${owner}, CURRENT_TIMESTAMP + make_interval(secs => ${ttlMs / 1000}))
    ON CONFLICT ("key") DO UPDATE SET owner = EXCLUDED.owner, "lockedUntil" = EXCLUDED."lockedUntil"
    WHERE work_leases."lockedUntil" < CURRENT_TIMESTAMP
    RETURNING owner`;
  return rows[0]?.owner === owner ? owner : null;
}

export async function releaseLease(key: string, owner: string) {
  await prisma.$executeRaw`DELETE FROM work_leases WHERE "key" = ${key} AND owner = ${owner}`;
}

/**
 * Runs `task` while holding the lease. Waits up to `waitMs` for a busy lease, then throws LeaseBusyError.
 * The lease expires after `ttlMs`, so a crashed owner never blocks the key for longer than that.
 */
export async function withLease<T>(key: string, options: { ttlMs: number; waitMs?: number; pollMs?: number }, task: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + (options.waitMs ?? 0);
  let owner = await tryAcquireLease(key, options.ttlMs);
  while (!owner && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, options.pollMs ?? 500));
    owner = await tryAcquireLease(key, options.ttlMs);
  }
  if (!owner) throw new LeaseBusyError(key);
  try { return await task(); }
  finally { await releaseLease(key, owner).catch(error => console.error(`Lease ${key} release failed`, error)); }
}
