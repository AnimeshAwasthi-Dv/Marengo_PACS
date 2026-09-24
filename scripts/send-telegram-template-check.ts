import dotenv from 'dotenv';
import { telegramConfig, telegramAlertConfig, telegramMessage, telegramAlertMessage, sendTelegram } from '../server/telegramPolicy';
import { technicalAlertText, notedKeyboard } from '../server/technicalAlertPolicy';
import fs from 'node:fs/promises';
dotenv.config({ path: ['.env', '.env.telegram.local'], quiet: true });
const now = Date.now();
const fixture = { id: `TEST-NO-ACTION-${now}`, center: 'TEST ONLY — no real patient or study', modality: 'CT', priority: 'REGULAR', status: 'TEST ONLY — connectivity check', startedAt: new Date(now).toISOString(), targetSeconds: 3600, completedAt: null };
const receipt: unknown[] = [];
async function chat(token: string, chatId: string) {
  const response = await fetch(`https://api.telegram.org/bot${token}/getChat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId }), signal: AbortSignal.timeout(15000) });
  const body = await response.json();
  if (!body.ok || !['group', 'supergroup'].includes(body.result?.type)) throw new Error('Configured destination is not an accessible group');
  return body.result.title as string;
}
const entries = [{ kind: 'Study processing', config: telegramConfig(), message: telegramMessage }, { kind: 'Report TAT', config: telegramAlertConfig(), message: telegramAlertMessage }];
for (const entry of entries) {
  const title = await chat(entry.config.token, entry.config.chatId);
  const message = entry.message(fixture, entry.config.portalUrl);
  const messageId = await sendTelegram(entry.config, message.text, message.url);
  receipt.push({ template: entry.kind, title, messageId });
  console.log(JSON.stringify(receipt.at(-1)));
}
const token = process.env.TECH_ALERT_BOT_TOKEN!;
const chatId = process.env.TECH_ALERT_CHAT_ID!;
const title = await chat(token, chatId);
const text = technicalAlertText({ id: fixture.id, service: 'TEST ONLY — Telegram connectivity check', center: 'No real outage; no action required', detail: 'One-time template verification. No incident created and no reminders scheduled.', observedStatus: 'TEST — service health unchanged' });
const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text, reply_markup: notedKeyboard, protect_content: true, link_preview_options: { is_disabled: true } }), signal: AbortSignal.timeout(15000) });
const result = await response.json();
if (!result.ok) throw new Error(`Technical test delivery failed (${result.error_code})`);
receipt.push({ template: 'Technical alert', title, messageId: result.result.message_id });
console.log(JSON.stringify(receipt.at(-1)));
await fs.mkdir('artifacts', { recursive: true });
await fs.writeFile(`artifacts/telegram-template-check-${now}.json`, JSON.stringify({ sentAt: new Date().toISOString(), receipt }, null, 2));
