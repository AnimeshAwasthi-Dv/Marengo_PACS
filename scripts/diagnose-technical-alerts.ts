import { prisma } from '../server/db';
import fs from 'node:fs';
import dotenv from 'dotenv';

try {
  const state = await prisma.$queryRaw<Array<{ lastCheckAt: Date | null; lastTickAt: Date | null; lastError: string | null }>>`SELECT "lastCheckAt", "lastTickAt", "lastError" FROM technical_monitor_state`;
  const counts = await prisma.$queryRaw`SELECT service, status, count(*)::integer AS count, sum("reminderCount")::integer AS deliveries FROM technical_incidents GROUP BY service, status`;
  const heartbeat = state[0]?.lastTickAt;
  const stale = !heartbeat || Date.now() - heartbeat.getTime() > 120_000;
  const files = ['.env', '.env.telegram.local'].map(file => {
    const values = fs.existsSync(file) ? dotenv.parse(fs.readFileSync(file)) : {};
    return { file, technicalKeys: Object.keys(values).filter(key => key.startsWith('TECH_ALERT_')) };
  });
  console.log(JSON.stringify({ state, stale, counts, files, config: { enabled: process.env.TECH_ALERT_ENABLED, readOnly: process.env.DATABASE_READ_ONLY, tokenConfigured: Boolean(process.env.TECH_ALERT_BOT_TOKEN), chatConfigured: Boolean(process.env.TECH_ALERT_CHAT_ID) } }));
  const token = process.env.TECH_ALERT_BOT_TOKEN;
  const chatId = process.env.TECH_ALERT_CHAT_ID;
  if (token && chatId) {
    for (const method of ['getChat', 'getWebhookInfo']) {
      try {
        const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(method === 'getChat' ? { chat_id: chatId } : {}), signal: AbortSignal.timeout(10000) });
        const body = await response.json();
        console.log(JSON.stringify({ method, ok: body.ok, code: body.error_code, title: body.result?.title, type: body.result?.type, webhookConfigured: Boolean(body.result?.url) }));
      } catch { console.log(JSON.stringify({ method, error: 'Telegram connection failed' })); }
    }
  }
} finally { await prisma.$disconnect(); }
