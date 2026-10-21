import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import express from 'express'
import yauzl from 'yauzl'
import dcmjs from 'dcmjs'
import { createChunkedUploadStore } from './bridgeChunkedUpload'
import { createBridgeInstanceUploadRouter, createInstanceUploadStore } from './bridgeInstanceUpload'

const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex')
const bytes = (length: number, seed = 0) => Buffer.from(Array.from({ length }, (_, i) => (i * 17 + seed) % 256))
const streamed = (data: Buffer) => Readable.from((function* () { for (let i = 0; i < data.length; i += 4093) yield data.subarray(i, i + 4093) })())

function syntheticDicom(index: number) {
  const { DicomDict, DicomMetaDictionary } = dcmjs.data
  const sopClass = '1.2.840.10008.5.1.4.1.1.7'
  const sopInstance = `2.25.12345.${index + 1}`
  const dicom = new DicomDict(DicomMetaDictionary.denaturalizeDataset({
    FileMetaInformationVersion: new Uint8Array([0, 1]).buffer,
    MediaStorageSOPClassUID: sopClass, MediaStorageSOPInstanceUID: sopInstance,
    TransferSyntaxUID: '1.2.840.10008.1.2.1', ImplementationClassUID: '2.25.12345.999',
  }))
  dicom.dict = DicomMetaDictionary.denaturalizeDataset({
    SOPClassUID: sopClass, SOPInstanceUID: sopInstance, StudyInstanceUID: '2.25.12345', SeriesInstanceUID: '2.25.12345.100',
    PatientName: 'SYNTHETIC^STREAM_TEST', PatientID: 'SYNTHETIC', Modality: 'OT',
    Rows: 512, Columns: 512, SamplesPerPixel: 1, PhotometricInterpretation: 'MONOCHROME2',
    BitsAllocated: 8, BitsStored: 8, HighBit: 7, PixelRepresentation: 0,
    PixelData: Uint8Array.from(bytes(512 * 512, index)).buffer,
  })
  dicom.dict['7FE00010'].vr = 'OB'
  return Buffer.from(dicom.write())
}

async function temporary(t: Parameters<Parameters<typeof test>[1]>[0]) {
  const root = await mkdtemp(path.join(tmpdir(), 'bridge-stream-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

test('Bridge ZIP parts stream, reject bad data, survive restart and complete idempotently', async t => {
  const root = await temporary(t)
  const options = { root: path.join(root, 'parts'), maxTotalBytes: 2 * 1024 ** 2 }
  let store = createChunkedUploadStore(options)
  const data = bytes(700001)
  const session = await store.init({ fileName: 'synthetic.zip', totalSize: data.length, partSize: 262144, sha256: hash(data), fields: { client_code: 'SYNTHETIC', study_instance_uid: '2.25.12345' } })
  const dest = path.join(root, 'study.zip')
  await assert.rejects(store.assemble(session.uploadId, dest), /missing/)
  const first = data.subarray(0, session.partSize)
  await assert.rejects(store.writePart(session.uploadId, 0, streamed(first), '0'.repeat(64)), /checksum/)
  await assert.rejects(store.writePart(session.uploadId, 0, streamed(first.subarray(0, 20))), /expected/)
  await assert.rejects(store.writePart(session.uploadId, -1, streamed(first)), /index/)
  await assert.rejects(store.status('../outside'), /not found/)
  await assert.rejects(store.writePart(session.uploadId, 0, Readable.from((async function* () { yield first.subarray(0, 100); throw new Error('Simulated link reset') })())), /link reset/)
  assert.deepEqual((await store.status(session.uploadId)).receivedParts, [])
  for (const index of [2, 0, 1, 0]) {
    const part = data.subarray(index * session.partSize, (index + 1) * session.partSize)
    await store.writePart(session.uploadId, index, streamed(part), hash(part))
  }
  store = createChunkedUploadStore(options)
  assert.deepEqual((await store.status(session.uploadId)).receivedParts, [0, 1, 2])
  await store.assemble(session.uploadId, dest)
  assert.deepEqual(await readFile(dest), data)
  await store.markCompleted(session.uploadId, { study_id: 'synthetic-study' })
  assert.deepEqual(await store.completedResult(session.uploadId), { study_id: 'synthetic-study' })
  assert.equal((await store.status(session.uploadId)).completed, true)
  assert.equal((await readdir(path.join(options.root, session.uploadId))).some(name => name.endsWith('.tmp') || name.startsWith('part-')), false)
})

test('Bridge whole-file checksum failure removes the assembled archive', async t => {
  const root = await temporary(t)
  const store = createChunkedUploadStore({ root, maxTotalBytes: 100, minPartBytes: 1 })
  const data = bytes(10)
  const session = await store.init({ fileName: 'bad.zip', totalSize: 10, partSize: 10, sha256: '0'.repeat(64), fields: {} })
  await store.writePart(session.uploadId, 0, streamed(data), hash(data))
  const dest = path.join(root, 'bad.zip')
  await assert.rejects(store.assemble(session.uploadId, dest), /SHA-256/)
  await assert.rejects(readFile(dest), { code: 'ENOENT' })
})

function unzip(data: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => yauzl.fromBuffer(data, { lazyEntries: true }, (error, zip) => {
    if (error) return reject(error)
    const files = new Map<string, Buffer>()
    zip.on('error', reject)
    zip.on('end', () => resolve(files))
    zip.on('entry', entry => zip.openReadStream(entry, async (error, stream) => {
      if (error) return reject(error)
      try { const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(chunk); files.set(entry.fileName, Buffer.concat(chunks)); zip.readEntry() } catch (error) { reject(error) }
    }))
    zip.readEntry()
  }))
}

test('HTTP Bridge image streaming authorizes, validates, deduplicates and commits exact ZIP contents', async t => {
  const root = await temporary(t)
  const store = createInstanceUploadStore({ root: path.join(root, 'images'), maxBatchBytes: 1024 ** 2, maxBatchInstances: 128, maxStudyBytes: 2 * 1024 ** 2 })
  const app = express()
  app.use(express.json())
  let commits = 0
  let archive: Buffer
  app.use('/api/v1/study-bridge', createBridgeInstanceUploadRouter({ store, studiesRoot: path.join(root, 'studies'), authorize: async (req, res) => {
    if (req.headers.authorization === 'Bearer synthetic-test-token') return true
    res.status(401).json({ error: 'Unauthorized' }); return false
  }, commit: async input => { commits++; archive = await readFile(input.filePath); return { status: 201, body: { study_id: 'isolated-synthetic-study' } } } }))
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  t.after(() => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close(error => error ? reject(error) : resolve()) }))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1/study-bridge/studies/instances`
  const headers = { authorization: 'Bearer synthetic-test-token', 'content-type': 'application/json' }
  const images = [syntheticDicom(0), syntheticDicom(1)]
  const refs = images.map((data, i) => ({ sha256: hash(data), size: data.length, sop_instance_uid: `2.25.12345.${i + 1}` }))
  const body = { client_code: 'SYNTHETIC', study_instance_uid: '2.25.12345', instances: refs }
  assert.equal((await fetch(`${base}/check`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).status, 401)
  const check = () => fetch(`${base}/check`, { method: 'POST', headers, body: JSON.stringify(body) }).then(res => res.json())
  assert.equal((await check()).missing.length, 2)
  const commit = () => fetch(`${base}/commit`, { method: 'POST', headers, body: JSON.stringify({ ...body, file_name: 'synthetic.zip', fields: { client_code: 'SYNTHETIC', study_instance_uid: body.study_instance_uid, patient_meta: JSON.stringify({ patient_name: 'SYNTHETIC TEST ONLY' }) } }) })
  assert.equal((await commit()).status, 409)
  const batch = async (data: Buffer, encoding?: string) => fetch(`${base}/batch?client_code=SYNTHETIC&study_instance_uid=2.25.12345`, { method: 'PUT', headers: { authorization: headers.authorization, 'content-type': 'application/octet-stream', 'x-instances': JSON.stringify(refs), ...(encoding ? { 'content-encoding': encoding } : {}) }, body: streamed(data) as never, duplex: 'half' } as RequestInit)
  assert.equal((await batch(Buffer.concat(images), 'br')).status, 415)
  assert.equal((await batch(images[0].subarray(0, 100))).status, 400)
  assert.equal((await check()).missing.length, 2)
  assert.equal((await batch(Buffer.concat([bytes(images[0].length, 1), images[1]]))).status, 400)
  assert.equal((await check()).missing.length, 2)
  const { gzipSync } = await import('node:zlib')
  assert.equal((await batch(gzipSync(Buffer.concat(images)), 'gzip')).status, 200)
  assert.deepEqual((await check()).missing, [])
  assert.equal((await batch(Buffer.concat(images))).status, 200)
  assert.equal((await commit()).status, 201)
  assert.equal((await commit()).status, 201)
  assert.equal(commits, 1)
  const files = await unzip(archive!)
  images.forEach((image, i) => assert.deepEqual(files.get(`${refs[i].sop_instance_uid}.dcm`), image))
  for (const image of images) {
    const data = dcmjs.data.DicomMessage.readFile(Uint8Array.from(image).buffer)
    const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(data.dict)
    assert.equal(dataset.StudyInstanceUID, body.study_instance_uid)
    assert.equal(dataset.PatientID, 'SYNTHETIC')
  }
  assert.match(files.get('patient_meta.json')!.toString(), /SYNTHETIC/)
})
