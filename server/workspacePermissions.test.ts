import assert from 'node:assert/strict';
import test from 'node:test';
import { workspacePermissions, clientWorkspaceTabs, assignableCenterRoles } from '../src/workspacePermissions';

test('front office and managers can submit studies and handle all report features without administering users', () => {
  for (const role of ['FRONT_DESK', 'MANAGER']) {
    const permissions = workspacePermissions('CLIENT_USER', role);
    assert(permissions.viewStudies && permissions.share && permissions.schedule && permissions.attach);
    assert(permissions.submit && !permissions.upload && !permissions.manageUsers);
  }
});

test('the complete center role matrix gates navigation and sensitive features', () => {
  for (const [role, analytics, users, health] of [
    ['TECHNICIAN', false, false, false], ['FRONT_DESK', false, false, false],
    ['MANAGER', true, false, false], ['IT_TEAM', true, true, true],
  ] as const) {
    const permissions = workspacePermissions('CLIENT_USER', role);
    assert.equal(permissions.analytics, analytics);
    assert.equal(permissions.manageUsers, users);
    assert.equal(permissions.healthcheck, health);
    assert.equal(permissions.billing, false);
    const tabs = clientWorkspaceTabs(role);
    assert.equal(tabs.includes('Analytics'), analytics);
    assert.equal(tabs.includes('Users'), users);
    assert.equal(tabs.includes('Healthcheck'), health);
    assert(!tabs.includes('Processing') && !tabs.includes('Profile') && !tabs.includes('Billing'));
  }
  const group = workspacePermissions('CLIENT_USER', 'IT_TEAM', true);
  assert(group.analytics && group.healthcheck && group.billing && group.manageUsers);
  assert(clientWorkspaceTabs('IT_TEAM', true).includes('Billing'));
  assert.deepEqual(assignableCenterRoles(), ['FRONT_DESK', 'TECHNICIAN', 'MANAGER']);
  assert(assignableCenterRoles(true).includes('IT_TEAM'));
});
test('technicians have clinical intake actions but no user management', () => {
  const permissions = workspacePermissions('CLIENT_USER', 'TECHNICIAN');
  assert(permissions.upload && permissions.submit && permissions.attach && permissions.share && permissions.schedule);
  assert(!permissions.manageUsers);
});
test('IT, group and super administrators have explicitly scoped management actions', () => {
  assert(workspacePermissions('CLIENT_USER', 'IT_TEAM').manageUsers);
  assert(workspacePermissions('CLIENT_USER', 'IT_TEAM', true).submit);
  assert(!workspacePermissions('CLIENT_USER', 'IT_TEAM', true).upload);
  const admin = workspacePermissions('SUPER_ADMIN');
  assert(admin.submit && admin.attach && admin.share && admin.schedule && admin.manageUsers);
});
test('specialist roles cannot use center intake or booking actions', () => {
  for (const role of ['RADIOLOGIST', 'PROVIDER_ADMIN', 'PROVIDER_MANAGER']) {
    const permissions = workspacePermissions(role);
    assert(permissions.share && permissions.viewStudies);
    assert(!permissions.attach && !permissions.submit && !permissions.upload && !permissions.schedule && !permissions.manageUsers);
  }
  assert(Object.values(workspacePermissions('UNKNOWN')).every((value) => !value));
});
