import { createLimiter } from './runtime/tasks';
const limitReportRendering = createLimiter(2);
import { findExecutable } from './platform/tools';
import { pngToBmp, renderTextBmp } from './platform/reportImages';
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import type { ReturnFormat } from '@prisma/client'
import { prisma } from './db'

const execFileAsync = promisify(execFile)
const pacsOutboxPath = path.resolve(process.cwd(), 'uploads', 'pacs-outbox')

type ReportForPacs = {
  id: string
  clientId: string
  serviceName: string
  patientName: string | null
  patientId: string | null
  studyUid: string | null
  accession: string | null
  modality?: string | null
  outputFormat: ReturnFormat
  aiReportJson?: unknown
  editedReportJson?: unknown
}

type DicomMetadata = {
  patientName?: string
  patientId?: string
  accession?: string
  patientSex?: string
  patientAge?: string
  patientBirthDate?: string
  studyInstanceUid?: string
  studyDate?: string
  studyTime?: string
  modality?: string
}

export type PacsDeliveryResult = {
  format: ReturnFormat
  dcmPath: string
  sourcePath: string
  peer: string
  port: number
  calledAeTitle: string
  callingAeTitle: string
  stdout: string
  stderr: string
  sentAt: string
}

export async function sendApprovedReportToPacs(input: { report: ReportForPacs; htmlReport: string; requestedFormat?: ReturnFormat; sourcePdfPath?: string | null }): Promise<PacsDeliveryResult> {
  const config = await findPacsDestination(input.report)
  if (!config) throw new Error(`No PACS destination is configured for ${input.report.serviceName}`)

  const format = toDicomReturnFormat(input.requestedFormat ?? config.returnFormat ?? input.report.outputFormat)
  if (!['DICOM_ENCAPSULATED_PDF', 'DICOM_SECONDARY_CAPTURE'].includes(format)) throw new Error(`${format} PACS send-back is not implemented yet.`)

  const workDir = path.join(pacsOutboxPath, input.report.id)
  await fs.mkdir(workDir, { recursive: true })
  const dcmPath = path.join(workDir, 'final-report.dcm')
  const sourcePath = format === 'DICOM_ENCAPSULATED_PDF' ? path.join(workDir, 'final-report.pdf') : path.join(workDir, 'final-report.bmp')
  if (format === 'DICOM_ENCAPSULATED_PDF') {
    if (input.sourcePdfPath) {
      await fs.copyFile(input.sourcePdfPath, sourcePath)
    } else {
      await renderHtmlReportPdf({ html: input.htmlReport, outputPath: sourcePath, workDir })
    }
    await createEncapsulatedPdfDicom({ sourcePath, dcmPath, report: input.report })
  } else {
    await renderHtmlReportBmp({ html: input.htmlReport, sourcePath, workDir, report: input.report })
    await createSecondaryCaptureDicom({ sourcePath, dcmPath, report: input.report })
  }

  const storescu = await findDcmtkTool('storescu.exe')
  const { stdout, stderr } = await storeDicom({
    storescu,
    dcmPath,
    peer: config.clientPacsIp,
    port: config.clientPacsPort,
    callingAeTitle: config.aeTitle,
    calledAeTitle: config.clientPacsAeTitle || 'ANY-SCP',
  })
  return {
    format,
    dcmPath,
    sourcePath,
    peer: config.clientPacsIp,
    port: config.clientPacsPort,
    calledAeTitle: config.clientPacsAeTitle,
    callingAeTitle: config.aeTitle,
    stdout: String(stdout ?? ''),
    stderr: String(stderr ?? ''),
    sentAt: new Date().toISOString(),
  }
}

async function findPacsDestination(report: ReportForPacs) {
  const configs = await prisma.pacsConfig.findMany({
    where: { clientId: report.clientId },
    include: { clientService: { include: { service: true } } },
  })
  if (!configs.length) return null
  const exact = configs.find((config) => config.clientService?.service?.name === report.serviceName)
  if (exact) return exact

  const serviceText = `${report.serviceName} ${report.modality ?? ''} ${report.aiReportJson ? JSON.stringify(report.aiReportJson).slice(0, 500) : ''}`.toLowerCase()
  const byService = configs.find((config) => {
    const name = config.clientService?.service?.name?.toLowerCase() ?? ''
    if (!name) return false
    if (serviceText.includes('x-ray') || serviceText.includes('xray') || serviceText.includes('xr')) return name.includes('x-ray') || name.includes('xray')
    if (serviceText.includes('mri') || serviceText.includes('mr ')) return name.includes('mri')
    if (serviceText.includes('ct')) return name.includes('ct')
    return false
  })
  if (byService) return byService

  return configs.find((config) => config.workflowType === 'TELERADIOLOGY_ONLY')
    ?? configs.find((config) => config.workflowType === 'AI_TELERADIOLOGY')
    ?? configs[0]
}

async function createEncapsulatedPdfDicom(input: { sourcePath: string; dcmPath: string; report: ReportForPacs }) {
  const pdf2dcm = await findDcmtkTool('pdf2dcm.exe')
  const title = `DecXpert Final Report ${input.report.id}`.slice(0, 64)
  const metadata = getReportDicomMetadata(input.report)
  const pdfArgs = [
    '+t', title,
    '+pn', toDicomPersonName(metadata.patientName),
    '+pi', sanitizeDicomText(metadata.patientId || input.report.id, 64),
    ...commonDicomKeys(input.report, metadata, title, 'DOC'),
    input.sourcePath,
    input.dcmPath,
  ]
  await execFileAsync(pdf2dcm, pdfArgs, { windowsHide: true, timeout: 120000 })
}

async function createSecondaryCaptureDicom(input: { sourcePath: string; dcmPath: string; report: ReportForPacs }) {
  const img2dcm = await findDcmtkTool('img2dcm.exe')
  const title = `DecXpert Final Report ${input.report.id}`.slice(0, 64)
  const metadata = getReportDicomMetadata(input.report)
  const args = [
    '-i', 'BMP',
    '-sc',
    ...commonDicomKeys(input.report, metadata, title, 'OT', true),
    input.sourcePath,
    input.dcmPath,
  ]
  await execFileAsync(img2dcm, args, { windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 * 4 })
}

async function storeDicom(input: { storescu: string; dcmPath: string; peer: string; port: number; callingAeTitle: string; calledAeTitle: string }) {
  const storeArgs = [
    '-v',
    '-aet', sanitizeAeTitle(input.callingAeTitle),
    '-aec', sanitizeAeTitle(input.calledAeTitle),
    '-to', '30',
    '-ta', '30',
    '-td', '120',
    input.peer,
    String(input.port),
    input.dcmPath,
  ]
  return execFileAsync(input.storescu, storeArgs, { windowsHide: true, timeout: 180000, maxBuffer: 1024 * 1024 * 4 })
}

async function renderReportBmp(input: { sourcePath: string; workDir: string; lines: string[]; report: ReportForPacs }) { await renderTextBmp(input.lines, input.sourcePath); }

async function renderHtmlReportBmpUnbounded(input: { html: string; sourcePath: string; workDir: string; report: ReportForPacs }) {
  const browser = await findHeadlessBrowser()
  if (!browser) {
    const reportLines = htmlToReportText(input.html, input.report).flatMap((line) => wrapText(line, 94))
    await renderReportBmp({ sourcePath: input.sourcePath, workDir: input.workDir, lines: reportLines, report: input.report })
    return
  }

  const htmlPath = path.join(input.workDir, 'final-report.html')
  const pngPath = path.join(input.workDir, 'final-report.png')
  const userDataDir = path.join(input.workDir, 'edge-screenshot-profile')
  await fs.writeFile(htmlPath, input.html, 'utf8')
  await fs.mkdir(userDataDir, { recursive: true })
  await fs.rm(input.sourcePath, { force: true })
  await fs.rm(pngPath, { force: true })

  try {
    const png = await captureHtmlScreenshot({ browser, htmlPath, userDataDir })
    await fs.writeFile(pngPath, png)
    await convertPngToBmp({ pngPath, bmpPath: input.sourcePath, workDir: input.workDir })
    const stats = await waitForFile(input.sourcePath, 5000)
    if (!stats?.size) throw new Error('Headless browser did not create a BMP')
  } catch {
    const fallbackRendered = await renderHtmlScreenshotWithCli({ browser, htmlPath, pngPath, bmpPath: input.sourcePath, userDataDir, workDir: input.workDir }).catch(() => false)
    if (fallbackRendered) return
    const reportLines = htmlToReportText(input.html, input.report).flatMap((line) => wrapText(line, 94))
    await renderReportBmp({ sourcePath: input.sourcePath, workDir: input.workDir, lines: reportLines, report: input.report })
  }
}

async function renderHtmlReportPdfUnbounded(input: { html: string; outputPath: string; workDir: string }) {
  const htmlPath = path.join(input.workDir, 'final-report.html')
  await fs.writeFile(htmlPath, input.html, 'utf8')
  const browser = await findHeadlessBrowser()
  if (!browser) {
    await fs.writeFile(input.outputPath, buildSimplePdfFromHtml(input.html), 'binary')
    return
  }
  const userDataDir = path.join(input.workDir, 'edge-profile')
  await fs.mkdir(userDataDir, { recursive: true })
  try {
    await fs.rm(input.outputPath, { force: true })
    await execFileAsync(browser, [
      '--headless',
      ...(process.env.CHROMIUM_NO_SANDBOX === 'true' ? ['--no-sandbox'] : []),
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--no-first-run',
      '--no-default-browser-check',
      '--no-pdf-header-footer',
      `--user-data-dir=${userDataDir}`,
      `--print-to-pdf=${input.outputPath}`,
      pathToFileURL(htmlPath).toString(),
    ], { windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 * 4 })
    const stats = await waitForFile(input.outputPath, 5000)
    if (!stats?.size) throw new Error('Headless browser did not create a PDF')
  } catch {
    await fs.writeFile(input.outputPath, buildSimplePdfFromHtml(input.html), 'binary')
  }
}

async function captureHtmlScreenshot(input: { browser: string; htmlPath: string; userDataDir: string }) {
  const browserProcess = spawn(input.browser, [
    '--headless',
      ...(process.env.CHROMIUM_NO_SANDBOX === 'true' ? ['--no-sandbox'] : []),
      '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    `--user-data-dir=${input.userDataDir}`,
    pathToFileURL(input.htmlPath).toString(),
  ], { windowsHide: true, stdio: 'ignore' })

  try {
    const port = await waitForDevToolsPort(input.userDataDir)
    const targets = await httpJson<Array<{ type?: string; url?: string; webSocketDebuggerUrl?: string }>>(`http://127.0.0.1:${port}/json/list`)
    const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl) ?? targets.find((target) => target.webSocketDebuggerUrl)
    if (!page?.webSocketDebuggerUrl) throw new Error('No browser page target was available')
    const cdp = await createCdpClient(page.webSocketDebuggerUrl)
    try {
      await cdp.send('Page.enable')
      await cdp.send('Runtime.enable')
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1240, height: 1754, deviceScaleFactor: 1, mobile: false })
      const loadPromise = waitForCdpEvent(cdp, 'Page.loadEventFired', 10000).catch(() => undefined)
      await cdp.send('Page.navigate', { url: pathToFileURL(input.htmlPath).toString() })
      await loadPromise
      await waitForDocumentReady(cdp)
      const metrics = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const body = document.body;
          const root = document.documentElement;
          return {
            width: Math.ceil(Math.max(root.scrollWidth, body ? body.scrollWidth : 0, 1240)),
            height: Math.ceil(Math.max(root.scrollHeight, body ? body.scrollHeight : 0, 1754))
          };
        })()`,
        returnByValue: true,
      }) as { result?: { value?: { width?: number; height?: number } } }
      const width = clampDimension(metrics.result?.value?.width, 1240)
      const height = clampDimension(metrics.result?.value?.height, 1754)
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
      const screenshot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width, height, scale: 1 },
      }) as { data?: string }
      if (!screenshot.data) throw new Error('Browser screenshot was empty')
      return Buffer.from(screenshot.data, 'base64')
    } finally {
      cdp.close()
    }
  } finally {
    browserProcess.kill()
  }
}

async function convertPngToBmp(input: { pngPath: string; bmpPath: string; workDir: string }) { await pngToBmp(input.pngPath, input.bmpPath); }

async function renderHtmlScreenshotWithCli(input: { browser: string; htmlPath: string; pngPath: string; bmpPath: string; userDataDir: string; workDir: string }) {
  await fs.rm(input.pngPath, { force: true })
  await execFileAsync(input.browser, [
    '--headless',
      ...(process.env.CHROMIUM_NO_SANDBOX === 'true' ? ['--no-sandbox'] : []),
      '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${input.userDataDir}-cli`,
    '--window-size=1240,4000',
    `--screenshot=${input.pngPath}`,
    pathToFileURL(input.htmlPath).toString(),
  ], { windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 * 4 })
  const pngStats = await waitForFile(input.pngPath, 5000)
  if (!pngStats?.size) return false
  await convertPngToBmp({ pngPath: input.pngPath, bmpPath: input.bmpPath, workDir: input.workDir })
  const bmpStats = await waitForFile(input.bmpPath, 5000)
  return Boolean(bmpStats?.size)
}

async function waitForFile(filePath: string, timeoutMs: number) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const stats = await fs.stat(filePath).catch(() => null)
    if (stats?.size) return stats
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  return null
}

async function waitForDevToolsPort(userDataDir: string) {
  const activePortPath = path.join(userDataDir, 'DevToolsActivePort')
  const started = Date.now()
  while (Date.now() - started < 15000) {
    const content = await fs.readFile(activePortPath, 'utf8').catch(() => '')
    const port = Number(content.split(/\r?\n/)[0])
    if (Number.isInteger(port) && port > 0) return port
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error('Headless browser did not expose a DevTools port')
}

async function httpJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Browser DevTools request failed: ${response.status}`)
  return response.json() as Promise<T>
}

type CdpClient = {
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>
  once: (method: string, timeoutMs: number) => Promise<unknown>
  close: () => void
}

async function createCdpClient(url: string): Promise<CdpClient> {
  const socket = new WebSocket(url)
  let messageId = 0
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  const listeners = new Map<string, Array<(params: unknown) => void>>()

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out opening browser DevTools socket')), 10000)
    socket.addEventListener('open', () => {
      clearTimeout(timeout)
      resolve()
    }, { once: true })
    socket.addEventListener('error', () => {
      clearTimeout(timeout)
      reject(new Error('Unable to open browser DevTools socket'))
    }, { once: true })
  })

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as { id?: number; method?: string; params?: unknown; result?: unknown; error?: { message?: string } }
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id)!
      pending.delete(message.id)
      if (message.error) request.reject(new Error(message.error.message || 'Browser DevTools command failed'))
      else request.resolve(message.result)
      return
    }
    if (message.method) {
      const callbacks = listeners.get(message.method) ?? []
      listeners.delete(message.method)
      callbacks.forEach((callback) => callback(message.params))
    }
  })

  return {
    send(method, params = {}) {
      const id = ++messageId
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
    once(method, timeoutMs) {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeoutMs)
        const callbacks = listeners.get(method) ?? []
        callbacks.push((params) => {
          clearTimeout(timeout)
          resolve(params)
        })
        listeners.set(method, callbacks)
      })
    },
    close() {
      socket.close()
      pending.forEach((request) => request.reject(new Error('Browser DevTools socket closed')))
      pending.clear()
    },
  }
}

function waitForCdpEvent(cdp: CdpClient, method: string, timeoutMs: number) {
  return cdp.once(method, timeoutMs)
}

async function waitForDocumentReady(cdp: CdpClient) {
  const started = Date.now()
  while (Date.now() - started < 10000) {
    const result = await cdp.send('Runtime.evaluate', {
      expression: 'document.readyState',
      returnByValue: true,
    }) as { result?: { value?: string } }
    if (result.result?.value === 'interactive' || result.result?.value === 'complete') return
    await Promise.race([
      waitForCdpEvent(cdp, 'Page.loadEventFired', 1000),
      new Promise((resolve) => setTimeout(resolve, 250)),
    ]).catch(() => undefined)
  }
}

function clampDimension(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value) || !value) return fallback
  return Math.min(Math.max(Math.ceil(value), fallback), 12000)
}

async function findHeadlessBrowser() { return findExecutable(process.env.CHROMIUM_PATH || 'chromium'); }

async function findDcmtkTool(fileName: string) { const found = await findExecutable(fileName); if (!found) throw new Error(fileName + ' was not found'); return found; }

function buildSimplePdfFromHtml(html: string) {
  const text = htmlToPlainText(html)
  const wrappedLines = text.flatMap((line) => wrapText(line, 94))
  const pages = chunk(wrappedLines.length ? wrappedLines : ['DecXpert final report'], 48)
  const objects: string[] = []
  objects.push('<< /Type /Catalog /Pages 2 0 R >>')
  objects.push(`<< /Type /Pages /Kids [${pages.map((_, index) => `${3 + index * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`)
  for (const [index, lines] of pages.entries()) {
    const pageObject = 3 + index * 2
    const contentObject = pageObject + 1
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> /F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> >> >> /Contents ${contentObject} 0 R >>`)
    const content = [
      'BT',
      '/F2 16 Tf',
      '50 748 Td',
      `(${escapePdfString(index === 0 ? 'DecXpert AI-Assisted Radiology Report' : 'DecXpert Report')}) Tj`,
      '0 -18 Td',
      '/F1 10 Tf',
      '14 TL',
      ...lines.map((line) => `(${escapePdfString(line)}) Tj T*`),
      'ET',
    ].join('\n')
    objects.push(`<< /Length ${Buffer.byteLength(content, 'binary')} >>\nstream\n${content}\nendstream`)
  }

  const header = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'
  const parts = [header]
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(parts.join(''), 'binary'))
    parts.push(`${index + 1} 0 obj\n${object}\nendobj\n`)
  }
  const xrefOffset = Buffer.byteLength(parts.join(''), 'binary')
  parts.push(`xref\n0 ${objects.length + 1}\n`)
  parts.push('0000000000 65535 f \n')
  for (let index = 1; index < offsets.length; index += 1) parts.push(`${String(offsets[index]).padStart(10, '0')} 00000 n \n`)
  parts.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`)
  return parts.join('')
}

function htmlToReportText(html: string, report: ReportForPacs) {
  const metadata = getReportDicomMetadata(report)
  const header = [
    `Report ID: ${report.id}`,
    `Patient: ${metadata.patientName || '-'} (${metadata.patientId || '-'})`,
    `Study UID: ${metadata.studyInstanceUid || '-'}`,
    `Service: ${report.serviceName}`,
    '',
  ]
  const body = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/(h1|h2|h3|p|div|tr|li|section|table)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<t[dh][^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&bull;/gi, '-')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  return [...header, ...body]
}

function htmlToPlainText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/(h1|h2|h3|p|div|tr|li|section|table)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<t[dh][^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&bull;/gi, '-')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function commonDicomKeys(report: ReportForPacs, metadata: DicomMetadata, title: string, outputModality: string, includePatientKeys = false) {
  const keys: string[] = []
  if (includePatientKeys) {
    keys.push('-k', `0010,0010=${toDicomPersonName(metadata.patientName)}`)
    keys.push('-k', `0010,0020=${sanitizeDicomText(metadata.patientId || report.id, 64)}`)
  }
  keys.push('-k', `0008,0050=${sanitizeDicomText(metadata.accession || report.id, 64)}`)
  keys.push('-k', `0008,0060=${sanitizeDicomText(outputModality, 16)}`)
  keys.push('-k', `0008,1030=${sanitizeDicomText(report.serviceName, 64)}`)
  keys.push('-k', `0008,103E=${sanitizeDicomText(title, 64)}`)
  keys.push('-k', `0020,0010=${sanitizeDicomText(report.id, 16)}`)
  if (metadata.patientSex) keys.push('-k', `0010,0040=${sanitizeDicomText(metadata.patientSex, 16)}`)
  if (metadata.patientAge) keys.push('-k', `0010,1010=${sanitizeDicomText(metadata.patientAge, 4)}`)
  if (isDicomDate(metadata.patientBirthDate)) keys.push('-k', `0010,0030=${metadata.patientBirthDate}`)
  if (isDicomDate(metadata.studyDate)) keys.push('-k', `0008,0020=${metadata.studyDate}`)
  if (isDicomTime(metadata.studyTime)) keys.push('-k', `0008,0030=${metadata.studyTime}`)
  if (isDicomUid(metadata.studyInstanceUid)) keys.push('-k', `0020,000D=${metadata.studyInstanceUid}`)
  return keys
}

function getReportDicomMetadata(report: ReportForPacs): DicomMetadata {
  const jsonMetadata = {
    ...extractDicomMetadataFromJson(report.aiReportJson),
    ...extractDicomMetadataFromJson(report.editedReportJson),
  }
  return {
    ...jsonMetadata,
    patientName: jsonMetadata.patientName ?? report.patientName ?? undefined,
    patientId: jsonMetadata.patientId ?? report.patientId ?? undefined,
    accession: jsonMetadata.accession ?? report.accession ?? undefined,
    studyInstanceUid: jsonMetadata.studyInstanceUid ?? report.studyUid ?? undefined,
    modality: jsonMetadata.modality ?? report.modality ?? undefined,
  }
}

function extractDicomMetadataFromJson(value: unknown): DicomMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const metadata = (value as Record<string, unknown>).dicomMetadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {}
  const source = metadata as Record<string, unknown>
  return {
    patientName: getString(source.patientName),
    patientId: getString(source.patientId),
    accession: getString(source.accession),
    patientSex: getString(source.patientSex),
    patientAge: getString(source.patientAge),
    patientBirthDate: getString(source.patientBirthDate),
    studyInstanceUid: getString(source.studyInstanceUid),
    studyDate: getString(source.studyDate),
    studyTime: getString(source.studyTime),
    modality: getString(source.modality),
  }
}

function getString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function wrapText(line: string, width: number) {
  if (!line) return ['']
  const words = line.split(/\s+/)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if ((current ? current.length + 1 : 0) + word.length <= width) {
      current = current ? `${current} ${word}` : word
    } else {
      if (current) lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines
}

function chunk<T>(items: T[], size: number) {
  const pages: T[][] = []
  for (let index = 0; index < items.length; index += size) pages.push(items.slice(index, index + size))
  return pages.length ? pages : [[]]
}

function escapePdfString(value: string) {
  return value.replace(/[\\()]/g, (match) => `\\${match}`).split('').map((char) => {
    const code = char.charCodeAt(0)
    return code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126) ? char : '?'
  }).join('')
}

function toDicomPersonName(value: string | null) {
  return sanitizeDicomText((value || 'Unknown').replace(/\s+/g, '^'), 64)
}

function sanitizeDicomText(value: string, maxLength: number) {
  return value.replace(/[^\x20-\x7E]/g, ' ').replace(/[\\"]/g, '').trim().slice(0, maxLength) || 'UNKNOWN'
}

function sanitizeAeTitle(value: string) {
  return sanitizeDicomText(value || 'ANY-SCP', 16).replace(/\s+/g, '_')
}

function toDicomReturnFormat(format: ReturnFormat): Extract<ReturnFormat, 'DICOM_ENCAPSULATED_PDF' | 'DICOM_SECONDARY_CAPTURE'> {
  return format === 'DICOM_SECONDARY_CAPTURE' ? 'DICOM_SECONDARY_CAPTURE' : 'DICOM_ENCAPSULATED_PDF'
}

function isDicomUid(value: string | null) {
  return Boolean(value && /^[0-9]+(\.[0-9]+)*$/.test(value) && value.length <= 64)
}

function isDicomDate(value: string | undefined) {
  return Boolean(value && /^\d{8}$/.test(value))
}

function isDicomTime(value: string | undefined) {
  return Boolean(value && /^\d{2}(\d{2}(\d{2}(\.\d{1,6})?)?)?$/.test(value))
}

export function renderHtmlReportPdf(input: Parameters<typeof renderHtmlReportPdfUnbounded>[0]) { return limitReportRendering(() => renderHtmlReportPdfUnbounded(input)); }
function renderHtmlReportBmp(input: Parameters<typeof renderHtmlReportBmpUnbounded>[0]) { return limitReportRendering(() => renderHtmlReportBmpUnbounded(input)); }
