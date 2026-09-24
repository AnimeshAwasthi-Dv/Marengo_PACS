import assert from 'node:assert/strict';
import test from 'node:test';
import { acknowledgmentReply, excludedTechnicalEndpoints, HEALTH_INTERVAL_MS, REMINDER_INTERVAL_MS, technicalAlertExcluded, technicalAlertText, technicalFailure, type TelegramUpdate } from './technicalAlertPolicy';
const update: TelegramUpdate = { update_id: 1, message: { message_id: 8, date: 1, text: 'Noted', chat: { id: -100123, type: 'supergroup' }, from: { id: 12, first_name: 'Operator' }, reply_to_message: { message_id: 7 } } };
test('technical alerts exclude exactly the requested 19 PACS endpoints and WhatsApp', () => {
  assert.equal(excludedTechnicalEndpoints.size, 19);
  for (const id of excludedTechnicalEndpoints) assert(technicalAlertExcluded({ id, service: 'PACS' }));
  assert(technicalAlertExcluded({ id: 'notifications', service: 'Notification outbox' }));
  assert(technicalAlertExcluded({ id: 'other', service: 'WhatsApp' }));
  assert(!technicalAlertExcluded({ id: 'DICOM receive:54.95.134.100:6000', service: 'DICOM receive' }));
  assert(!technicalAlertExcluded({ id: 'redis', service: 'Redis cache' }));
  assert(technicalAlertExcluded({ id: 'MRI_STUDY:1', service: 'Legacy AI endpoint' }));
});
test('only concrete failures open incidents; enabled catalog entries are not health claims', () => {
  const row = { id: 'viewer', service: 'Viewer', center: 'Shared', status: 'Needs attention', detail: '', observedAt: null };
  assert(technicalFailure(row));
  for (const status of ['Healthy', 'Enabled', 'Disabled', 'Reachable', 'Observed', 'No activity']) assert(!technicalFailure({ ...row, status }));
  assert.equal(HEALTH_INTERVAL_MS, 900000); assert.equal(REMINDER_INTERVAL_MS, 120000);
});
test('Noted requires a human reply in the configured group, never an unrelated message', () => {
  assert.equal(acknowledgmentReply(update, '-100123')?.messageId, 7);
  assert.equal(acknowledgmentReply(update, '-100999'), null);
  for (const change of [{ text: 'not noted' }, { text: 'Noted 123' }, { from: { id: 12, is_bot: true } }, { sender_chat: { id: 1 } }, { chat: { id: -100123, type: 'private' } }]) {
    assert.equal(acknowledgmentReply({ ...update, message: { ...update.message!, ...change } }, '-100123'), null);
  }
  assert(acknowledgmentReply({ ...update, message: { ...update.message!, text: ' noted. ' } }, '-100123'));
  assert.equal(acknowledgmentReply({ ...update, message: { ...update.message!, reply_to_message: undefined } }, '-100123')?.messageId, null);
  const callback = { update_id: 2, callback_query: { id: 'cb', data: 'technical-noted', from: { id: 12 }, message: { message_id: 7, chat: { id: -100123, type: 'group' } } } };
  assert.equal(acknowledgmentReply(callback, '-100123')?.messageId, 7);
  assert.equal(acknowledgmentReply(callback, '-100999'), null);
});
test('alert tells responders how to acknowledge and keeps manual resolution distinct', () => {
  const text = technicalAlertText({ id: 'incident-1', service: 'Viewer', center: 'Shared', detail: 'Timeout', observedStatus: 'Needs attention' });
  assert.match(text, /Tap Noted below/);
  assert.match(text, /Super Admin must resolve/);
  assert(text.length < 4096);
});
