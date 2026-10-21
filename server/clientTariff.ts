import type { Prisma } from '@prisma/client'

export type TariffRow = { key: string; modality: string; bodyPart: string; studies: string; rateMinor: number; unit: string; chargeType: string }
export type ClientTariff = { version: 1; sourceSha256: string; reportedOnly: true; xrayViewSource?: 'IMAGE_COUNT'; rows: TariffRow[] }
export type TariffDecision = { status: 'UNINVOICED' | 'PENDING_REPORT' | 'PRICING_REVIEW'; units: number; unitPriceMinor: number; amountMinor: number; currency: string; reason: string; breakdown: Array<{ key: string; units: number; rateMinor: number }> }
export const editableBillingStatuses = ['UNINVOICED', 'PENDING_REPORT', 'PRICING_REVIEW']
export const tariffSettingKey = (clientId: string) => `client_billing_tariff:${clientId}`
const normal = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
export const isReported = (status?: string | null) => ['APPROVED', 'PUSHED', 'REPORTED'].includes((status ?? '').toUpperCase())

export function parseClientTariff(value: unknown): ClientTariff {
  const c = value as ClientTariff
  if (c?.version !== 1 || c.reportedOnly !== true || !Array.isArray(c.rows) || !c.rows.length || !c.sourceSha256) throw new Error('Invalid client tariff configuration')
  const keys = new Set<string>()
  for (const r of c.rows) {
    if (!r.key || keys.has(r.key) || !Number.isSafeInteger(r.rateMinor) || r.rateMinor < 0 || !r.modality || !r.unit || !r.chargeType) throw new Error('Invalid or duplicate client tariff row')
    keys.add(r.key)
  }
  return c
}

export function descriptionViews(description: string): number | null {
  const d = description.toLowerCase()
  const words: Record<string, number> = { one: 1, single: 1, two: 2, three: 3, four: 4 }
  const counts = [...d.matchAll(/\b(\d+|one|single|two|three|four)[ -]?views?\b/g)].map(m => words[m[1]] ?? Number(m[1]))
  if (counts.length) return counts.every(n => n === counts[0]) && counts[0] > 0 ? counts[0] : null
  // A description containing an unspecified combination is not a verified quantity.
  if (/\b(?:ap|pa)\s*(?:and|&|\+)\s*(?:lat(?:eral)?|lt)\b/.test(d)) return 2
  if (/[+&]|\band\b|\bboth\b|\bbilateral\b|\bb\s*\/\s*l\b/.test(d)) return null
  const views = new Set([...d.matchAll(/\b(ap|pa|lateral|lat|oblique|skyline|merchant|frog|flexion|extension)\b/g)].map(m => m[1] === 'lat' ? 'lateral' : m[1]))
  return views.size === 1 ? 1 : null
}

export function priceReportedStudy(config: ClientTariff, input: { reportStatus?: string | null; description: string; modalities: string[]; serviceName: string; imageCount?: number | null }): TariffDecision {
  const hold = (reason: string, status: TariffDecision['status'] = 'PRICING_REVIEW'): TariffDecision => ({ status, units: 1, unitPriceMinor: 0, amountMinor: 0, currency: 'INR', reason, breakdown: [] })
  if (!isReported(input.reportStatus)) return hold('Excluded: study is not Reported (approved/pushed).', 'PENDING_REPORT')
  const configRows = config.rows
  const find = (modality: string, bodyPart: string, unit?: string) => configRows.find(r => r.modality === modality && r.bodyPart === bodyPart && (!unit || r.unit === unit))
  const charge = (parts: Array<{ row: TariffRow | undefined; units: number }>, reason: string): TariffDecision => {
    if (parts.some(p => !p.row || !Number.isSafeInteger(p.units) || p.units <= 0)) return hold('Missing tariff rate or verified quantity.')
    const breakdown = parts.map(p => ({ key: p.row!.key, units: p.units, rateMinor: p.row!.rateMinor }))
    const amount = breakdown.reduce((s, p) => s + p.units * p.rateMinor, 0)
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 2147483647) return hold('Invalid calculated amount.')
    // One complete study per billing line; breakdown preserves per-view/per-side rates.
    return { status: 'UNINVOICED', units: 1, unitPriceMinor: amount, amountMinor: amount, currency: 'INR', reason, breakdown }
  }
  const d = normal(input.description)
  const modalities = input.modalities.map(m => m.toUpperCase())
  const xr = modalities.some(m => ['CR', 'DX', 'DR', 'XR', 'X-RAY', 'X RAY', 'MG'].includes(m))
  if (xr) {
    if (/\bmammo/.test(d)) {
      const sides = /\bbilateral\b|\bboth\b|\bb l\b/.test(d) ? 2 : /\bleft\b|\bright\b|\bunilateral\b/.test(d) ? 1 : null
      return sides ? charge([{ row: find('X RAY', 'Special Study', 'Side'), units: sides }], `${sides} mammography side(s), explicitly described.`) : hold('Mammography side count is unspecified.')
    }
    const special = find('X RAY', 'Special Study', 'Study')
    if (special?.studies.split(',').some(s => new RegExp(`\\b${normal(s.trim())}\\b`).test(d))) return charge([{ row: special, units: 1 }], 'Special X-ray study tariff.')
    // A service assignment alone cannot establish modality, study type or view count.
    if (/mammo|special/i.test(input.serviceName)) return hold('Service assignment needs confirmation against the study description.')
    const useImages = config.xrayViewSource === 'IMAGE_COUNT'
    const views = useImages ? input.imageCount : descriptionViews(input.description)
    if (!views || !Number.isSafeInteger(views) || views < 1) return hold(useImages ? 'Missing or invalid image count; cannot calculate billable views.' : 'X-ray view count is not explicit.')
    return charge([{ row: find('X RAY', 'Radiography', 'First view'), units: 1 }, ...(views > 1 ? [{ row: find('X RAY', 'Radiography', 'Additional view'), units: views - 1 }] : [])], `1 first view + ${views - 1} additional view(s), from ${useImages ? 'image count (user-confirmed billing rule)' : 'description'}.`)
  }
  const modality = modalities.includes('CT') ? 'CT' : modalities.some(m => ['MR', 'MRI'].includes(m)) ? 'MRI' : modalities.some(m => ['NM', 'NMR', 'PT'].includes(m)) ? 'NMR' : ''
  if (!modality) return hold('No supported modality established for this study.')
  // Exact catalogue matches only: broad legacy service names can span different CSV rates.
  const stripped = d.replace(/^(?:ct|mri|mr|nmr|nm) /, '')
  const candidates = configRows.filter(r => r.modality === modality && r.chargeType === 'BASE' &&
    (normal(`${r.modality} ${r.bodyPart}`) === d || r.studies.split(',').some(s => normal(s) === stripped)))
  if (modality === 'MRI' && stripped === 'foot with ankle') return charge([{ row: find('MRI', 'Foot with Ankle'), units: 1 }], 'Dedicated MRI Foot with Ankle rate takes precedence over MSK.')
  if (candidates.length !== 1) return hold('Study requires an exact tariff classification, including any contrast, add-ons, extremity counts or protocol charges.')
  return charge([{ row: candidates[0], units: 1 }], `${modality} ${candidates[0].bodyPart}: exact tariff catalogue match.`)
}

type Db = Prisma.TransactionClient
export async function loadClientTariff(db: Db, clientId: string) {
  const setting = await db.systemSetting.findUnique({ where: { key: tariffSettingKey(clientId) } })
  return setting ? parseClientTariff(setting.value) : null
}

export async function resolveClientTariff(db: Db, input: { clientId: string; studyId?: string | null; processingJobId?: string | null; serviceName: string; studyUid?: string | null }, supplied?: ClientTariff) {
  const config = supplied ?? await loadClientTariff(db, input.clientId)
  if (!config) return null
  const study = await db.study.findFirst({ where: { clientId: input.clientId, ...(input.studyId ? { id: input.studyId } : { id: '__missing__' }) }, select: { studyUid: true } })
  const uid = study?.studyUid || input.studyUid
  const bridge = await db.availableBridgeStudy.findFirst({ where: { clientId: input.clientId, OR: [...(uid ? [{ studyInstanceUid: uid }] : []), ...(input.processingJobId ? [{ processingJobId: input.processingJobId }] : [])] }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], select: { studyInstanceUid: true, studyDescription: true, modalities: true, instanceCount: true } })
  const report = await db.reportReview.findFirst({ where: { clientId: input.clientId, OR: [...(uid || bridge?.studyInstanceUid ? [{ studyUid: uid || bridge!.studyInstanceUid }] : []), ...(input.studyId ? [{ studyId: input.studyId }] : [])] }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], select: { id: true, status: true } })
  const decision = priceReportedStudy(config, { reportStatus: report?.status, description: bridge?.studyDescription ?? '', modalities: bridge?.modalities ?? [], serviceName: input.serviceName, imageCount: bridge?.instanceCount })
  return { ...decision, sourceSha256: config.sourceSha256, reportReviewId: report?.id ?? null }
}

export function tariffTransactionData(decision: NonNullable<Awaited<ReturnType<typeof resolveClientTariff>>>, metadata: unknown) {
  return {
    units: decision.units, unitPriceMinor: decision.unitPriceMinor, amountMinor: decision.amountMinor,
    currency: decision.currency, status: decision.status,
    metadata: { ...(metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata as Record<string, Prisma.InputJsonValue> : {}),
      manualBilling: decision.status === 'PRICING_REVIEW', manualBillingReason: decision.status === 'UNINVOICED' ? null : decision.reason,
      clientTariff: { ...decision, calculationUnit: 'Complete study; see breakdown for per-view/per-side rates' } } as Prisma.InputJsonObject,
  }
}
