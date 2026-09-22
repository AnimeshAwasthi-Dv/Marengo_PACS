import assert from 'node:assert/strict';
import test from 'node:test';
import { modalityCode, redactExchange, sendTelegram, studyTatCategory, tatTargetSeconds, TelegramDeliveryError, telegramConfig, telegramMessage } from './telegramPolicy';

const valid = { TELEGRAM_ENABLED: 'true', TELEGRAM_BOT_TOKEN: 'test-only-token', TELEGRAM_CHAT_ID: '-100123456', TELEGRAM_CLIENT_IDS: 'center-a, center-b', TELEGRAM_PORTAL_URL: 'https://pacs.example.org' };

test('Telegram requires an explicit group, center allowlist and public HTTPS URL', () => {
  const config = telegramConfig(valid);
  assert.deepEqual(config.missing, []);
  assert.deepEqual(config.clientIds, ['center-a', 'center-b']);
  assert.equal(telegramConfig({}).enabled, false);
  for (const url of ['http://example.org', 'https://localhost', 'https://127.0.0.1', 'https://user:pass@example.org', 'https://example.org/?token=secret']) assert(telegramConfig({ ...valid, TELEGRAM_PORTAL_URL: url }).missing.includes('public HTTPS portal URL'));
  assert(telegramConfig({ ...valid, TELEGRAM_CHAT_ID: '123456' }).missing.includes('group chat ID'));
});

test('TAT normalization preserves unknown targets and independent urgent targets', () => {
  const env = { TELEGRAM_TAT_XRAY_MINUTES: '30', TELEGRAM_TAT_CT_MINUTES: '60', TELEGRAM_TAT_CT_URGENT_MINUTES: '20' };
  for (const code of ['XR', 'DX', 'CR', 'X RAY']) assert.equal(tatTargetSeconds(code, 'REGULAR', env), 1800);
  assert.equal(modalityCode('MR'), 'MRI');
  assert.equal(modalityCode('PT'), 'NMR');
  assert.equal(tatTargetSeconds('CT', 'URGENT', env), 1200);
  assert.equal(tatTargetSeconds('XR', 'URGENT', env), null);
  assert.equal(tatTargetSeconds('MRI', null, env), null);
  assert.equal(tatTargetSeconds('CT', null, { TELEGRAM_TAT_CT_MINUTES: '-1' }), null);
});

test('Signed report SLA distinguishes special X-ray services and does not misclassify CT or MRI', () => {
  const env = { TELEGRAM_TAT_XRAY_MINUTES: '30', TELEGRAM_TAT_SPECIAL_XRAY_MINUTES: '120', TELEGRAM_TAT_CT_MINUTES: '120', TELEGRAM_TAT_MRI_MINUTES: '180', TELEGRAM_TAT_SPECIAL_XRAY_URGENT_MINUTES: '120' };
  assert.equal(studyTatCategory('DX', 'special-xray-contrast-media', 'Examination'), 'SPECIAL_XRAY');
  assert.equal(studyTatCategory('CR', 'xray', 'HSG'), 'SPECIAL_XRAY');
  assert.equal(studyTatCategory('DX', 'xray', 'Chest PA'), 'XRAY');
  assert.equal(studyTatCategory('CT', 'ct-abdomen', 'CT Sinogram'), 'CT');
  assert.equal(studyTatCategory('MR', 'mri', 'MRI Fistulogram'), 'MRI');
  for (const [code, seconds] of [['XRAY', 1800], ['SPECIAL_XRAY', 7200], ['CT', 7200], ['MRI', 10800]] as const) assert.equal(tatTargetSeconds(code, 'REGULAR', env), seconds);
  assert.equal(tatTargetSeconds('SPECIAL_XRAY', 'URGENT', env), 7200);
  assert.equal(tatTargetSeconds('NM', 'REGULAR', env), null);
});

test('Protected integration JSON redacts nested credentials, binary files and signed URLs', () => {
  const body = redactExchange({ status: 'accepted', nested: [{ api_key: 'hidden', accessToken: 'hidden', password: 'hidden', report_base64: 'hidden', filePath: '/hidden' }], url: 'https://storage.example.org/private?sig=hidden', note: 'Bearer private-jwt' });
  const serialized = JSON.stringify(body);
  assert(!serialized.includes('hidden'));
  assert(!serialized.includes('private-jwt'));
  assert(serialized.includes('accepted'));
});

test('Telegram message contains an IST deadline and authenticated link, not patient payloads', () => {
  const result = telegramMessage({ id: 'job-1', modality: 'CT', priority: 'Routine', status: 'Reporting', startedAt: '2026-09-22T00:00:00.000Z', targetSeconds: 3600, completedAt: null }, 'https://pacs.example.org');
  assert(result.text.includes('06:30:00 IST'));
  assert.equal(result.url, 'https://pacs.example.org/study-status/job-1');
  assert(!result.text.includes('token'));
});

test('Telegram sender protects content, disables previews and stores the returned message ID', async () => {
  const result = await sendTelegram(telegramConfig(valid), 'Study message', 'https://pacs.example.org/study-status/job-1', (async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.chat_id, valid.TELEGRAM_CHAT_ID);
    assert.equal(body.protect_content, true);
    assert.equal(body.link_preview_options.is_disabled, true);
    assert(!body.parse_mode);
    return new Response(JSON.stringify({ ok: true, result: { message_id: 99 } }));
  }) as typeof fetch);
  assert.equal(result, 99);
});

test('Telegram rate limits preserve retry_after without exposing API response descriptions', async () => {
  await assert.rejects(sendTelegram(telegramConfig(valid), 'Message', 'https://pacs.example.org', (async () => new Response(JSON.stringify({ ok: false, error_code: 429, description: 'secret token', parameters: { retry_after: 90 } }), { status: 429 })) as typeof fetch), error => {
    assert(error instanceof TelegramDeliveryError);
    assert.equal(error.retryAfter, 90);
    assert(!error.message.includes('secret'));
    return true;
  });
  await assert.rejects(sendTelegram(telegramConfig(valid), 'Message', 'https://pacs.example.org', (async () => { throw new Error('URL with secret'); }) as typeof fetch), /code 0/);
});
