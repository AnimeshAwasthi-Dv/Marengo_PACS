import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request, Response } from 'express';
import yauzl from 'yauzl';
import { analysisMetrics, classifyAnalysisModality, createStudyAnalysisHandler, parseAnalysisSelection, type AnalysisStudy } from './studyAnalysis';
import { studyAnalysisWorkbook } from './studyAnalysisWorkbook';

const study = (overrides: Partial<AnalysisStudy> = {}): AnalysisStudy => ({
  id: 'study-a', clientId: 'center-a', accessionNumber: 'A', studyInstanceUid: 'uid-a', modalities: ['CR'], studyDescription: 'Portable chest',
  firstDetectedAt: new Date('2026-10-06T03:30:00Z'), readyAt: null, submittedAt: new Date('2026-10-06T03:40:00Z'),
  createdAt: new Date('2026-10-06T03:30:00Z'), updatedAt: new Date('2026-10-06T06:00:00Z'),
  reportStatus: 'APPROVED', approvedAt: new Date('2026-10-06T04:50:00Z'), ...overrides,
});

test('date selection includes entire IST days and rejects invalid or oversized selections', () => {
  const selection = parseAnalysisSelection({ from: '2026-10-06', to: '2026-10-15', modalities: 'MRI,X-Ray,MRI' });
  assert.equal(selection.range.start.toISOString(), '2026-10-05T18:30:00.000Z');
  assert.equal(selection.range.end.toISOString(), '2026-10-15T18:30:00.000Z');
  assert.deepEqual(selection.modalities, ['X-Ray', 'MRI']);
  for (const values of [{ from: '' }, { from: '2026-02-30' }, { to: '2026-10-05' }, { to: '2027-10-07' }, { modalities: '' }, { modalities: 'US' }, { modalities: ['CT'] }]) {
    assert.throws(() => parseAnalysisSelection({ from: '2026-10-06', to: '2026-10-15', modalities: 'CT', ...values }));
  }
});

test('classification follows explicit code precedence and limits description fallback', () => {
  for (const [modalities, studyDescription, expected] of [
    [['CR'], 'MRI chest', 'X-Ray'], [['DX', 'CT'], '', 'CT'], [['CT', 'MR'], '', 'MRI'],
    [['SC'], 'magnetic resonance brain', 'MRI'], [[], 'computed tomography head', 'CT'],
    [['OT'], 'Chest radiograph', 'X-Ray'], [['US'], 'CT guided ultrasound', null],
  ] as const) assert.equal(classifyAnalysisModality({ modalities: [...modalities], studyDescription }), expected);
});

test('summary reproduces all nine metrics, using approval rather than delivery and excluding pending reports', () => {
  const rows = [study(), study({ id: 'b', accessionNumber: 'B', studyDescription: 'Chest', firstDetectedAt: new Date('2026-10-06T12:30:00Z'), submittedAt: new Date('2026-10-06T12:40:00Z'), approvedAt: new Date('2026-10-06T14:40:00Z') }),
    study({ id: 'c', accessionNumber: 'C', approvedAt: null }), study({ id: 'd', accessionNumber: 'D', reportStatus: 'DRAFT' })];
  assert.deepEqual(analysisMetrics(rows, ['X-Ray', 'CT'])[0].values, [3, 2, 1, 1, 2, '1h 35m', 2, 1, '66.67%']);
  assert.deepEqual(analysisMetrics(rows, ['CT'])[0].values, [0, 'N/A', 'N/A', 0, 0, 'N/A', 0, 0, '0.00%']);
});

test('deduplication prefers final reports and keeps their own receipt and submission times', () => {
  const original = study();
  const duplicate = study({ id: 'duplicate', accessionNumber: ' a ', studyInstanceUid: 'different', updatedAt: new Date('2026-10-07'), reportStatus: 'PENDING', firstDetectedAt: new Date('2026-10-05T21:00:00Z'), submittedAt: new Date('2026-10-05T21:00:00Z') });
  assert.deepEqual(analysisMetrics([original, duplicate], ['X-Ray'])[0].values, [1, 1, 0, 0, 1, '1h 10m', 0, 1, '0.00%']);
  assert.equal(analysisMetrics([original, study({ clientId: 'other' })], ['X-Ray'])[0].values[0], 2);
  assert.equal(analysisMetrics([original, study({ accessionNumber: null }), study({ id: 'other-uid', accessionNumber: null, studyInstanceUid: 'uid-b' })], ['X-Ray'])[0].values[0], 3);
});

test('SLA uses exact thresholds, on-duty receipt, start date and scoped exemptions; invalid TAT stays unavailable', () => {
  for (const [modality, code, minutes] of [['X-Ray', 'DX', 70], ['CT', 'CT', 120], ['MRI', 'MR', 180]] as const) {
    const base = study({ modalities: [code], approvedAt: new Date(+study().submittedAt! + minutes * 60000) });
    assert.equal(analysisMetrics([base], [modality])[0].values[7], 1);
    assert.equal(analysisMetrics([{ ...base, approvedAt: new Date(+base.approvedAt! - 1) }], [modality])[0].values[7], 0);
    assert.equal(analysisMetrics([{ ...base, firstDetectedAt: new Date('2026-09-27T03:30:00Z') }], [modality])[0].values[7], 0);
    assert.equal(analysisMetrics([{ ...base, firstDetectedAt: new Date('2026-10-06T03:29:59Z') }], [modality])[0].values[7], 0);
    assert.equal(analysisMetrics([base], [modality], new Set(['A']))[0].values[7], 0);
  }
  assert.deepEqual(analysisMetrics([study({ approvedAt: new Date('2026-10-05') })], ['X-Ray'])[0].values.slice(5), ['N/A', 1, 0, '100.00%']);
});

async function unzip(buffer: Buffer) {
  return new Promise<Record<string, string>>((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error);
      const files: Record<string, string> = {};
      zip.on('error', reject); zip.on('end', () => resolve(files));
      zip.on('entry', entry => zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) return reject(error);
        const chunks: Buffer[] = [];
        stream.on('data', chunk => chunks.push(chunk)); stream.on('error', reject);
        stream.on('end', () => { files[entry.fileName] = Buffer.concat(chunks).toString(); zip.readEntry(); });
      }));
      zip.readEntry();
    });
  });
}

test('Excel contains just Study Analysis, selected modality columns, escaped text and no patient detail sheets', async () => {
  const buffer = await studyAnalysisWorkbook({ center: { name: '=Example & <Center>', code: 'A', location: null }, range: { from: '2026-10-06', to: '2026-10-15' }, columns: analysisMetrics([study()], ['X-Ray', 'MRI']), thresholds: { 'X-Ray': 70, CT: 120, MRI: 180 }, hasTechnicalExemptions: false });
  const files = await unzip(buffer);
  assert.equal(Object.keys(files).filter(name => name.startsWith('xl/worksheets/')).length, 1);
  assert.match(files['xl/workbook.xml'], /name="Study Analysis"/);
  const sheet = files['xl/worksheets/sheet1.xml'];
  assert.match(sheet, /=Example &amp; &lt;Center&gt;/);
  assert.match(sheet, /<t xml:space="preserve">MRI<\/t>/);
  assert.doesNotMatch(sheet, /<t xml:space="preserve">CT<\/t>|<f[ >]|Patient Details/);
  assert.match(sheet, /<c r="C12" s="0"><v>1<\/v>/);
});

test('export handler derives tenant from authenticated user and rejects scope overrides and non-center accounts', async () => {
  let queryCalls = 0; let auditCalls = 0; let kind = 'CENTER'; let tooMany = false;
  const db = {
    client: { findUnique: async ({ where }: { where: { id: string } }) => { assert.equal(where.id, 'center-a'); return { id: 'center-a', name: 'Example', code: 'EX', location: null, kind }; } },
    $queryRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => {
      queryCalls++;
      assert.equal(values[0], 'center-a');
      assert.equal((values[1] as Date).toISOString(), '2026-10-05T18:30:00.000Z');
      assert.equal((values[2] as Date).toISOString(), '2026-10-06T18:30:00.000Z');
      assert.match(sql.join('?'), /r\."clientId" = s\."clientId"/);
      return tooMany ? Array(50001).fill(study()) : [study()];
    },
    auditLog: { create: async ({ data }: { data: { clientId: string } }) => { assert.equal(data.clientId, 'center-a'); auditCalls++; } },
  } as unknown as Parameters<typeof createStudyAnalysisHandler>[0];
  const handler = createStudyAnalysisHandler(db);
  async function invoke(query: Record<string, unknown>, role = 'CLIENT_USER', clientId: string | undefined = 'center-a') {
    let status = 200; let body: unknown;
    const res = { status(code: number) { status = code; return this; }, json(value: unknown) { body = value; return this; }, type() { return this; }, attachment() { return this; }, send(value: unknown) { body = value; return this; } } as unknown as Response;
    await handler({ user: { sub: 'user', role, clientId }, query: { from: '2026-10-06', to: '2026-10-06', modalities: 'CT', ...query } } as unknown as Request, res, error => { if (error) throw error; });
    return { status, body };
  }
  assert.equal((await invoke({ centerId: 'other' })).status, 403);
  assert.equal((await invoke({ clientId: 'other' })).status, 403);
  assert.equal((await invoke({}, 'SUPER_ADMIN')).status, 403);
  assert.equal((await invoke({}, 'CLIENT_USER', '')).status, 403);
  kind = 'GROUP'; assert.equal((await invoke({})).status, 403); kind = 'CENTER';
  assert.equal((await invoke({ from: 'invalid' })).status, 400);
  assert.equal(queryCalls, 0);
  const response = await invoke({});
  assert.equal(response.status, 200); assert.ok(Buffer.isBuffer(response.body));
  assert.equal(queryCalls, 1); assert.equal(auditCalls, 1);
  tooMany = true;
  assert.equal((await invoke({})).status, 422);
  assert.equal(auditCalls, 1, 'A truncated report is never downloaded or audited as successful');
});
