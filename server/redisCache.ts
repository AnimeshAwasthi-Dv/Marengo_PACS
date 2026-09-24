import { createClient, createCluster } from 'redis'

type StandaloneRedisClient = ReturnType<typeof createClient>
type ClusterRedisClient = ReturnType<typeof createCluster>
type CacheConnection =
  | { mode: 'standalone'; client: StandaloneRedisClient }
  | { mode: 'cluster'; client: ClusterRedisClient }
type CacheConfig = { url: string; cluster: boolean }
let connectionClient: CacheConnection | null = null
let connection: Promise<CacheConnection | null> | null = null
let warnedUnavailable = false
let retryAfter = 0
const inFlight = new Map<string, Promise<unknown>>()
export const redisNamespace = `marengo:${process.env.NODE_ENV ?? 'development'}`

function warn(error: unknown) {
  if (warnedUnavailable) return
  warnedUnavailable = true
  console.warn(`Redis cache unavailable; continuing without cache: ${error instanceof Error ? error.message : String(error)}`)
}

function cacheConfig(): CacheConfig | null {
  if (process.env.REDIS_CACHE_ENABLED !== 'true') return null
  const url = process.env.REDIS_URL?.trim()
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (!['redis:', 'rediss:'].includes(parsed.protocol) || !parsed.hostname) return null
    return { url, cluster: process.env.REDIS_CLUSTER_MODE === 'true' }
  } catch {
    warn('Redis configuration is malformed; cache disabled')
    return null
  }
}

function isReady(redis: CacheConnection) {
  return redis.mode === 'standalone' ? redis.client.isReady : redis.client.isOpen
}

async function createCacheConnection(config: CacheConfig): Promise<CacheConnection | null> {
  const next: CacheConnection = config.cluster
    ? { mode: 'cluster', client: createCluster({ rootNodes: [{ url: config.url }], defaults: { socket: { connectTimeout: 1000, reconnectStrategy: false }, disableOfflineQueue: true } }) }
    : { mode: 'standalone', client: createClient({ url: config.url, socket: { connectTimeout: 1000, reconnectStrategy: false }, disableOfflineQueue: true }) }

  next.client.on('error', warn)
  next.client.on('reconnecting', () => console.warn('Redis cache reconnecting'))

  try {
    await next.client.connect()
    warnedUnavailable = false
    console.info(`Redis cache connected (${config.cluster ? 'cluster' : 'single-node'})`)
    return next
  } catch (error) {
    warn(error)
    await next.client.disconnect().catch(() => undefined)
    return null
  }
}

async function getClient(): Promise<CacheConnection | null> {
  const config = cacheConfig()
  if (!config) return null
  if (connectionClient && isReady(connectionClient)) return connectionClient
  if (Date.now() < retryAfter) return null
  if (connection) return connection
  connection = createCacheConnection(config)
  const result = await connection
  connectionClient = result
  if (!result) retryAfter = Date.now() + 30000
  connection = null
  return result
}

async function withClient<T>(operation: (redis: CacheConnection) => Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const work = async () => { const redis = await getClient(); return redis ? operation(redis) : fallback }
    return await Promise.race([work(), new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('Redis operation timed out')), Number(process.env.REDIS_TIMEOUT_MS ?? 500)) })])
  } catch (error) {
    warn(error)
    return fallback
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function cachePing(redis: CacheConnection) {
  const reply = redis.mode === 'standalone'
    ? await redis.client.ping()
    : await redis.client.sendCommand(undefined, true, ['PING'])
  return reply === 'PONG'
}

async function cacheGet(redis: CacheConnection, key: string) {
  return redis.mode === 'standalone'
    ? await redis.client.get(key)
    : await redis.client.sendCommand<string | null>(key, true, ['GET', key])
}

async function cacheSet(redis: CacheConnection, key: string, value: string, ttlSeconds: number) {
  if (redis.mode === 'standalone') {
    await redis.client.set(key, value, { EX: ttlSeconds })
    return
  }
  await redis.client.sendCommand(key, false, ['SET', key, value, 'EX', String(ttlSeconds)])
}

async function cacheDelete(redis: CacheConnection, keys: string[]) {
  if (!keys.length) return
  if (redis.mode === 'standalone') {
    await redis.client.del(keys)
    return
  }
  await Promise.all(keys.map(key => redis.client.del(key)))
}

async function scanStandalone(redis: StandaloneRedisClient, match: string) {
  const keys: string[] = []
  for await (const batch of redis.scanIterator({ MATCH: match, COUNT: 100 })) {
    keys.push(...batch.map(key => key.toString()))
  }
  return keys
}

async function scanCluster(redis: ClusterRedisClient, match: string) {
  const keys = new Set<string>()
  await Promise.all(redis.masters.map(async master => {
    const node = await redis.nodeClient(master)
    for await (const batch of node.scanIterator({ MATCH: match, COUNT: 100 })) {
      for (const key of batch) keys.add(key.toString())
    }
  }))
  return [...keys]
}

async function cacheScan(redis: CacheConnection, match: string) {
  return redis.mode === 'standalone'
    ? scanStandalone(redis.client, match)
    : scanCluster(redis.client, match)
}

export async function redisPing() { return withClient(cachePing, false) }

export async function redisGetJson<T>(key: string): Promise<T | null> {
  return withClient(async redis => {
    const value = await cacheGet(redis, key)
    if (typeof value !== 'string') return null
    if (!value) return null
    try { return JSON.parse(value) as T } catch { return null }
  }, null)
}

export async function redisSetJson(key: string, value: unknown, ttlSeconds = 60) {
  if (!cacheConfig()) return
  const serialized = JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item)
  await withClient(async redis => { await cacheSet(redis, key, serialized, Math.max(1, Math.round(ttlSeconds))); return true }, false)
}

export async function redisDeleteKeys(prefix: string) {
  if (!prefix.trim()) return
  await withClient(async redis => {
    const keys = await cacheScan(redis, `${prefix}*`)
    await cacheDelete(redis, keys)
    return true
  }, false)
}

export async function invalidateDashboardCaches() {
  await Promise.all([
    redisDeleteKeys(`${redisNamespace}:admin-overview:`),
    redisDeleteKeys(`${redisNamespace}:client-dashboard:`),
  ])
}

export async function cachedJson<T>(key: string, loader: () => Promise<T>, ttlSeconds = 60): Promise<T> {
  const cached = await redisGetJson<T>(key)
  if (cached !== null) return cached
  const existing = inFlight.get(key) as Promise<T> | undefined
  if (existing) return existing
  const pending = loader().then(async value => { await redisSetJson(key, value, ttlSeconds); return value }).finally(() => inFlight.delete(key))
  inFlight.set(key, pending)
  return pending
}

export async function closeRedis() {
  const redis = connectionClient
  connectionClient = null
  connection = null
  if (redis?.client.isOpen) await redis.client.quit().catch(() => redis.client.disconnect().catch(() => undefined))
}
