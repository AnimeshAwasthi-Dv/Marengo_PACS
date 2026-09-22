import assert from 'node:assert/strict'
import test from 'node:test'
import { isWhitelistRecipientEligible, maskPatientReference } from './notificationService'
import { normalizeWhatsappPhone } from './whatsapp'

test('patient references are masked before notification persistence', () => {
  assert.equal(maskPatientReference('PATIENT-123456'), '********3456')
  assert.equal(maskPatientReference('1234'), '1234')
  assert.equal(maskPatientReference(null), null)
})

test('WhatsApp eligibility requires verified opt-in and matching category', () => {
  const recipient = { active: true, verificationStatus: 'VERIFIED', consentStatus: 'OPTED_IN', phoneE164: '+917380650077', notificationCategories: ['STUDY_STATUS'] }
  assert.equal(isWhitelistRecipientEligible(recipient, 'STUDY_STATUS'), true)
  assert.equal(isWhitelistRecipientEligible({ ...recipient, verificationStatus: 'PENDING' }, 'STUDY_STATUS'), false)
  assert.equal(isWhitelistRecipientEligible({ ...recipient, active: false }, 'STUDY_STATUS'), false)
  assert.equal(isWhitelistRecipientEligible(recipient, 'BILLING'), false)
  assert.equal(isWhitelistRecipientEligible({ ...recipient, notificationCategories: ['ALL'] }, 'BILLING'), true)
})

test('Indian mobile numbers are normalized for WhatsApp Cloud API', () => {
  assert.equal(normalizeWhatsappPhone('9919899933'), '+919919899933')
  assert.equal(normalizeWhatsappPhone('+91 99198 99933'), '+919919899933')
  assert.equal(normalizeWhatsappPhone('447700900123'), '+447700900123')
})
