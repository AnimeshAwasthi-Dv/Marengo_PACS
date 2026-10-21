import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseClientTariff, priceReportedStudy, descriptionViews, resolveClientTariff } from './clientTariff'
const tariff = parseClientTariff(JSON.parse(readFileSync(new URL('../data/marengo-tariff.json', import.meta.url), 'utf8')))
const quote = (description: string, reportStatus = 'APPROVED', modalities = ['DX'], serviceName = 'X-Ray Chest', imageCount: number | null = 1) => priceReportedStudy(tariff, { description, reportStatus, modalities, serviceName, imageCount })

test('CSV uses 30 exact rate entries and rejects malformed/duplicate configuration', () => {
  assert.equal(tariff.rows.length, 30)
  assert.throws(() => parseClientTariff({ ...tariff, rows: [...tariff.rows, tariff.rows[0]] }))
  assert.throws(() => parseClientTariff({ ...tariff, reportedOnly: false }))
})
test('X-ray first view and incremental view calculations ignore legacy service prices', () => {
  assert.equal(quote('X-ray Chest PA').amountMinor, 2500)
  assert.equal(quote('Knee AP & Lateral', 'PUSHED', ['DX'], 'X-Ray Chest', 2).amountMinor, 4500)
  assert.equal(quote('Knee', 'APPROVED', ['DX'], 'X-Ray Chest', 3).amountMinor, 6500)
  assert.equal(quote('Knee', 'APPROVED', ['DX'], 'X-Ray Chest', 4).amountMinor, 8500)
  assert.equal(quote('Knee AP', 'APPROVED', ['DX'], 'X-Ray Other - per additional view').amountMinor, 2500)
})
test('only final reports are billable; failed and pending rows are held', () => {
  for (const status of ['PENDING', 'FAILED', 'CANCELLED', '', 'DRAFT']) {
    assert.equal(quote('Chest PA', status).status, 'PENDING_REPORT')
    assert.equal(quote('Chest PA', status).amountMinor, 0)
  }
})
test('user-confirmed image count prices portable and unnamed studies; invalid counts stay held', () => {
  for (const d of ['Chest', '', 'AP+C8', 'Both knees AP', '1 view and 2 views']) assert.equal(descriptionViews(d), null)
  assert.equal(quote('X-Ray Chest - PORTABLE').amountMinor, 2500)
  assert.equal(quote('').amountMinor, 2500)
  assert.equal(quote('1 view', 'APPROVED', ['DX'], 'X-Ray Chest', 3).amountMinor, 6500)
  for (const count of [null, 0, -1, 1.5, NaN]) assert.equal(quote('Chest PA', 'APPROVED', ['DX'], 'X-Ray Chest', count).status, 'PRICING_REVIEW')
})
test('mammography charges by explicit side and special X-rays by study', () => {
  assert.equal(quote('Bilateral Mammogram').amountMinor, 11000)
  assert.equal(quote('Left Mammogram').amountMinor, 5500)
  assert.equal(quote('Mammogram').status, 'PRICING_REVIEW')
  assert.equal(quote('X RAY SCANOGRAM').amountMinor, 15000)
})
test('dedicated MRI rate wins; unknown modalities and add-ons never use broad fallback', () => {
  assert.equal(quote('MRI Foot with Ankle', 'APPROVED', ['MR']).amountMinor, 60000)
  assert.equal(quote('CT Brain', 'APPROVED', ['CT']).amountMinor, 22500)
  assert.equal(quote('CT Brain with contrast', 'APPROVED', ['CT']).status, 'PRICING_REVIEW')
  assert.equal(quote('MRI Epilepsy Protocol', 'APPROVED', ['MR']).status, 'PRICING_REVIEW')
  assert.equal(quote('Abdomen', 'APPROVED', ['US']).status, 'PRICING_REVIEW')
})
test('clients with no override retain their existing billing logic', async () => {
  const db = { systemSetting: { findUnique: async () => null } }
  assert.equal(await resolveClientTariff(db as never, { clientId: 'another-hospital', serviceName: 'X-Ray Chest' }), null)
})
