import { Worker } from 'node:worker_threads'

type Job = { id: number; buffer: ArrayBuffer; maxSize: number; resolve: (jpeg: Buffer) => void; reject: (error: Error) => void; timer?: NodeJS.Timeout }

const WORKER_URL = new URL('../workers/quickviewPreview.worker.mjs', import.meta.url)
const JOB_TIMEOUT_MS = 30_000

/**
 * A single background thread that renders QuickView previews one at a time, so decoding large
 * images never blocks API requests. Process-local (single app replica).
 */
class PreviewPool {
  private worker: Worker | null = null
  private readonly queue: Job[] = []
  private active: Job | null = null
  private nextId = 1

  render(buffer: ArrayBuffer, maxSize: number) {
    return new Promise<Buffer>((resolve, reject) => {
      this.queue.push({ id: this.nextId++, buffer, maxSize, resolve, reject })
      this.pump()
    })
  }

  private ensureWorker() {
    if (this.worker) return this.worker
    // Plain ESM worker: no inherited flags (e.g. --import tsx or --test) from the parent process.
    const worker = new Worker(WORKER_URL, { execArgv: [] })
    worker.on('message', (message: { id: number; jpeg?: Uint8Array; error?: string }) => {
      if (this.worker !== worker) return
      const job = this.active
      if (!job || job.id !== message.id) return
      this.finish(job, message.error ? new Error(message.error) : null, message.jpeg ? Buffer.from(message.jpeg) : undefined)
    })
    // Events from a worker that was already replaced must not touch the current one.
    worker.on('error', error => { if (this.worker === worker) this.fail(error) })
    worker.on('exit', code => { if (this.worker === worker) this.fail(new Error(`Preview worker exited with code ${code}`)) })
    // After the listeners: attaching a 'message' listener re-references the worker. An idle preview
    // thread must never keep the process alive.
    worker.unref()
    this.worker = worker
    return worker
  }

  private pump() {
    if (this.active || !this.queue.length) return
    const job = this.queue.shift()!
    this.active = job
    job.timer = setTimeout(() => this.fail(new Error('Preview rendering timed out')), JOB_TIMEOUT_MS)
    const worker = this.ensureWorker()
    worker.ref() // hold the process open only while a preview is being rendered
    worker.postMessage({ id: job.id, buffer: job.buffer, maxSize: job.maxSize }, [job.buffer])
  }

  private finish(job: Job, error: Error | null, jpeg?: Buffer) {
    clearTimeout(job.timer)
    this.active = null
    if (error || !jpeg) job.reject(error ?? new Error('Preview rendering failed'))
    else job.resolve(jpeg)
    if (!this.queue.length) this.worker?.unref()
    this.pump()
  }

  // A crashed or stuck worker is replaced; only the job it was running fails.
  private fail(error: Error) {
    const job = this.active
    const worker = this.worker
    this.worker = null
    void worker?.terminate()
    if (job) this.finish(job, error)
  }
}

export const previewPool = new PreviewPool()
