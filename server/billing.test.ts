import test from 'node:test'
import assert from 'node:assert/strict'
import { isNightTime } from './billing'

test('night billing applies from 9 PM IST through before 9 AM IST', () => {
  assert.equal(isNightTime(new Date('2026-07-24T15:29:00.000Z')), false)
  assert.equal(isNightTime(new Date('2026-07-24T15:30:00.000Z')), true)
  assert.equal(isNightTime(new Date('2026-07-25T03:29:00.000Z')), true)
  assert.equal(isNightTime(new Date('2026-07-25T03:30:00.000Z')), false)
})
