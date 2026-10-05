import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { once } from 'node:events'
import { pipeline } from 'node:stream/promises'
import type { Readable } from 'node:stream'
import express, { type Request, type Response } from 'express'
import yazl from 'yazl'

/**
 * Per-image Bridge uploads. Instead of one study ZIP, Bridge sends each DICOM image (identified by its SHA-256)
 * while the study is still arriving, asking first which ones the portal lacks. Committing the study's image list
 * builds the same ZIP the ZIP upload would have delivered, so registration and everything after it are unchanged.
 * Re-sends, retries and images arriving later cost only the images the portal does not have yet.
 */

export class InstanceUploadError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: Record<string, unknown>) {
    super(message)
  }
}

export type InstanceRef = { sha256: string; size: number }
export type CommitInstance = InstanceRef & { sopInstanceUid: string }

const sha256Pattern = /^[0-9a-f]{64}$/
// One path segment each: letters, digits, dots, dashes and underscores, never "." or "..".
const segmentPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export function createInstanceUploadStore(options: { root: string; maxBatchBytes: number; maxBatchInstances: number; maxStudyBytes: number }) {
  const studyDir = (clientCode: string, studyUid: string) => {
    for (const [name, value] of [['client_code', clientCode], ['study_instance_uid', studyUid]] as const) {
      if (typeof value !== 'string' || !segmentPattern.test(value) || value.includes('..')) {
        throw new InstanceUploadError(400, 'INVALID_STUDY', `${name} is missing or invalid`)
      }
    }
    return path.join(options.root, clientCode.toUpperCase(), studyUid)
  }
  const instancePath = (dir: string, sha256: string) => path.join(dir, `${sha256}.dcm`)

  const normalizeRefs = (refs: unknown, maxCount: number): InstanceRef[] => {
    if (!Array.isArray(refs) || refs.length === 0 || refs.length > maxCount) {
      throw new InstanceUploadError(400, 'INVALID_INSTANCES', `instances must list between 1 and ${maxCount} images`)
    }
    return refs.map((ref, index) => {
      const sha256 = typeof ref?.sha256 === 'string' ? ref.sha256.toLowerCase() : ''
      const size = ref?.size
      if (!sha256Pattern.test(sha256)) throw new InstanceUploadError(400, 'INVALID_INSTANCES', `instances[${index}].sha256 must be a hex SHA-256 digest`)
      if (!Number.isSafeInteger(size) || size <= 0 || size > options.maxBatchBytes) {
        throw new InstanceUploadError(400, 'INVALID_INSTANCES', `instances[${index}].size must be between 1 and ${options.maxBatchBytes} bytes`)
      }
      return { sha256, size }
    })
  }

  async function missing(clientCode: string, studyUid: string, refs: InstanceRef[]) {
    const dir = studyDir(clientCode, studyUid)
    const result = new Set<string>()
    for (const ref of refs) {
      const stat = await fs.stat(instancePath(dir, ref.sha256)).catch(() => null)
      if (stat?.size !== ref.size) result.add(ref.sha256)
    }
    return [...result]
  }

  return {
    normalizeRefs,

    /** The images of `refs` this study does not have yet. A stored image is identified by content, so re-sends match. */
    async missing(clientCode: string, studyUid: string, refs: unknown) {
      return missing(clientCode, studyUid, normalizeRefs(refs, Number.MAX_SAFE_INTEGER))
    },

    /**
     * Stores the images of one batch: `body` is their bytes concatenated in the order of `refs`. Each image is
     * checked against its SHA-256 before it is kept, so a cut-off or altered request stores nothing wrong.
     */
    async writeBatch(clientCode: string, studyUid: string, refsInput: unknown, body: Readable) {
      const refs = normalizeRefs(refsInput, options.maxBatchInstances)
      const total = refs.reduce((sum, ref) => sum + ref.size, 0)
      if (total > options.maxBatchBytes) throw new InstanceUploadError(413, 'BATCH_TOO_LARGE', `A batch may carry at most ${options.maxBatchBytes} bytes`)
      const dir = studyDir(clientCode, studyUid)
      await fs.mkdir(dir, { recursive: true })

      type Current = { ref: InstanceRef; tempPath: string; output: fsSync.WriteStream; hash: crypto.Hash; written: number }
      let index = 0
      let current: Current | null = null
      const finish = async (item: Current) => {
        item.output.end()
        await once(item.output, 'close')
        if (item.hash.digest('hex') !== item.ref.sha256) {
          await fs.rm(item.tempPath, { force: true }).catch(() => undefined)
          throw new InstanceUploadError(400, 'INSTANCE_CHECKSUM_MISMATCH', `Image ${index + 1} of the batch does not match its SHA-256`)
        }
        await fs.rename(item.tempPath, instancePath(dir, item.ref.sha256))
      }

      try {
        for await (const chunk of body as AsyncIterable<Buffer>) {
          let offset = 0
          while (offset < chunk.length) {
            if (index >= refs.length) throw new InstanceUploadError(400, 'BATCH_SIZE_MISMATCH', 'Batch carries more bytes than its images declare')
            if (!current) {
              const tempPath = `${instancePath(dir, refs[index].sha256)}.${crypto.randomUUID()}.tmp`
              current = { ref: refs[index], tempPath, output: fsSync.createWriteStream(tempPath), hash: crypto.createHash('sha256'), written: 0 }
            }
            const piece = chunk.subarray(offset, offset + Math.min(chunk.length - offset, current.ref.size - current.written))
            current.hash.update(piece)
            if (!current.output.write(piece)) await once(current.output, 'drain')
            offset += piece.length
            current.written += piece.length
            if (current.written === current.ref.size) {
              const done = current
              current = null
              await finish(done)
              index += 1
            }
          }
        }
        if (index !== refs.length || current) throw new InstanceUploadError(400, 'BATCH_SIZE_MISMATCH', `Batch ended after ${index} of ${refs.length} image(s)`)
      } catch (error) {
        if (current) {
          current.output.destroy()
          await fs.rm(current.tempPath, { force: true }).catch(() => undefined)
        }
        throw error
      }
      return { stored: refs.length }
    },

    /**
     * Writes the study ZIP from its committed image list (images stored, not recompressed) plus any extra entries.
     * Refuses with INSTANCES_MISSING, listing them, until every image has arrived.
     */
    async buildZip(clientCode: string, studyUid: string, instancesInput: unknown, destinationPath: string, extraEntries: { name: string; content: Buffer }[] = []) {
      if (!Array.isArray(instancesInput)) throw new InstanceUploadError(400, 'INVALID_INSTANCES', 'instances must be a list')
      const refs = normalizeRefs(instancesInput, Number.MAX_SAFE_INTEGER)
      const instances: CommitInstance[] = refs.map((ref, index) => ({ ...ref, sopInstanceUid: String(instancesInput[index]?.sop_instance_uid ?? '') }))
      const totalBytes = refs.reduce((sum, ref) => sum + ref.size, 0)
      if (totalBytes > options.maxStudyBytes) throw new InstanceUploadError(413, 'UPLOAD_TOO_LARGE', `Study exceeds the ${options.maxStudyBytes} byte upload limit`)
      const absent = await missing(clientCode, studyUid, refs)
      if (absent.length > 0) {
        throw new InstanceUploadError(409, 'INSTANCES_MISSING', `Portal is missing ${absent.length} image(s) of this study`, { missing: absent })
      }

      const dir = studyDir(clientCode, studyUid)
      await fs.mkdir(path.dirname(destinationPath), { recursive: true })
      const zip = new yazl.ZipFile()
      const written = pipeline(zip.outputStream, fsSync.createWriteStream(destinationPath))
      const names = new Set<string>()
      for (const instance of instances) {
        const base = instance.sopInstanceUid.replace(/[^A-Za-z0-9._-]/g, '_') || instance.sha256
        let name = `${base}.dcm`
        for (let suffix = 1; names.has(name.toLowerCase()); suffix += 1) name = `${base}_${suffix}.dcm`
        names.add(name.toLowerCase())
        zip.addFile(instancePath(dir, instance.sha256), name, { compress: false })
      }
      for (const entry of extraEntries) zip.addBuffer(entry.content, entry.name)
      zip.end()
      await written
      return { sizeBytes: (await fs.stat(destinationPath)).size, instanceCount: instances.length }
    },

    /** Removes studies whose images have not changed for `maxAgeMs`. */
    async sweep(maxAgeMs: number, now = Date.now()) {
      let removed = 0
      for (const client of await fs.readdir(options.root, { withFileTypes: true }).catch(() => [])) {
        if (!client.isDirectory()) continue
        const clientDir = path.join(options.root, client.name)
        for (const study of await fs.readdir(clientDir, { withFileTypes: true }).catch(() => [])) {
          if (!study.isDirectory()) continue
          const dir = path.join(clientDir, study.name)
          let lastTouched = (await fs.stat(dir).catch(() => null))?.mtimeMs ?? 0
          for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
            lastTouched = Math.max(lastTouched, (await fs.stat(path.join(dir, name)).catch(() => null))?.mtimeMs ?? 0)
          }
          if (now - lastTouched < maxAgeMs) continue
          await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
          removed += 1
        }
      }
      return removed
    },
  }
}

export type InstanceUploadStore = ReturnType<typeof createInstanceUploadStore>

export type InstanceCommitHandler = (input: {
  fields: Record<string, string>
  filePath: string
  uploadName: string
  folder: string
  sizeBytes: number
}) => Promise<{ status: number; body: unknown }>

/**
 * Routes for per-image uploads, mounted under the Bridge API prefixes. `authorize` checks the Bridge token;
 * `commit` registers the built ZIP exactly as the ZIP upload does.
 */
export function createBridgeInstanceUploadRouter(options: {
  store: InstanceUploadStore
  authorize: (req: Request, res: Response) => Promise<boolean>
  commit: InstanceCommitHandler
  studiesRoot: string
}) {
  const router = express.Router()
  const committing = new Set<string>()

  router.post('/studies/instances/check', async (req, res) => {
    if (!await options.authorize(req, res)) return
    try {
      const body = req.body ?? {}
      res.json({ missing: await options.store.missing(String(body.client_code ?? ''), String(body.study_instance_uid ?? ''), body.instances) })
    } catch (error) {
      sendError(res, error)
    }
  })

  router.put('/studies/instances/batch', async (req, res) => {
    if (!await options.authorize(req, res)) return
    try {
      let refs: unknown
      try {
        refs = JSON.parse(String(req.headers['x-instances'] ?? ''))
      } catch {
        throw new InstanceUploadError(400, 'INVALID_INSTANCES', 'X-Instances header must be a JSON list of {sha256, size}')
      }
      const encoding = String(req.headers['content-encoding'] ?? '').toLowerCase()
      if (encoding && encoding !== 'gzip' && encoding !== 'identity') throw new InstanceUploadError(415, 'UNSUPPORTED_ENCODING', `Content-Encoding ${encoding} is not supported`)
      let body: Readable = req
      if (encoding === 'gzip') {
        // pipeline (unlike pipe) destroys the gunzip stream if the client disconnects, so the read below ends.
        const gunzip = zlib.createGunzip()
        pipeline(req, gunzip).catch(() => undefined)
        body = gunzip
      }
      res.json(await options.store.writeBatch(String(req.query.client_code ?? ''), String(req.query.study_instance_uid ?? ''), refs, body))
    } catch (error) {
      sendError(res, error)
    }
  })

  router.post('/studies/instances/commit', async (req, res) => {
    if (!await options.authorize(req, res)) return
    const body = req.body ?? {}
    const clientCode = String(body.client_code ?? '')
    const studyUid = String(body.study_instance_uid ?? '')
    const key = `${clientCode.toUpperCase()}/${studyUid}`
    if (committing.has(key)) {
      return res.status(409).json({ error: { code: 'COMMIT_IN_PROGRESS', message: 'This study is already being committed; retry shortly' } })
    }

    committing.add(key)
    let folder: string | null = null
    let registering = false
    try {
      const fields = Object.fromEntries(Object.entries(body.fields ?? {}).map(([name, value]) => [name, String(value)]))
      const uploadName = safeZipName(String(body.file_name ?? `${studyUid}.zip`))
      folder = path.join(options.studiesRoot, crypto.randomUUID())
      const filePath = path.join(folder, uploadName)
      const extras = fields.patient_meta ? [{ name: 'patient_meta.json', content: Buffer.from(fields.patient_meta) }] : []
      const zip = await options.store.buildZip(clientCode, studyUid, body.instances, filePath, extras)
      registering = true
      const result = await options.commit({ fields, filePath, uploadName, folder, sizeBytes: zip.sizeBytes })
      res.status(result.status).json(result.body)
    } catch (error) {
      if (folder && !registering) await fs.rm(folder, { recursive: true, force: true }).catch(() => undefined)
      sendError(res, error)
    } finally {
      committing.delete(key)
    }
  })

  return router
}

function safeZipName(name: string) {
  const base = path.basename(name).replace(/[^A-Za-z0-9._-]/g, '_')
  return base.toLowerCase().endsWith('.zip') && base.length > 4 ? base : `${base || 'study'}.zip`
}

function sendError(res: Response, error: unknown) {
  if (res.headersSent) return
  if (error instanceof InstanceUploadError) {
    return res.status(error.status).json({ error: { code: error.code, message: error.message, ...error.details } })
  }
  console.error('Bridge instance upload failed', error)
  res.status(400).json({ error: { code: 'BRIDGE_UPLOAD_FAILED', message: error instanceof Error ? error.message : 'Unable to upload bridge images' } })
}
