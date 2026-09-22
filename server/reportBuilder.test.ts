import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRadiologyReport, buildRadiologyReportHtml, filterReportText, replaceReportPlaceholders } from './reportBuilder'

test('buildRadiologyReportHtml merges successful sources without raw JSON', () => {
  const html = buildRadiologyReportHtml('X-Ray AI report', [
    { exam_type: 'Chest radiograph', findings: ['No focal opacity'], confidence: 0.91 },
    { classification: 'Normal', impression: 'No acute abnormality' },
  ])

  assert.match(html, /Patient ID/)
  assert.match(html, /OBSERVATION:/)
  assert.match(html, /Chest radiograph/)
  assert.match(html, /No focal opacity/)
  assert.match(html, /No acute abnormality/)
  assert.doesNotMatch(html, /"exam_type"/)
})

test('filterReportText removes generic CT placeholder language', () => {
  const text = filterReportText('Volumetric candidate pathology regions... adaptive subtle-finding review... Mild atelectasis.')
  assert.equal(text, '... ... Mild atelectasis.')
})

test('buildRadiologyReport exposes editable structured sections', () => {
  const report = buildRadiologyReport('X-Ray AI report', [
    { findings: 'Clear lungs', systematic_sweep: 'Cardiomediastinal silhouette is normal', recommendation: 'Routine follow-up' },
    { impression: 'No acute cardiopulmonary abnormality' },
  ])

  assert.equal(report.sections.findings, 'Clear lungs')
  assert.equal(report.sections.systematicSweep, 'Cardiomediastinal silhouette is normal')
  assert.equal(report.sections.impression, 'No acute cardiopulmonary abnormality')
  assert.match(report.html, /OBSERVATION:/)
  assert.match(report.html, /IMPRESSION: -/)
})

test('buildRadiologyReport handles skeletal individual_reports response', () => {
  const report = buildRadiologyReport('X-Ray AI report', [
    {
      individual_reports: [
        {
          filename: 'DEEPAK.jpg.jpeg',
          exam_type: 'Knee X-Ray',
          findings: 'No fracture.',
          impression: 'No acute osseous abnormality.',
          recommendation: 'Clinical follow-up.',
        },
      ],
    },
  ])

  assert.equal(report.sections.examType, 'Knee X-Ray')
  assert.equal(report.sections.findings, 'No fracture.')
  assert.equal(report.sections.impression, 'No acute osseous abnormality.')
  assert.match(report.html, /Knee X-Ray/)
  assert.match(report.html, /No fracture\./)
  assert.doesNotMatch(report.html, /individual_reports/)
})

test('buildRadiologyReport renders multiple accepted xray reports as master blocks', () => {
  const report = buildRadiologyReport('X-Ray AI report', [
    { __reportTitle: 'chest.png (chest)', exam_type: 'Chest radiograph', findings: 'Right upper lobe opacity.' },
    { __reportTitle: 'hand.png (skeletal)', exam_type: 'Hand radiograph', findings: 'Distal radius fracture.' },
  ])

  assert.match(report.html, /Patient ID/)
  assert.match(report.html, /class="report-card"/)
  assert.match(report.html, /Chest radiograph/)
  assert.match(report.html, /Hand radiograph/)
  assert.match(report.html, /Right upper lobe opacity\./)
  assert.match(report.html, /Distal radius fracture\./)
})

test('CT markdown reports render clinical content without an empty findings fallback', () => {
  const report = buildRadiologyReport('CT AI report', [{
    report_markdown: '## Technique\nContrast-enhanced CT chest.\n## Findings\nMild bibasal atelectasis.\n## Impression\nNo acute thoracic abnormality.',
  }])

  assert.match(report.html, /Contrast-enhanced CT chest\./)
  assert.match(report.html, /Mild bibasal atelectasis\./)
  assert.match(report.html, /No acute thoracic abnormality\./)
  assert.doesNotMatch(report.html, /No findings provided/i)
})

test('report placeholder replacement clears every supported patient placeholder', () => {
  const html = replaceReportPlaceholders('{{ patient_id }} {{ patient_name }} {{ patient_age }} {{ patient_sex }}', {
    patient_id: 'P-100', patient_name: 'Asha <Test>', patient_age: '42Y', patient_sex: 'F',
  })
  assert.equal(html, 'P-100 Asha &lt;Test&gt; 42Y F')
  assert.doesNotMatch(html, /\{\{/)
})
