import assert from 'node:assert/strict'
import test from 'node:test'
import { getDeploymentFeatures } from './deploymentProfile'

const managedEnvironmentVariables = [
  'DEPLOYMENT_PROFILE',
  'FEATURE_BILLING_ENABLED',
  'FEATURE_CALLING_ENABLED',
  'FEATURE_NOTIFICATIONS_ENABLED',
  'FEATURE_SUPPORT_ENABLED',
  'FEATURE_WHATSAPP_ENABLED',
  'FEATURE_RENEWIST_PDF_CONVERSION_ENABLED',
  'PORTAL_DASHBOARD_POLL_MS',
  'AVAILABLE_STUDIES_POLL_MS',
] as const

function withEnvironment(values: Partial<Record<(typeof managedEnvironmentVariables)[number], string>>, run: () => void) {
  const previous = Object.fromEntries(managedEnvironmentVariables.map((name) => [name, process.env[name]]))
  for (const name of managedEnvironmentVariables) delete process.env[name]
  Object.assign(process.env, values)
  try {
    run()
  } finally {
    for (const name of managedEnvironmentVariables) {
      const value = previous[name]
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

test('Marengo profile disables unrelated compute by default', () => {
  withEnvironment({ DEPLOYMENT_PROFILE: 'marengo' }, () => {
    assert.deepEqual(getDeploymentFeatures(), {
      profile: 'marengo',
      marengoMinimal: true,
      billing: false,
      calling: false,
      notifications: false,
      support: false,
      whatsapp: false,
      renewistPdfConversion: false,
      dashboardPollMs: 0,
      availableStudiesPollMs: 30_000,
    })
  })
})

test('default profile preserves existing behavior and explicit overrides win', () => {
  withEnvironment({ FEATURE_BILLING_ENABLED: 'false', AVAILABLE_STUDIES_POLL_MS: '12000' }, () => {
    const features = getDeploymentFeatures()
    assert.equal(features.profile, 'default')
    assert.equal(features.billing, false)
    assert.equal(features.calling, true)
    assert.equal(features.notifications, true)
    assert.equal(features.support, true)
    assert.equal(features.whatsapp, true)
    assert.equal(features.renewistPdfConversion, true)
    assert.equal(features.dashboardPollMs, 30_000)
    assert.equal(features.availableStudiesPollMs, 12_000)
  })
})
