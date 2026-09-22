import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import yauzl from 'yauzl'
import yazl from 'yazl'
import { pipeline } from 'node:stream/promises'
import { aiServiceTypeForServiceType, cleanDicomZip, inferBridgeServiceType, prepareRenewistStudyZip, serviceMatchesBridgeInference, serviceNameForType, zipDirectory } from './uploadPipeline'

test('X-ray and CT Thorax service routes resolve to their dedicated AI pipelines', () => {
  assert.equal(serviceNameForType('xray'), 'X-ray Suite')
  assert.equal(aiServiceTypeForServiceType('xray'), 'xray')
  assert.equal(serviceNameForType('xray-chest'), 'X-Ray Chest')
  assert.equal(aiServiceTypeForServiceType('xray-chest'), 'xray')
  assert.equal(serviceNameForType('ct-thorax'), 'CT Thorax')
  assert.equal(aiServiceTypeForServiceType('ct-thorax'), 'ct-thorax')
})

test('bridge metadata distinguishes CT head and thorax from CT angiography', () => {
  assert.equal(inferBridgeServiceType({ modalities: ['CT'], studyDescription: 'CT Head (Plain)' }), 'ct-brain-pns-orbit')
  assert.equal(inferBridgeServiceType({ modalities: ['CT'], studyDescription: 'Chest -C HCT 5mm' }), 'ct-thorax')
  assert.equal(inferBridgeServiceType({ modalities: ['CT'], studyDescription: 'CT ABD&B/L L LIMB ANG' }), 'ct-angio-all-studies')
  assert.equal(serviceMatchesBridgeInference('ct-angio-all-studies', 'ct-brain-pns-orbit'), false)
  assert.equal(serviceMatchesBridgeInference('ct-brain-pns-orbit', 'ct-brain-pns-orbit'), true)
})

test('cleanDicomZip flattens DICOM entries and keeps extensionless DICM files only', async () => {
  const folder = await fsp.mkdtemp(path.join(os.tmpdir(), 'decxpert-ct-'))
  const source = path.join(folder, 'source.zip')
  const cleaned = path.join(folder, 'cleaned.zip')

  const dicomBytes = Buffer.concat([Buffer.alloc(128), Buffer.from('DICM'), Buffer.from('payload')])
  const zip = new yazl.ZipFile()
  zip.addBuffer(Buffer.from('not dicom'), 'notes.txt')
  zip.addBuffer(Buffer.from('dicom by extension'), 'nested/image.dcm')
  zip.addBuffer(dicomBytes, 'nested/extensionless')
  zip.addBuffer(dicomBytes, 'other/image.dcm')
  zip.end()
  await pipeline(zip.outputStream, fs.createWriteStream(source))

  const result = await cleanDicomZip(source, cleaned)
  const names = await listZipEntries(cleaned)

  assert.equal(result.dicomCount, 3)
  assert.deepEqual(names.sort(), ['extensionless.dcm', 'image-2.dcm', 'image.dcm'])
})

test('zipDirectory flattens DICOM files and adds .dcm before Renewist submission', async () => {
  const folder = await fsp.mkdtemp(path.join(os.tmpdir(), 'decxpert-pacs-folder-'))
  const sourceDir = path.join(folder, 'study')
  const nestedDir = path.join(sourceDir, 'series')
  const otherNestedDir = path.join(sourceDir, 'other-series')
  await fsp.mkdir(nestedDir, { recursive: true })
  await fsp.mkdir(otherNestedDir, { recursive: true })
  const destination = path.join(folder, 'study.zip')

  const dicomBytes = Buffer.concat([Buffer.alloc(128), Buffer.from('DICM'), Buffer.from('payload')])
  await fsp.writeFile(path.join(sourceDir, 'IMG0001'), dicomBytes)
  await fsp.writeFile(path.join(nestedDir, 'IMG0002.dcm'), dicomBytes)
  await fsp.writeFile(path.join(otherNestedDir, 'IMG0002.dcm'), dicomBytes)
  await fsp.writeFile(path.join(sourceDir, 'storescp.log'), 'receiver log')
  await fsp.writeFile(path.join(sourceDir, 'README'), 'not dicom')

  const result = await zipDirectory(sourceDir, destination)
  const names = await listZipEntries(destination)

  assert.equal(result.fileCount, 3)
  assert.deepEqual(names.sort(), ['IMG0001.dcm', 'IMG0002-2.dcm', 'IMG0002.dcm'])
})

test('prepareRenewistStudyZip sanitizes existing ZIP studies for Renewist submission', async () => {
  const folder = await fsp.mkdtemp(path.join(os.tmpdir(), 'decxpert-renewist-zip-'))
  const source = path.join(folder, 'source.zip')
  const dicomBytes = Buffer.concat([Buffer.alloc(128), Buffer.from('DICM'), Buffer.from('payload')])
  const zip = new yazl.ZipFile()
  zip.addBuffer(dicomBytes, 'series/IMG0001')
  zip.addBuffer(Buffer.from('clinical note'), 'notes.txt')
  zip.end()
  await pipeline(zip.outputStream, fs.createWriteStream(source))

  const result = await prepareRenewistStudyZip(source)
  const names = await listZipEntries(result.zipPath)

  assert.equal(path.basename(result.zipPath), 'source-renewist.zip')
  assert.equal(result.fileCount, 1)
  assert.deepEqual(names.sort(), ['series/IMG0001'])
})

test('prepareRenewistStudyZip wraps a single extensionless DICOM as a .dcm zip entry', async () => {
  const folder = await fsp.mkdtemp(path.join(os.tmpdir(), 'decxpert-renewist-single-'))
  const source = path.join(folder, 'IM000001')
  const dicomBytes = Buffer.concat([Buffer.alloc(128), Buffer.from('DICM'), Buffer.from('payload')])
  await fsp.writeFile(source, dicomBytes)

  const result = await prepareRenewistStudyZip(source)
  const names = await listZipEntries(result.zipPath)

  assert.equal(result.fileCount, 1)
  assert.deepEqual(names, ['IM000001.dcm'])
})

function listZipEntries(filePath: string) {
  return new Promise<string[]>((resolve, reject) => {
    const names: string[] = []
    yauzl.open(filePath, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) {
        reject(error)
        return
      }
      zip.readEntry()
      zip.on('entry', (entry) => {
        names.push(entry.fileName)
        zip.readEntry()
      })
      zip.on('end', () => resolve(names))
      zip.on('error', reject)
    })
  })
}
