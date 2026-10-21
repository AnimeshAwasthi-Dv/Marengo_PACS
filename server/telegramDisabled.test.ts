import assert from 'node:assert/strict'
import test from 'node:test'
import { parse } from 'dotenv'
import { existsSync, readFileSync } from 'node:fs'
import { telegramConfig, telegramAlertConfig, telegramUrgentConfig, telegramCallbackConfig, sendTelegram, TelegramDeliveryError } from './telegramPolicy'
import { enqueueTelegramStudy, processTelegramOutbox } from './telegram'
import { enqueueTatAlerts } from './telegramAlerts'
import { processPhysicianTelegramOutbox } from './physicianTelegram'
import { tickTechnicalMonitor } from './technicalAlerts'

test('disabled Telegram channels never send, query the database or enqueue notifications', async t => {
  const flags = ['TELEGRAM_ENABLED', 'TELEGRAM_ALERT_ENABLED', 'TELEGRAM_URGENT_ENABLED', 'TELEGRAM_CALLBACK_ENABLED', 'TECH_ALERT_ENABLED']
  const previous = flags.map(key => process.env[key])
  flags.forEach(key => { process.env[key] = 'false' })
  t.after(() => flags.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i] }))
  let sends = 0
  t.mock.method(globalThis, 'fetch', async () => { sends++; throw new Error('No network permitted') })
  const db = new Proxy({}, { get() { throw new Error('Disabled channel must not touch the database') } }) as never
  const job = { id: 'synthetic-job', clientId: 'synthetic-center', serviceType: 'CT', priority: 'URGENT', demoMode: false }
  const env = { TELEGRAM_BOT_TOKEN: 'fake', TELEGRAM_CHAT_ID: '-1001', TELEGRAM_CLIENT_IDS: 'synthetic-center', TELEGRAM_PORTAL_URL: 'https://example.com', ...Object.fromEntries(flags.map(key => [key, 'false'])) }
  for (const config of [telegramConfig(env), telegramAlertConfig(env), telegramUrgentConfig(env), telegramCallbackConfig(env)]) {
    assert.equal(config.enabled, false)
    await assert.rejects(sendTelegram(config, 'Synthetic study', 'https://example.com'), (error: unknown) => error instanceof TelegramDeliveryError && error.code === 403)
    await enqueueTelegramStudy(db, job, 'CT', config)
    await processTelegramOutbox({ config, db })
  }
  await enqueueTatAlerts({ config: telegramAlertConfig(env), db })
  await processPhysicianTelegramOutbox()
  await tickTechnicalMonitor()
  assert.equal(sends, 0)
})

test('local environment explicitly disables every Telegram channel before dotenv overlays load', t => {
  if (!existsSync('.env')) { t.skip('Local .env is not distributed with the repository'); return }
  const env = parse(readFileSync('.env'))
  for (const key of ['TELEGRAM_ENABLED', 'TELEGRAM_ALERT_ENABLED', 'TELEGRAM_URGENT_ENABLED', 'TELEGRAM_CALLBACK_ENABLED', 'TECH_ALERT_ENABLED']) assert.equal(env[key], 'false', key)
})

test('Compose disables every Telegram channel for all deployed application roles', () => {
  const compose = readFileSync('compose.yaml', 'utf8')
  for (const key of ['TELEGRAM_ENABLED', 'TELEGRAM_ALERT_ENABLED', 'TELEGRAM_URGENT_ENABLED', 'TELEGRAM_CALLBACK_ENABLED', 'TECH_ALERT_ENABLED']) assert.match(compose, new RegExp(`^    ${key}: 'false'\\r?$`, 'm'))
})
