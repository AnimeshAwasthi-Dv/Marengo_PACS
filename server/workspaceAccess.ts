import type { Request, Response, NextFunction } from 'express';
import { prisma } from './db';
import { workspacePermissions } from '../src/workspacePermissions';

export type WorkspaceCapability = 'analytics' | 'healthcheck' | 'billing' | 'manageUsers';

export async function workspaceAccess(req: Request, clients: Pick<typeof prisma.client, 'findUnique' | 'findMany'> = prisma.client) {
  const user = req.user!;
  const client = user.clientId ? await clients.findUnique({ where: { id: user.clientId }, select: { id: true, kind: true } }) : null;
  const group = client?.kind === 'GROUP';
  const clientIds = user.role === 'SUPER_ADMIN' ? null : user.role !== 'CLIENT_USER' || !client ? [] : group
    ? [client.id, ...(await clients.findMany({ where: { parentClientId: client.id, kind: 'CENTER' }, select: { id: true } })).map(c => c.id)]
    : [client.id];
  return { clientIds, group, permissions: workspacePermissions(user.role, user.portalRole, group) };
}

export function requireWorkspaceCapability(capability: WorkspaceCapability, resolveAccess = workspaceAccess) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const access = await resolveAccess(req);
      if (!access.permissions[capability]) return res.status(403).json({ message: 'Your role does not have access to this section.' });
      res.locals.workspaceAccess = access;
      next();
    } catch (error) { next(error); }
  };
}
