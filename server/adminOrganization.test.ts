import assert from 'node:assert/strict'
import test from 'node:test'
import {
  accountStatusSchema,
  adminRadiologistCreateSchema,
  groupAdminCreateSchema,
  managedRadiologistScope,
} from './adminOrganizationContracts'

test('group-admin input normalizes email addresses and rejects unknown fields only by omission', () => {
  const parsed = groupAdminCreateSchema.parse({ name: '  Marengo Admin  ', email: '  ADMIN@MARENGO.LOCAL ' })
  assert.deepEqual(parsed, { name: 'Marengo Admin', email: 'admin@marengo.local' })
})

test('radiologist creation permits only the two super-admin management scopes', () => {
  const base = {
    fullName: 'Network Radiologist',
    email: 'radiologist@marengo.local',
    qualification: 'MD Radiodiagnosis',
    medicalRegistrationNumber: 'RAD-001',
  }
  assert.equal(adminRadiologistCreateSchema.parse({ ...base, scope: 'MARENGO_GROUP' }).scope, 'MARENGO_GROUP')
  assert.equal(adminRadiologistCreateSchema.parse({ ...base, scope: 'RENEWIST' }).scope, 'RENEWIST')
  assert.equal(adminRadiologistCreateSchema.safeParse({ ...base, scope: 'CENTER' }).success, false)
})

test('managed radiologist scope excludes center and unrelated-provider profiles', () => {
  assert.equal(managedRadiologistScope({ clientId: 'group-1', providerCode: null }, 'group-1'), 'MARENGO_GROUP')
  assert.equal(managedRadiologistScope({ clientId: null, providerCode: 'RENEWIST' }, 'group-1'), 'RENEWIST')
  assert.equal(managedRadiologistScope({ clientId: 'center-1', providerCode: null }, 'group-1'), null)
  assert.equal(managedRadiologistScope({ clientId: null, providerCode: 'OTHER' }, 'group-1'), null)
})

test('account status changes require an explicit boolean', () => {
  assert.deepEqual(accountStatusSchema.parse({ active: false }), { active: false })
  assert.equal(accountStatusSchema.safeParse({ active: 'false' }).success, false)
})
