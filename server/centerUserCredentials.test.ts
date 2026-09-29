import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { centerUserSchema, centerLoginConflictWhere } from './centerUserCredentials';
const base = { name: 'Center User', email: 'USER@example.com', portalRole: 'FRONT_DESK' };
test('center credentials support automatic generation and normalize chosen usernames', () => {
 assert.equal(centerUserSchema.parse(base).userId, undefined);
 assert.equal(centerUserSchema.parse({ ...base, userId: '', password: '' }).password, '');
 const parsed = centerUserSchema.parse({ ...base, userId: ' Center.Admin ', password: 'ChosenPassword12!' });
 assert.equal(parsed.userId, 'center.admin'); assert.equal(parsed.email, 'user@example.com');
});
test('custom credentials reject ambiguous usernames, invalid roles, short passwords and bcrypt truncation', () => {
 for (const userId of ['a', 'two words', 'user@example.com', 'a'.repeat(65)]) assert.equal(centerUserSchema.safeParse({ ...base, userId }).success, false);
 for (const password of ['short', 'a'.repeat(73), '\u00e9'.repeat(37)]) assert.equal(centerUserSchema.safeParse({ ...base, password }).success, false);
 assert.equal(centerUserSchema.safeParse({ ...base, portalRole: 'SUPER_ADMIN' }).success, false);
});
test('chosen password authenticates with bcrypt without trimming', async () => {
 const password = '  ChosenPassword12!  ';
 const parsed = centerUserSchema.parse({ ...base, password });
 const hash = await bcrypt.hash(parsed.password!, 4);
 assert(await bcrypt.compare(password, hash)); assert.equal(await bcrypt.compare(password.trim(), hash), false);
});
test('duplicate check reserves usernames and emails case-insensitively', () => {
 const where = centerLoginConflictWhere('center.admin', 'user@example.com');
 assert.deepEqual(where.OR, [
  { userId: { equals: 'center.admin', mode: 'insensitive' } },
  { email: { equals: 'center.admin', mode: 'insensitive' } },
  { userId: { equals: 'user@example.com', mode: 'insensitive' } },
  { email: { equals: 'user@example.com', mode: 'insensitive' } },
 ]);
});
