import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request, Response } from 'express';
import { requireWorkspaceCapability, workspaceAccess, type WorkspaceCapability } from './workspaceAccess';

test('API middleware independently enforces every role and derives scope from the database', async () => {
  const clients = {
    findUnique: async ({ where }: { where: { id: string } }) => ({ id: where.id, kind: where.id === 'group' ? 'GROUP' : 'CENTER' }),
    findMany: async ({ where }: { where: { parentClientId: string } }) => { assert.equal(where.parentClientId, 'group'); return [{ id: 'child-a' }, { id: 'child-b' }]; },
  } as unknown as Parameters<typeof workspaceAccess>[1];
  const resolveAccess = (req: Request) => workspaceAccess(req, clients);
  for (const [role, portalRole, clientId, allowed] of [
    ['CLIENT_USER', 'TECHNICIAN', 'own-center', []],
    ['CLIENT_USER', 'FRONT_DESK', 'own-center', []],
    ['CLIENT_USER', 'MANAGER', 'own-center', ['analytics']],
    ['CLIENT_USER', 'IT_TEAM', 'own-center', ['analytics', 'manageUsers', 'healthcheck']],
    ['CLIENT_USER', 'IT_TEAM', 'group', ['analytics', 'manageUsers', 'healthcheck', 'billing']],
    ['SUPER_ADMIN', null, undefined, ['analytics', 'manageUsers', 'healthcheck', 'billing']],
    ['RADIOLOGIST', null, undefined, []],
  ] as const) {
    const req = { user: { role, portalRole, clientId } } as Request;
    const access = await resolveAccess(req);
    assert.deepEqual(access.clientIds, role === 'SUPER_ADMIN' ? null : role === 'RADIOLOGIST' ? [] : clientId === 'group' ? ['group', 'child-a', 'child-b'] : ['own-center']);
    for (const capability of ['analytics', 'manageUsers', 'healthcheck', 'billing'] as WorkspaceCapability[]) {
      let status = 200; let called = false;
      const res = { locals: {}, status(code: number) { status = code; return this; }, json() { return this; } } as unknown as Response;
      await requireWorkspaceCapability(capability, resolveAccess)(req, res, () => { called = true; });
      const permitted = (allowed as readonly string[]).includes(capability);
      assert.equal(called, permitted, `${role}/${portalRole}/${clientId}: ${capability}`);
      assert.equal(status, permitted ? 200 : 403);
    }
  }
});
