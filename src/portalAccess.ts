export type PortalRole = 'SUPER_ADMIN' | 'CLIENT_USER' | 'RADIOLOGIST' | 'PROVIDER_ADMIN' | 'PROVIDER_MANAGER'
export type ClientPortalRole = 'FRONT_DESK' | 'TECHNICIAN' | 'MANAGER' | 'IT_TEAM'

export type PortalWorkspace = 'SUPER_ADMIN' | 'RENEWIST' | 'MARENGO_GROUP' | 'RADIOLOGIST' | 'CENTER'

export type PortalNavigationGroup = {
  label: string
  items: string[]
}

const superAdminNavigation: PortalNavigationGroup[] = [
  { label: 'Command', items: ['Dashboard'] },
  { label: 'Access Management', items: ['Group Admins', 'Radiologists'] },
  { label: 'Operations', items: ['Centers', 'Patients', 'Follow-ups', 'Studies', 'Processing', 'Reports', 'Processing Notifications', 'Queries', 'Demo Requests', 'Call Requests', 'AI Report Feedback'] },
  { label: 'Platform', items: ['WhatsApp Configuration', 'Technical Alerts'] },
  { label: 'Intelligence', items: ['Analytics', 'Billing'] },
  { label: 'Governance', items: ['Notification History', 'Support', 'WhatsApp Whitelist', 'Audit Logs'] },
]

const renewistNavigation: PortalNavigationGroup[] = [
  { label: 'Renewist Operations', items: ['Dashboard', 'Pushed Studies', 'Reports', 'Processing Notifications', 'Call Requests', 'AI Report Feedback', 'Analytics'] },
  { label: 'Governance', items: ['Notification History', 'Activity', 'Support', 'WhatsApp Whitelist', 'Settings'] },
]

const marengoGroupNavigation: PortalNavigationGroup[] = [
  { label: 'Marengo Network', items: ['Dashboard', 'Centers'] },
  { label: 'Clinical Operations', items: ['Available studies', 'Processing', 'Generated reports'] },
  { label: 'Management', items: ['Analytics', 'Reporting Statistics', 'Center Analytics', 'Radiologists', 'Profile'] },
  { label: 'Governance', items: ['Notifications', 'Support', 'Settings'] },
]

const radiologistNavigation: PortalNavigationGroup[] = [
  { label: 'Clinical Workspace', items: ['Studies', 'Generated Reports', 'AI Report Feedback', 'Call Requests'] },
  { label: 'Account', items: ['Notifications', 'Profile'] },
]

export function resolvePortalWorkspace(role: PortalRole, clientCode?: string | null, clientKind?: 'GROUP' | 'CENTER' | null): PortalWorkspace {
  if (role === 'SUPER_ADMIN') return 'SUPER_ADMIN'
  if (role === 'PROVIDER_ADMIN' || role === 'PROVIDER_MANAGER') return 'RENEWIST'
  if (role === 'RADIOLOGIST') return 'RADIOLOGIST'
  if (clientKind === 'GROUP' || clientCode === 'MARENGO') return 'MARENGO_GROUP'
  return 'CENTER'
}

export function getPortalNavigation(workspace: PortalWorkspace, _studySyncEnabled = false): PortalNavigationGroup[] {
  if (workspace === 'SUPER_ADMIN') return superAdminNavigation
  if (workspace === 'RENEWIST') return renewistNavigation
  if (workspace === 'MARENGO_GROUP') return marengoGroupNavigation
  if (workspace === 'RADIOLOGIST') return radiologistNavigation
  const worklist = ['Dashboard', 'Report', 'Available studies', 'Processing', 'Generated reports', 'Analytics', 'Users']
  return [
    { label: 'Worklist', items: worklist },
    { label: 'Account', items: ['Support', 'Profile', 'Notifications'] },
  ]
}

export function getPortalTabs(workspace: PortalWorkspace, studySyncEnabled = false) {
  return getPortalNavigation(workspace, studySyncEnabled).flatMap((group) => group.items)
}

export function filterClientPortalTabs(tabs: string[], portalRole?: ClientPortalRole | null, workspace?: PortalWorkspace) {
  if (workspace !== 'CENTER') return tabs
  const role = portalRole ?? 'IT_TEAM'
  const allowed: Record<ClientPortalRole, Set<string>> = {
    FRONT_DESK: new Set(['Dashboard', 'Report', 'Available studies', 'Generated reports', 'Support', 'Profile', 'Notifications']),
    TECHNICIAN: new Set(['Dashboard', 'Available studies', 'Processing', 'Generated reports', 'Support', 'Profile', 'Notifications']),
    MANAGER: new Set(['Dashboard', 'Available studies', 'Generated reports', 'Processing', 'Analytics', 'Support', 'Profile', 'Notifications']),
    IT_TEAM: new Set(['Dashboard', 'Report', 'Available studies', 'Generated reports', 'Processing', 'Analytics', 'Users', 'Support', 'Profile', 'Notifications']),
  }
  return tabs.filter((tab) => allowed[role].has(tab))
}

export function filterNavigationByTabs(groups: PortalNavigationGroup[], tabs: string[]) {
  const allowed = new Set(tabs)
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => allowed.has(item)) }))
    .filter((group) => group.items.length)
}

export function getWorkspaceDescription(workspace: PortalWorkspace) {
  if (workspace === 'SUPER_ADMIN') return 'Complete control across Marengo centers, Renewist operations, studies, reporting, billing, and governance'
  if (workspace === 'RENEWIST') return 'Monitor every study routed to Renewist and download its complete clinical package'
  if (workspace === 'MARENGO_GROUP') return 'Network-wide oversight of center uploads, processing, generated reports, and monthly performance'
  if (workspace === 'RADIOLOGIST') return 'Read-only access to Marengo studies and generated reports'
  return 'Center workspace for studies, reports, support, and service activity'
}
