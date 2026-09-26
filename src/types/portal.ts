import type { resolvePortalWorkspace } from "../portalAccess";
import type { PortalRole } from "../portalAccess";

export type UserRole = PortalRole;

export type ClientStatus = "ACTIVE" | "BLOCKED";

export type ServiceStatus = "ACTIVE" | "EXPIRED" | "REVOKED";

export type JobStatus = "QUEUED" | "PROCESSING" | "SUCCESS" | "FAILED";

export type ReturnFormat =
  | "DICOM_ENCAPSULATED_PDF"
  | "DICOM_SECONDARY_CAPTURE"
  | "HL7"
  | "HTML"
  | "PDF"
  | "DOCX";

export type WorkflowType = "AI_ONLY" | "TELERADIOLOGY_ONLY" | "AI_TELERADIOLOGY";

export type ReportReviewStatus =
  "PENDING" | "IN_REVIEW" | "SAVED" | "APPROVED" | "PUSHED" | "FAILED";

export type User = {
  id: string;
  userId?: string | null;
  name: string;
  email: string;
  role: UserRole;
  portalRole?: ClientPortalRole | null;
  clientId?: string | null;
  providerCode?: string | null;
  active?: boolean;
  lastGeneratedPassword?: string | null;
  createdAt?: string;
  deploymentFeatures?: {
    profile: "default" | "marengo";
    marengoMinimal: boolean;
    billing: boolean;
    calling: boolean;
    notifications: boolean;
    support: boolean;
    dashboardPollMs: number;
    availableStudiesPollMs: number;
  };
};

export type ClientPortalRole = "FRONT_DESK" | "TECHNICIAN" | "MANAGER" | "IT_TEAM";

export type Service = {
  id: string;
  name: string;
  code: string;
  category: string;
  description: string;
  enabled: boolean;
};

export type PacsConfig = {
  id: string;
  ec2PublicIp: string;
  receivingPort: number;
  aeTitle: string;
  urgentReceivingPort?: number | null;
  urgentAeTitle?: string | null;
  extraEndpoints?: Array<{
    id: string;
    receivingPort: number;
    aeTitle: string;
    priority: "REGULAR" | "URGENT";
    label?: string;
  }> | null;
  returnFormat: ReturnFormat;
  workflowType?: WorkflowType;
  teleradiologyProviderCode?: string | null;
  outsourceTeleradiology?: boolean;
  clientPacsIp?: string;
  clientPacsPort?: number;
  clientPacsAeTitle?: string;
};

export type StudySyncConfig = {
  enabled: boolean;
  centerCode?: string;
  clientId: string;
  clientName: string;
  authentication: {
    type: string;
    registration: string;
    headers: string[];
  };
  endpoints: Record<string, {
    method: string;
    url: string;
    contentType?: string;
    fileField?: string;
    maxFileSize?: string;
    note?: string;
    result?: string;
    body?: unknown;
  }>;
  dicomEndpoints: Array<{
    service: string;
    workflowType?: WorkflowType;
    portalReceive: {
      ip: string;
      port: number;
      aeTitle: string;
      urgentPort?: number | null;
      urgentAeTitle?: string | null;
    };
    reportPushTarget: {
      ip: string;
      port: number;
      aeTitle: string;
      format: ReturnFormat;
    };
  }>;
  directPacs?: {
    incoming: {
      ip: string;
      port: number;
      aeTitle: string;
    };
    outgoing: {
      ip: string;
      port: number;
      aeTitle: string;
      format: ReturnFormat;
    };
    services: string[];
  } | null;
  payloadNotes: Record<string, string>;
};

export type ClientService = {
  id: string;
  status: ServiceStatus;
  workflowType?: WorkflowType;
  credits: number;
  usedCredits: number;
  validUntil: string;
  service: Service;
  pacsConfig?: PacsConfig | null;
};

export type Client = {
  id: string;
  code: string;
  name: string;
  kind?: "GROUP" | "CENTER";
  hospitalSlug?: string | null;
  facilityType: string;
  primaryContact: string;
  email: string;
  billingDiscountPercent: number;
  studySyncEnabled?: boolean;
  demoModeEnabled?: boolean;
  demoStudyLimit?: number | null;
  status: ClientStatus;
  services: ClientService[];
  users?: User[];
  jobs?: Job[];
  usageLogs?: UsageLog[];
  reportSettings?: ReportSetting[];
  radiologists?: RadiologistProfile[];
  reportReviews?: ReportReview[];
  processingJobs?: ProcessingJob[];
  availableBridgeStudies?: BridgeStudy[];
  billing?: BillingSnapshot;
  organization?: {
    centers: Array<{
      id: string;
      code: string;
      name: string;
      status: ClientStatus;
      studySyncEnabled: boolean;
      services: number;
      studies: number;
      reports: number;
      tickets: number;
    }>;
    reports?: ReportReview[];
    radiologists?: RadiologistProfile[];
    processingJobs?: ProcessingJob[];
    bridgeStudies?: BridgeStudy[];
    totals: {
      centers: number;
      activeCenters: number;
      services: number;
      studies: number;
      reports: number;
      tickets: number;
    };
  };
  _count?: { processingJobs?: number };
};

export type BridgeStudy = {
  id: string;
  publicStudyId: string;
  agentId: string;
  agentName?: string | null;
  studyInstanceUid: string;
  patientId?: string | null;
  patientName?: string | null;
  patientSex?: string | null;
  patientAge?: string | null;
  accessionNumber?: string | null;
  studyDate?: string | null;
  studyTime?: string | null;
  studyDescription?: string | null;
  modalities: string[];
  seriesCount: number;
  instanceCount: number;
  totalSizeBytes?: string;
  localIp?: string | null;
  localPort?: number | null;
  localAeTitle?: string | null;
  archiveName?: string | null;
  clinicalIndication?: string | null;
  priority?: string | null;
  processingJobId?: string | null;
  status?: string;
  availabilityStatus: string;
  workflowStatus: string;
  lastSyncedAt: string;
  receivedAt?: string | null;
  referringPhysician?: string | null;
  selectedAt?: string | null;
  submittedAt?: string | null;
  updatedAt?: string;
  // Slim worklist rows carry the attachment count and the matching report instead of the full lists.
  attachmentCount?: number;
  report?: ReportSummary | null;
  attachments?: Array<{
    id: string;
    originalName: string;
    mimeType?: string | null;
    sizeBytes: string;
    createdAt: string;
  }>;
  processingJob?: {
    id: string;
    status: string;
    clinicalStatus?: string | null;
    completedAt?: string | null;
    priority?: string | null;
    error?: string | null;
  } | null;
  latestDispatch?: {
    requestId: string;
    status: string;
    progressPercentage: number;
    lastErrorMessage?: string | null;
  } | null;
  client?: Pick<Client, "id" | "name" | "code"> | null;
};

export type Job = {
  id: string;
  serviceName: string;
  status: JobStatus;
  attempts: number;
  error?: string | null;
  latencyMs?: number | null;
  createdAt: string;
  client?: Pick<Client, "name" | "code">;
  study?: { studyUid: string; modality: string } | null;
};

export type UsageLog = {
  id: string;
  serviceName: string;
  studyUid?: string | null;
  creditsUsed: number;
  success: boolean;
  message: string;
  createdAt: string;
  client?: Pick<Client, "name" | "code">;
};

export type ProcessingJob = {
  id: string;
  clientId?: string;
  serviceType: string;
  status: string;
  priority?: string | null;
  upstreamStatus: unknown;
  imageCount: number;
  uploadName: string;
  error?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  client?: Pick<Client, "name" | "code">;
  bridgeStudy?: {
    id?: string;
    patientId?: string | null;
    patientName?: string | null;
    patientSex?: string | null;
    patientAge?: string | null;
    studyDescription?: string | null;
    studyInstanceUid?: string | null;
    submittedAt?: string | null;
    modalities?: string[] | null;
    accessionNumber?: string | null;
    studyDate?: string | null;
    studyTime?: string | null;
    clinicalIndication?: string | null;
    seriesCount?: number;
    instanceCount?: number;
    institutionName?: string | null;
    referringPhysician?: string | null;
    attachments?: Array<{
      id: string;
      originalName: string;
      mimeType?: string | null;
      sizeBytes: string;
      createdAt: string;
    }>;
  } | null;
};

export type ReportSetting = {
  id: string;
  serviceName: string;
  dicomReturnFormat: ReturnFormat;
  outputFormat?: ReturnFormat;
  reportMode: "Comprehensive" | "Custom";
  radiologistReviewEnabled?: boolean;
  includeRadiologistSignature?: boolean;
  signatureDetailFields?: string[];
  enabledSections: string[];
};

export type RadiologistProfile = {
  id: string;
  clientId?: string | null;
  providerCode?: string | null;
  userId: string;
  fullName: string;
  email: string;
  phone?: string | null;
  qualification: string;
  medicalRegistrationNumber: string;
  organisationName: string;
  signatureImageUrl?: string | null;
  documentUrl?: string | null;
  documentName?: string | null;
  scope?: "MARENGO_GROUP" | "RENEWIST";
  active: boolean;
  user?: User;
  manager?: User | null;
  managerUserId?: string | null;
  reportReviews?: ReportReview[];
  callBookings?: ReportCallBooking[];
  availabilitySlots?: RadiologistAvailability[];
};

export type ReportReview = {
  includeViewer?: boolean;
  id: string;
  clientId: string;
  radiologistId?: string | null;
  serviceName: string;
  patientName?: string | null;
  patientId?: string | null;
  studyUid?: string | null;
  accession?: string | null;
  modality?: string | null;
  status: ReportReviewStatus;
  outputFormat: ReturnFormat;
  // Dashboard lists send only a summary of these (jsonPartial: true); load the full
  // report with `loadFullReport` / `useFullReport` before reading report text.
  aiReportJson?: Record<string, unknown>;
  editedReportJson?: Record<string, unknown>;
  jsonPartial?: boolean;
  locked: boolean;
  generatedAt: string;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string | null;
  approvedAt?: string | null;
  pushedAt?: string | null;
  client?: Pick<Client, "name" | "code">;
  radiologist?: RadiologistProfile | null;
  callBookings?: ReportCallBooking[];
};

/** The report fields the worklist rows and their share/call/preview actions read. */
export type ReportSummary = Pick<ReportReview, "id" | "clientId" | "studyUid" | "status" | "patientName" | "patientId" | "accession" | "serviceName" | "modality" | "generatedAt" | "approvedAt" | "reviewedAt" | "pushedAt" | "updatedAt">;

export type PatientProfile = {
  id: string;
  clientId: string;
  patientIdentifier: string;
  name: string;
  dateOfBirth?: string | null;
  age?: string | null;
  gender?: string | null;
  sex?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  clinicalHistory?: string | null;
  medicalHistory?: string | null;
  followUpInfo?: string | null;
  createdAt: string;
  updatedAt: string;
  client?: Pick<Client, "id" | "name" | "code">;
  studies?: Array<{
    id: string;
    studyUid: string;
    modality: string;
    status: string;
    createdAt: string;
    reportReviews?: ReportReview[];
  }>;
  reports?: ReportReview[];
  processingJobs?: ProcessingJob[];
  bridgeStudies?: BridgeStudy[];
  archivedStudies?: PatientStudyArchive[];
  followUps?: PatientFollowUp[];
  _count?: {
    studies: number;
    reports: number;
    followUps: number;
    archivedStudies?: number;
  };
};

export type PatientStudyArchive = {
  id: string;
  studyInstanceUid?: string | null;
  accessionNumber?: string | null;
  studyDate?: string | null;
  modality?: string | null;
  studyDescription: string;
  bodyRegion?: string | null;
  clinicalIndication?: string | null;
  institutionName?: string | null;
  referringPhysician?: string | null;
  seriesCount?: number | null;
  instanceCount?: number | null;
  createdAt: string;
  files: Array<{
    id: string;
    role: string;
    originalName: string;
    mimeType?: string | null;
    sizeBytes: string;
    createdAt: string;
  }>;
};

export type PatientFollowUp = {
  id: string;
  clientId: string;
  patientId: string;
  reportId?: string | null;
  required: boolean;
  followUpDate: string;
  reason: string;
  status: string;
  notes?: string | null;
  patient?: PatientProfile;
  client?: Pick<Client, "id" | "name" | "code">;
  report?: ReportReview | null;
};

export type RadiologistFeedbackItem = {
  id: string;
  clientId: string;
  reportId: string;
  feedbackType: string;
  comment: string;
  status: string;
  internalNotes?: string | null;
  renewistStatus: string;
  createdAt: string;
  client?: Pick<Client, "id" | "name" | "code">;
  patient?: PatientProfile | null;
  report?: ReportReview;
  radiologist?: User;
};

export type DecxpertViewerSession = {
  enabled: boolean;
  viewerUrl?: string;
  studyInstanceUid?: string | null;
  reportId?: string;
  patientName?: string | null;
  patientId?: string | null;
  modality?: string | null;
  importedInstances?: number;
  skippedInstances?: number;
  failedInstances?: number;
  message?: string | null;
};

export type BillingSummary = {
  uninvoicedAmountMinor: number;
  invoicedAmountMinor: number;
  paidAmountMinor: number;
  outstandingAmountMinor: number;
  providerPayableMinor: number;
  transactionCount: number;
  invoiceCount: number;
  disputeCount: number;
};

export type BillingTransaction = {
  id: string;
  clientId?: string;
  serviceName: string;
  workflowType: string;
  priority: string;
  units: number;
  unitPriceMinor: number;
  amountMinor: number;
  currency: string;
  status: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
  client?: Pick<Client, "name" | "code">;
  invoice?: { invoiceNumber: string; status: string } | null;
};

export type BillingInvoice = {
  id: string;
  clientId?: string;
  invoiceNumber: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  currency: string;
  razorpayPaymentLinkId?: string | null;
  paymentUrl?: string | null;
  client?: Pick<Client, "name" | "code">;
  lineItems?: Array<{
    id: string;
    description: string;
    units: number;
    amountMinor: number;
    currency: string;
    metadata?: Record<string, unknown>;
  }>;
  paymentLinks?: Array<{
    id: string;
    provider: string;
    providerLinkId?: string | null;
    status: string;
    amountMinor: number;
    currency: string;
    createdAt: string;
  }>;
  payments?: BillingPayment[];
};

export type BillingPayment = {
  id: string;
  amountMinor: number;
  currency: string;
  status: string;
  provider: string;
  providerPaymentId?: string | null;
  method?: string | null;
  paidAt: string;
  client?: Pick<Client, "name" | "code">;
  invoice?: { invoiceNumber: string } | null;
};

export type PricingRule = {
  id: string;
  serviceName: string;
  workflowType: string;
  priority: string;
  unitPriceMinor: number;
  providerPayableMinor: number;
  currency: string;
  active: boolean;
};

export type RazorpayPaymentLinkResponse = {
  paymentUrl: string;
  providerLinkId?: string | null;
  status: string;
};

export type ProviderPayable = {
  id: string;
  providerCode: string;
  serviceName: string;
  workflowType: string;
  priority: string;
  units: number;
  amountMinor: number;
  currency: string;
  status: string;
  metadata?: Record<string, unknown>;
};

export type ProviderSettlement = {
  id: string;
  providerCode: string;
  settlementNumber: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  subtotalMinor: number;
  currency: string;
  paidAt?: string | null;
};

export type BillingDispute = {
  id: string;
  type: string;
  reason: string;
  status: string;
  createdAt: string;
  client?: Pick<Client, "name" | "code">;
};

export type BillingSnapshot = {
  summary: BillingSummary;
  transactions: BillingTransaction[];
  invoices: BillingInvoice[];
  payments: BillingPayment[];
  pricingRules: PricingRule[];
  providerPayables: ProviderPayable[];
  providerSettlements: ProviderSettlement[];
  disputes: BillingDispute[];
};

export type ClientBillingUsage = {
  client: Pick<Client, "id" | "name" | "code">;
  start: string;
  end: string;
  summary: {
    transactionCount: number;
    units: number;
    amountMinor: number;
    providerPayableMinor: number;
    currency: string;
  };
  transactions: BillingTransaction[];
};

export type TeleradiologyProvider = {
  id: string;
  name: string;
  code: string;
  apiBaseUrl?: string | null;
  active: boolean;
  authType?: string;
  reportCallbackEndpoint?: string | null;
  users?: User[];
};

export type ProviderDashboard = {
  provider: TeleradiologyProvider;
  summary: {
    assignedStudies: number;
    reportsSubmitted: number;
    apiRequests: number;
    pendingPayableMinor: number;
    settlementCount: number;
    disputeCount: number;
    managerCount?: number;
    callRequestCount?: number;
  };
  studies: Array<{
    id: string;
    processingJobId?: string | null;
    dectrocelJobId: string;
    providerJobId?: string | null;
    status: string;
    updatedAt: string;
    client?: Pick<Client, "id" | "name" | "code"> | null;
    patientName?: string | null;
    patientId?: string | null;
    accessionNumber?: string | null;
    studyDescription?: string | null;
    modalities?: string[];
    clinicalIndication?: string | null;
    priority?: string | null;
    processingStatus?: string;
    imageCount?: number;
    pushedAt?: string;
    bundleStudyId?: string | null;
    archiveName?: string | null;
    attachments?: Array<{
      id: string;
      originalName: string;
      mimeType?: string | null;
      sizeBytes: string;
      createdAt: string;
    }>;
  }>;
  reports: Array<{
    id: string;
    dectrocelJobId: string;
    renewistJobId: string;
    reportStatus: string;
    reportType: string;
    reportFormat: string;
    receivedAt: string;
  }>;
  apiLogs: Array<{
    id: string;
    requestId: string;
    endpoint: string;
    status: string;
    authenticated: boolean;
    responseCode?: number | null;
    createdAt: string;
  }>;
  usage: ProviderPayable[];
  settlements: Array<{
    id: string;
    settlementNumber: string;
    periodStart: string;
    periodEnd: string;
    status: string;
    subtotalMinor: number;
    currency: string;
  }>;
  disputes: BillingDispute[];
  radiologists: RadiologistProfile[];
  reportReviews: ReportReview[];
  managers?: User[];
  availabilitySlots?: RadiologistAvailability[];
  callBookings?: ReportCallBooking[];
  clientInvoices?: BillingInvoice[];
  clientTransactions?: BillingTransaction[];
  portalLogs?: AuditLog[];
};

export type RadiologistAvailability = {
  id: string;
  providerCode: string;
  radiologistId: string;
  slotStart: string;
  slotEnd: string;
  durationMinutes: number;
  availabilityWindowId?: string;
  availabilityWindowStart?: string;
  availabilityWindowEnd?: string;
  status: string;
  radiologist?: RadiologistProfile;
  createdBy?: User | null;
};

export type AuditLog = {
  id: string;
  clientId?: string | null;
  actorUserId?: string | null;
  action: string;
  metadata: Record<string, unknown>;
  ipAddress?: string | null;
  createdAt: string;
  client?: Pick<Client, "name" | "code"> | null;
};

export type CallOptions = {
  pricePerMinuteMinor: number;
  currency: string;
  slots: RadiologistAvailability[];
};

export type ReportCallBooking = {
  id: string;
  clientId?: string;
  reportId: string;
  slotStart: string;
  slotEnd: string;
  status: string;
  reason?: string | null;
  requestMessage?: string | null;
  urgency?: string | null;
  confirmedAt?: string | null;
  cancelledAt?: string | null;
  requestedDurationMinutes?: number;
  actualDurationMinutes?: number | null;
  communicationMode?: string;
  phoneNumber?: string | null;
  pricePerMinuteMinor?: number;
  estimatedAmountMinor?: number;
  finalAmountMinor?: number | null;
  managerAcceptedAt?: string | null;
  radiologistAcceptedAt?: string | null;
  meetingRoom: string;
  meetingUrl: string;
  radiologist?: RadiologistProfile | null;
  report?: ReportReview;
  client?: Pick<Client, "name" | "code">;
};

export type SupportTicketMessage = {
  id: string;
  ticketId: string;
  authorUserId?: string | null;
  authorRole?: string | null;
  visibility: string;
  channel: string;
  body: string;
  whatsappDemo: boolean;
  createdAt: string;
};

export type SupportTicket = {
  id: string;
  ticketNumber: string;
  clientId?: string | null;
  relatedStudyId?: string | null;
  category: string;
  priority: string;
  subject: string;
  description: string;
  status: string;
  assignedTeam?: string | null;
  whatsappDemo: boolean;
  createdAt: string;
  updatedAt: string;
  client?: Pick<Client, "id" | "name" | "code"> | null;
  messages: SupportTicketMessage[];
};

export type NotificationRecipient = {
  id: string;
  name: string;
  role: string;
  organization: string;
  clientId?: string | null;
  userId?: string | null;
  phoneE164?: string | null;
  notificationCategories: string[];
  accessCategories: string[];
  active: boolean;
  consentStatus: string;
  verificationStatus: string;
  verifiedAt?: string | null;
  consentAt?: string | null;
  consentSource?: string | null;
  consentText?: string | null;
  optOutAt?: string | null;
  lastNotificationAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NotificationOutboxItem = {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
  status: string;
  attempts: number;
  nextAttemptAt: string;
  createdAt: string;
  processedAt?: string | null;
};

export type WhatsAppBotConfig = {
  physicianReportReady: boolean;
  physicianReportTemplateName: string;
  callRequests: Array<{ id: string; message: string; status: string; createdAt: string; aggregateId: string }>;
  cloudApiEnabled: boolean;
  demoMode: boolean;
  hasCloudApiToken: boolean;
  hasPhoneNumberId: boolean;
  hasWebhookVerifyToken: boolean;
  hasAppSecret: boolean;
  hasUtilityTemplate: boolean;
  outboundReady: boolean;
  webhookUrl: string;
  callbackUrl?: string;
  webhookVerifyToken?: string;
  commandExample: string;
  recipients: NotificationRecipient[];
  outbox: NotificationOutboxItem[];
  summary: { pendingCount: number; sentCount: number; failedCount: number };
};

export type AdminOverview = {
  dashboard: {
    totalClients: number;
    activeClients: number;
    blockedClients: number;
    totalStudies: number;
    failedJobs: number;
    liveJobs: number;
  };
  clients: Client[];
  services: Service[];
  jobs: Job[];
  usageLogs: UsageLog[];
  reportSettings: ReportSetting[];
  reportReviews: ReportReview[];
  radiologists: RadiologistProfile[];
  processingJobs: ProcessingJob[];
  availableBridgeStudies?: BridgeStudy[];
  auditLogs?: AuditLog[];
  billing?: BillingSnapshot;
};

export type ModalityTab = 'ALL' | 'MRI' | 'CT' | 'Mammography' | 'X-RAY' | 'PET-CT' | 'Ultrasound';

export type SortDirection = "asc" | "desc";

export type FilterOption = { value: string; label: string };

export type PasswordPromptState = {
  title: string;
  description: string;
};

export type PatientArchiveFile = PatientStudyArchive["files"][number];

export type PortalNotification = {
  id: string;
  status: string;
  readAt?: string | null;
  createdAt: string;
  event: { id: string; eventType: string; title: string; message: string; status: string; stage?: string | null; occurredAt: string };
};

export type WorkspaceAction = { kind: "share" | "call"; report: ReportSummary } | { kind: "attach"; study: BridgeStudy };

export type WorklistMedia =
  | { kind: "dicom"; studyId: string; title: string }
  | { kind: "report"; report: ReportSummary; title: string }
  | { kind: "attachment"; studyId: string; attachment: NonNullable<BridgeStudy["attachments"]>[number]; title: string };

export type BrowserSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

export type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

export type SpeechRecognitionResultEventLike = {
  resultIndex: number;
  results: ArrayLike<{ isFinal?: boolean; 0?: { transcript?: string } }>;
};

export type SpeechRecognitionErrorEventLike = { error?: string };

export type WindowWithSpeechRecognition = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

export type Workspace = ReturnType<typeof resolvePortalWorkspace>;
