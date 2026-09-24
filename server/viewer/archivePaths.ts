import path from 'node:path';
import fs from 'node:fs/promises';
// Old absolute Windows paths are mapped only to configured upload roots, never
// accepted as arbitrary paths. Realpath checks also reject symlink escapes.
export async function resolveArchivePath(candidate: string | null | undefined, roots: string[]) {
  if (!candidate || candidate.startsWith('s3://')) return null;
  const normalized = candidate.replaceAll('\\', '/');
  const offset = normalized.toLowerCase().lastIndexOf('/uploads/');
  const suffix = offset >= 0 ? normalized.slice(offset + '/uploads/'.length) : null;
  for (const root of roots) {
    const realRoot = await fs.realpath(root).catch(() => null);
    if (!realRoot) continue;
    for (const name of [candidate, ...(suffix ? [path.resolve(realRoot, suffix)] : [])]) {
      const real = await fs.realpath(name).catch(() => null);
      if (!real) continue;
      const relative = path.relative(realRoot, real);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;
      if ((await fs.stat(real)).isFile()) return real;
    }
  }
  return null;
}
