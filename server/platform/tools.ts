import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

const cache = new Map<string, string>();
export async function findExecutable(name: string): Promise<string | null> {
  const executable = process.platform === 'win32' ? name : name.replace(/\.exe$/i, '');
  if (cache.has(executable)) return cache.get(executable)!;
  const candidates = path.isAbsolute(executable) ? [executable] : [process.env.DCMTK_BIN, ...(process.env.PATH ?? '').split(path.delimiter)].filter(Boolean).map(folder => path.join(folder!, executable));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      cache.set(executable, candidate);
      return candidate;
    } catch { /* Try the next configured directory. */ }
  }
  return null;
}
