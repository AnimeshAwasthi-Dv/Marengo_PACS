import { z } from 'zod'

// Reject arrays/objects and oversized searches instead of stringifying them into
// expensive, accidental filters. Prisma continues to bind all filter values.
// Bound raw input before normalization, allowing ordinary copy/paste whitespace.
// Unicode mode preserves valid surrogate pairs, including emoji.
// Tabs and newlines remain valid whitespace in search text.
// eslint-disable-next-line no-control-regex -- Deliberately detect and reject control characters in query input.
const invalidText = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uD800-\uDFFF]/u
const text = (max: number) => z.string().max(max + 1024).pipe(
  z.string().refine(value => !invalidText.test(value), 'Unsupported control character or malformed Unicode').trim().max(max),
).optional()
// Date.parse alone silently rolls impossible dates such as February 30 forward.
// Portal sync cursors use ISO timestamps; ISO date-only input is also supported.
const syncDate = z.string().max(40).pipe(z.union([
  z.iso.datetime({ offset: true }),
  z.iso.date(),
])).optional()
const schema = z.object({
  limit: z.string().regex(/^\d{1,9}$/, 'limit must be a positive integer').optional(),
  q: text(200), status: text(64), modality: text(16), cursor: text(128),
  includeProcessed: z.enum(['0', '1']).optional(), all: z.enum(['0', '1']).optional(),
  updatedSince: syncDate,
})
export function parseWorklistQuery(query: unknown) {
  const value = schema.parse(query)
  return {
    take: Math.min(500, Math.max(1, Number(value.limit ?? 50))),
    q: value.q || undefined, status: value.status || undefined,
    modality: value.modality?.toUpperCase() || undefined, cursor: value.cursor || undefined,
    includeProcessed: value.includeProcessed === '1' || value.all === '1',
    updatedSince: value.updatedSince ? new Date(value.updatedSince) : null,
  }
}

// Share only concurrent identical, already-authorized reads. No completed rows
// are cached, so a later refresh still observes mutations and permission changes.
const pendingReads = new Map<string, Promise<unknown>>()
export async function coalesceWorklistRead<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const existing = pendingReads.get(key)
  if (existing) return existing as Promise<T>
  if (pendingReads.size >= 500) return loader()
  const pending = Promise.resolve().then(loader).finally(() => pendingReads.delete(key))
  pendingReads.set(key, pending)
  return pending
}
