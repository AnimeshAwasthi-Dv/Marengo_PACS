import dotenv from 'dotenv';
import { telegramUrgentConfig } from '../server/telegramPolicy';
dotenv.config({ path: ['.env', '.env.telegram.local'], quiet: true });
const config = telegramUrgentConfig();
console.log(JSON.stringify({ urgentEnabled: config.enabled, missing: config.missing, chatId: config.chatId,
  startupWorkersDisabled: process.env.DISABLE_STARTUP_WORKERS === 'true',
  databaseReadOnly: process.env.DATABASE_READ_ONLY === 'true' }));
if (config.token && config.chatId) {
  for (const method of ['getMe', 'getChat']) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${config.token}/${method}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(method === 'getChat' ? { chat_id: config.chatId } : {}), signal: AbortSignal.timeout(15000),
      });
      const body = await response.json() as { ok?: boolean; error_code?: number; result?: { username?: string } };
      console.log(JSON.stringify({ check: method, ok: body.ok === true, code: body.error_code ?? response.status,
        ...(method === 'getMe' && body.ok ? { bot: body.result?.username } : {}) }));
    } catch { console.log(JSON.stringify({ check: method, ok: false, reason: 'Network request failed' })); }
  }
}
// Read-only database connection; this script never sends messages or starts workers.
process.env.DATABASE_READ_ONLY = 'true';
const { prisma } = await import('../server/db');
try {
  const rows = await prisma.notificationOutbox.findMany({ where: { eventType: 'TELEGRAM_URGENT_STUDY' },
    orderBy: { createdAt: 'desc' }, take: 5,
    select: { status: true, attempts: true, createdAt: true, nextAttemptAt: true } });
  console.log(JSON.stringify({ recentUrgentNotifications: rows }));
} catch { console.log('Urgent queue could not be read.'); process.exitCode = 1; }
finally { await prisma.$disconnect(); }
