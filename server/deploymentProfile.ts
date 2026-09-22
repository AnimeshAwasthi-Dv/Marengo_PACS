export type DeploymentFeatures = {
  profile: 'default' | 'marengo'
  marengoMinimal: boolean
  billing: boolean
  calling: boolean
  notifications: boolean
  support: boolean
  whatsapp: boolean
  renewistPdfConversion: boolean
  dashboardPollMs: number
  availableStudiesPollMs: number
}

function envBoolean(name: string, fallback: boolean) {
  const value = process.env[name]?.trim().toLowerCase()
  if (!value) return fallback
  if (['1', 'true', 'yes', 'on'].includes(value)) return true
  if (['0', 'false', 'no', 'off'].includes(value)) return false
  return fallback
}

function envInterval(name: string, fallback: number) {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

export function getDeploymentFeatures(): DeploymentFeatures {
  const marengoMinimal = process.env.DEPLOYMENT_PROFILE?.trim().toLowerCase() === 'marengo'
  return {
    profile: marengoMinimal ? 'marengo' : 'default',
    marengoMinimal,
    billing: envBoolean('FEATURE_BILLING_ENABLED', !marengoMinimal),
    calling: envBoolean('FEATURE_CALLING_ENABLED', !marengoMinimal),
    notifications: envBoolean('FEATURE_NOTIFICATIONS_ENABLED', !marengoMinimal),
    support: envBoolean('FEATURE_SUPPORT_ENABLED', !marengoMinimal),
    whatsapp: envBoolean('FEATURE_WHATSAPP_ENABLED', !marengoMinimal),
    renewistPdfConversion: envBoolean('FEATURE_RENEWIST_PDF_CONVERSION_ENABLED', !marengoMinimal),
    dashboardPollMs: envInterval('PORTAL_DASHBOARD_POLL_MS', marengoMinimal ? 0 : 30_000),
    availableStudiesPollMs: envInterval('AVAILABLE_STUDIES_POLL_MS', marengoMinimal ? 30_000 : 5_000),
  }
}

export function publicDeploymentFeatures() {
  const features = getDeploymentFeatures()
  return {
    profile: features.profile,
    marengoMinimal: features.marengoMinimal,
    billing: features.billing,
    calling: features.calling,
    notifications: features.notifications,
    support: features.support,
    dashboardPollMs: features.dashboardPollMs,
    availableStudiesPollMs: features.availableStudiesPollMs,
  }
}
