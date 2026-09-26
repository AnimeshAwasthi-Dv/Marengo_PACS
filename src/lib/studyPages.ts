// Publish the first page quickly; only replace an existing worklist after a
// complete refresh so a failed later page cannot discard previously loaded data.
export async function loadStudyPages<T extends { id: string }>(
  fetchPage: (cursor: string, limit: number) => Promise<{ studies: T[]; nextCursor?: string | null }>,
  options: { signal?: AbortSignal; onFirstPage?: (studies: T[]) => void; firstPageSize?: number } = {},
): Promise<T[]> {
  const studies = new Map<string, T>();
  const cursors = new Set<string>();
  let cursor = '';
  do {
    options.signal?.throwIfAborted();
    const result = await fetchPage(cursor, cursor ? 500 : options.firstPageSize ?? 100);
    options.signal?.throwIfAborted();
    for (const study of result.studies) studies.set(study.id, study);
    if (!cursor) options.onFirstPage?.([...studies.values()]);
    cursor = result.nextCursor ?? '';
    if (cursor && cursors.has(cursor)) throw new Error('Study pagination stalled. Please retry.');
    cursors.add(cursor);
  } while (cursor);
  return [...studies.values()];
}

// Apply an incremental refresh: changed rows replace their old copy, new rows go first.
export function mergeStudies<T extends { id: string }>(current: T[], changes: T[]): T[] {
  if (!changes.length) return current;
  const updates = new Map(changes.map((study) => [study.id, study]));
  const known = new Set(current.map((study) => study.id));
  return [...changes.filter((study) => !known.has(study.id)), ...current.map((study) => updates.get(study.id) ?? study)];
}
