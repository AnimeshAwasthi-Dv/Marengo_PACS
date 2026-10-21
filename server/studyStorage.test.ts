import assert from 'node:assert/strict'
import test from 'node:test'
import { Readable } from 'node:stream'
import { S3Client, CopyObjectCommand } from '@aws-sdk/client-s3'
import { studyObjectReference } from './lib/studyStorage'
import { prepareViewerStudyObject } from './reportStorage'
import { openStudyArchive } from './studyBundle'

test('exact S3 study URI overrides stale processing metadata without decoding the key', () => {
  assert.deepEqual(studyObjectReference({ storage: { originalStudy: { bucket: 'old', key: 'old.zip' } } }, 's3://ct/CT/a%20b.zip'),
    { bucket: 'ct', key: 'CT/a%20b.zip' })
  assert.deepEqual(studyObjectReference({ storage: { originalStudy: { bucket: 'ct', key: 'a.zip' } } }), { bucket: 'ct', key: 'a.zip' })
  for (const value of [null, [], {}, { storage: null }, { originalStudy: { bucket: 'ct' } }]) assert.equal(studyObjectReference(value), null)
})

test('reconciled study downloads its exact S3 archive without a processing job or bucket scan', async () => {
  const archive = await openStudyArchive({ id: 'a', publicStudyId: 'BS-A', studyInstanceUid: '1.2.3', modalities: ['CT'], archivePath: 's3://ct/CT/study.zip' }, {
    local: async () => { throw new Error('Must not read local files') },
    openLocal: () => { throw new Error('Must not read local files') },
    findStored: async () => { throw new Error('Must not scan buckets') },
    openStored: async reference => { assert.deepEqual(reference, { bucket: 'ct', key: 'CT/study.zip' }); return { stream: Readable.from(['archive']) } },
  })
  let bytes = ''; for await (const chunk of archive.stream) bytes += chunk
  assert.equal(bytes, 'archive')
})

test('viewer preserves same-bucket keys and copies cross-bucket sources into modality storage', async t => {
  const values = { S3_CT_STUDIES_BUCKET: 'ct-destination', S3_CT_STUDIES_PREFIX: 'CT', S3_ACCESS_KEY_ID: 'test', S3_SECRET_ACCESS_KEY: 'test', S3_REGION: 'us-east-1' }
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]))
  Object.assign(process.env, values)
  t.after(() => { for (const [key,value] of Object.entries(previous)) { if(value === undefined) delete process.env[key]; else process.env[key] = value } })
  const calls: unknown[] = []
  t.mock.method(S3Client.prototype, 'send', async (command: CopyObjectCommand) => { calls.push(command.input); return {} })
  assert.deepEqual(await prepareViewerStudyObject({ bucket: 'ct-destination', key: 'CT/existing.zip' }, 'ct-studies', 'a'), { bucket: 'ct-destination', key: 'CT/existing.zip' })
  assert.equal(calls.length, 0)
  assert.deepEqual(await prepareViewerStudyObject({ bucket: 'legacy', key: 'folder/a b.zip' }, 'ct-studies', 'a'), { bucket: 'ct-destination', key: 'CT/viewer-imports/a/study.zip' })
  assert.deepEqual(calls, [{ Bucket: 'ct-destination', Key: 'CT/viewer-imports/a/study.zip', CopySource: 'legacy/folder/a%20b.zip' }])
  t.mock.method(S3Client.prototype, 'send', async () => { throw new Error('AccessDenied') })
  await assert.rejects(prepareViewerStudyObject({ bucket: 'legacy', key: 'a.zip' }, 'ct-studies', 'a'), /AccessDenied/)
})

test('S3 study submission materializes bytes locally and removes oversized partial downloads', async t => {
  const fs = await import('node:fs/promises')
  const os = await import('node:os')
  const path = await import('node:path')
  const { materializeStudyArchive } = await import('./studyBundle')
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'study-storage-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const study = { id: 'a', publicStudyId: 'BS-A', studyInstanceUid: '1.2.3', modalities: ['CT'], archivePath: 's3://ct/CT/a.zip' }
  const dependencies = {
    local: async () => null,
    openLocal: () => { throw new Error('No local archive') },
    findStored: async () => { throw new Error('No scan needed') },
    openStored: async () => ({ stream: Readable.from([Buffer.from('archive')]) }),
  }
  const file = await materializeStudyArchive(study, { directory, dependencies })
  assert.equal(await fs.readFile(file, 'utf8'), 'archive')
  await assert.rejects(materializeStudyArchive(study, { directory, dependencies, maxBytes: 3 }), /size limit/)
  assert.deepEqual(await fs.readdir(directory), [path.basename(file)])
  assert.equal(await materializeStudyArchive(study, { directory, dependencies: { ...dependencies, local: async () => file, openStored: async () => { throw new Error('Must reuse local file') } } }), file)
})
