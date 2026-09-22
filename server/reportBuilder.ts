export type ReportSource = Record<string, unknown>
export type BuiltRadiologyReport = {
  html: string
  sections: Record<string, string>
}

type BuildRadiologyReportOptions = {
  reportId?: string
  generatedAt?: Date
}

export const reportSectionLabels = [
  'Exam Type',
  'Image Quality',
  'Severity Score',
  'Classification',
  'Findings',
  'Technique',
  'Systematic Sweep',
  'Abnormality Candidates',
  'Comparison',
  'Impression',
  'Recommendation',
  'Critical Findings',
  'Measurements',
  'Confidence',
  'Disclaimer',
] as const

const sectionKeys: Record<(typeof reportSectionLabels)[number], string[]> = {
  'Exam Type': ['examType', 'exam_type', 'studyType', 'modality', 'exam'],
  'Image Quality': ['imageQuality', 'image_quality', 'quality'],
  'Severity Score': ['severityScore', 'severity_score', 'severity', 'score'],
  Classification: ['classification', 'class', 'prediction'],
  Findings: ['findings', 'finding', 'observations'],
  Technique: ['technique', 'method'],
  'Systematic Sweep': ['systematicSweep', 'systematic_sweep', 'sweep'],
  'Abnormality Candidates': ['abnormalityCandidates', 'abnormality_candidates', 'abnormalities', 'candidates'],
  Comparison: ['comparison', 'priorComparison', 'prior_comparison'],
  Impression: ['impression', 'summary'],
  Recommendation: ['recommendation', 'recommendations', 'nextSteps', 'next_steps'],
  'Critical Findings': ['criticalFindings', 'critical_findings', 'critical'],
  Measurements: ['measurements', 'measurement'],
  Confidence: ['confidence', 'confidenceScore', 'confidence_score'],
  Disclaimer: ['disclaimer'],
}

const filteredPhrases = [
  'Volumetric candidate pathology regions',
  'subtle-review slices',
  'Correlate with source images',
  'adaptive subtle-finding review',
]

export function buildRadiologyReport(title: string, sources: ReportSource[], options: BuildRadiologyReportOptions = {}): BuiltRadiologyReport {
  const generatedAt = options.generatedAt ?? new Date()
  const normalizedSources = sources.flatMap(normalizeReportSource)
  const sections = reportSectionLabels.map((label) => {
    const content = mergeSectionContent(label, normalizedSources)
    return { label, content: content || 'Not provided.' }
  })
  const sectionMap = Object.fromEntries(sections.map((section) => [toCamelCase(section.label), section.content]))
  const reportBlocks = normalizedSources.length
    ? normalizedSources.map((source, index) => renderReportCard(source, index, title))
    : [renderReportCard(Object.fromEntries(sections.map((section) => [toCamelCase(section.label), section.content])), 0, title)]

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>DecXpert AI-Assisted Radiology Report</title>
<style>
  :root { --ink:#111827; --muted:#4b5563; --line:#111827; --soft-line:#cbd5e1; }
  * { box-sizing:border-box; }
  body { margin:0; background:#f3f4f6; color:var(--ink); font-family:Arial, Helvetica, sans-serif; font-size:14px; line-height:1.45; }
  .page { width:794px; min-height:1123px; margin:24px auto; background:white; border:1px solid var(--soft-line); box-shadow:0 10px 30px rgba(15,23,42,.08); }
  .inner { padding:44px 54px 42px; }
  table { width:100%; border-collapse:collapse; margin:0 0 24px; }
  th, td { border:1px solid var(--line); padding:7px 9px; vertical-align:top; }
  th { width:18%; background:#fff; color:var(--ink); text-align:left; font-size:13px; font-weight:700; }
  td { width:32%; background:#fff; font-size:13px; font-weight:400; }
  .study-title { margin:20px 0 18px; text-align:center; font-size:16px; font-weight:700; letter-spacing:0; text-transform:uppercase; }
  .report-card { margin:0; background:#fff; }
  .ai-triage { margin:0 0 16px; color:var(--muted); font-size:12px; }
  .ai-triage span { display:inline-block; margin-right:18px; }
  h2 { margin:16px 0 8px; color:var(--ink); font-size:14px; font-weight:700; letter-spacing:0; text-transform:uppercase; }
  p { margin:0 0 9px; font-size:14px; line-height:1.5; }
  .section-body { margin-bottom:8px; }
  .finding-line strong { font-weight:700; }
  .impression-list { margin:0 0 10px 0; padding:0; list-style:none; counter-reset:item; }
  .impression-list li { margin:0 0 7px; padding-left:0; font-size:14px; line-height:1.5; counter-increment:item; }
  .impression-list li::before { content:counter(item) ". "; font-weight:400; }
  .footer-note { margin-top:26px; border-top:1px solid var(--soft-line); padding-top:10px; color:var(--muted); font-size:11px; line-height:1.35; }
  @media print { body { background:white; } .page { margin:0; box-shadow:none; border:none; width:auto; min-height:0; } }
</style>
</head>
<body>
  <main class="page">
    <div class="inner">
      <table class="patient-grid"><tbody>
        <tr><th>Patient ID</th><td>{{ patient_id }}</td><th>Age/Sex</th><td>{{ patient_age }}/{{ patient_sex }}</td></tr>
        <tr><th>Patient Name</th><td>{{ patient_name }}</td><th>Reported Date</th><td>${escapeHtml(formatReportDate(generatedAt))}</td></tr>
        <tr><th>Encounter No.</th><td>{{ encounter_no }}</td><th>Bill Date</th><td>{{ bill_date }}</td></tr>
        <tr><th>Admission Type</th><td>{{ admission_type }}</td><th>Accession No.</th><td>{{ accession }}</td></tr>
      </tbody></table>
      ${reportBlocks.join('\n')}
      <div class="footer-note">This report was generated using DecXpert AI-assisted radiology analysis software developed by Dectrocel Healthcare and Research. The output is intended for clinical workflow assistance only and must be reviewed, interpreted, and validated by a qualified radiologist or licensed medical practitioner prior to clinical use. AI-generated findings should always be correlated with patient history, examination findings, and additional investigations where appropriate.</div>
    </div>
  </main>
</body>
</html>`

  return { html, sections: sectionMap }
}

export function buildRadiologyReportHtml(title: string, sources: ReportSource[], options: BuildRadiologyReportOptions = {}) {
  return buildRadiologyReport(title, sources, options).html
}

export function replaceReportPlaceholders(html: string, values: Record<string, string | undefined>) {
  return html.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_placeholder, key: string) => escapeHtml(values[key.toLowerCase()] ?? ''))
}

export function filterReportText(value: unknown) {
  const text = stringifyReportValue(value)
  return filteredPhrases.reduce((current, phrase) => current.replaceAll(phrase, ''), text).replace(/\s{2,}/g, ' ').trim()
}

function mergeSectionContent(label: (typeof reportSectionLabels)[number], sources: ReportSource[]) {
  const values = sources
    .map((source) => extractByKeys(source, sectionKeys[label]))
    .map(filterReportText)
    .filter(Boolean)

  return Array.from(new Set(values)).join('\n')
}

function normalizeReportSource(source: ReportSource): ReportSource[] {
  const reportTitle = stringifyReportValue(source.__reportTitle)
  const markdown = extractMarkdown(source)
  if (markdown) return [{ ...source, ...parseClinicalMarkdown(markdown), __reportTitle: reportTitle || stringifyReportValue(source.title) }]
  if (!Array.isArray(source.individual_reports)) return [source]

  return source.individual_reports
    .filter((item): item is ReportSource => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .map((report, index) => {
      const filename = stringifyReportValue(report.filename) || reportTitle || `Report ${index + 1}`
      return {
        __reportTitle: filename,
        exam_type: report.exam_type,
        findings: report.findings,
        impression: report.impression,
        recommendation: report.recommendation,
        image_quality: report.image_quality,
        severity_score: report.severity_score,
        classification: report.classification,
        systematic_sweep: report.systematic_sweep,
        abnormality_candidates: report.abnormality_candidates,
        comparison: report.comparison,
        confidence: report.confidence,
        disclaimer: report.disclaimer,
      }
    })
}

function extractMarkdown(source: ReportSource) {
  for (const key of ['report_markdown', 'reportMarkdown', 'markdown']) {
    const value = source[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}

/** Turns common upstream clinical markdown into the same structured fields used by JSON APIs. */
export function parseClinicalMarkdown(markdown: string): ReportSource {
  const result: ReportSource = {}
  let current: string | null = null
  const keyForHeading = (heading: string) => {
    const normalized = heading.toLowerCase().replace(/[^a-z]+/g, ' ').trim()
    if (normalized.includes('technique')) return 'technique'
    if (normalized.includes('finding') || normalized.includes('observation')) return 'findings'
    if (normalized.includes('impression') || normalized.includes('conclusion')) return 'impression'
    if (normalized.includes('recommend')) return 'recommendation'
    if (normalized.includes('critical')) return 'critical_findings'
    if (normalized.includes('measurement')) return 'measurements'
    if (normalized.includes('disclaimer')) return 'disclaimer'
    return null
  }
  for (const rawLine of markdown.replace(/\r/g, '').split('\n')) {
    const heading = rawLine.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/) ?? rawLine.match(/^\s*([A-Za-z][A-Za-z /-]{2,40}):\s*$/)
    if (heading) { current = keyForHeading(heading[1]); continue }
    if (!current || !rawLine.trim()) continue
    const previous = typeof result[current] === 'string' ? result[current] : ''
    result[current] = `${previous}${previous ? '\n' : ''}${rawLine.trim()}`
  }
  // Some APIs provide prose without headings; it is still valid clinical content.
  if (!Object.keys(result).length && markdown.trim()) result.findings = markdown.trim()
  return result
}

function extractByKeys(source: ReportSource, keys: string[]): unknown {
  for (const key of keys) {
    const value = findValue(source, key.toLowerCase())
    if (value !== undefined && value !== null && stringifyReportValue(value).trim()) return value
  }
  return undefined
}

function findValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findValue(item, key)
      if (found !== undefined) return found
    }
    return undefined
  }

  for (const [candidateKey, candidateValue] of Object.entries(value as Record<string, unknown>)) {
    if (candidateKey.toLowerCase() === key) return candidateValue
    const found = findValue(candidateValue, key)
    if (found !== undefined) return found
  }
  return undefined
}

function stringifyReportValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(stringifyReportValue).filter(Boolean).join('\n')
  return Object.values(value as Record<string, unknown>).map(stringifyReportValue).filter(Boolean).join('\n')
}

function renderReportCard(source: ReportSource, index: number, title: string) {
  const reportTitle = stringifyReportValue(source.__reportTitle) || stringifyReportValue(extractByKeys(source, ['filename', 'fileName', 'uploadName'])) || `${title} ${index + 1}`
  const examType = filterReportText(extractByKeys(source, sectionKeys['Exam Type'])) || reportTitle
  const classification = filterReportText(extractByKeys(source, sectionKeys.Classification))
  const imageQuality = filterReportText(extractByKeys(source, sectionKeys['Image Quality']))
  const severityScore = filterReportText(extractByKeys(source, sectionKeys['Severity Score']))
  const findings = filterReportText(extractByKeys(source, sectionKeys.Findings))
  const sweep = filterReportText(extractByKeys(source, sectionKeys['Systematic Sweep']))
  const candidates = filterReportText(extractByKeys(source, sectionKeys['Abnormality Candidates']))
  const comparison = filterReportText(extractByKeys(source, sectionKeys.Comparison))
  const impression = filterReportText(extractByKeys(source, sectionKeys.Impression))
  const recommendation = filterReportText(extractByKeys(source, sectionKeys.Recommendation))
  const confidence = filterReportText(extractByKeys(source, sectionKeys.Confidence))
  const disclaimer = filterReportText(extractByKeys(source, sectionKeys.Disclaimer))

  return `<section class="report-card">
<div class="study-title">${escapeHtml(examType)}</div>
${renderAiTriage(classification, severityScore, confidence)}
${imageQuality ? renderContentSection('Image Quality', imageQuality) : ''}
${findings ? renderContentSection('Findings', findings) : ''}
${filterReportText(extractByKeys(source, sectionKeys.Technique)) ? renderContentSection('Technique', filterReportText(extractByKeys(source, sectionKeys.Technique))) : ''}
${sweep ? renderContentSection('Systematic Sweep', sweep) : ''}
${candidates ? renderContentSection('Abnormality Candidates', candidates) : ''}
${comparison ? renderContentSection('Comparison', comparison) : ''}
${impression ? renderContentSection('Impression', impression) : ''}
${recommendation ? renderContentSection('Recommendation', recommendation) : ''}
${filterReportText(extractByKeys(source, sectionKeys['Critical Findings'])) ? renderContentSection('Critical Findings', filterReportText(extractByKeys(source, sectionKeys['Critical Findings']))) : ''}
${filterReportText(extractByKeys(source, sectionKeys.Measurements)) ? renderContentSection('Measurements', filterReportText(extractByKeys(source, sectionKeys.Measurements))) : ''}
${disclaimer ? renderContentSection('Disclaimer', disclaimer) : ''}
</section>`
}

function renderContentSection(label: string, content: string) {
  return `<h2 data-section="${escapeHtml(label)}">${escapeHtml(displaySectionHeading(label))}</h2>
<div class="section-body">${formatSection(label, content)}</div>`
}

function renderAiTriage(classification: string, severityScore: string, confidence: string) {
  const items = [
    classification ? `<span><strong>Classification:</strong> ${escapeHtml(classification)}</span>` : '',
    severityScore ? `<span><strong>Severity Score:</strong> ${escapeHtml(severityScore)}</span>` : '',
    confidence ? `<span><strong>Confidence:</strong> ${escapeHtml(confidence)}</span>` : '',
  ].filter(Boolean)
  return items.length ? `<div class="ai-triage" data-section="AI Triage">${items.join('')}</div>` : ''
}

function formatSection(label: string, content: string) {
  const lines = content.split('\n').map((line) => line.trim()).filter(Boolean)
  if (label === 'Findings' || label === 'Systematic Sweep' || label === 'Abnormality Candidates') {
    return lines.map((line) => `<p class="finding-line">${formatFindingLine(line)}</p>`).join('')
  }
  if (label === 'Impression') {
    return `<ol class="impression-list">${lines.map((line) => `<li>${escapeHtml(stripListMarker(line))}</li>`).join('')}</ol>`
  }
  if (lines.length > 1) return lines.map((line) => `<p>${escapeHtml(stripListMarker(line))}</p>`).join('')
  return `<p>${escapeHtml(lines[0] ?? '')}</p>`
}

function formatFindingLine(line: string) {
  const match = line.match(/^([^:]{2,48}):\s*(.+)$/)
  if (!match) return escapeHtml(line)
  return `<strong>${escapeHtml(match[1])}:</strong> ${escapeHtml(match[2])}`
}

function displaySectionHeading(label: string) {
  if (label === 'Findings') return 'OBSERVATION:'
  if (label === 'Impression') return 'IMPRESSION: -'
  if (label === 'Recommendation') return 'Adv: -'
  return `${label}:`
}

function stripListMarker(line: string) {
  return line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
}

function formatReportDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function toCamelCase(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+(.)/g, (_match, character: string) => character.toUpperCase())
}
