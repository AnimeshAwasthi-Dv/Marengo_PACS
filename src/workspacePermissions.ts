export function workspacePermissions(role: string, portalRole?: string | null, group = false) {
  const admin = role === 'SUPER_ADMIN';
  const client = role === 'CLIENT_USER';
  const operator = client && !group && ['IT_TEAM', 'TECHNICIAN'].includes(portalRole ?? 'IT_TEAM');
  const manager = client && (group || ['MANAGER', 'IT_TEAM'].includes(portalRole ?? 'IT_TEAM'));
  return {
    viewStudies: admin || client || role === 'RADIOLOGIST' || role.startsWith('PROVIDER_'),
    upload: operator,
    submit: admin || client,
    attach: admin || client,
    share: admin || client || role === 'RADIOLOGIST' || role.startsWith('PROVIDER_'),
    schedule: admin || client,
    manageUsers: admin || (client && (group || (portalRole ?? 'IT_TEAM') === 'IT_TEAM')),
    analytics: admin || manager,
    healthcheck: admin || (client && (group || portalRole === 'IT_TEAM')),
    billing: admin || (client && group),
  };
}

export function assignableCenterRoles(group = false) {
  return group ? ['FRONT_DESK', 'TECHNICIAN', 'MANAGER', 'IT_TEAM'] : ['FRONT_DESK', 'TECHNICIAN', 'MANAGER'];
}

export function clientWorkspaceTabs(portalRole?: string | null, group = false) {
  const permissions = workspacePermissions('CLIENT_USER', portalRole, group);
  return ['Available studies', 'Generated reports',
    ...(permissions.analytics ? ['Analytics'] : []),
    ...(permissions.manageUsers ? ['Users'] : []),
    ...(permissions.healthcheck ? ['Healthcheck'] : []),
    ...(permissions.billing ? ['Billing'] : []),
  ];
}
