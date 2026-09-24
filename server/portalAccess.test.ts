import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getPortalNavigation,
  getPortalTabs,
  filterClientPortalTabs,
  filterNavigationByTabs,
  resolvePortalWorkspace,
  type PortalNavigationGroup,
  type PortalWorkspace,
} from '../src/portalAccess'

const expectedNavigation: Record<Exclude<PortalWorkspace, 'CENTER'>, PortalNavigationGroup[]> = {
  SUPER_ADMIN: [
    { label: 'Command', items: ['Dashboard'] },
    { label: 'Access Management', items: ['Group Admins', 'Radiologists'] },
    { label: 'Operations', items: ['Centers', 'Patients', 'Follow-ups', 'Studies', 'Processing', 'Reports', 'Processing Notifications', 'Queries', 'Demo Requests', 'Call Requests', 'AI Report Feedback'] },
    { label: 'Platform', items: ['WhatsApp Configuration', 'Technical Alerts'] },
    { label: 'Intelligence', items: ['Analytics', 'Billing'] },
    { label: 'Governance', items: ['Notification History', 'Support', 'WhatsApp Whitelist', 'Audit Logs'] },
  ],
  RENEWIST: [
    { label: 'Renewist Operations', items: ['Dashboard', 'Pushed Studies', 'Reports', 'Processing Notifications', 'Call Requests', 'AI Report Feedback', 'Analytics'] },
    { label: 'Governance', items: ['Notification History', 'Activity', 'Support', 'WhatsApp Whitelist', 'Settings'] },
  ],
  MARENGO_GROUP: [
    { label: 'Marengo Network', items: ['Dashboard', 'Centers'] },
    { label: 'Clinical Operations', items: ['Available studies', 'Processing', 'Generated reports'] },
    { label: 'Management', items: ['Analytics', 'Reporting Statistics', 'Center Analytics', 'Radiologists', 'Profile'] },
    { label: 'Governance', items: ['Notifications', 'Support', 'Settings'] },
  ],
  RADIOLOGIST: [
    { label: 'Clinical Workspace', items: ['Studies', 'Generated Reports', 'AI Report Feedback', 'Call Requests'] },
    { label: 'Account', items: ['Notifications', 'Profile'] },
  ],
}

test('each privileged workspace exposes its exact role-specific navigation', () => {
  for (const [workspace, expected] of Object.entries(expectedNavigation)) {
    assert.deepEqual(getPortalNavigation(workspace as Exclude<PortalWorkspace, 'CENTER'>), expected)
    assert.deepEqual(
      getPortalTabs(workspace as Exclude<PortalWorkspace, 'CENTER'>),
      expected.flatMap((group) => group.items),
    )
    assert.deepEqual(
      filterClientPortalTabs(getPortalTabs(workspace as Exclude<PortalWorkspace, 'CENTER'>), 'FRONT_DESK', workspace as Exclude<PortalWorkspace, 'CENTER'>),
      expected.flatMap((group) => group.items),
    )
  }
})

test('center portal roles expose only the requested tabs', () => {
  const tabs = getPortalTabs('CENTER')

  assert.deepEqual(filterClientPortalTabs(tabs, 'FRONT_DESK', 'CENTER'), ['Dashboard', 'Report', 'Available studies', 'Generated reports', 'Support', 'Profile', 'Notifications'])
  assert.deepEqual(filterClientPortalTabs(tabs, 'TECHNICIAN', 'CENTER'), ['Dashboard', 'Available studies', 'Processing', 'Generated reports', 'Support', 'Profile', 'Notifications'])
  assert.deepEqual(filterClientPortalTabs(tabs, 'MANAGER', 'CENTER'), ['Dashboard', 'Available studies', 'Processing', 'Generated reports', 'Analytics', 'Support', 'Profile', 'Notifications'])
  assert.deepEqual(filterClientPortalTabs(tabs, 'IT_TEAM', 'CENTER'), ['Dashboard', 'Report', 'Available studies', 'Processing', 'Generated reports', 'Analytics', 'Users', 'Support', 'Profile', 'Notifications'])
})

test('sidebar navigation groups render only tabs available to the portal role', () => {
  const centerNavigation = getPortalNavigation('CENTER')
  const frontDeskTabs = filterClientPortalTabs(getPortalTabs('CENTER'), 'FRONT_DESK', 'CENTER')
  const technicianTabs = filterClientPortalTabs(getPortalTabs('CENTER'), 'TECHNICIAN', 'CENTER')

  assert.deepEqual(filterNavigationByTabs(centerNavigation, frontDeskTabs), [
    { label: 'Worklist', items: ['Dashboard', 'Report', 'Available studies', 'Generated reports'] },
    { label: 'Account', items: ['Support', 'Profile', 'Notifications'] },
  ])
  assert.deepEqual(filterNavigationByTabs(centerNavigation, technicianTabs), [
    { label: 'Worklist', items: ['Dashboard', 'Available studies', 'Processing', 'Generated reports'] },
    { label: 'Account', items: ['Support', 'Profile', 'Notifications'] },
  ])
})

test('roles and the Marengo group account resolve to their intended workspaces', () => {
  assert.equal(resolvePortalWorkspace('SUPER_ADMIN'), 'SUPER_ADMIN')
  assert.equal(resolvePortalWorkspace('PROVIDER_ADMIN'), 'RENEWIST')
  assert.equal(resolvePortalWorkspace('PROVIDER_MANAGER'), 'RENEWIST')
  assert.equal(resolvePortalWorkspace('RADIOLOGIST'), 'RADIOLOGIST')
  assert.equal(resolvePortalWorkspace('CLIENT_USER', 'MARENGO'), 'MARENGO_GROUP')
  assert.equal(resolvePortalWorkspace('CLIENT_USER', 'MARENGO_AHMEDABAD'), 'CENTER')
  assert.equal(resolvePortalWorkspace('CLIENT_USER', null), 'CENTER')
})

test('Marengo group navigation is never replaced by center study-sync navigation', () => {
  assert.deepEqual(getPortalNavigation('MARENGO_GROUP', true), expectedNavigation.MARENGO_GROUP)
  assert.equal(getPortalTabs('MARENGO_GROUP', true).includes('Available studies'), true)
  assert.equal(getPortalTabs('MARENGO_GROUP', true).includes('Processing'), true)
})

test('Renewist navigation includes notification and call operations while excluding unrelated administration', () => {
  const tabs = getPortalTabs('RENEWIST')

  assert.deepEqual(tabs, expectedNavigation.RENEWIST.flatMap((group) => group.items))
  assert.equal(tabs.includes('Centers'), false)
  assert.equal(tabs.includes('Billing'), false)
  assert.equal(tabs.includes('Radiologists'), false)
})

test('radiologist navigation includes authorized feedback, calls, and notifications', () => {
  const tabs = getPortalTabs('RADIOLOGIST')

  assert.deepEqual(tabs, expectedNavigation.RADIOLOGIST.flatMap((group) => group.items))
  assert.equal(tabs.includes('Processing'), false)
  assert.equal(tabs.includes('Centers'), false)
  assert.equal(tabs.includes('Radiologists'), false)
})

test('center navigation includes its operational dashboard with study sync disabled or enabled', () => {
  assert.deepEqual(getPortalNavigation('CENTER', false), [
    { label: 'Worklist', items: ['Dashboard', 'Report', 'Available studies', 'Processing', 'Generated reports', 'Analytics', 'Users'] },
    { label: 'Account', items: ['Support', 'Profile', 'Notifications'] },
  ])
  assert.deepEqual(getPortalNavigation('CENTER', true), [
    { label: 'Worklist', items: ['Dashboard', 'Report', 'Available studies', 'Processing', 'Generated reports', 'Analytics', 'Users'] },
    { label: 'Account', items: ['Support', 'Profile', 'Notifications'] },
  ])
})
