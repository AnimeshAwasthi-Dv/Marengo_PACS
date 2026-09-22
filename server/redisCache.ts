import net from 'node:net'
import tls from 'node:tls'

type RedisReply = string | null
let warnedUnavailable = false

function serializeJson(value: unknown) {
  return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item)
}

function config() {
  const raw = process.env.REDIS_URL?.trim() || (process.env.REDIS_HOST ? `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT ?? '6379'}` : '')
  if (!raw) return null
  const url = new URL(raw)
  return { host: url.hostname, port: Number(url.port || 6379), password: url.password || process.env.REDIS_PASSWORD, tls: process.env.REDIS_TLS === 'true' || url.protocol === 'rediss:' }
}

function command(parts: string[]) {
  return `*${parts.length}\r\n${parts.map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`).join('')}`
}

async function execute(parts: string[]): Promise<RedisReply> {
  const settings = config()
  if (!settings) return null
  return new Promise((resolve, reject) => {
    const socket = settings.tls ? tls.connect({ host: settings.host, port: settings.port, servername: settings.host }) : net.connect(settings.port, settings.host)
    const chunks: Buffer[] = []
    const configuredTimeoutMs = Number(process.env.REDIS_TIMEOUT_MS ?? 250)
    const timeoutMs = Number.isFinite(configuredTimeoutMs) ? Math.max(50, configuredTimeoutMs) : 250
    const timer = setTimeout(() => socket.destroy(new Error('Redis request timed out')), timeoutMs)
    socket.setNoDelay(true)
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback()
      socket.end()
    }
    const parseResponse = () => {
      const response = Buffer.concat(chunks).toString('utf8')
      if (!response) return undefined
      if (response.startsWith('+')) {
        const end = response.indexOf('\r\n')
        return end >= 0 ? { value: response.slice(1, end) } : undefined
      }
      if (response.startsWith('-')) {
        const end = response.indexOf('\r\n')
        return end >= 0 ? { error: new Error(response.slice(1, end)) } : undefined
      }
      if (response.startsWith('$-1\r\n')) return { value: null }
      if (response.startsWith('$')) {
        const end = response.indexOf('\r\n')
        if (end < 0) return undefined
        const length = Number(response.slice(1, end))
        if (!Number.isFinite(length) || length < 0) return { value: null }
        const start = end + 2
        const stop = start + length
        if (response.length < stop + 2) return undefined
        return { value: response.slice(start, stop) }
      }
      return undefined
    }
    socket.once('connect', () => socket.write(command(settings.password ? ['AUTH', settings.password] : []).replace(/^\*0\r\n/, '') + command(parts)))
    socket.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk))
      const parsed = parseResponse()
      if (!parsed) return
      if ('error' in parsed && parsed.error) finish(() => reject(parsed.error))
      else finish(() => resolve(parsed.value ?? null))
    })
    socket.once('error', (error) => finish(() => reject(error)))
    socket.once('close', () => {
      if (settled) return
      const parsed = parseResponse()
      if (parsed && 'error' in parsed && parsed.error) finish(() => reject(parsed.error))
      else finish(() => resolve(parsed?.value ?? null))
    })
  })
}

export async function redisPing(): Promise<boolean> {
  try {
    return (await execute(['PING'])) === 'PONG'
  } catch (error) {
    warn(error)
    return false
  }
}

export async function redisGetJson<T>(key: string): Promise<T | null> {
  try {
    const value = await execute(['GET', key])
    if (!value) return null
    return JSON.parse(value) as T
  } catch (error) { warn(error); return null }
}

export async function redisSetJson(key: string, value: unknown, ttlSeconds = 300) {
  try {
    const serialized = serializeJson(value)
    await execute(['SET', key, serialized, 'EX', String(ttlSeconds)])
  } catch (error) { warn(error) }
}

function warn(error: unknown) { if (!warnedUnavailable) { warnedUnavailable = true; console.warn(`Redis cache unavailable; continuing without cache: ${error instanceof Error ? error.message : String(error)}`) } }
