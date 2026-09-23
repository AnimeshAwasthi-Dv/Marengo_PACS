const net = require('node:net')
const tls = require('node:tls')

const listenHost = process.env.PG_TLS_PROXY_HOST || '127.0.0.1'
const listenPort = Number(process.env.PG_TLS_PROXY_PORT || 15432)
const upstreamHost = process.env.PG_TLS_PROXY_UPSTREAM_HOST || 'marengo-staging-db.cv6sic6s0w5b.ap-south-1.rds.amazonaws.com'
const upstreamPort = Number(process.env.PG_TLS_PROXY_UPSTREAM_PORT || 5432)

const sslRequest = Buffer.from([0, 0, 0, 8, 4, 210, 22, 47])

const server = net.createServer((client) => {
  const upstream = net.connect({ host: upstreamHost, port: upstreamPort })
  let settled = false

  const closeBoth = () => {
    client.destroy()
    upstream.destroy()
  }

  client.on('error', closeBoth)
  upstream.on('error', closeBoth)

  upstream.once('connect', () => upstream.write(sslRequest))
  upstream.once('data', (chunk) => {
    if (settled) return
    settled = true
    if (chunk[0] !== 83) return closeBoth()

    const secure = tls.connect({
      socket: upstream,
      servername: upstreamHost,
      rejectUnauthorized: false,
    })

    secure.once('secureConnect', () => {
      if (chunk.length > 1) secure.unshift(chunk.subarray(1))
      client.pipe(secure)
      secure.pipe(client)
    })
    secure.on('error', closeBoth)
    secure.on('close', () => client.destroy())
    client.on('close', () => secure.destroy())
  })
})

server.on('error', (error) => {
  console.error(`Postgres TLS proxy failed: ${error.message}`)
  process.exit(1)
})

server.listen(listenPort, listenHost, () => {
  console.log(`Postgres TLS proxy listening on ${listenHost}:${listenPort} -> ${upstreamHost}:${upstreamPort}`)
})

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 5000).unref()
  })
}
