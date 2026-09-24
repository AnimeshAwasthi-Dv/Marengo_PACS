// Integration verification uses synthetic observations in a rolled-back transaction.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../server/db';
import { acknowledgeTechnicalReply, recordTechnicalObservations, resolveTechnicalIncident, type TechnicalIncident } from '../server/technicalAlerts';

const rollback = new Error('ROLLBACK_VERIFICATION');
try {
  await prisma.$transaction(async db => {
    const probeId = `verification-${randomUUID()}`;
    const row = { id: probeId, service: 'Synthetic verification probe', center: 'Test', detail: 'Synthetic failure', status: 'Needs attention', observedAt: new Date().toISOString() };
    await recordTechnicalObservations(db, [row]);
    await recordTechnicalObservations(db, [row]);
    let incidents = await db.$queryRaw<TechnicalIncident[]>`SELECT * FROM technical_incidents WHERE "probeId"=${probeId}`;
    assert.equal(incidents.length, 1, 'Repeated failure must not create duplicate incidents');
    const incident = incidents[0];
    assert.equal(await resolveTechnicalIncident(db, incident.id, 'verification', 'Synthetic resolution'), null, 'Unacknowledged incident cannot be resolved');
    await recordTechnicalObservations(db, [{ ...row, status: 'Healthy' }]);
    incidents = await db.$queryRaw<TechnicalIncident[]>`SELECT * FROM technical_incidents WHERE id=${incident.id}`;
    assert.equal(incidents[0].status, 'OPEN', 'Recovery must not auto-resolve');
    assert.equal(incidents[0].observedStatus, 'Healthy');
    const chatId = '-100000000001';
    await db.$executeRaw`INSERT INTO technical_alert_events (id, "incidentId", event, actor, detail, "chatId", "messageId") VALUES (${randomUUID()}, ${incident.id}, 'SENT', 'verification', 'No real message sent', ${chatId}, 123)`;
    const update = { update_id: 999, message: { message_id: 124, date: Math.floor(Date.now() / 1000), text: 'Noted', chat: { id: Number(chatId), type: 'supergroup' }, from: { id: 12345, first_name: 'Test' }, reply_to_message: { message_id: 123 } } };
    assert.equal(await acknowledgeTechnicalReply(db, update, '-100999'), 0);
    assert.equal(await acknowledgeTechnicalReply(db, { ...update, message: { ...update.message, reply_to_message: { message_id: 999 } } }, chatId), 0);
    assert.equal(await acknowledgeTechnicalReply(db, update, chatId), 1);
    assert.equal(await acknowledgeTechnicalReply(db, update, chatId), 0, 'Repeated reply must be idempotent');
    incidents = await db.$queryRaw<TechnicalIncident[]>`SELECT * FROM technical_incidents WHERE id=${incident.id}`;
    assert.equal(incidents[0].status, 'ACKNOWLEDGED');
    assert.match(incidents[0].acknowledgedBy!, /12345/);
    const [due] = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM technical_incidents WHERE id=${incident.id} AND status='OPEN' AND "nextReminderAt"<=CURRENT_TIMESTAMP`;
    assert.equal(Number(due.count), 0, 'Acknowledged incident must not be due for reminders');
    const events = await db.$queryRaw<{ event: string }[]>`SELECT event FROM technical_alert_events WHERE "incidentId"=${incident.id}`;
    assert.deepEqual(events.map(item => item.event).sort(), ['ACKNOWLEDGED', 'HEALTH_CHANGED', 'OPENED', 'SENT']);
    const admin = await db.user.findFirstOrThrow({ where: { role: 'SUPER_ADMIN', active: true }, select: { id: true } });
    assert.equal((await resolveTechnicalIncident(db, incident.id, admin.id, 'Synthetic verification repair'))?.status, 'RESOLVED');
    assert.equal(await resolveTechnicalIncident(db, incident.id, admin.id, 'Duplicate resolution'), null);
    await recordTechnicalObservations(db, [row]);
    const reopened = await db.$queryRaw<TechnicalIncident[]>`SELECT * FROM technical_incidents WHERE "probeId"=${probeId} AND status='OPEN'`;
    assert.equal(reopened.length, 1, 'Failure after resolution opens a new incident');
    assert.notEqual(reopened[0].id, incident.id, 'Resolved history is preserved');
    throw rollback;
  }, { timeout: 30000 });
} catch (error) { if (error !== rollback) throw error; }
finally { await prisma.$disconnect(); }
console.log('Technical incident lifecycle verified; all synthetic records rolled back. No Telegram messages sent.');
