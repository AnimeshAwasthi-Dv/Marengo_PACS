import { prisma } from '../server/db';
import jwt from 'jsonwebtoken';
const state = await prisma.$queryRaw`SELECT "lastCheckAt", "lastTickAt", "lastError" FROM technical_monitor_state`;
const incidents = await prisma.$queryRaw`SELECT service,status,"reminderCount","acknowledgedBy" FROM technical_incidents ORDER BY "openedAt"`;
console.log(JSON.stringify({ state, incidents }));
const users = await Promise.all(['SUPER_ADMIN', 'CLIENT_USER'].map(role => prisma.user.findFirst({ where: { role: role as 'SUPER_ADMIN' | 'CLIENT_USER', active: true }, select: { id: true, role: true, clientId: true, providerCode: true } })));
for (const user of users) if (user && process.env.JWT_SECRET) {
  const token = jwt.sign({ sub: user.id, role: user.role, clientId: user.clientId, providerCode: user.providerCode }, process.env.JWT_SECRET, { expiresIn: '1m' });
  const response = await fetch('http://127.0.0.1:4000/api/technical-alerts', { headers: { Authorization: `Bearer ${token}` } });
  console.log(`${user.role} technical alert API: ${response.status}`);
  if (user.role === 'SUPER_ADMIN' && process.argv.includes('--check-now')) {
    const check = await fetch('http://127.0.0.1:4000/api/technical-alerts/check-now', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    console.log(`Requested current health check: ${check.status}`);
  }
}
await prisma.$disconnect();
