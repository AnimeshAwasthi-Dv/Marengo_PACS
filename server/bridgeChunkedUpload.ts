import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform, type Readable } from 'node:stream'

/**
 * Resumable, part-by-part storage for Bridge study ZIPs. Slow or filtered client links reset long single
 * uploads, so Bridge sends the ZIP as small parts that each finish quickly and are retried on their own.
 * Sessions live on disk so a portal restart does not lose parts already received.
 */

export class ChunkedUploadError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

export type ChunkedUploadSession = {
  uploadId: string
  fileName: string
  totalSize: number
  partSize: number
  partCount: number
  sha256: string
  fields: Record<string, string>
  createdAt: string
}

export type ChunkedUploadStatus = ChunkedUploadSession & { receivedParts: number[]; completed: boolean }

export type ChunkedUploadInit = {
  fileName: string
  totalSize: number
  partSize: number
  sha256: string
  fields: Record<string, string>
}

const sessionFile = 'session.json'
const resultFile = 'result.json'
const uploadIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const partFilePattern = /^part-(\d{6})$/

export function createChunkedUploadStore(options: { root: string; maxTotalBytes: number; minPartBytes?: number; maxPartBytes?: number }) {
  const minPartBytes = options.minPartBytes ?? 256 * 1024
  const maxPartBytes = options.maxPartBytes ?? 64 * 1024 * 1024

  const sessionDir = (uploadId: string) => {
    if (!uploadIdPattern.test(uploadId)) throw new ChunkedUploadError(404, 'UPLOAD_NOT_FOUND', 'Upload session not found')
    return path.join(options.root, uploadId)
  }
  const partPath = (dir: string, index: number) => path.join(dir, `part-${String(index).padStart(6, '0')}`)
  const expectedPartSize = (session: ChunkedUploadSession, index: number) =>
    index < session.partCount - 1 ? session.partSize : session.totalSize - session.partSize * (session.partCount - 1)

  async function readSession(uploadId: string) {
    const dir = sessionDir(uploadId)
    const raw = await fs.readFile(path.join(dir, sessionFile), 'utf8').catch(() => null)
    if (!raw) throw new ChunkedUploadError(404, 'UPLOAD_NOT_FOUND', 'Upload session not found or expired')
    return { dir, session: JSON.parse(raw) as ChunkedUploadSession }
  }

  async function receivedParts(dir: string, session: ChunkedUploadSession) {
    const received: number[] = []
    for (const name of await fs.readdir(dir)) {
      const match = partFilePattern.exec(name)
      if (!match) continue
      const index = Number(match[1])
      if (index >= session.partCount) continue
      const stat = await fs.stat(path.join(dir, name)).catch(() => null)
      if (stat?.size === expectedPartSize(session, index)) received.push(index)
    }
    return received.sort((a, b) => a - b)
  }

  return {
    async init(input: ChunkedUploadInit): Promise<ChunkedUploadStatus> {
      if (!Number.isSafeInteger(input.totalSize) || input.totalSize <= 0) throw new ChunkedUploadError(400, 'INVALID_SIZE', 'total_size must be a positive integer')
      if (input.totalSize > options.maxTotalBytes) throw new ChunkedUploadError(413, 'UPLOAD_TOO_LARGE', `Study ZIP exceeds the ${options.maxTotalBytes} byte upload limit`)
      if (!Number.isSafeInteger(input.partSize) || input.partSize < minPartBytes || input.partSize > maxPartBytes) {
        throw new ChunkedUploadError(400, 'INVALID_PART_SIZE', `part_size must be between ${minPartBytes} and ${maxPartBytes} bytes`)
      }
      if (!/^[0-9a-f]{64}$/i.test(input.sha256)) throw new ChunkedUploadError(400, 'INVALID_SHA256', 'sha256 must be a hex SHA-256 digest')
      const session: ChunkedUploadSession = {
        uploadId: crypto.randomUUID(),
        fileName: input.fileName,
        totalSize: input.totalSize,
        partSize: input.partSize,
        partCount: Math.ceil(input.totalSize / input.partSize),
        sha256: input.sha256.toLowerCase(),
        fields: input.fields,
        createdAt: new Date().toISOString(),
      }
      const dir = sessionDir(session.uploadId)
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(path.join(dir, sessionFile), JSON.stringify(session))
      return { ...session, receivedParts: [], completed: false }
    },

    async status(uploadId: string): Promise<ChunkedUploadStatus> {
      const { dir, session } = await readSession(uploadId)
      const completed = fsSync.existsSync(path.join(dir, resultFile))
      return { ...session, receivedParts: completed ? [] : await receivedParts(dir, session), completed }
    },

    /** Stores one part. Re-sending a part replaces it, so a retry after a dropped response is safe. */
    async writePart(uploadId: string, index: number, body: Readable, partSha256?: string) {
      const { dir, session } = await readSession(uploadId)
      if (!Number.isInteger(index) || index < 0 || index >= session.partCount) {
        throw new ChunkedUploadError(400, 'INVALID_PART_INDEX', `Part index must be between 0 and ${session.partCount - 1}`)
      }
      const expected = expectedPartSize(session, index)
      const tempPath = `${partPath(dir, index)}.${crypto.randomUUID()}.tmp`
      const hash = crypto.createHash('sha256')
      let size = 0
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          size += chunk.length
          if (size > expected) return callback(new ChunkedUploadError(400, 'PART_SIZE_MISMATCH', `Part ${index} is larger than ${expected} bytes`))
          hash.update(chunk)
          callback(null, chunk)
        },
      })
      try {
        await pipeline(body, meter, fsSync.createWriteStream(tempPath))
        if (size !== expected) throw new ChunkedUploadError(400, 'PART_SIZE_MISMATCH', `Part ${index} has ${size} bytes, expected ${expected}`)
        if (partSha256 && hash.digest('hex') !== partSha256.toLowerCase()) throw new ChunkedUploadError(400, 'PART_CHECKSUM_MISMATCH', `Part ${index} checksum mismatch`)
        await fs.rename(tempPath, partPath(dir, index))
      } catch (error) {
        await fs.rm(tempPath, { force: true }).catch(() => undefined)
        throw error
      }
      return { index, size }
    },

    /**
     * Joins all parts into `destinationPath` and checks the whole-file SHA-256. Parts stay until
     * `markCompleted`, so a failure after assembly can be retried without re-uploading.
     */
    async assemble(uploadId: string, destinationPath: string) {
      const { dir, session } = await readSession(uploadId)
      const received = await receivedParts(dir, session)
      if (received.length !== session.partCount) {
        const missing = Array.from({ length: session.partCount }, (_, index) => index).filter(index => !received.includes(index))
        throw new ChunkedUploadError(409, 'PARTS_MISSING', `Upload is missing ${missing.length} part(s): ${missing.slice(0, 20).join(', ')}`)
      }
      await fs.mkdir(path.dirname(destinationPath), { recursive: true })
      const hash = crypto.createHash('sha256')
      const output = fsSync.createWriteStream(destinationPath)
      try {
        for (let index = 0; index < session.partCount; index += 1) {
          for await (const chunk of fsSync.createReadStream(partPath(dir, index))) {
            hash.update(chunk as Buffer)
            if (!output.write(chunk)) await new Promise<void>(resolve => output.once('drain', () => resolve()))
          }
        }
        await new Promise<void>((resolve, reject) => output.end((error?: Error | null) => (error ? reject(error) : resolve())))
      } catch (error) {
        output.destroy()
        await fs.rm(destinationPath, { force: true }).catch(() => undefined)
        throw error
      }
      if (hash.digest('hex') !== session.sha256) {
        await fs.rm(destinationPath, { force: true }).catch(() => undefined)
        throw new ChunkedUploadError(422, 'CHECKSUM_MISMATCH', 'Assembled study ZIP does not match the SHA-256 sent by Bridge')
      }
      return { session, sizeBytes: session.totalSize }
    },

    /** Drops the parts and keeps the response, so a repeated complete call returns the same result. */
    async markCompleted(uploadId: string, result: unknown) {
      const { dir } = await readSession(uploadId)
      await fs.writeFile(path.join(dir, resultFile), JSON.stringify(result))
      for (const name of await fs.readdir(dir)) {
        if (name.startsWith('part-')) await fs.rm(path.join(dir, name), { force: true }).catch(() => undefined)
      }
    },

    async completedResult(uploadId: string): Promise<unknown | null> {
      const dir = sessionDir(uploadId)
      const raw = await fs.readFile(path.join(dir, resultFile), 'utf8').catch(() => null)
      return raw ? JSON.parse(raw) : null
    },

    /** Removes sessions untouched for `maxAgeMs`; abandoned uploads otherwise keep their parts forever. */
    async sweep(maxAgeMs: number, now = Date.now()) {
      const entries = await fs.readdir(options.root, { withFileTypes: true }).catch(() => [])
      let removed = 0
      for (const entry of entries) {
        if (!entry.isDirectory() || !uploadIdPattern.test(entry.name)) continue
        const dir = path.join(options.root, entry.name)
        const files = await fs.readdir(dir).catch(() => [] as string[])
        let lastTouched = (await fs.stat(dir).catch(() => null))?.mtimeMs ?? 0
        for (const name of files) lastTouched = Math.max(lastTouched, (await fs.stat(path.join(dir, name)).catch(() => null))?.mtimeMs ?? 0)
        if (now - lastTouched < maxAgeMs) continue
        await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
        removed += 1
      }
      return removed
    },
  }
}

export type ChunkedUploadStore = ReturnType<typeof createChunkedUploadStore>
