const { spawn } = require('node:child_process')
const net = require('node:net')
const path = require('node:path')

const proxyHost = process.env.PG_TLS_PROXY_HOST || '127.0.0.1'
const proxyPort = Number(process.env.PG_TLS_PROXY_PORT || 15432)
const startupTimeoutMs = Number(process.env.PG_TLS_PROXY_STARTUP_TIMEOUT_MS || 10000)

function databaseUsesLocalProxy() {
  const value = process.env.DATABASE_URL
  if (!value) return false
  try {
    const url = new URL(value)
    const hostname = url.hostname === 'localhost' ? '127.0.0.1' : url.hostname
    const configuredHost = proxyHost === 'localhost' ? '127.0.0.1' : proxyHost
    const port = Number(url.port || 5432)
    return hostname === configuredHost && port === proxyPort
  } catch {
    return false
  }
}

function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ host, port })
      socket.once('connect', () => {
        socket.destroy()
        resolve()
      })
      socket.once('error', (error) => {
        socket.destroy()
        if (Date.now() >= deadline) {
          reject(new Error(`PostgreSQL TLS proxy did not start on ${host}:${port}: ${error.message}`))
          return
        }
        setTimeout(attempt, 100)
      })
    }
    attempt()
  })
}

function isPortOpen(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => {
      socket.destroy()
      resolve(false)
    })
  })
}

function spawnChild(command, args, options = {}) {
  return spawn(command, args, { stdio: 'inherit', ...options })
}

async function stopProcess(child, name) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, 5000)
    timeout.unref()
    child.once('exit', () => {
      clearTimeout(timeout)
      resolve()
    })
    child.kill('SIGTERM')
  })
  console.log(`${name} stopped`)
}

async function run(command, args) {
  let proxy = null
  let child = null
  let shuttingDown = false

  const shutdown = async (signal) => {
    if (shuttingDown) return
    shuttingDown = true
    if (child && child.exitCode === null && child.signalCode === null) child.kill(signal)
    await stopProcess(proxy, 'PostgreSQL TLS proxy')
  }

  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      void shutdown(signal).finally(() => process.exit(128 + (signal === 'SIGINT' ? 2 : 15)))
    })
  }

  try {
    if (databaseUsesLocalProxy()) {
      if (await isPortOpen(proxyHost, proxyPort)) {
        console.log(`PostgreSQL TLS proxy endpoint already available on ${proxyHost}:${proxyPort}`)
      } else {
        const proxyScript = path.join(__dirname, 'pg-tls-proxy.cjs')
        proxy = spawnChild(process.execPath, [proxyScript])
        proxy.once('exit', (code, signal) => {
          if (!shuttingDown && (!child || child.exitCode === null)) {
            console.error(`PostgreSQL TLS proxy exited before command completed (${signal ?? code})`)
            if (child) child.kill('SIGTERM')
          }
        })
        await waitForPort(proxyHost, proxyPort, startupTimeoutMs)
      }
    }

    child = spawnChild(command, args)
    const exit = await new Promise((resolve) => {
      child.once('exit', (code, signal) => resolve({ code, signal }))
    })

    shuttingDown = true
    await stopProcess(proxy, 'PostgreSQL TLS proxy')
    if (exit.signal) process.kill(process.pid, exit.signal)
    process.exit(exit.code ?? 1)
  } catch (error) {
    shuttingDown = true
    console.error(error instanceof Error ? error.message : String(error))
    await stopProcess(proxy, 'PostgreSQL TLS proxy')
    process.exit(1)
  }
}

module.exports = { run }

if (require.main === module) {
  const [, , command, ...args] = process.argv
  if (!command) {
    console.error('Usage: node scripts/with-pg-tls-proxy.cjs <command> [...args]')
    process.exit(1)
  }
  void run(command, args)
}
