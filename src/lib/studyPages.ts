// Publish the first page quickly; only replace an existing worklist after a
// complete refresh so a failed later page cannot discard previously loaded data.
export async function loadStudyPages<T extends { id: string }>(
  fetchPage: (cursor: string, limit: number) => Promise<{ studies: T[]; nextCursor?: string | null }>,
  options: { signal?: AbortSignal; onFirstPage?: (studies: T[]) => void } = {},
): Promise<T[]> {
  const studies = new Map<string, T>();
  const cursors = new Set<string>();
  let cursor = '';
  do {
    options.signal?.throwIfAborted();
    const result = await fetchPage(cursor, cursor ? 500 : 100);
    options.signal?.throwIfAborted();
    for (const study of result.studies) studies.set(study.id, study);
    if (!cursor) options.onFirstPage?.([...studies.values()]);
    cursor = result.nextCursor ?? '';
    if (cursor && cursors.has(cursor)) throw new Error('Study pagination stalled. Please retry.');
    cursors.add(cursor);
  } while (cursor);
  return [...studies.values()];
}
