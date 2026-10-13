import { createHash } from 'node:crypto';
import { Queue, Worker, type ConnectionOptions, type Job, type JobsOptions } from 'bullmq';
import { recordOperationalFailure } from '../operationalAlerts';

/**
 * Messages between the api, ingest and worker processes (BullMQ on Redis).
 *
 * The database stays the record of what must happen; a message only says "do this now". Every handler is
 * idempotent (it re-checks and claims the database row), and each process runs a 60 s sweep that re-sends
 * messages for work the database says is still pending. So a message lost to a crash or a Redis outage
 * delays work by at most a minute; it never loses it.
 */
export const QUEUE_NAMES = ['dicom-intake', 'study-prepare', 'study-dispatch', 'study-submit', 'pacs-deliver', 'processing-cancel', 'receivers-reconcile'] as const;
export type QueueName = typeof QUEUE_NAMES[number];

// The hash tag keeps every BullMQ key in one Redis Cluster slot.
const PREFIX = '{marengo}';
const DAY_SECONDS = 24 * 60 * 60;

const defaults: Record<QueueName, JobsOptions> = {
  // Failed intake/prepare/dispatch jobs are kept a day, so the sweeps don't re-run a broken study every minute.
  'dicom-intake': { attempts: 5, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: true, removeOnFail: { age: DAY_SECONDS } },
  // Completed preparations are kept a day so the sweep can tell a prepared study from a lost message.
  'study-prepare': { attempts: 5, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: { age: DAY_SECONDS }, removeOnFail: { age: DAY_SECONDS } },
  'study-dispatch': { attempts: 5, backoff: { type: 'exponential', delay: 60_000 }, removeOnComplete: true, removeOnFail: { age: DAY_SECONDS } },
  // Submission and PACS retries follow the database policy (each retry is a new delayed message); these
  // attempts only cover a handler that crashed before recording its outcome.
  'study-submit': { attempts: 3, backoff: { type: 'exponential', delay: 60_000 }, removeOnComplete: true, removeOnFail: true },
  'pacs-deliver': { attempts: 3, backoff: { type: 'exponential', delay: 60_000 }, removeOnComplete: true, removeOnFail: true },
  'processing-cancel': { attempts: 3, backoff: { type: 'fixed', delay: 5_000 }, removeOnComplete: true, removeOnFail: true },
  'receivers-reconcile': { attempts: 3, backoff: { type: 'fixed', delay: 10_000 }, removeOnComplete: true, removeOnFail: true },
};

function redisUrl() {
  const url = process.env.QUEUE_REDIS_URL?.trim();
  if (!url) throw new Error('QUEUE_REDIS_URL is not set. The api, ingest and worker processes exchange messages through Redis.');
  return new URL(url);
}

function connection(forWorker: boolean): ConnectionOptions {
  const url = redisUrl();
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : undefined,
    tls: url.protocol === 'rediss:' ? {} : undefined,
    // Workers wait for Redis to come back; producers fail fast so an HTTP request never hangs on Redis.
    maxRetriesPerRequest: forWorker ? null : 1,
    enableOfflineQueue: forWorker,
    connectTimeout: 5_000,
  };
}

export function queuesConfigured() {
  return Boolean(process.env.QUEUE_REDIS_URL?.trim());
}

const queues = new Map<QueueName, Queue>();
function queue(name: QueueName) {
  let existing = queues.get(name);
  if (!existing) {
    existing = new Queue(name, { connection: connection(false), prefix: PREFIX, defaultJobOptions: defaults[name] });
    existing.on('error', error => console.error(`Queue ${name} connection error`, error.message));
    queues.set(name, existing);
  }
  return existing;
}

/** BullMQ job ids may not contain ':'; long parts (paths) are hashed. */
export function jobId(name: QueueName, ...parts: Array<string | number>) {
  return [name, ...parts.map(part => {
    const text = String(part).replace(/:/g, '_');
    return text.length > 80 ? createHash('sha1').update(text).digest('hex') : text;
  })].join('__');
}

/**
 * Sends a message. Never throws: the caller has already saved its work in the database, and the sweep re-sends
 * the message if Redis is unavailable now. A message with an id that is still waiting or running is ignored.
 */
export async function sendMessage(name: QueueName, id: string, data: Record<string, unknown>, options: { delayMs?: number; priority?: number } = {}) {
  try {
    await Promise.race([
      queue(name).add(name, data, { jobId: id, delay: Math.max(0, options.delayMs ?? 0), priority: options.priority }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Redis did not answer within 5 s')), 5_000).unref()),
    ]);
    return true;
  } catch (error) {
    console.error(`Message ${id} was not sent; the database sweep will re-send it`, error instanceof Error ? error.message : error);
    return false;
  }
}

/** Whether a message with this id is waiting, delayed or running. */
export async function messagePending(name: QueueName, id: string) {
  const job = await queue(name).getJob(id);
  if (!job) return false;
  const state = await job.getState();
  return state === 'waiting' || state === 'delayed' || state === 'active' || state === 'prioritized' || state === 'waiting-children';
}

const workers: Worker[] = [];

/** Starts consuming one queue in this process. One copy of each consumer process (see processRole.ts). */
export function consume(name: QueueName, concurrency: number, handler: (job: Job) => Promise<unknown>) {
  const worker = new Worker(name, handler, {
    connection: connection(true),
    prefix: PREFIX,
    concurrency,
    // Long Renewist uploads keep the lock: BullMQ renews it every lockDuration / 2 while the handler runs.
    lockDuration: 60_000,
    maxStalledCount: 2,
  });
  worker.on('failed', (job, error) => {
    if (!job) return;
    const final = job.attemptsMade >= (job.opts.attempts ?? 1);
    console.error(`Queue ${name} job ${job.id} failed (attempt ${job.attemptsMade}${final ? ', giving up' : ''})`, error.message);
    if (final) void recordOperationalFailure(`Queue ${name}`, String(job.id), `Message failed after ${job.attemptsMade} attempts: ${error.message}`.slice(0, 500)).catch(() => undefined);
  });
  worker.on('stalled', id => console.error(`Queue ${name} job ${id} stalled; it will run again`));
  worker.on('error', error => {
    console.error(`Queue ${name} worker error`, error.message);
    void recordOperationalFailure('Message queue', name, `Queue worker cannot reach Redis: ${error.message}`.slice(0, 500)).catch(() => undefined);
  });
  workers.push(worker);
  return worker;
}

/**
 * BullMQ needs Redis to keep every key (maxmemory-policy noeviction); an evicting Redis silently drops messages.
 * Managed Redis may refuse CONFIG, in which case this only logs.
 */
export async function checkQueueRedis() {
  const client = await queue('study-submit').client;
  try {
    const reply = await (client as unknown as { config: (...args: string[]) => Promise<string[]> }).config('GET', 'maxmemory-policy');
    const policy = reply?.[1];
    if (policy && policy !== 'noeviction') {
      const message = `Redis maxmemory-policy is ${policy}; queues need noeviction or messages can be dropped.`;
      console.error(message);
      await recordOperationalFailure('Message queue', 'redis-eviction-policy', message).catch(() => undefined);
    }
  } catch (error) {
    console.warn('Could not read the Redis eviction policy', error instanceof Error ? error.message : error);
  }
}

/** Lets running handlers finish (up to the container's stop grace period), then disconnects. */
export async function closeQueues() {
  await Promise.allSettled(workers.map(worker => worker.close()));
  await Promise.allSettled([...queues.values()].map(item => item.close()));
}
