import assert from 'node:assert/strict'
import test from 'node:test'
import { AUTO_REPORTING_DELAY_MS, autoReportingCountdown, autoReportingDelayMs, autoReportingEnabled, autoReportingModality } from '../src/autoReporting'
import { formatBridgeStudyForClient } from './lib/bridgeStudyFormat'
import { worklistTatStart } from '../src/pacsWorklist'

test('each center independently controls each modality and all-off disables automatic reporting', () => {
  const ct = { modalities: ['CT'] }
  assert.equal(autoReportingEnabled(['CT'], ct), true)
  assert.equal(autoReportingEnabled(['XR'], ct), false)
  assert.equal(autoReportingEnabled([], ct), false)
  for (const modality of ['XR', 'CT', 'MR', 'MG', 'PT', 'US']) {
    assert.equal(autoReportingEnabled([modality], { modalities: [modality] }), true)
  }
})

test('DICOM aliases map to the center switches', () => {
  for (const modality of ['CR', 'DX', 'DR', 'XRAY']) assert.equal(autoReportingModality({ modalities: [modality] }), 'XR')
  assert.equal(autoReportingModality({ modalities: ['MRI'] }), 'MR')
  assert.equal(autoReportingModality({ modalities: ['USG'] }), 'US')
  assert.equal(autoReportingModality({ modalities: ['NM'] }), 'PT')
  assert.equal(autoReportingModality({ modalities: ['CT', 'PT'] }), 'PT')
  assert.equal(autoReportingEnabled(['XR'], { modalities: ['SR'] }), false)
})

test('special X-rays and mammograms do not inherit routine X-ray auto-send', () => {
  const special = { modalities: ['DX'], studyDescription: 'Barium swallow' }
  assert.equal(autoReportingEnabled(['XR'], special), false)
  assert.equal(autoReportingEnabled(['SPECIALXRAY'], special), true)
  assert.equal(autoReportingEnabled(['XR'], { modalities: ['MG', 'DX'] }), false)
  assert.equal(autoReportingEnabled(['MG'], { modalities: ['MG', 'DX'] }), true)
})

test('CXR studies skip the grace period without making every X-ray immediate', () => {
  assert.equal(autoReportingDelayMs({ modalities: ['DX'], studyDescription: 'CXR PA view' }), 0)
  assert.equal(autoReportingDelayMs({ modalities: ['CR'], studyDescription: 'X-Ray Chest AP' }), 0)
  assert.equal(autoReportingDelayMs({ modalities: ['DX'], studyDescription: 'X-Ray Knee' }), AUTO_REPORTING_DELAY_MS)
  assert.equal(autoReportingDelayMs({ modalities: ['CT'], studyDescription: 'CT Chest' }), AUTO_REPORTING_DELAY_MS)
  assert.equal(autoReportingDelayMs({ modalities: ['DX'], studyDescription: 'Barium swallow' }), AUTO_REPORTING_DELAY_MS)
})

test('five-minute countdown is stable across refreshes and never goes negative', () => {
  const start = Date.parse('2026-09-30T12:00:00Z')
  const due = new Date(start + AUTO_REPORTING_DELAY_MS).toISOString()
  assert.equal(autoReportingCountdown(due, start), 'Auto-send in 5:00')
  assert.equal(autoReportingCountdown(due, start + 61000), 'Auto-send in 3:59')
  assert.equal(autoReportingCountdown(due, start + 299999), 'Auto-send in 0:01')
  assert.equal(autoReportingCountdown(due, start + 300000), 'Auto-send pending')
  assert.equal(autoReportingCountdown(due, start + 600000), 'Auto-send pending')
})

test('study responses expose the deadline only before submission; reporting TAT excludes the grace period', () => {
  const now = new Date('2026-09-30T12:00:00Z')
  const study = {
    id: 'study', publicStudyId: 'public', agentId: 'agent', studyInstanceUid: 'uid',
    modalities: ['DX'], seriesCount: 1, instanceCount: 1, availabilityStatus: 'Available',
    workflowStatus: 'Available', lastSyncedAt: now, autoSubmitAt: new Date(now.getTime() + AUTO_REPORTING_DELAY_MS),
  }
  assert.equal(formatBridgeStudyForClient(study).autoSubmitAt, study.autoSubmitAt)
  assert.equal(worklistTatStart('AVAILABLE', null), null)
  const submittedAt = study.autoSubmitAt.toISOString()
  assert.equal(worklistTatStart('REPORTING', submittedAt), submittedAt)
  assert.equal(formatBridgeStudyForClient({ ...study, processingJobId: 'job' }).autoSubmitAt, null)
})
