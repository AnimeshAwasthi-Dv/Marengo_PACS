import { createClient, createCluster, type RedisClientType, type RedisClusterType } from 'redis'

type CacheClient = RedisClientType | RedisClusterType
type CacheConfig = { url: string; cluster: boolean }
let client: CacheClient | null = null
let connection: Promise<CacheClient | null> | null = null
let warnedUnavailable = false
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

async function getClient(): Promise<CacheClient | null> {
  const config = cacheConfig()
  if (!config) return null
  if (client?.isReady) return client
  if (connection) return connection
  connection = (async () => {
    const next = config.cluster ? createCluster({ rootNodes: [{ url: config.url }] }) : createClient({ url: config.url })
    next.on('error', warn)
    next.on('reconnecting', () => console.warn('Redis cache reconnecting'))
    try {
      await next.connect()
      client = next
      warnedUnavailable = false
      console.info(`Redis cache connected (${config.cluster ? 'cluster' : 'single-node'})`)
      return next
    } catch (error) {
      warn(error)
      await next.disconnect().catch(() => undefined)
      return null
    }
  })()
  const result = await connection
  connection = null
  return result
}

async function withClient<T>(operation: (redis: CacheClient) => Promise<T>, fallback: T): Promise<T> {
  const redis = await getClient()
  if (!redis) return fallback
  try {
    return await Promise.race([operation(redis), new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Redis operation timed out')), Number(process.env.REDIS_TIMEOUT_MS ?? 500)))])
  } catch (error) {
    warn(error)
    return fallback
  }
}

export async function redisPing() { return withClient(async redis => (await redis.ping()) === 'PONG', false) }

export async function redisGetJson<T>(key: string): Promise<T | null> {
  return withClient(async redis => {
    const value = await redis.get(key)
    if (!value) return null
    try { return JSON.parse(value) as T } catch { return null }
  }, null)
}

export async function redisSetJson(key: string, value: unknown, ttlSeconds = 60) {
  const serialized = JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item)
  await withClient(async redis => { await redis.set(key, serialized, { EX: Math.max(1, Math.round(ttlSeconds)) }); return true }, false)
}

export async function redisDeleteKeys(prefix: string) {
  if (!prefix.trim()) return
  await withClient(async redis => {
    const keys: string[] = []
    for await (const key of redis.scanIterator({ MATCH: `${prefix}*`, COUNT: 100 })) keys.push(key)
    if (keys.length) await redis.del(keys)
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
  const redis = client
  client = null
  connection = null
  if (redis?.isOpen) await redis.quit().catch(() => redis.disconnect().catch(() => undefined))
}
