export type ProviderStudySubmission = {
  dectrocelJobId: string
  studyInstanceUid?: string | null
  accessionNumber?: string | null
  patientId?: string | null
  modality?: string | null
  workflowType: 'AI_ONLY' | 'TELERADIOLOGY_ONLY' | 'AI_TELERADIOLOGY'
  priority?: string | null
  aiReportHtml?: string | null
  studyZipPath?: string | null
  metadata?: Record<string, unknown>
}

export type ProviderReport = {
  dectrocelJobId: string
  providerJobId: string
  status: string
  reportType: string
  reportFormat: string
  reportedAt: string
  reportVersion: number
  findings?: string
  impression?: string
  advice?: string
  urgencyStatus?: string
  radiologistName?: string
  radiologistQualification?: string
  radiologistRegistrationNumber?: string
  filePath?: string
  checksum?: string
  metadata?: Record<string, unknown>
}

export type ProviderSubmissionResult = {
  httpStatus?: number
  providerJobId: string
  providerStatus: string
  raw?: unknown
}

export class ProviderSubmissionError extends Error {
  constructor(public httpStatus: number, public responseBody: unknown) {
    super(`Provider submission rejected (HTTP ${httpStatus})`)
  }
}

export interface TeleradiologyProviderAdapter {
  submitStudy(input: ProviderStudySubmission): Promise<ProviderSubmissionResult>
  getStudyStatus(providerJobId: string): Promise<{ providerStatus: string; raw?: unknown }>
  getReport(providerJobId: string): Promise<ProviderReport | null>
  cancelStudy(providerJobId: string, reason?: string): Promise<{ cancelled: boolean; raw?: unknown }>
  validateCallback(input: { headers: Record<string, string | string[] | undefined>; fields: Record<string, unknown>; body?: Buffer }): Promise<{ ok: boolean; reason?: string }>
  normalizeProviderStatus(status: string): string
  normalizeProviderReport(report: ProviderReport): ProviderReport
  testConnection(): Promise<{ ok: boolean; message: string }>
}

export class ManualRadiologistPortalAdapter implements TeleradiologyProviderAdapter {
  async submitStudy(input: ProviderStudySubmission): Promise<ProviderSubmissionResult> {
    return { providerJobId: input.dectrocelJobId, providerStatus: 'ASSIGNED_TO_RADIOLOGIST' }
  }

  async getStudyStatus(providerJobId: string) {
    return { providerStatus: 'ASSIGNED_TO_RADIOLOGIST', raw: { providerJobId } }
  }

  async getReport() {
    return null
  }

  async cancelStudy() {
    return { cancelled: true }
  }

  async validateCallback() {
    return { ok: true }
  }

  normalizeProviderStatus(status: string) {
    return status
  }

  normalizeProviderReport(report: ProviderReport) {
    return report
  }

  async testConnection() {
    return { ok: true, message: 'Manual radiologist portal adapter is available.' }
  }
}
