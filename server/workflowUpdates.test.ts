import { handleWatiPhysicianWebhook } from './watiPhysicianWebhook';
import type { PrismaClient } from '@prisma/client';
import { enqueuePhysicianReports, requestPhysicianCall } from './physicianWhatsapp';
import test from 'node:test';
import assert from 'node:assert/strict';
import { modalityCode, modalityCodes, modalityLabel } from '../src/modalities';
import { worklistFacets } from '../src/pacsWorklist';
import { telegramUrgentConfig, telegramCallbackConfig, sendTelegram } from './telegramPolicy';
import { enqueueTelegramStudy, TELEGRAM_URGENT_EVENT, TELEGRAM_EVENT } from './telegram';
import { matchingPhysician, reportReadyTemplate } from './physicianWhatsapp';

const config = { enabled: true, token: 'test', chatId: '-1001', clientIds: ['center'], groupCode: '', portalUrl: 'https://portal.example.com', missing: [] };
const job = { id: 'job', clientId: 'center', serviceType: 'CT', priority: 'URGENT', demoMode: false };

test('modality ordering, labels and nuclear/PET aliases share one counted queue', () => {
 assert.deepEqual(modalityCodes.map(modalityLabel), ['X-Ray','Special X-Ray','CT','MRI','Mammography','PET-CT','USG']);
 for (const alias of ['NM','NMR','Nuclear medicine','PET=CT','PET_CT']) assert.equal(modalityCode(alias),'PT');
 const rows = [{ study: { modalities: ['NM','PT'] }, state: 'AVAILABLE' as const, priority: 'REGULAR' as const, needsAttention: false }];
 const facets = worklistFacets(rows,'ALL','PT',Date.now());
 assert.equal(facets.modalityCounts.PT,1); assert.equal(facets.scopedRows.length,1);
});

test('urgent queue rejects routine/demo/out-of-scope studies and uses its own idempotency key', async () => {
 const writes: any[] = [];
 const db: any = { notificationOutbox: { upsert: async (args: any) => { writes.push(args); } } };
 await enqueueTelegramStudy(db,{...job, priority:'REGULAR'},'CT',config,undefined,TELEGRAM_URGENT_EVENT);
 await enqueueTelegramStudy(db,{...job, demoMode:true},'CT',config,undefined,TELEGRAM_URGENT_EVENT);
 await enqueueTelegramStudy(db,{...job, clientId:'other'},'CT',config,undefined,TELEGRAM_URGENT_EVENT);
 assert.equal(writes.length,0);
 await enqueueTelegramStudy(db,job,'CT',config,undefined,TELEGRAM_URGENT_EVENT,'job:reported');
 assert.equal(writes[0].where.idempotencyKey,'telegram:urgent:job:reported');
 assert.equal(writes[0].create.idempotencyKey,writes[0].where.idempotencyKey);
 assert.equal(writes[0].create.eventType,TELEGRAM_URGENT_EVENT);
 await enqueueTelegramStudy(db,{...job,priority:'REGULAR'},'CT',config);
 assert.equal(writes[1].create.eventType,TELEGRAM_EVENT);
 assert.equal(writes[1].create.idempotencyKey,'telegram:processing:job');
});

test('operational group configurations remain independent', () => {
 const env = { TELEGRAM_BOT_TOKEN:'token', TELEGRAM_CLIENT_IDS:'center', TELEGRAM_PORTAL_URL:'https://portal.example.com', TELEGRAM_URGENT_ENABLED:'true', TELEGRAM_URGENT_CHAT_ID:'-1001', TELEGRAM_CALLBACK_ENABLED:'true', TELEGRAM_CALLBACK_CHAT_ID:'-1002' };
 assert.equal(telegramUrgentConfig(env).chatId,'-1001'); assert.equal(telegramCallbackConfig(env).chatId,'-1002');
 assert.deepEqual(telegramUrgentConfig(env).missing,[]);
 assert(telegramCallbackConfig({...env,TELEGRAM_CALLBACK_CHAT_ID:'https://t.me/+invite'}).missing.includes('group chat ID'));
});

test('Telegram transport routes to the selected group without live network access', async () => {
 let sent: any;
 const transport = (async (_url: unknown, init: any) => { sent=JSON.parse(init.body); return new Response(JSON.stringify({ok:true,result:{message_id:123}}),{status:200}); }) as typeof fetch;
 assert.equal(await sendTelegram(config,'Status','https://portal.example.com',transport),123);
 assert.equal(sent.chat_id,'-1001'); assert.equal(sent.protect_content,true);
});

test('physician mapping requires consent, verification, center match and an unambiguous name', () => {
 const person = {id:'p',name:'Dr Asha Shah',role:'REFERRING_PHYSICIAN',clientId:'center',phoneE164:'+919999999999',active:true,verificationStatus:'VERIFIED',consentStatus:'OPTED_IN',createdAt:new Date()};
 assert.equal(matchingPhysician([person],['SHAH^ASHA'],'center')?.id,'p');
 assert.equal(matchingPhysician([person],['SHAH^ASHA'],'other'),null);
 assert.equal(matchingPhysician([{...person,consentStatus:'OPTED_OUT'}],['Asha Shah'],'center'),null);
 assert.equal(matchingPhysician([person,{...person,id:'duplicate'}],['Asha Shah'],'center'),null);
 const template = reportReadyTemplate(person.phoneE164,'https://portal.example.com/shared/test','outbox','ready','en');
 assert.equal(template.template.components[1].parameters[0].payload,'physician_call:outbox');
});

const person = (changes = {}) => ({ id: 'physician', name: 'Dr. Amit Shah', role: 'REFERRING_PHYSICIAN', phoneE164: '+919876543210', clientId: null,
  active: true, consentStatus: 'OPTED_IN', verificationStatus: 'VERIFIED', createdAt: new Date('2026-01-01'), ...changes });

function fixture() {
  const recipient = person();
  const report = { id: 'report', clientId: 'center', studyUid: '1.2.3', status: 'APPROVED', approvedAt: new Date('2026-02-01'), createdAt: new Date('2026-02-01'),
    aiReportJson: {}, editedReportJson: {}, radiologistId: 'radiologist', radiologist: { userId: 'radiologist-user' } };
  const state = { recipient, report, names: ['Shah^Amit'], shares: [] as any[], outbox: [] as any[], events: [] as any[], deliveries: [] as any[], userQuery: undefined as any };
  const db: any = {
    notificationRecipient: { findMany: async () => [state.recipient], findUnique: async () => state.recipient },
    availableBridgeStudy: { findMany: async ({ where }: any) => { assert.equal(where.clientId, 'center'); return state.names.map(referringPhysician => ({ referringPhysician })); } },
    reportReview: { findMany: async ({ where }: any) => { assert.deepEqual(where.status.in, ['APPROVED', 'PUSHED']); return [state.report]; }, findUnique: async () => state.report },
    reportPublicShare: { findUnique: async () => state.shares[0] ?? null, upsert: async ({ create }: any) => { if (!state.shares.length) state.shares.push(create); return state.shares[0]; } },
    notificationOutbox: {
      findUnique: async ({ where }: any) => state.outbox.find(item => where.id ? item.id === where.id : item.idempotencyKey === where.idempotencyKey) ?? null,
      upsert: async ({ create }: any) => { let entry = state.outbox.find(item => item.idempotencyKey === create.idempotencyKey); if (!entry) { entry = { ...create, id: 'outbox', status: 'PENDING' }; state.outbox.push(entry); } return entry; },
    },
    notificationEvent: { upsert: async ({ create }: any) => { let event = state.events.find(item => item.idempotencyKey === create.idempotencyKey); if (!event) { event = { ...create, id: 'event' }; state.events.push(event); } return event; } },
    user: { findMany: async (query: any) => { state.userQuery = query; return [{ id: 'superadmin', role: 'SUPER_ADMIN' }, ...(state.report.radiologist ? [{ id: 'radiologist-user', role: 'RADIOLOGIST' }] : [])]; } },
    notificationDelivery: { createMany: async ({ data, skipDuplicates }: any) => { assert.equal(skipDuplicates, true); for (const row of data) if (!state.deliveries.some(item => item.recipientKey === row.recipientKey)) state.deliveries.push(row); } },
  };
  db.$transaction = async (run: any) => run(db);
  return { db: db as PrismaClient, state };
}


test('verified callback queues one notification for the dedicated Telegram group across webhook retries', async () => {
 const keys = ['TELEGRAM_CALLBACK_ENABLED','TELEGRAM_CALLBACK_CHAT_ID','PORTAL_BASE_URL'];
 const saved = keys.map(key => process.env[key]);
 process.env.TELEGRAM_CALLBACK_ENABLED='true'; process.env.TELEGRAM_CALLBACK_CHAT_ID='-1002'; process.env.PORTAL_BASE_URL='https://portal.example.com';
 try {
  const {db,state}=fixture(); await enqueuePhysicianReports(db); state.outbox[0].status='SENT';
  assert.equal(await requestPhysicianCall(db,'+919999999999','outbox'),false);
  assert.equal(state.events.length,0);
  assert.equal(await requestPhysicianCall(db,state.recipient.phoneE164,'outbox'),true);
  assert.equal(await requestPhysicianCall(db,state.recipient.phoneE164,'outbox'),true);
  const callbacks=state.outbox.filter(row=>row.eventType==='TELEGRAM_PHYSICIAN_CALLBACK');
  assert.equal(callbacks.length,1); assert.equal(callbacks[0].payload.chatId,'-1002');
  assert.equal(callbacks[0].aggregateId,state.events[0].id);
 } finally { keys.forEach((key,i)=>{ if(saved[i]===undefined) delete process.env[key]; else process.env[key]=saved[i]; }); }
});

test('WATI case discussion correlates the original report and never guesses from a generic chat message', async () => {
 const {db,state}=fixture();await enqueuePhysicianReports(db);state.outbox[0].status='SENT';
 state.outbox[0].payload.watiMessageIds=['original-message'];
 (db.notificationOutbox as any).findMany=async({where}:any)=>where.payload.path[0]==='watiMessageIds' && where.payload.array_contains[0]==='original-message'?[state.outbox[0]]:[];
 const event={eventType:'messageReceived',owner:false,waId:'919876543210',type:'button',text:'Connect to Radiologist',replyContextId:'original-message'};
 await handleWatiPhysicianWebhook(db,{...event,replyContextId:''});assert.equal(state.events.length,0);
 await handleWatiPhysicianWebhook(db,{...event,type:'text'});assert.equal(state.events.length,0);
 await handleWatiPhysicianWebhook(db,{...event,waId:'919999999999'});assert.equal(state.events.length,0);
 await handleWatiPhysicianWebhook(db,event);await handleWatiPhysicianWebhook(db,event);
 assert.equal(state.events.length,1);assert.equal(state.events[0].aggregateId,'report');
});
