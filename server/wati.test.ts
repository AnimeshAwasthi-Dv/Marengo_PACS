import test from 'node:test';
import assert from 'node:assert/strict';
import { watiConfigured, watiTemplatePayload, watiTemplateStatus, sendWatiPhysicianReport, validWatiWebhookSecret, captureWatiWebhookSecret } from './wati';
import { physicianTemplateFields, reportReadyTemplate, enqueuePhysicianReports } from './physicianWhatsapp';
const env = { WATI_ENABLED:'true', WATI_API_URL:'https://wati.example.test/tenant', WATI_API_TOKEN:'test-token', WHATSAPP_REPORT_READY_TEMPLATE_NAME:'notification_to_physician' };
const fields = { name:'Test Patient', age:'34 years', study:'CT Chest' };
const link = 'https://portal.example.test/shared/report-token';

test('physician template uses the four named WATI variables in body order', () => {
 const payload = watiTemplatePayload(fields, link, 'outbox', env);
 assert.equal(payload.template_name,'notification_to_physician');
 assert.deepEqual(payload.parameters, [{name:'name',value:fields.name},{name:'age',value:fields.age},{name:'study',value:fields.study},{name:'study_link',value:link}]);
 assert.equal(payload.broadcast_name,'physician_report_outbox');
 const meta = reportReadyTemplate('+919876543210',link,'outbox','notification_to_physician','en',fields);
 assert.deepEqual(meta.template.components[0].parameters.map(p=>p.text),[fields.name,fields.age,fields.study,link]);
});

test('patient fields use recorded data, normalize DICOM age and do not invent demographics', () => {
 assert.deepEqual(physicianTemplateFields({patientName:'Test^Patient',serviceName:'CT Suite'},{patientAge:'034Y',studyDescription:'CT Chest'}),fields);
 assert.deepEqual(physicianTemplateFields({serviceName:'MRI'}),{name:'Not available',age:'Not available',study:'MRI'});
 assert.equal(physicianTemplateFields({editedReportJson:{dicomMetadata:{patientAge:'006M'}}}).age,'6 months');
});

test('missing or invalid phone numbers do not call WATI', async () => {
 const transport = (async()=>{throw new Error('Must not call network');}) as typeof fetch;
 for(const phone of [undefined,null,'',' ','not-configured','+0']) {
  assert.equal((await sendWatiPhysicianReport(phone,fields,link,'outbox',env,transport)).skipped,true);
 }
 assert.equal((await sendWatiPhysicianReport('+919876543210',fields,link,'outbox',{},transport)).skipped,true);
});

test('no eligible contact skips reconciliation before reading reports or creating links', async () => {
 for(const contacts of [[],[{phoneE164:null}],[{phoneE164:'',verificationStatus:'VERIFIED',consentStatus:'OPTED_IN'}],[{phoneE164:'+919876543210',verificationStatus:'PENDING',consentStatus:'OPTED_IN'}]]) {
  const db:any={notificationRecipient:{findMany:async()=>contacts}};
  await assert.doesNotReject(()=>enqueuePhysicianReports(db));
 }
});

test('template approval status is read without attempting delivery', async () => {
 let calls=0;
 const transport=(async(url:unknown)=>{calls++;assert.match(String(url),/getMessageTemplates/);return Response.json({result:true,messageTemplates:[{elementName:'notification_to_physician',status:'PENDING'}]});}) as typeof fetch;
 assert.equal(await watiTemplateStatus(env,transport),'PENDING');assert.equal(calls,1);
 assert.equal(watiConfigured({...env,WATI_API_URL:'http://wati.example.test'}),false);
});

test('WATI sends mapped parameters and retains provider message IDs', async () => {
 const transport=(async(url:unknown,init:any)=>{
  assert.match(String(url),/tenant\/api\/v1\/sendTemplateMessage\?whatsappNumber=919876543210/);
  assert.equal(init.headers.Authorization,'Bearer test-token');
  assert.deepEqual(JSON.parse(init.body),watiTemplatePayload(fields,link,'outbox',env));
  return Response.json({result:true,localMessageId:'local',message:{whatsappMessageId:'wamid.123'}});
 }) as typeof fetch;
 assert.deepEqual(await sendWatiPhysicianReport('+919876543210',fields,link,'outbox',env,transport),{skipped:false,messageIds:['local','wamid.123']});
});

test('WATI missing-contact responses skip silently; other failures remain background delivery failures', async () => {
 for(const status of [200,400]) {
  const transport=(async()=>Response.json({result:false,info:'Contact does not exist'},{status})) as typeof fetch;
  assert.equal((await sendWatiPhysicianReport('+919876543210',fields,link,'outbox',env,transport)).skipped,true);
 }
 const denied=(async()=>Response.json({result:false,error:'private provider diagnostic'},{status:403})) as typeof fetch;
 await assert.rejects(()=>sendWatiPhysicianReport('+919876543210',fields,link,'outbox',env,denied),{message:'WATI request failed (HTTP 403)'});
});

test('webhook secret is mandatory and removed before request logging', () => {
 const secret='a'.repeat(64);
 assert.equal(validWatiWebhookSecret(secret,secret),true);
 assert.equal(validWatiWebhookSecret('wrong',secret),false);
 assert.equal(validWatiWebhookSecret(undefined,secret),false);
 const req:any={originalUrl:'/api/v1/whatsapp/wati/webhook?secret='+secret+'&source=wati',url:'/?secret='+secret+'&source=wati'};
 const res:any={locals:{}};let continued=false;
 captureWatiWebhookSecret(req,res,()=>{continued=true;});
 assert.equal(res.locals.watiWebhookSecret,secret);assert.equal(continued,true);
 assert.equal(req.originalUrl,'/api/v1/whatsapp/wati/webhook?source=wati');
 assert.equal(req.url,'/?source=wati');
});

test('invalid template errors are not mistaken for missing contacts', async () => {
 const transport=(async()=>Response.json({result:false,error:'Invalid WhatsApp template'},{status:400})) as typeof fetch;
 await assert.rejects(()=>sendWatiPhysicianReport('+919876543210',fields,link,'outbox',env,transport),{message:'WATI request failed (HTTP 400)'});
});
