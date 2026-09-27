import test from 'node:test';
import assert from 'node:assert/strict';
import { reportingActivity, statisticsRange, type StatisticsRow } from './workspaceStatistics';
import { modalityCodes, modalityCode, modalityLabel, modalityMatchesCode } from '../src/modalities';
const row = (id:string, fields:Partial<StatisticsRow>):StatisticsRow => ({id, clientId:'c',center:'Center',patient:'',patientId:'',accession:'',modality:'CT',description:'',studyUid:id,jobId:null,demo:false,received:null,processed:null,reported:null,tatSeconds:null,...fields});
test('reporting distinguishes submission activity from the received cohort at IST boundaries',()=>{
 const range=statisticsRange('2026-09-22','2026-09-22');
 const stats=reportingActivity([
  row('carry-in',{received:'2026-09-20T00:00:00Z',submitted:range.start.toISOString()}),
  row('sent',{received:range.start.toISOString(),submitted:'2026-09-22T01:00:00Z',modality:'MG'}),
  row('not-sent',{received:range.start.toISOString()}),
  row('sent-later',{received:range.start.toISOString(),submitted:range.end.toISOString()}),
  row('next-day',{received:range.end.toISOString(),submitted:range.end.toISOString()}),
 ],range);
 assert.deepEqual(stats.totals,{submitted:2,received:3,sent:1,notSent:2});
 assert.equal(stats.hourly[0].studies,1);
 assert.equal(stats.daily[0].sent+stats.daily[0].notSent,stats.daily[0].received);
 assert.equal(stats.modalityDistribution.find(x=>x.modality==='Mammography')?.count,1);
});
test('TAT numbers all valid completed studies in completion order and preserves zero',()=>{
 const stats=reportingActivity([
 row('later',{reported:'2026-09-22T02:00:00Z',tatSeconds:120,modality:'US'}),
 row('first',{reported:'2026-09-22T01:00:00Z',tatSeconds:0,modality:'PT'}),
 row('incomplete',{reported:'2026-09-22T01:00:00Z',tatSeconds:null}),
 ],statisticsRange('2026-09-22','2026-09-22'));
 assert.deepEqual(stats.tatStudies.map(r=>[r.study,r.id,r.minutes,r.modality]),[[1,'first',0,'PET-CT'],[2,'later',2,'USG']]);
});
test('all requested modality aliases filter by DICOM codes and display consistently',()=>{
 for(const [code,label,aliases] of [['MG','Mammography',['MG','mammo','Mammography']],['PT','PET-CT',['PT','PET','PET_CT']],['US','USG',['US','USG','Ultrasound']]] as const){
  for(const alias of aliases){assert.equal(modalityCode(alias),code);assert.equal(modalityLabel(alias),label);assert(modalityMatchesCode(alias,code));}
 }
 assert(!modalityMatchesCode('CT','PT'));
});
test('empty reporting period has zero-filled daily and hourly series',()=>{
 const stats=reportingActivity([],statisticsRange('2026-09-21','2026-09-22'));
 assert.equal(stats.daily.length,2);assert.equal(stats.hourly.length,24);
 assert.deepEqual(stats.totals,{submitted:0,received:0,sent:0,notSent:0});assert.deepEqual(stats.tatStudies,[]);
});

test('TAT groups modalities with min, max and study-weighted averages across the selected period', () => {
 const reported = '2026-09-22T01:00:00Z';
 const stats = reportingActivity([
  row('nuclear', { reported, modality: 'NM', tatSeconds: 60 }),
  row('ct-zero', { reported, modality: 'CT', tatSeconds: 0 }),
  row('ct-two', { reported, modality: 'CT', tatSeconds: 120 }),
  row('multi', { reported, modality: 'CT, MR, MRI', tatSeconds: 600 }),
  row('mr', { reported, modality: 'MR', tatSeconds: 120 }),
  row('missing', { reported, modality: 'CT', tatSeconds: null }),
  row('negative', { reported, modality: 'CT', tatSeconds: -60 }),
  row('invalid', { reported, modality: 'CT', tatSeconds: NaN }),
  row('outside', { reported: '2026-09-23T01:00:00Z', modality: 'CT', tatSeconds: 9000 }),
 ], statisticsRange('2026-09-22', '2026-09-22'));
 assert.deepEqual(stats.tatByModality.filter(group => group.samples > 0), [
  { modality: 'CT', minimumMinutes: 0, maximumMinutes: 10, averageMinutes: 4, samples: 3 },
  { modality: 'MRI', minimumMinutes: 2, maximumMinutes: 10, averageMinutes: 6, samples: 2 },
 ]);
 assert.deepEqual(stats.tatByModality.map(group => group.modality), modalityCodes.filter(code => code !== 'NM').map(modalityLabel));
 const empty = reportingActivity([], statisticsRange('2026-09-22', '2026-09-22')).tatByModality;
 assert.deepEqual(empty, modalityCodes.filter(code => code !== 'NM').map(code => ({ modality: modalityLabel(code), minimumMinutes: null, maximumMinutes: null, averageMinutes: null, samples: 0 })));
});
