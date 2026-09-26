import LoginView from './LoginView';
import './pacs-workspace.css';
import { needsFullAdminOverview } from './lib/adminOverview';
import { ProcessingActions } from './ProcessingActions';
import { FollowUpsView } from './FollowUps';
import { lazy } from 'react';
import { isSpecialXrayStudy } from './specialXray';
import { api } from './lib/api';
import { loadStudyPages, mergeStudies } from './lib/studyPages';
import type { ClientStatus, ReturnFormat, WorkflowType, User, ClientPortalRole, Service, StudySyncConfig, ClientService, Client, BridgeStudy, Job, UsageLog, ProcessingJob, ReportSetting, RadiologistProfile, ReportReview, ReportSummary, PatientProfile, PatientStudyArchive, RadiologistFeedbackItem, BillingInvoice, PricingRule, RazorpayPaymentLinkResponse, ProviderSettlement, BillingSnapshot, ClientBillingUsage, TeleradiologyProvider, ProviderDashboard, RadiologistAvailability, AuditLog, CallOptions, ReportCallBooking, SupportTicketMessage, SupportTicket, NotificationRecipient, WhatsAppBotConfig, AdminOverview, ModalityTab, SortDirection, FilterOption, PasswordPromptState, PatientArchiveFile, PortalNotification, WorkspaceAction, WorklistMedia, BrowserSpeechRecognition, WindowWithSpeechRecognition } from './types/portal';
import { ExternalViewerPane } from "./features/viewer/ExternalViewerPane";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  Bold,
  Bookmark,
  Building2,
  CalendarDays,
  CheckCircle2,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  CreditCard,
  Download,
  FileText,
  Italic,
  KeyRound,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  MessageSquare,
  Mic,
  Network,
  Eye,
  EyeOff,
  Filter,
  PanelLeftClose,
  PanelLeftOpen,
  Phone,
  Plus,
  RefreshCw,
  Save,
  Search,
  Share2,
  Send,
  ShieldCheck,

  UploadCloud,
  UserCog,
  UserRound,
  Users,
  Underline,
  X,
} from "lucide-react";

import { useLiveRefresh } from "./useLiveRefresh";
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  ChangeEvent,
  FormEvent,
  ReactNode,
} from "react";
import { createPortal } from "react-dom";




import marengoSmallLogo from "./assets/marengo-asia-emblem-small.webp";
import { istTimestamp, worklistDuration, worklistTatStart, worklistTatEnd, worklistStatus, worklistPriority, worklistFacets, worklistModality, worklistModalityLabel } from "./pacsWorklist";
import { workspacePermissions, assignableCenterRoles, clientWorkspaceTabs } from "./workspacePermissions";

import { StudyStatusPage } from "./StudyStatusPage";
import { PORTAL_TOKEN_KEY } from "./lib/session";

import { WorkspaceDrawer, WorkspaceDrawerContext } from "./WorkspaceDrawer";
import {
  filterClientPortalTabs,
  getPortalTabs,
  resolvePortalWorkspace,
} from "./portalAccess";













const ServiceUsageChart = lazy(() => import('./features/analytics/Charts').then(module => ({ default: module.ServiceUsageChart })));
const MonthlyNetworkChart = lazy(() => import('./features/analytics/Charts').then(module => ({ default: module.MonthlyNetworkChart })));
const ModalityCasesChart = lazy(() => import('./features/analytics/Charts').then(module => ({ default: module.ModalityCasesChart })));
const NetworkTrendChart = lazy(() => import('./features/analytics/Charts').then(module => ({ default: module.NetworkTrendChart })));
const AdminConsole = lazy(() => import('./AdminConsole').then(module => ({ default: module.AdminConsole })));
const AdminEvidence = lazy(() => import('./AdminConsole').then(module => ({ default: module.AdminEvidence })));
const WorkspaceStatistics = lazy(() => import('./WorkspaceOperations').then(module => ({ default: module.WorkspaceStatistics })));
const WorkspaceHealthcheck = lazy(() => import('./WorkspaceOperations').then(module => ({ default: module.WorkspaceHealthcheck })));
const TechnicalAlerts = lazy(() => import('./TechnicalAlerts'));
const WorkspaceBilling = lazy(() => import('./WorkspaceBilling').then(module => ({ default: module.WorkspaceBilling })));

const clientPortalRoleOptions: Array<[ClientPortalRole, string]> = [
  ["FRONT_DESK", "Front Desk"],
  ["TECHNICIAN", "Technician"],
  ["MANAGER", "Radiology Manager"],
  ["IT_TEAM", "IT Team"],
];

function clientPortalRoleLabel(role?: ClientPortalRole | null) {
  return clientPortalRoleOptions.find(([value]) => value === role)?.[1] ?? "IT Team";
}


















































































const tokenKey = PORTAL_TOKEN_KEY;
const formatLabels: Record<ReturnFormat, string> = {
  DICOM_ENCAPSULATED_PDF: "DICOM Encapsulated PDF",
  DICOM_SECONDARY_CAPTURE: "DICOM Secondary Capture",
  HL7: "HL7",
  HTML: "HTML",
  PDF: "PDF",
  DOCX: "DOCX",
};
const workflowLabels: Record<WorkflowType, string> = {
  AI_ONLY: "AI only",
  TELERADIOLOGY_ONLY: "Radiologist review",
  AI_TELERADIOLOGY: "AI + Teleradiology",
};
const providerWorkflowLabels: Record<string, string> = {
  TELERADIOLOGY_ONLY: "Radiologist review",
  AI_TELERADIOLOGY: "Teleradiology review",
};
function isTeleradiologyWorkflowType(
  workflowType?: WorkflowType | string | null,
) {
  return (
    workflowType === "TELERADIOLOGY_ONLY" || workflowType === "AI_TELERADIOLOGY"
  );
}
const serviceTypeLabels: Record<string, string> = {
  xray: "X-ray Suite",
  ct: "CT Suite",
  mri: "MRI Suite",
  "ct-thorax-ai": "CT Thorax",
  "mri-brain": "MRI Brain",
  "mri-brain-contrast-epilepsy": "MRI Brain w/ Contrast - Epilepsy",
  "mri-spine": "MRI Spine",
  "mri-body-head-neck-upper-lower-abdomen-pelvis":
    "MRI Body - Head-Neck, Upper/Lower Abdomen, Pelvis",
  mrcp: "MRCP",
  "mri-whole-abdomen": "MRI Whole Abdomen",
  "mri-joints-limbs": "MRI Joints / Limbs",
  "mri-prostate-breast-pituitary": "MRI Prostate / Breast / Pituitary",
  "mri-screening": "MRI Screening",
  "mra-mrv-mrs": "MRA / MRV / MRS",
  "ct-brain-pns-orbit": "CT Brain / PNS / Orbit",
  "ct-face": "CT Face",
  "ct-head-contrast": "CT Head with Contrast",
  "hrct-temporal-bone": "HRCT Temporal Bone",
  "ct-body-with-or-without-contrast": "CT Body - with or without Contrast",
  "ct-thorax": "CT Thorax",
  "triple-phase-ct": "Triple Phase CT",
  "ct-angio-all-studies": "CT Angio - all studies",
  "xray-chest": "X-Ray Chest",
  "xray-other-additional-view": "X-Ray Other - per additional view",
  "special-xray-contrast-media": "Special X-ray (contrast media)",
  mammography: "Mammography",
};
const modalityTabs = [
  "ALL",
  "MRI",
  "CT",
  "Mammography",
  "X-RAY",
  "PET-CT",
  "Ultrasound",
] as const;




function normalizeModalityTab(value?: string | null): ModalityTab | null {
  const text = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!text) return null;
  if (/\b(pet[\s-]?ct|pt)\b/.test(text)) return "PET-CT";
  if (/\b(mammography|mammo|mg)\b/.test(text)) return "Mammography";
  if (/\b(ultrasound|usg|us)\b/.test(text)) return "Ultrasound";
  if (/\b(x[\s-]?ray|xray|dx|cr)\b/.test(text)) return "X-RAY";
  if (/\b(mri|mr|mra|mrv|mrs|mrcp)\b/.test(text)) return "MRI";
  if (/\bct\b|computed tomography/.test(text)) return "CT";
  return null;
}

function modalityMatches(
  active: ModalityTab,
  values: Array<string | null | undefined>,
) {
  if (active === "ALL") return true;
  return values.some((value) => normalizeModalityTab(value) === active);
}

function processingJobModalityValues(job: ProcessingJob) {
  const status =
    job.upstreamStatus &&
    typeof job.upstreamStatus === "object" &&
    !Array.isArray(job.upstreamStatus)
      ? (job.upstreamStatus as Record<string, unknown>)
      : {};
  const metadata =
    status.dicomMetadata &&
    typeof status.dicomMetadata === "object" &&
    !Array.isArray(status.dicomMetadata)
      ? (status.dicomMetadata as Record<string, unknown>)
      : {};
  const modality =
    typeof metadata.modality === "string" ? metadata.modality : null;
  return [
    job.serviceType,
    serviceTypeLabels[job.serviceType],
    modality,
    ...(job.bridgeStudy?.modalities ?? []),
  ];
}

function reportModalityValues(report: ReportReview) {
  return [
    report.modality,
    report.serviceName,
    typeof report.aiReportJson?.modality === "string"
      ? report.aiReportJson.modality
      : null,
    typeof report.editedReportJson?.modality === "string"
      ? report.editedReportJson.modality
      : null,
  ];
}

function dicomExamLabel(metadata: Record<string, unknown>, fallback: string) {
  const modality = typeof metadata.modality === "string" ? metadata.modality.trim().toUpperCase() : "";
  const description = typeof metadata.studyDescription === "string" ? metadata.studyDescription.trim() : "";
  if (description) return description;

  const bodyPart = typeof metadata.bodyPartExamined === "string" ? metadata.bodyPartExamined.trim() : "";
  const protocol = typeof metadata.protocolName === "string" ? metadata.protocolName.trim() : "";
  const source = `${bodyPart} ${protocol}`.toLowerCase();
  const exam = /\bkub\b/.test(source)
    ? "KUB"
    : /\b(chest|thorax|lung|lungs)\b/.test(source)
      ? "Chest"
      : /\b(head|brain)\b/.test(source)
        ? "Head"
        : bodyPart
          ? bodyPart.replaceAll("_", " ").replace(/\b\w/g, (value) => value.toUpperCase())
          : protocol;
  return [modality, exam].filter(Boolean).join(" ") || fallback;
}

function reportExamLabel(report: ReportReview) {
  const study = report.aiReportJson?.study;
  const studyRecord = study && typeof study === "object" && !Array.isArray(study)
    ? (study as Record<string, unknown>)
    : {};
  const nestedMetadata = studyRecord.dicomMetadata;
  const metadata = nestedMetadata && typeof nestedMetadata === "object" && !Array.isArray(nestedMetadata)
    ? (nestedMetadata as Record<string, unknown>)
    : {};
  return dicomExamLabel(
    { modality: report.modality, ...metadata },
    report.modality?.trim().toUpperCase() || "DICOM study",
  );
}

function processingJobExamLabel(job: ProcessingJob) {
  const status = job.upstreamStatus && typeof job.upstreamStatus === "object" && !Array.isArray(job.upstreamStatus)
    ? (job.upstreamStatus as Record<string, unknown>)
    : {};
  const nestedMetadata = status.dicomMetadata;
  const metadata = nestedMetadata && typeof nestedMetadata === "object" && !Array.isArray(nestedMetadata)
    ? (nestedMetadata as Record<string, unknown>)
    : {};
  return dicomExamLabel(
    {
      modality: job.bridgeStudy?.modalities?.[0] ?? metadata.modality,
      ...metadata,
      studyDescription: job.bridgeStudy?.studyDescription ?? metadata.studyDescription,
    },
    job.bridgeStudy?.modalities?.[0]?.trim().toUpperCase() || "DICOM study",
  );
}

function ModalityBookmarkFilter({
  active,
  onChange,
  counts,
}: {
  active: ModalityTab;
  onChange: (tab: ModalityTab) => void;
  counts: Record<ModalityTab, number>;
}) {
  return (
    <div className="modality-bookmarks" aria-label="Filter by modality">
      {modalityTabs.map((tab) => (
        <button
          aria-pressed={active === tab}
          className={cx(
            "modality-bookmark",
            active === tab && "modality-bookmark-active",
          )}
          key={tab}
          onClick={() => onChange(tab)}
          type="button"
        >
          <Bookmark size={14} />
          <span>{tab}</span>
          <b>{counts[tab]}</b>
        </button>
      ))}
    </div>
  );
}

function WorklistSearchFilterBar({
  query,
  onQueryChange,
  onFilterClick,
  activeFilterCount,
  placeholder,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onFilterClick: () => void;
  activeFilterCount?: number;
  placeholder: string;
}) {
  return (
    <div className="worklist-search-filter">
      <label className="worklist-search-box">
        <Search size={16} />
        <input
          aria-label={placeholder}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={placeholder}
          type="search"
        />
      </label>
      <button
        aria-label={`Open filters${activeFilterCount ? `, ${activeFilterCount} active` : ""}`}
        className="worklist-filter-button"
        onClick={onFilterClick}
        type="button"
      >
        <Filter size={16} />
        <span>Filter</span>
        {activeFilterCount ? <b>{activeFilterCount}</b> : null}
      </button>
    </div>
  );
}

function WorklistFilterModal({
  title,
  sortBy,
  sortOptions,
  sortDirection,
  filterValues,
  filterGroups,
  onChangeSortBy,
  onChangeSortDirection,
  onChangeFilter,
  onReset,
  onClose,
}: {
  title: string;
  sortBy: string;
  sortOptions: FilterOption[];
  sortDirection: SortDirection;
  filterValues: Record<string, string>;
  filterGroups: Array<{ key: string; label: string; options: FilterOption[] }>;
  onChangeSortBy: (value: string) => void;
  onChangeSortDirection: (value: SortDirection) => void;
  onChangeFilter: (key: string, value: string) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectInput
            label="Sort by"
            value={sortBy}
            onChange={onChangeSortBy}
            options={sortOptions.map((item) => [item.value, item.label])}
          />
          <SelectInput
            label="Order"
            value={sortDirection}
            onChange={(value) => onChangeSortDirection(value as SortDirection)}
            options={[
              ["desc", "Newest / highest first"],
              ["asc", "Oldest / lowest first"],
            ]}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput
            label="From date / time"
            value={filterValues.dateFrom ?? ""}
            onChange={(value) => onChangeFilter("dateFrom", value)}
            type="datetime-local"
          />
          <TextInput
            label="To date / time"
            value={filterValues.dateTo ?? ""}
            onChange={(value) => onChangeFilter("dateTo", value)}
            type="datetime-local"
          />
        </div>
        {filterGroups.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {filterGroups.map((group) => (
              <SelectInput
                key={group.key}
                label={group.label}
                value={filterValues[group.key] ?? "ALL"}
                onChange={(value) => onChangeFilter(group.key, value)}
                options={group.options.map((item) => [item.value, item.label])}
              />
            ))}
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            className="rounded-md border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700"
            onClick={onReset}
            type="button"
          >
            Reset
          </button>
          <button
            className="rounded-md bg-sky-600 px-4 py-2 text-sm font-bold text-white"
            onClick={onClose}
            type="button"
          >
            Apply
          </button>
        </div>
      </div>
    </Modal>
  );
}

function searchableText(values: Array<unknown>) {
  return values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter((value) => value != null)
    .join(" ")
    .toLowerCase();
}

function brandText(value?: string | null) {
  return String(value ?? "")
    .replace(/Dectrocel CIMS Hospital/gi, "Marengo CIMS Hospital")
    .replace(/Dectrocel Hospital/gi, "Marengo Asia Hospital")
    .replace(/Dectrocel center/gi, "Marengo center");
}

function parseDateValue(value?: string | null) {
  if (!value) return 0;
  const normalized = value.trim();
  if (/^\d{8}$/.test(normalized)) {
    return new Date(
      Number(normalized.slice(0, 4)),
      Number(normalized.slice(4, 6)) - 1,
      Number(normalized.slice(6, 8)),
    ).getTime();
  }
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function compareValues(
  a: string | number,
  b: string | number,
  direction: SortDirection,
) {
  const result =
    typeof a === "number" && typeof b === "number"
      ? a - b
      : String(a).localeCompare(String(b), undefined, {
          numeric: true,
          sensitivity: "base",
        });
  return direction === "asc" ? result : -result;
}

function activeFilterCount(values: Record<string, string>) {
  return Object.values(values).filter((value) => value && value !== "ALL")
    .length;
}

function dateWithinRange(
  value: string | null | undefined,
  from?: string,
  to?: string,
) {
  const time = parseDateValue(value);
  if (!time) return !from && !to;
  const fromTime = from ? Date.parse(from) : 0;
  const toTime = to ? Date.parse(to) : 0;
  if (fromTime && time < fromTime) return false;
  if (toTime && time > toTime) return false;
  return true;
}

function displayServiceName(name?: string | null) {
  if (!name) return "";
  return name
    .replace(/^DecXpert\s+CT\s+Thorax$/i, "CT Thorax")
    .replace(/^DecXpert\s+CT\s+Suite$/i, "CT Suite")
    .replace(/^DecXpert\s+X-ray\s+Suite$/i, "X-ray Suite");
}
const reportSections = [
  "AI Triage",
  "Image Quality",
  "Findings",
  "Impression",
  "Systematic Sweep",
  "Abnormality Candidates",
  "Comparison",
  "Recommendation",
  "Disclaimer",
];
const signatureTypes = ["image/png", "image/jpeg", "image/webp"];
const radiologistDocumentTypes = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const signatureDetailOptions: Array<[string, string]> = [
  ["fullName", "Radiologist name"],
  ["qualification", "Qualification"],
  ["medicalRegistrationNumber", "Registration number"],
  ["organisationName", "Organisation"],
  ["approvedAt", "Approval date and time"],
];
function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function formatJson(value: unknown) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value ?? "");
  }
}

function readSignatureFile(file: File): Promise<string> {
  if (!signatureTypes.includes(file.type))
    return Promise.reject(
      new Error("Upload PNG, JPG, or WEBP signature images only."),
    );
  if (file.size > 2 * 1024 * 1024)
    return Promise.reject(
      new Error("Signature image must be 2 MB or smaller."),
    );
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Unable to read signature image."));
    reader.readAsDataURL(file);
  });
}

function readRadiologistDocument(file: File): Promise<string> {
  if (!radiologistDocumentTypes.includes(file.type))
    return Promise.reject(
      new Error("Upload image, PDF, DOC, or DOCX documents only."),
    );
  if (file.size > 8 * 1024 * 1024)
    return Promise.reject(new Error("Document must be 8 MB or smaller."));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Unable to read document."));
    reader.readAsDataURL(file);
  });
}



async function downloadProtectedFile(path: string, token?: string) {
  const response = await fetch(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.message ?? "Download failed");
  }
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = match?.[1] ?? "invoice.html";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadCsvFile(
  fileName: string,
  columns: string[],
  rows: Array<Array<string | number>>,
) {
  const escapeCell = (value: string | number) =>
    `"${String(value).replaceAll('"', '""')}"`;
  const csv = [columns, ...rows]
    .map((row) => row.map(escapeCell).join(","))
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}



function usePasswordConfirmation() {
  const [request, setRequest] = useState<PasswordPromptState | null>(null);
  const resolver = useRef<((password: string | null) => void) | null>(null);

  function confirmPassword(title: string, description: string) {
    setRequest({ title, description });
    return new Promise<string | null>((resolve) => {
      resolver.current = resolve;
    });
  }

  function close(password: string | null) {
    resolver.current?.(password);
    resolver.current = null;
    setRequest(null);
  }

  return {
    confirmPassword,
    passwordPrompt: request ? (
      <PasswordConfirmModal
        request={request}
        onCancel={() => close(null)}
        onConfirm={(password) => close(password)}
      />
    ) : null,
  };
}

function PasswordConfirmModal({
  request,
  onCancel,
  onConfirm,
}: {
  request: PasswordPromptState;
  onCancel: () => void;
  onConfirm: (password: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  return (
    <Modal title={request.title} onClose={onCancel}>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (password.trim()) onConfirm(password);
        }}
      >
        <p className="text-sm leading-6 text-slate-600">
          {request.description}
        </p>
        <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
          Current password
          <span className="flex items-center overflow-hidden rounded-md border border-slate-200 bg-white">
            <input
              autoFocus
              className="min-w-0 flex-1 px-3 py-2 text-sm outline-none"
              onChange={(event) => setPassword(event.target.value)}
              type={visible ? "text" : "password"}
              value={password}
            />
            <button
              aria-label={visible ? "Hide password" : "Show password"}
              className="grid h-10 w-10 place-items-center text-slate-500 hover:text-sky-700"
              onClick={() => setVisible((current) => !current)}
              type="button"
            >
              {visible ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </span>
        </label>
        <div className="flex justify-end gap-2">
          <button
            className="rounded-md border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700"
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="rounded-md bg-slate-950 px-4 py-2 text-sm font-bold text-white"
            disabled={!password.trim()}
            type="submit"
          >
            Continue
          </button>
        </div>
      </form>
    </Modal>
  );
}

function toDate(value: string) {
  return new Date(value).toLocaleDateString();
}

function localDateInputValue(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfWeekDate(value: string) {
  const source = value ? new Date(`${value}T00:00:00`) : new Date();
  if (!Number.isFinite(source.getTime())) source.setTime(Date.now());
  const day = source.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  source.setDate(source.getDate() + mondayOffset);
  source.setHours(0, 0, 0, 0);
  return source;
}

function addCalendarDays(value: Date, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function formatCalendarWeekRange(days: Date[]) {
  if (!days.length) return "";
  const first = days[0];
  const last = days[days.length - 1];
  return `${first.toLocaleDateString([], { month: "short", day: "numeric" })} - ${last.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`;
}

function formatTimeLabel(value: string) {
  const [hourValue, minuteValue] = value.split(":").map(Number);
  const date = new Date();
  date.setHours(hourValue || 0, minuteValue || 0, 0, 0);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function availabilityEventClass(status: string) {
  if (status === "REQUESTED")
    return "border-amber-200 bg-amber-100 text-amber-900";
  if (status === "BOOKED")
    return "border-emerald-200 bg-emerald-100 text-emerald-900";
  return "border-sky-200 bg-sky-100 text-sky-900";
}

function addMinutesToTime(value: string, minutes: number) {
  const [hourValue, minuteValue] = value.split(":").map(Number);
  const date = new Date();
  date.setHours(hourValue || 0, minuteValue || 0, 0, 0);
  date.setMinutes(date.getMinutes() + minutes);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function nextAvailabilityDefaults() {
  const start = new Date();
  const minutes = start.getMinutes();
  const nextHalfHour = minutes === 0 ? 30 : Math.ceil(minutes / 30) * 30;
  if (nextHalfHour >= 60) start.setHours(start.getHours() + 1, 0, 0, 0);
  else start.setMinutes(nextHalfHour, 0, 0);
  const end = new Date(start);
  end.setHours(end.getHours() + 2);
  return {
    date: localDateInputValue(start.toISOString()),
    startTime: `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`,
    endTime: `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`,
  };
}

function moneyMinor(value?: number | null, currency = "INR") {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format((value ?? 0) / 100);
}

function billingAmountLabel(
  value?: number | null,
  currency = "INR",
  metadata?: Record<string, unknown>,
) {
  return metadata?.manualBilling === true
    ? "Will be billed manually"
    : moneyMinor(value, currency);
}

function creditLeft(service: ClientService) {
  return Math.max(0, service.credits - service.usedCredits);
}

function shortestValidity(services: ClientService[]) {
  if (!services.length) return "-";
  const timestamps = services
    .map((service) => new Date(service.validUntil).getTime())
    .filter((value) => Number.isFinite(value));
  if (!timestamps.length) return "-";
  return toDate(new Date(Math.min(...timestamps)).toISOString());
}

function buildUsageChart(logs: UsageLog[], jobs: Job[]) {
  const days = Array.from({ length: 7 }, (_item, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    return {
      key: date.toISOString().slice(0, 10),
      day: date.toLocaleDateString(undefined, { weekday: "short" }),
      studies: 0,
      credits: 0,
      failures: 0,
    };
  });
  const byDay = new Map(days.map((day) => [day.key, day]));

  for (const log of logs) {
    const key = new Date(log.createdAt).toISOString().slice(0, 10);
    const day = byDay.get(key);
    if (day) {
      day.studies += 1;
      day.credits += log.creditsUsed;
      if (!log.success) day.failures += 1;
    }
  }

  for (const job of jobs) {
    const key = new Date(job.createdAt).toISOString().slice(0, 10);
    const day = byDay.get(key);
    if (day && job.status === "FAILED") day.failures += 1;
  }

  return days;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ACTIVE: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    READY: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    BLOCKED: "bg-rose-50 text-rose-700 ring-rose-200",
    APPROVED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    PUSHED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    PENDING: "bg-amber-50 text-amber-700 ring-amber-200",
    IN_REVIEW: "bg-sky-50 text-sky-700 ring-sky-200",
    SAVED: "bg-indigo-50 text-indigo-700 ring-indigo-200",
    REJECTED: "bg-rose-50 text-rose-700 ring-rose-200",
    SENT_TO_RADIOLOGIST: "bg-sky-50 text-sky-700 ring-sky-200",
    SENT_TO_PACS: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    SUBMITTED_TO_OUTSOURCED_TELERADIOLOGY:
      "bg-sky-50 text-sky-700 ring-sky-200",
    AWAITING_RADIOLOGIST: "bg-amber-50 text-amber-700 ring-amber-200",
    COMPLETED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    OUTBOUND_SUBMISSION_FAILED: "bg-rose-50 text-rose-700 ring-rose-200",
    PROCESSING: "bg-sky-50 text-sky-700 ring-sky-200",
    SUCCESS: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    FAILED: "bg-rose-50 text-rose-700 ring-rose-200",
    QUEUED: "bg-amber-50 text-amber-700 ring-amber-200",
    REGULAR: "bg-slate-100 text-slate-700 ring-slate-200",
    URGENT: "bg-rose-50 text-rose-700 ring-rose-200",
    NIGHT: "bg-indigo-50 text-indigo-700 ring-indigo-200",
    UNKNOWN: "bg-slate-100 text-slate-600 ring-slate-200",
    EXPIRED: "bg-amber-50 text-amber-700 ring-amber-200",
    REVOKED: "bg-slate-100 text-slate-600 ring-slate-200",
  };
  const normalized = status
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  const labels: Record<string, string> = {
    AWAITING_RADIOLOGIST: "In Review",
    COMPLETED: "Ready",
    IN_REVIEW: "In Review",
    OUTBOUND_SUBMISSION_FAILED: "Failed",
    PROCESSING: "Processing",
    QUEUED: "Processing",
    READY: "Ready",
    SENT_TO_RADIOLOGIST: "In Review",
    SENT_TO_PACS: "Ready",
    SUBMITTED_TO_OUTSOURCED_TELERADIOLOGY: "In Review",
  };
  const label = labels[normalized] ?? normalized.replaceAll("_", " ");
  return (
    <span
      aria-label={`Status: ${label}`}
      data-status={normalized}
      className={cx(
        "status-badge inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1",
        map[normalized] ?? map.ACTIVE,
      )}
    >
      {label}
    </span>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div
      aria-label={`${label}: ${value}. ${sub}`}
      className="clinical-kpi"
      role="group"
    >
      <div className="clinical-kpi-icon">
        <Icon aria-hidden="true" size={17} />
      </div>
      <div>
        <span>{label}</span>
        <b>{value}</b>
        <small>{sub}</small>
      </div>
    </div>
  );
}

function AdminDashboard({
  overview,
  onNavigate,
}: {
  overview: AdminOverview;
  onNavigate: (section: string) => void;
}) {
  const { dashboard } = overview;
  const [query, setQuery] = useState("");
  const [modality, setModality] = useState("ALL");
  const [centerCode, setCenterCode] = useState("ALL");
  const [selectedJob, setSelectedJob] = useState<ProcessingJob | null>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const worklist = (overview.processingJobs ?? [])
    .filter((job) => {
      if (centerCode !== "ALL" && job.client?.code !== centerCode) return false;
      const jobModalities = job.bridgeStudy?.modalities ?? [];
      if (
        modality !== "ALL" &&
        !jobModalities.some((item) =>
          item.toUpperCase().startsWith(modality),
        ) &&
        !job.serviceType.toUpperCase().startsWith(modality)
      )
        return false;
      return (
        !normalizedQuery ||
        searchableText([
          job.id,
          job.uploadName,
          job.client?.name,
          job.client?.code,
          job.bridgeStudy?.patientName,
          job.bridgeStudy?.patientId,
          job.bridgeStudy?.studyInstanceUid,
          job.bridgeStudy?.studyDescription,
        ]).includes(normalizedQuery)
      );
    })
    .slice(0, 50);
  const serviceCount = overview.services.length;
  return (
    <div className="clinical-workstation">
      <div className="clinical-kpi-strip">
        <MetricCard
          icon={Building2}
          label="Total centers"
          value={String(dashboard.totalClients)}
          sub="Marengo centers"
        />
        <MetricCard
          icon={CheckCircle2}
          label="Active centers"
          value={String(dashboard.activeClients)}
          sub={`${dashboard.blockedClients} blocked`}
        />
        <MetricCard
          icon={UploadCloud}
          label="Studies received"
          value={String(dashboard.totalStudies)}
          sub="All services"
        />
        <MetricCard
          icon={AlertTriangle}
          label="Live / failed jobs"
          value={`${dashboard.liveJobs} / ${dashboard.failedJobs}`}
          sub="Queue health"
        />
      </div>
      <section
        aria-labelledby="admin-access-shortcuts-heading"
        className="soft-card admin-access-shortcuts rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <div className="mb-3">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-sky-700">
            Access management
          </p>
          <h2
            className="mt-1 text-lg font-extrabold text-slate-950"
            id="admin-access-shortcuts-heading"
          >
            Manage Marengo portal users
          </h2>
          <p className="mt-1 text-sm font-semibold text-slate-500">
            Create, activate, block, reset, or review privileged user accounts.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            className="group flex min-h-20 items-center gap-3 rounded-xl border border-sky-100 bg-gradient-to-br from-sky-50 to-white p-4 text-left transition hover:border-sky-300 hover:shadow-md"
            onClick={() => onNavigate("Group Admins")}
            type="button"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-sky-700 text-white shadow-sm">
              <Users aria-hidden="true" size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <strong className="block text-sm font-extrabold text-slate-950">
                Manage group admins
              </strong>
              <span className="mt-1 block text-xs font-semibold leading-5 text-slate-500">
                Marengo network administrator accounts
              </span>
            </span>
            <ChevronRight
              aria-hidden="true"
              className="shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-sky-700"
              size={18}
            />
          </button>
          <button
            className="group flex min-h-20 items-center gap-3 rounded-xl border border-teal-100 bg-gradient-to-br from-teal-50 to-white p-4 text-left transition hover:border-teal-300 hover:shadow-md"
            onClick={() => onNavigate("Radiologists")}
            type="button"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-teal-700 text-white shadow-sm">
              <UserCog aria-hidden="true" size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <strong className="block text-sm font-extrabold text-slate-950">
                Manage radiologists
              </strong>
              <span className="mt-1 block text-xs font-semibold leading-5 text-slate-500">
                Marengo and Renewist radiologist access
              </span>
            </span>
            <ChevronRight
              aria-hidden="true"
              className="shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-teal-700"
              size={18}
            />
          </button>
        </div>
      </section>
      <section className="clinical-toolbar">
        <div className="clinical-search-group">
          <label>Quick search</label>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Patient ID, patient name, accession, study UID"
            value={query}
          />
        </div>
        <select
          onChange={(event) => setModality(event.target.value)}
          value={modality}
        >
          <option value="ALL">All modalities</option>
          <option value="CT">CT</option>
          <option value="MR">MR</option>
          <option value="XR">XR</option>
        </select>
        <select
          onChange={(event) => setCenterCode(event.target.value)}
          value={centerCode}
        >
          <option value="ALL">All centers</option>
          {overview.clients.map((client) => (
            <option key={client.id} value={client.code}>
              {brandText(client.name)}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            setQuery("");
            setModality("ALL");
            setCenterCode("ALL");
          }}
          type="button"
        >
          Clear filters
        </button>
      </section>
      <div className="clinical-main-grid">
        <section className="clinical-worklist-panel">
          <div className="clinical-panel-head">
            <div>
              <h2>Imaging Worklist</h2>
              <p>{worklist.length} recent processing studies</p>
            </div>
            <span>{serviceCount} active services</span>
          </div>
          <div className="clinical-table-wrap">
            <table className="clinical-table">
              <thead>
                <tr>
                  {[
                    "Patient",
                    "Center",
                    "Study",
                    "Status",
                    "Updated",
                    "Action",
                  ].map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {worklist.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <b>{job.bridgeStudy?.patientName ?? "-"}</b>
                      <span>
                        {job.bridgeStudy?.patientId ?? job.id.slice(0, 8)}
                      </span>
                    </td>
                    <td>{brandText(job.client?.name ?? "-")}</td>
                    <td>
                      {job.bridgeStudy?.studyDescription ?? job.uploadName}
                    </td>
                    <td>
                      <StatusBadge status={job.status} />
                    </td>
                    <td>{toDate(job.updatedAt)}</td>
                    <td>
                      <button
                        className="table-view-button"
                        onClick={() => setSelectedJob(job)}
                        type="button"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
                {!worklist.length ? (
                  <tr>
                    <td colSpan={6}>
                      <div className="clinical-empty-row">
                        No studies in the live processing queue.
                      </div>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      {selectedJob ? (
        <Modal
          title="Processing study details"
          onClose={() => setSelectedJob(null)}
        >
          <div className="record-detail-grid">
            <DetailField
              label="Patient"
              value={`${selectedJob.bridgeStudy?.patientName ?? "-"} / ${selectedJob.bridgeStudy?.patientId ?? "-"}`}
            />
            <DetailField
              label="Center"
              value={brandText(
                selectedJob.client?.name ?? selectedJob.clientId ?? "-",
              )}
            />
            <DetailField
              label="Study"
              value={
                selectedJob.bridgeStudy?.studyDescription ??
                selectedJob.uploadName
              }
            />
            <DetailField
              label="Study UID"
              value={selectedJob.bridgeStudy?.studyInstanceUid ?? "-"}
            />
            <DetailField
              label="Modality / service"
              value={`${selectedJob.bridgeStudy?.modalities?.join(", ") || "-"} / ${serviceTypeLabels[selectedJob.serviceType] ?? selectedJob.serviceType}`}
            />
            <DetailField
              label="Priority"
              value={selectedJob.priority ?? "REGULAR"}
            />
            <DetailField
              label="Images"
              value={String(selectedJob.imageCount)}
            />
            <DetailField
              label="Status"
              value={<StatusBadge status={selectedJob.status} />}
            />
            <DetailField
              label="Updated"
              value={toDate(selectedJob.updatedAt)}
            />
            <DetailField label="Error" value={selectedJob.error ?? "-"} />
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function ClientsView({
  token,
  overview,
  reload,
  notice,
}: {
  token: string;
  overview: AdminOverview;
  reload: () => Promise<void>;
  notice: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [generatedPassword, setGeneratedPassword] = useState("");
  const [form, setForm] = useState({
    name: "",
    hospitalSlug: "",
    facilityType: "",
    primaryContact: "",
    email: "",
  });
  const [clientUserForm, setClientUserForm] = useState({
    name: "",
    email: "",
    portalRole: "FRONT_DESK" as ClientPortalRole,
  });

  const [discountPercent, setDiscountPercent] = useState("0");
  const [demoModeEnabled, setDemoModeEnabled] = useState(false);
  const [demoStudyLimit, setDemoStudyLimit] = useState("");
  const [billingUsageOpen, setBillingUsageOpen] = useState(false);
  const [billingUsage, setBillingUsage] = useState<ClientBillingUsage | null>(
    null,
  );
  const [billingStart, setBillingStart] = useState(() =>
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .slice(0, 10),
  );
  const [billingEnd, setBillingEnd] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [billingLoading, setBillingLoading] = useState(false);
  const { confirmPassword, passwordPrompt } = usePasswordConfirmation();
  const visible = overview.clients.filter((client) =>
    `${client.code} ${client.name} ${client.email} ${client.primaryContact}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const selectedClient =
    overview.clients.find((client) => client.id === selectedClientId) ?? null;
  const selectedClientUser = selectedClient?.users?.find(
    (user) => user.role === "CLIENT_USER",
  );

  async function createClient(event: FormEvent) {
    event.preventDefault();
    const result = await api<{
      client: Client;
      user: User;
      temporaryPassword: string;
    }>("/api/admin/clients", token, {
      method: "POST",
      body: JSON.stringify(form),
    });
    setForm({
      name: "",
      hospitalSlug: "",
      facilityType: "",
      primaryContact: "",
      email: "",
    });
    setCreateOpen(false);
    setSelectedClientId(result.client.id);
    setGeneratedPassword(result.temporaryPassword);
    setDiscountPercent(String(result.client.billingDiscountPercent ?? 0));
    setDemoModeEnabled(Boolean(result.client.demoModeEnabled));
    setDemoStudyLimit(
      result.client.demoStudyLimit == null
        ? ""
        : String(result.client.demoStudyLimit),
    );

    notice(
      `Client login created for ${result.user.email}. The one-time password is shown in the account details.`,
    );
    await reload();
  }

  async function createClientUser(client: Client, event: FormEvent) {
    event.preventDefault();
    const result = await api<{
      client: Pick<Client, "id" | "code" | "name">;
      user: User;
      temporaryPassword: string;
    }>(`/api/admin/clients/${client.id}/users`, token, {
      method: "POST",
      body: JSON.stringify(clientUserForm),
    });
    setClientUserForm({
      name: "",
      email: "",
      portalRole: "FRONT_DESK",
    });
    setGeneratedPassword(result.temporaryPassword);
    notice(
      `${clientPortalRoleLabel(result.user.portalRole)} login created for ${result.user.email}.`,
    );
    await reload();
  }

  async function toggleStatus(client: Client) {
    await api<Client>(`/api/admin/clients/${client.id}/status`, token, {
      method: "PATCH",
      body: JSON.stringify({
        status: client.status === "ACTIVE" ? "BLOCKED" : "ACTIVE",
      }),
    });
    notice(
      client.status === "ACTIVE" ? "Client blocked." : "Client activated.",
    );
    await reload();
  }

  async function deleteClient(client: Client) {
    const confirmed = window.confirm(
      `Delete ${client.name}? This permanently removes the client, users, services, PACS configs, studies, reports, jobs, logs, and radiologists.`,
    );
    if (!confirmed) return;
    const password = await confirmPassword(
      "Confirm deletion",
      `Enter your current password to permanently delete ${client.name}.`,
    );
    if (!password) return;
    await api<{ deleted: boolean }>(`/api/admin/clients/${client.id}`, token, {
      method: "DELETE",
      body: JSON.stringify({ password }),
    });
    notice(`Client ${client.name} deleted.`);
    setSelectedClientId("");
    await reload();
  }

  function openClientProfile(client: Client) {
    setSelectedClientId(client.id);
    setGeneratedPassword("");
    setDiscountPercent(String(client.billingDiscountPercent ?? 0));
    setDemoModeEnabled(Boolean(client.demoModeEnabled));
    setDemoStudyLimit(
      client.demoStudyLimit == null ? "" : String(client.demoStudyLimit),
    );

  }

  async function saveBillingDiscount(client: Client, event: FormEvent) {
    event.preventDefault();
    const nextDiscount = Math.min(
      100,
      Math.max(0, Number(discountPercent) || 0),
    );
    const updated = await api<Client>(
      `/api/admin/clients/${client.id}/billing-discount`,
      token,
      {
        method: "PATCH",
        body: JSON.stringify({ billingDiscountPercent: nextDiscount }),
      },
    );
    setDiscountPercent(String(updated.billingDiscountPercent ?? nextDiscount));
    notice(`Billing discount updated to ${nextDiscount}% for ${client.name}.`);
    await reload();
  }

  async function setStudySyncEnabled(
    client: Client,
    studySyncEnabled: boolean,
  ) {
    await api<Client>(`/api/admin/clients/${client.id}/study-sync`, token, {
      method: "PATCH",
      body: JSON.stringify({ studySyncEnabled }),
    });
    notice(
      studySyncEnabled
        ? "Study Sync Agent pipeline enabled for this client."
        : "Study Sync Agent pipeline disabled for this client.",
    );
    await reload();
  }

  async function saveDemoMode(client: Client, event: FormEvent) {
    event.preventDefault();
    const limit = demoStudyLimit.trim()
      ? Math.max(0, Number(demoStudyLimit) || 0)
      : null;
    const updated = await api<Client>(
      `/api/admin/clients/${client.id}/demo-mode`,
      token,
      {
        method: "PATCH",
        body: JSON.stringify({ demoModeEnabled, demoStudyLimit: limit }),
      },
    );
    setDemoModeEnabled(Boolean(updated.demoModeEnabled));
    setDemoStudyLimit(
      updated.demoStudyLimit == null ? "" : String(updated.demoStudyLimit),
    );
    notice(
      updated.demoModeEnabled
        ? `Demo mode enabled for ${client.name}.`
        : `Demo mode disabled for ${client.name}.`,
    );
    await reload();
  }

  async function resetClientPassword(client: Client, user?: User | null) {
    const result = await api<{ user: User; temporaryPassword: string }>(
      `/api/admin/clients/${client.id}/reset-password`,
      token,
      {
        method: "POST",
        body: JSON.stringify(user?.id ? { userId: user.id } : {}),
      },
    );
    setGeneratedPassword(result.temporaryPassword);
    notice(`A new one-time password was generated for ${result.user.email}.`);
    await reload();
  }

  async function revealClientPassword(client: Client, user?: User | null) {
    const password = await confirmPassword(
      "Reveal client password",
      `Enter your super admin password to reveal the stored generated password for ${client.name}.`,
    );
    if (!password) throw new Error("Password confirmation cancelled");
    const result = await api<{ password: string }>(
      `/api/admin/clients/${client.id}/view-password`,
      token,
      {
        method: "POST",
        body: JSON.stringify({ password, ...(user?.id ? { userId: user.id } : {}) }),
      },
    );
    return result.password;
  }

  async function saveDirectPacsSetup(
    client: Client,
    values: {
      ec2PublicIp: string;
      receivingPort: number;
      aeTitle: string;
      clientPacsIp: string;
      clientPacsPort: number;
      clientPacsAeTitle: string;
      returnFormat: ReturnFormat;
    },
  ) {
    await api(`/api/admin/clients/${client.id}/direct-pacs`, token, {
      method: "PATCH",
      body: JSON.stringify(values),
    });
    notice(`Direct PACS setup updated for ${client.name}.`);
    await reload();
  }

  async function openBillingUsage(client: Client) {
    setBillingUsageOpen(true);
    setBillingLoading(true);
    try {
      const params = new URLSearchParams({
        start: billingStart,
        end: billingEnd,
      });
      setBillingUsage(
        await api<ClientBillingUsage>(
          `/api/admin/clients/${client.id}/billing-usage?${params.toString()}`,
          token,
        ),
      );
    } catch (error) {
      notice(
        error instanceof Error ? error.message : "Unable to load client usage",
      );
    } finally {
      setBillingLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="soft-card rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              Client accounts
            </h2>
            <p className="text-sm text-slate-500">
              Create center accounts and manage their profiles.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500">
              <Search size={16} />
              <input
                className="w-44 border-0 bg-transparent outline-none"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search clients"
                value={query}
              />
            </label>
            <button
              className="inline-flex items-center gap-2 rounded-md bg-sky-600 px-4 py-2 text-sm font-bold text-white"
              onClick={() => setCreateOpen(true)}
              type="button"
            >
              <Plus size={16} />
              Create client
            </button>
          </div>
        </div>
        <div className="table-scroll mt-5">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                <th className="py-3 pr-4">Center</th>
                <th className="py-3 pr-4">Login</th>
                <th className="py-3 pr-4">Status</th>
                <th className="py-3 pr-4">Action</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((client) => (
                <tr
                  className="border-b border-slate-100 align-top"
                  key={client.id}
                >
                  <td className="py-4 pr-4">
                    <p className="font-semibold text-slate-950">
                      {brandText(client.name)}
                    </p>
                    <p className="text-xs text-slate-500">
                      {client.code} - {client.primaryContact}
                    </p>
                  </td>
                  <td className="py-4 pr-4 font-mono text-xs text-slate-600">
                    {client.email}
                  </td>
                  <td className="py-4 pr-4">
                    <StatusBadge status={client.status} />
                  </td>
                  <td className="py-4 pr-4">
                    <button
                      className="table-view-button"
                      onClick={() => openClientProfile(client)}
                      type="button"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {createOpen ? (
        <Modal title="Create client" onClose={() => setCreateOpen(false)}>
          <FormCard
            title="Client details"
            onSubmit={createClient}
            submitLabel="Create and generate login"
          >
            <TextInput
              label="Facility name"
              value={form.name}
              onChange={(value) => setForm({ ...form, name: value })}
            />
            <TextInput
              label="Renewist slug"
              value="marengo"
              readOnly
            />
            <TextInput
              label="Facility type"
              value={form.facilityType}
              onChange={(value) => setForm({ ...form, facilityType: value })}
            />
            <TextInput
              label="Primary contact"
              value={form.primaryContact}
              onChange={(value) => setForm({ ...form, primaryContact: value })}
            />
            <TextInput
              label="Client email"
              value={form.email}
              onChange={(value) => setForm({ ...form, email: value })}
            />
          </FormCard>
        </Modal>
      ) : null}
      {selectedClient ? (
        <Modal
          title={`${selectedClient.name} profile`}
          onClose={() => {
            setSelectedClientId("");
            setGeneratedPassword("");
          }}
        >
          <div className="grid min-w-0 grid-cols-1 gap-5">
            <section className="soft-card rounded-lg p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">
                    {selectedClient.name}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {selectedClient.code} - {selectedClient.facilityType}
                  </p>
                </div>
                <StatusBadge status={selectedClient.status} />
              </div>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <TextInput
                  label="Primary contact"
                  value={selectedClient.primaryContact}
                  readOnly
                />
                <TextInput
                  label="Facility email"
                  value={selectedClient.email}
                  readOnly
                />
                <TextInput
                  label="Client code"
                  value={selectedClient.code}
                  readOnly
                />
                <TextInput
                  label="Internal client slug"
                  value={selectedClient.hospitalSlug ?? ""}
                  readOnly
                />
                <TextInput
                  label="Facility type"
                  value={selectedClient.facilityType}
                  readOnly
                />
              </div>
              <label className="mt-5 flex items-center justify-between gap-3 rounded-lg border border-teal-100 bg-teal-50 p-4 text-sm font-semibold text-slate-700">
                <span>
                  <span className="block text-sm font-bold uppercase text-teal-800">
                    Bridge-based integration
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-slate-600">
                    Enable Dectrocel Study Sync Agent for this client login and
                    show the Windows bridge API details.
                  </span>
                </span>
                <input
                  checked={Boolean(selectedClient.studySyncEnabled)}
                  onChange={(event) =>
                    void setStudySyncEnabled(
                      selectedClient,
                      event.target.checked,
                    )
                  }
                  type="checkbox"
                />
              </label>
              <section className="mt-5 rounded-lg border border-sky-200 bg-sky-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold uppercase text-sky-800">
                      {selectedClient.studySyncEnabled
                        ? "PACS report push-back setup"
                        : "Direct PACS setup"}
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      {selectedClient.studySyncEnabled
                        ? "Bridge receives studies, but final generated or signed reports can still be pushed back to the client PACS as DICOM Encapsulated PDF. Configure the outgoing PACS IP, port, and AE title below."
                        : "Bridge is disabled. Configure the center modality PACS to send studies to the portal receive endpoint below. Generated reports are pushed back to the configured PACS destination."}
                    </p>
                  </div>
                  <StatusBadge
                    status={selectedClient.studySyncEnabled ? "PACS PUSH" : "DIRECT PACS"}
                  />
                </div>
                <div className="mt-4">
                  <DirectPacsSetup
                    bridgeEnabled={Boolean(selectedClient.studySyncEnabled)}
                    services={selectedClient.services}
                    onSave={(values) =>
                      saveDirectPacsSetup(selectedClient, values)
                    }
                  />
                </div>
              </section>
              <form
                className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4"
                onSubmit={(event) => saveDemoMode(selectedClient, event)}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold uppercase text-amber-800">
                      Demo mode
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      Restrict demo uploads and keep demo studies out of credits
                      and billing.
                    </p>
                  </div>
                  <input
                    checked={demoModeEnabled}
                    onChange={(event) =>
                      setDemoModeEnabled(event.target.checked)
                    }
                    type="checkbox"
                  />
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
                  <TextInput
                    label="Study limit"
                    type="number"
                    value={demoStudyLimit}
                    onChange={setDemoStudyLimit}
                  />
                  <button
                    className="self-end rounded-md bg-slate-950 px-4 py-2 text-sm font-bold text-white"
                    type="submit"
                  >
                    Save demo
                  </button>
                </div>
                <p className="mt-2 text-xs font-semibold text-slate-600">
                  Used: {selectedClient._count?.processingJobs ?? 0}
                  {selectedClient.demoStudyLimit == null
                    ? ""
                    : ` / ${selectedClient.demoStudyLimit}`}{" "}
                  demo studies.
                </p>
              </form>
              <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-sm font-bold uppercase text-slate-500">
                  Renewist API hospital slug
                </h3>
                <p className="mt-2 text-sm font-semibold text-slate-700">
                  Renewist submissions always use <span className="font-extrabold">marengo</span>.
                </p>
              </div>
              <form
                className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4"
                onSubmit={(event) => saveBillingDiscount(selectedClient, event)}
              >
                <h3 className="text-sm font-bold uppercase text-slate-500">
                  Billing discount
                </h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
                  <TextInput
                    label="Discount %"
                    type="number"
                    value={discountPercent}
                    onChange={setDiscountPercent}
                  />
                  <button
                    className="self-end rounded-md bg-slate-950 px-4 py-2 text-sm font-bold text-white"
                    type="submit"
                  >
                    Save discount
                  </button>
                </div>
                <p className="mt-2 text-xs font-semibold text-slate-500">
                  Applied during monthly invoice generation for this client
                  only.
                </p>
              </form>
              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  className="rounded-md bg-sky-600 px-4 py-2 text-sm font-bold text-white"
                  onClick={() => void openBillingUsage(selectedClient)}
                  type="button"
                >
                  Bill
                </button>
                <button
                  className="rounded-md border border-amber-200 px-4 py-2 text-sm font-bold text-amber-700"
                  onClick={() => toggleStatus(selectedClient)}
                  type="button"
                >
                  {selectedClient.status === "ACTIVE"
                    ? "Block client"
                    : "Activate client"}
                </button>
                <button
                  className="rounded-md border border-rose-200 px-4 py-2 text-sm font-bold text-rose-700"
                  onClick={() => deleteClient(selectedClient)}
                  type="button"
                >
                  Delete client
                </button>
              </div>
              <section className="mt-6 rounded-lg border border-sky-100 bg-sky-50 p-4">
                <h3 className="text-sm font-bold uppercase text-sky-800">
                  Client login credentials
                </h3>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <TextInput
                    label="User ID"
                    value={
                      selectedClientUser?.userId ??
                      "Reset or recreate login to assign"
                    }
                    readOnly
                  />
                  <TextInput
                    label="Contact email"
                    value={selectedClientUser?.email ?? selectedClient.email}
                    readOnly
                  />
                  <TextInput
                    label="Portal user"
                    value={
                      selectedClientUser?.name ?? selectedClient.primaryContact
                    }
                    readOnly
                  />
                  <TextInput
                    label="Role"
                    value={selectedClientUser?.role ?? "CLIENT_USER"}
                    readOnly
                  />
                  <TextInput
                    label="Account status"
                    value={
                      selectedClientUser?.active === false
                        ? "Inactive"
                        : "Active"
                    }
                    readOnly
                  />
                </div>
                <div className="mt-4 rounded-md border border-sky-200 bg-white p-3">
                  <CredentialField
                    label="Latest one-time temporary password"
                    value={generatedPassword}
                    emptyText="Enter super admin password to reveal stored generated password"
                    onReveal={() =>
                      revealClientPassword(selectedClient, selectedClientUser)
                    }
                  />
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    Only passwords generated after this update can be viewed.
                    Reset the password if an older account has no saved
                    generated password.
                  </p>
                </div>
                <button
                  className="mt-4 rounded-md bg-slate-950 px-4 py-2 text-sm font-bold text-white"
                  onClick={() =>
                    resetClientPassword(selectedClient, selectedClientUser)
                  }
                  type="button"
                >
                  Generate new password
                </button>
              </section>
              <form
                className="mt-5 rounded-lg border border-slate-200 bg-white p-4"
                onSubmit={(event) => createClientUser(selectedClient, event)}
              >
                <h3 className="text-sm font-bold uppercase text-slate-600">
                  Create role-based user
                </h3>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <TextInput
                    label="User name"
                    value={clientUserForm.name}
                    onChange={(value) =>
                      setClientUserForm({ ...clientUserForm, name: value })
                    }
                  />
                  <TextInput
                    label="Contact email"
                    type="email"
                    value={clientUserForm.email}
                    onChange={(value) =>
                      setClientUserForm({ ...clientUserForm, email: value })
                    }
                  />
                  <SelectInput
                    label="Portal role"
                    value={clientUserForm.portalRole}
                    onChange={(value) =>
                      setClientUserForm({
                        ...clientUserForm,
                        portalRole: value as ClientPortalRole,
                      })
                    }
                    options={clientPortalRoleOptions}
                  />
                  <button
                    className="self-end rounded-md bg-sky-600 px-4 py-2 text-sm font-bold text-white"
                    type="submit"
                  >
                    Create user
                  </button>
                </div>
              </form>
              <p className="pw-help">All Marengo services are available to this center.</p>
            </section>

          </div>
        </Modal>
      ) : null}
      {selectedClient && billingUsageOpen ? (
        <Modal
          title={`${selectedClient.name} usage`}
          onClose={() => setBillingUsageOpen(false)}
          wide
        >
          <div className="space-y-5">
            <section className="soft-card rounded-lg p-5">
              <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
                <TextInput
                  label="Start date"
                  type="date"
                  value={billingStart}
                  onChange={setBillingStart}
                />
                <TextInput
                  label="End date"
                  type="date"
                  value={billingEnd}
                  onChange={setBillingEnd}
                />
                <button
                  className="self-end rounded-md bg-sky-600 px-4 py-2 text-sm font-bold text-white"
                  disabled={billingLoading}
                  onClick={() => void openBillingUsage(selectedClient)}
                  type="button"
                >
                  {billingLoading ? "Loading..." : "Load usage"}
                </button>
              </div>
            </section>
            <div className="grid gap-4 md:grid-cols-4">
              <MetricCard
                icon={ClipboardList}
                label="Transactions"
                value={String(billingUsage?.summary.transactionCount ?? 0)}
                sub={`${toDate(billingStart)} - ${toDate(billingEnd)}`}
              />
              <MetricCard
                icon={UploadCloud}
                label="Units"
                value={String(billingUsage?.summary.units ?? 0)}
                sub="Billable study units"
              />
              <MetricCard
                icon={CreditCard}
                label="Amount"
                value={moneyMinor(
                  billingUsage?.summary.amountMinor ?? 0,
                  billingUsage?.summary.currency ?? "INR",
                )}
                sub="Client charge"
              />
              <MetricCard
                icon={FileText}
                label="Provider payable"
                value={moneyMinor(
                  billingUsage?.summary.providerPayableMinor ?? 0,
                  billingUsage?.summary.currency ?? "INR",
                )}
                sub="If applicable"
              />
            </div>
            <SimpleTable
              title="Client usage details"
              columns={[
                "Date",
                "Service",
                "Workflow",
                "Priority",
                "Units",
                "Unit price",
                "Amount",
                "Invoice",
                "Status",
              ]}
              rows={(billingUsage?.transactions ?? []).map((item) => [
                toDate(item.createdAt),
                displayServiceName(item.serviceName),
                workflowLabels[item.workflowType as WorkflowType] ??
                  item.workflowType,
                item.priority,
                item.units,
                billingAmountLabel(
                  item.unitPriceMinor,
                  item.currency,
                  item.metadata,
                ),
                billingAmountLabel(
                  item.amountMinor,
                  item.currency,
                  item.metadata,
                ),
                item.invoice?.invoiceNumber ?? "-",
                item.status,
              ])}
            />
          </div>
        </Modal>
      ) : null}
      {passwordPrompt}
    </div>
  );
}

function Modal({
  title, children, onClose, wide = false,
}: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const workspace = useContext(WorkspaceDrawerContext);
  return workspace ? <WorkspaceDrawer title={title} onClose={onClose} wide={wide}>{children}</WorkspaceDrawer> : <LegacyModal title={title} onClose={onClose} wide={wide}>{children}</LegacyModal>;
}

function LegacyModal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() =>
      closeButtonRef.current?.focus(),
    );
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-start justify-center overflow-y-auto bg-slate-950/55 p-3 backdrop-blur-[2px] sm:p-5"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        aria-label={title}
        aria-modal="true"
        className={cx(
          "my-auto flex max-h-[calc(100dvh-1.5rem)] w-full flex-col overflow-hidden rounded-xl bg-white shadow-2xl outline-none sm:max-h-[calc(100dvh-2.5rem)]",
          wide ? "max-w-6xl" : "max-w-2xl",
        )}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-5 sm:py-4">
          <h2 className="text-xl font-semibold text-slate-950">{title}</h2>
          <button
            aria-label={`Close ${title}`}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-slate-200 text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950"
            onClick={onClose}
            ref={closeButtonRef}
            title="Close"
            type="button"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5">
          {children}
        </div>
      </section>
    </div>,
    document.body,
  );
}

function DetailField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="record-detail-field">
      <span>{label}</span>
      <div>{value}</div>
    </div>
  );
}

function FormCard({
  title,
  children,
  submitLabel,
  onSubmit,
  className = "",
}: {
  title: string;
  children: ReactNode;
  submitLabel: string;
  onSubmit: (event: FormEvent) => void;
  className?: string;
}) {
  return (
    <form
      className={cx("soft-card form-card rounded-lg p-5", className)}
      onSubmit={onSubmit}
    >
      <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
      <div className="mt-5 grid gap-4 md:grid-cols-2">{children}</div>
      <div className="form-card-actions">
        <button
          className="inline-flex items-center gap-2 rounded-md bg-sky-600 px-4 py-3 text-sm font-bold text-white"
          type="submit"
        >
          <Plus size={16} />
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

function TextInput({
  label,
  value,
  onChange,
  type = "text",
  readOnly = false,
  required = false,
  maxLength,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  type?: string;
  readOnly?: boolean;
  required?: boolean;
  maxLength?: number;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
      {label}
      <input
        className={cx(
          "rounded-md border px-3 py-2 text-sm outline-none",
          readOnly
            ? "border-slate-200 bg-slate-100 font-mono text-slate-500"
            : "border-slate-200 bg-white text-slate-900 focus:border-sky-400",
        )}
        maxLength={maxLength}
        readOnly={readOnly}
        required={required}
        type={type}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
      />
      {maxLength ? (
        <span className="text-xs font-medium text-slate-500">
          Maximum {maxLength} characters
        </span>
      ) : null}
    </label>
  );
}

function DirectPacsSetup({
  bridgeEnabled = false,
  services,
  emptyMessage = "No PACS service is configured yet.",
  onSave,
}: {
  bridgeEnabled?: boolean;
  services: ClientService[];
  emptyMessage?: string;
  onSave?: (values: {
    ec2PublicIp: string;
    receivingPort: number;
    aeTitle: string;
    clientPacsIp: string;
    clientPacsPort: number;
    clientPacsAeTitle: string;
    returnFormat: ReturnFormat;
  }) => Promise<void>;
}) {
  const pacsServices = services.filter((item) => item.pacsConfig);
  if (!pacsServices.length && (!bridgeEnabled || !services.length)) {
    return (
      <p className="rounded-md border border-slate-200 bg-white p-3 text-sm font-semibold text-slate-500">
        {bridgeEnabled
          ? "Allot at least one PACS service before configuring Bridge report push-back."
          : emptyMessage}
      </p>
    );
  }
  const primaryConfig = pacsServices[0]?.pacsConfig;
  const editable = Boolean(onSave);
  const formats = Array.from(
    new Set(
      pacsServices
        .map((item) => item.pacsConfig?.returnFormat)
        .filter((value): value is ReturnFormat => Boolean(value)),
    ),
  );
  const [form, setForm] = useState({
    ec2PublicIp: primaryConfig?.ec2PublicIp ?? "",
    receivingPort: String(primaryConfig?.receivingPort ?? 1),
    aeTitle: primaryConfig?.aeTitle ?? "DECXPERT",
    clientPacsIp: primaryConfig?.clientPacsIp ?? "",
    clientPacsPort: String(primaryConfig?.clientPacsPort ?? 104),
    clientPacsAeTitle: primaryConfig?.clientPacsAeTitle ?? "",
    returnFormat: primaryConfig?.returnFormat ?? "DICOM_ENCAPSULATED_PDF",
  });
  const configuredServices = pacsServices.length ? pacsServices : services;
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({
      ec2PublicIp: primaryConfig?.ec2PublicIp ?? "",
      receivingPort: String(primaryConfig?.receivingPort ?? 1),
      aeTitle: primaryConfig?.aeTitle ?? "DECXPERT",
      clientPacsIp: primaryConfig?.clientPacsIp ?? "",
      clientPacsPort: String(primaryConfig?.clientPacsPort ?? 104),
      clientPacsAeTitle: primaryConfig?.clientPacsAeTitle ?? "",
      returnFormat: primaryConfig?.returnFormat ?? "DICOM_ENCAPSULATED_PDF",
    });
  }, [
    primaryConfig?.ec2PublicIp,
    primaryConfig?.receivingPort,
    primaryConfig?.aeTitle,
    primaryConfig?.clientPacsIp,
    primaryConfig?.clientPacsPort,
    primaryConfig?.clientPacsAeTitle,
    primaryConfig?.returnFormat,
  ]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!onSave) return;
    setSaving(true);
    try {
      await onSave({
        ec2PublicIp: form.ec2PublicIp.trim(),
        receivingPort: Number(form.receivingPort),
        aeTitle: form.aeTitle.trim(),
        clientPacsIp: form.clientPacsIp.trim(),
        clientPacsPort: Number(form.clientPacsPort),
        clientPacsAeTitle: form.clientPacsAeTitle.trim(),
        returnFormat: bridgeEnabled ? "DICOM_ENCAPSULATED_PDF" : form.returnFormat,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="rounded-md border border-slate-200 bg-white p-3" onSubmit={submit}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-slate-900">
            {bridgeEnabled
              ? "Shared report push-back PACS for bridge studies"
              : "Shared PACS route for all configured modalities"}
          </p>
          <p className="mt-1 text-xs font-medium leading-5 text-slate-500">
            {bridgeEnabled
              ? "Bridge handles study intake. Configure the PACS destination once below so final reports are returned as DICOM Encapsulated PDF to the client's PACS."
              : "Configure your PACS once. This one incoming listener accepts CT, MRI, X-ray, mammography, and other assigned studies; generated reports are pushed back through the one outgoing destination below."}
          </p>
        </div>
        <span className="rounded-full bg-sky-50 px-2 py-1 text-xs font-bold uppercase text-sky-700">
          {configuredServices.length} services
        </span>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {!bridgeEnabled ? (
          <>
            <TextInput
              label="Portal incoming IP"
              value={form.ec2PublicIp}
              onChange={(value) => setForm({ ...form, ec2PublicIp: value })}
              readOnly={!editable}
              required={editable}
            />
            <TextInput
              label="Portal incoming port"
              value={form.receivingPort}
              onChange={(value) => setForm({ ...form, receivingPort: value })}
              readOnly={!editable}
              required={editable}
              type="number"
            />
            <TextInput
              label="Portal incoming AE title"
              value={form.aeTitle}
              onChange={(value) => setForm({ ...form, aeTitle: value })}
              readOnly={!editable}
              required={editable}
              maxLength={16}
            />
          </>
        ) : null}
        {bridgeEnabled ? (
          <TextInput
            label="Report return format"
            value="DICOM Encapsulated PDF"
            readOnly
          />
        ) : editable ? (
          <SelectInput
            label="Return format"
            value={form.returnFormat}
            onChange={(value) =>
              setForm({ ...form, returnFormat: value as ReturnFormat })
            }
            options={Object.entries(formatLabels)}
          />
        ) : (
          <TextInput
            label="Return format"
            value={formats.length > 1 ? "Configured per report format" : formats[0] ?? "-"}
            readOnly
          />
        )}
        <TextInput
          label={bridgeEnabled ? "Client PACS IP for report push" : "Outgoing report PACS IP"}
          value={form.clientPacsIp}
          onChange={(value) => setForm({ ...form, clientPacsIp: value })}
          readOnly={!editable}
          required={editable}
        />
        <TextInput
          label={bridgeEnabled ? "Client PACS port for report push" : "Outgoing report PACS port"}
          value={form.clientPacsPort}
          onChange={(value) => setForm({ ...form, clientPacsPort: value })}
          readOnly={!editable}
          required={editable}
          type="number"
        />
        <TextInput
          label={bridgeEnabled ? "Client PACS AE title for report push" : "Outgoing report PACS AE title"}
          value={form.clientPacsAeTitle}
          onChange={(value) => setForm({ ...form, clientPacsAeTitle: value })}
          readOnly={!editable}
          required={editable}
          maxLength={16}
        />
      </div>
      {editable ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            className="rounded-md bg-sky-600 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
            disabled={saving}
            type="submit"
          >
            {saving ? "Saving PACS setup..." : "Save PACS setup"}
          </button>
          <span className="text-xs font-medium text-slate-500">
            {bridgeEnabled
              ? "Outgoing PACS destination applies to bridge, AI, and Renewist signed reports for all assigned services. Keep return format as DICOM Encapsulated PDF for PACS push-back."
              : "Incoming listener changes apply to this shared direct route. Outgoing report destination applies to all assigned services."}
          </span>
        </div>
      ) : null}
      <p className="mt-3 text-xs font-semibold text-slate-500">
        Assigned modalities:{" "}
        {configuredServices
          .map((item) => displayServiceName(item.service.name))
          .join(", ")}
      </p>
    </form>
  );
}

function CredentialField({
  label,
  value,
  emptyText = "Only shown immediately after creation or reset",
  onReveal,
}: {
  label: string;
  value?: string | null;
  emptyText?: string;
  onReveal?: () => Promise<string>;
}) {
  const [visible, setVisible] = useState(false);
  const [revealedValue, setRevealedValue] = useState("");
  const [loading, setLoading] = useState(false);
  const actualValue = revealedValue || (value?.trim() ? value : "");
  async function toggleVisible() {
    if (visible) {
      setVisible(false);
      return;
    }
    if (!actualValue && onReveal) {
      setLoading(true);
      try {
        const revealed = await onReveal();
        if (!revealed) return;
        setRevealedValue(revealed);
      } catch (error) {
        window.alert(error instanceof Error ? error.message : "Unable to reveal password");
        return;
      } finally {
        setLoading(false);
      }
    }
    setVisible(true);
  }
  return (
    <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
      {label}
      <span className="flex items-center overflow-hidden rounded-md border border-slate-200 bg-slate-100">
        <input
          className="min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-sm text-slate-700 outline-none"
          readOnly
          type={actualValue && !visible ? "password" : "text"}
          value={actualValue || emptyText}
        />
        <button
          aria-label={visible ? "Hide password" : "Show password"}
          className="grid h-10 w-10 place-items-center text-slate-500 hover:text-sky-700 disabled:cursor-not-allowed disabled:text-slate-300"
          disabled={loading || (!actualValue && !onReveal)}
          onClick={toggleVisible}
          type="button"
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </span>
    </label>
  );
}

function FileInput({
  label,
  fileName,
  onChange,
  accept = signatureTypes.join(","),
  hint = "PNG, JPG, or WEBP up to 2 MB",
}: {
  label: string;
  fileName: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  accept?: string;
  hint?: string;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold text-slate-700 md:col-span-2">
      {label}
      <span className="flex flex-col gap-2 rounded-md border border-dashed border-slate-300 bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-sm font-medium text-slate-500">
          {fileName || hint}
        </span>
        <span className="inline-flex w-full justify-center rounded-md bg-slate-900 px-3 py-2 text-sm font-bold text-white sm:w-auto">
          Choose file
        </span>
      </span>
      <input
        accept={accept}
        className="sr-only"
        type="file"
        onChange={onChange}
      />
    </label>
  );
}

function SelectInput({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
      {label}
      <select
        className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-400"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([optionValue, labelText]) => (
          <option key={`${optionValue}-${labelText}`} value={optionValue}>
            {labelText}
          </option>
        ))}
      </select>
    </label>
  );
}

function RenewistAdminView({
  token,
  notice,
}: {
  token: string;
  notice: (message: string) => void;
}) {
  const [providers, setProviders] = useState<TeleradiologyProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "Renewist Sub Admin", email: "" });
  const [generatedPassword, setGeneratedPassword] = useState("");
  const { passwordPrompt } = usePasswordConfirmation();

  async function loadProviders() {
    setLoading(true);
    try {
      setProviders(
        await api<TeleradiologyProvider[]>(
          "/api/admin/teleradiology/providers",
          token,
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProviders();
  }, [token]);

  const renewist =
    providers.find((provider) => provider.code === "RENEWIST") ?? providers[0];

  async function createRenewistUser(event: FormEvent) {
    event.preventDefault();
    if (!renewist) return;
    const result = await api<{ user: User; temporaryPassword: string }>(
      `/api/admin/teleradiology/providers/${renewist.code}/users`,
      token,
      {
        method: "POST",
        body: JSON.stringify(form),
      },
    );
    setGeneratedPassword(
      `${result.user.userId ?? result.user.email} / ${result.temporaryPassword}`,
    );
    setForm({ name: "Renewist Sub Admin", email: "" });
    notice(
      `Renewist login created for ${result.user.email}. The one-time password is shown below.`,
    );
    await loadProviders();
  }

  async function resetPassword(user: User) {
    const result = await api<{ user: User; temporaryPassword: string }>(
      `/api/admin/teleradiology/provider-users/${user.id}/reset-password`,
      token,
      { method: "POST" },
    );
    setGeneratedPassword(`${result.user.email} / ${result.temporaryPassword}`);
    notice(`A new one-time password was generated for ${result.user.email}.`);
    await loadProviders();
  }

  return (
    <div className="space-y-6">
      <section className="soft-card rounded-lg p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              Renewist sub-admin login credentials
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Create and manage provider-scoped users for the Renewist portal.
            </p>
          </div>
          <StatusBadge status={renewist?.active ? "ACTIVE" : "FAILED"} />
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <TextInput
            label="Provider"
            value={
              renewist
                ? `${renewist.name} (${renewist.code})`
                : loading
                  ? "Loading..."
                  : "Missing"
            }
            readOnly
          />
          <TextInput
            label="Callback API"
            value={
              renewist?.reportCallbackEndpoint ??
              "/api/v1/integrations/renewist/reports"
            }
            readOnly
          />
        </div>
        {generatedPassword ? (
          <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm font-semibold text-sky-800">
            Latest credential: {generatedPassword}
          </div>
        ) : null}
      </section>

      <FormCard
        title="Create Renewist sub-admin"
        onSubmit={createRenewistUser}
        submitLabel="Create login"
      >
        <TextInput
          label="Name"
          value={form.name}
          onChange={(value) => setForm({ ...form, name: value })}
        />
        <TextInput
          label="Email"
          value={form.email}
          onChange={(value) => setForm({ ...form, email: value })}
        />
      </FormCard>

      <section className="soft-card rounded-lg p-5">
        <h2 className="mb-4 text-lg font-semibold text-slate-950">
          Renewist users
        </h2>
        <div className="table-scroll no-x-scroll">
          <table className="report-table renewist-users-table w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                {[
                  "Name",
                  "Email",
                  "Status",
                  "Provider",
                  "Created",
                  "Action",
                ].map((column) => (
                  <th className="py-3 pr-4" key={column}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(renewist?.users ?? []).map((user) => (
                <tr
                  className="border-b border-slate-100 align-top"
                  key={user.id}
                >
                  <td className="py-4 pr-4 font-semibold text-slate-900">
                    {user.name}
                  </td>
                  <td className="py-4 pr-4 text-slate-700">{user.email}</td>
                  <td className="py-4 pr-4 text-slate-700">
                    {user.active ? "Active" : "Inactive"}
                  </td>
                  <td className="py-4 pr-4 text-slate-700">
                    {user.providerCode ?? "-"}
                  </td>
                  <td className="py-4 pr-4 text-slate-700">
                    {toDate(user.createdAt ?? new Date().toISOString())}
                  </td>
                  <td className="py-4 pr-4">
                    <button
                      className="table-action-button rounded-md border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700"
                      onClick={() => void resetPassword(user)}
                      type="button"
                    >
                      Reset password
                    </button>
                  </td>
                </tr>
              ))}
              {!(renewist?.users ?? []).length ? (
                <tr>
                  <td
                    className="py-6 text-sm font-semibold text-slate-500"
                    colSpan={6}
                  >
                    No Renewist users yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
      {passwordPrompt}
    </div>
  );
}

function ServicesView({ services }: { services: Service[] }) {
  return (
    <SimpleTable
      columns={["Service", "Code", "Category", "Enabled", "Description"]}
      rows={services.map((service) => [
        displayServiceName(service.name),
        service.code,
        service.category,
        service.enabled ? "Yes" : "No",
        service.description,
      ])}
    />
  );
}

function AnalyticsView({ overview }: { overview: AdminOverview }) {
  const [centerId, setCenterId] = useState("ALL");
  const chartData = buildUsageChart(overview.usageLogs, overview.jobs);
  const totalLogs = overview.usageLogs.length;
  const successfulLogs = overview.usageLogs.filter((log) => log.success).length;
  const successRate = totalLogs
    ? `${((successfulLogs / totalLogs) * 100).toFixed(1)}%`
    : "0%";
  const failedJobs = overview.jobs.filter(
    (job) => job.status === "FAILED",
  ).length;
  const serviceTotals = overview.usageLogs.reduce<Record<string, number>>(
    (totals, log) => {
      totals[log.serviceName] = (totals[log.serviceName] ?? 0) + 1;
      return totals;
    },
    {},
  );
  const topService = Object.entries(serviceTotals).sort(
    (a, b) => b[1] - a[1],
  )[0];
  const selectedCenter = overview.clients.find(
    (client) => client.id === centerId,
  );
  const networkJobs = (overview.processingJobs ?? []).filter(
    (job) => centerId === "ALL" || job.clientId === centerId,
  );
  const networkReports = overview.reportReviews.filter(
    (report) => centerId === "ALL" || report.clientId === centerId,
  );
  const now = new Date();
  const monthlyNetworkData = Array.from({ length: 12 }, (_item, offset) => {
    const monthDate = new Date(
      now.getFullYear(),
      now.getMonth() - (11 - offset),
      1,
    );
    const key = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`;
    const studies = networkJobs.filter((job) =>
      job.createdAt.startsWith(key),
    ).length;
    const reports = networkReports.filter((report) =>
      String(report.generatedAt ?? report.createdAt).startsWith(key),
    );
    const completed = reports.filter((report) =>
      ["APPROVED", "PUSHED"].includes(report.status),
    ).length;
    return {
      key,
      label: monthDate.toLocaleDateString(undefined, {
        month: "short",
        year: "numeric",
      }),
      studies,
      reports: reports.length,
      completed,
      completion: Math.round((completed / Math.max(1, reports.length)) * 100),
    };
  });

  function exportNetworkAnalysis() {
    downloadCsvFile(
      `marengo-super-admin-analysis-${selectedCenter?.code?.toLowerCase() ?? "all-centers"}-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        "Scope",
        "Month",
        "Studies received",
        "Reports generated",
        "Completed reports",
        "Completion percent",
      ],
      monthlyNetworkData.map((month) => [
        selectedCenter?.name ?? "All Marengo centers",
        month.label,
        month.studies,
        month.reports,
        month.completed,
        month.completion,
      ]),
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={UploadCloud}
          label="Studies processed"
          value={String(totalLogs)}
          sub="Usage logs"
        />
        <MetricCard
          icon={Activity}
          label="Top service"
          value={topService ? String(topService[1]) : "0"}
          sub={topService?.[0] ?? "No usage yet"}
        />
        <MetricCard
          icon={CheckCircle2}
          label="Successful returns"
          value={successRate}
          sub={`${successfulLogs} successful`}
        />
        <MetricCard
          icon={AlertTriangle}
          label="Failed jobs"
          value={String(failedJobs)}
          sub="Needs review"
        />
      </div>
      <section className="soft-card rounded-lg p-5">
        <h2 className="text-lg font-semibold text-slate-950">
          Service usage analytics
        </h2>
        <div className="mt-6 h-96">
          <ServiceUsageChart data={chartData} />
        </div>
      </section>
      <section className="soft-card rounded-lg p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              Marengo network monthly performance
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Compare center study volume, generated reports, and completion
              across the latest 12 months.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <SelectInput
              label="Center"
              value={centerId}
              onChange={setCenterId}
              options={[
                ["ALL", "All Marengo centers"],
                ...overview.clients.map(
                  (client) =>
                    [client.id, brandText(client.name)] as [string, string],
                ),
              ]}
            />
            <button
              className="inline-flex min-h-11 items-center gap-2 rounded-md bg-sky-700 px-4 py-2.5 text-sm font-bold text-white"
              onClick={exportNetworkAnalysis}
              type="button"
            >
              <Download aria-hidden="true" size={15} />
              Export CSV
            </button>
          </div>
        </div>
        <div
          className="mt-6 h-80"
          role="img"
          aria-label={`Twelve-month study and report trend for ${selectedCenter?.name ?? "all Marengo centers"}`}
        >
          <MonthlyNetworkChart data={monthlyNetworkData} />
        </div>
      </section>
      <SimpleTable
        title="Monthly operational analysis"
        columns={["Month", "Studies", "Reports", "Completed", "Completion"]}
        rows={monthlyNetworkData.map((month) => [
          month.label,
          month.studies,
          month.reports,
          month.completed,
          `${month.completion}%`,
        ])}
      />
    </div>
  );
}

function CreditsView({ clients }: { clients: Client[] }) {
  const rows = clients.flatMap((client) =>
    client.services.map((item) => {
      const postpaidTeleradiology = isTeleradiologyWorkflowType(
        item.workflowType ?? item.pacsConfig?.workflowType ?? "AI_ONLY",
      );
      return [
        brandText(client.name),
        item.service.name,
        postpaidTeleradiology ? "Postpaid" : item.credits.toLocaleString(),
        postpaidTeleradiology
          ? "Monthly billing"
          : item.usedCredits.toLocaleString(),
        postpaidTeleradiology
          ? "No credit limit"
          : creditLeft(item).toLocaleString(),
        postpaidTeleradiology ? "Monthly billing" : toDate(item.validUntil),
      ];
    }),
  );
  return (
    <SimpleTable
      columns={[
        "Client",
        "Service",
        "Total credits",
        "Used credits",
        "Credit left",
        "Valid until",
      ]}
      rows={rows}
    />
  );
}

function JobsView({ jobs }: { jobs: Job[] }) {
  return (
    <SimpleTable
      columns={[
        "Job",
        "Client",
        "Study",
        "Service",
        "Status",
        "Attempts",
        "Created",
      ]}
      rows={jobs.map((job) => [
        job.id,
        brandText(job.client?.name ?? "Client"),
        job.study?.studyUid ?? "-",
        job.serviceName,
        job.status,
        job.attempts,
        toDate(job.createdAt),
      ])}
    />
  );
}

function UsageView({ logs }: { logs: UsageLog[] }) {
  return (
    <SimpleTable
      columns={["Client", "Service", "Study", "Credits", "Result", "Message"]}
      rows={logs.map((log) => [
        brandText(log.client?.name ?? "Client"),
        log.serviceName,
        log.studyUid ?? "-",
        log.creditsUsed,
        log.success ? "Success" : "Failed",
        log.message,
      ])}
    />
  );
}

function PlansView({ services }: { services: Service[] }) {
  return (
    <SimpleTable
      columns={["Plan", "Credits", "Validity", "Service"]}
      rows={services.map((service) => [
        `${service.name} PACS Plan`,
        "Custom",
        "Admin selected",
        service.name,
      ])}
    />
  );
}

function SubscriptionsView({ clients }: { clients: Client[] }) {
  const rows = clients.flatMap((client) =>
    client.services.map((item) => {
      const postpaidTeleradiology = isTeleradiologyWorkflowType(
        item.workflowType ?? item.pacsConfig?.workflowType ?? "AI_ONLY",
      );
      return [
        brandText(client.name),
        item.service.name,
        item.status,
        postpaidTeleradiology
          ? "Postpaid monthly"
          : `${creditLeft(item).toLocaleString()} / ${item.credits.toLocaleString()}`,
        postpaidTeleradiology ? "Monthly billing" : toDate(item.validUntil),
      ];
    }),
  );
  return (
    <SimpleTable
      columns={["Client", "Service", "Status", "Credit left", "Valid until"]}
      rows={rows}
    />
  );
}

function BillingView({
  billing,
  scope,
  token,
  reload,
  notice,
}: {
  billing?: BillingSnapshot;
  scope: "admin" | "client";
  token?: string;
  reload?: () => Promise<void>;
  notice?: (message: string) => void;
}) {
  const defaultCurrency =
    billing?.invoices[0]?.currency ??
    billing?.transactions[0]?.currency ??
    "INR";
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    invoices: true,
    usage: true,
    pricing: false,
    payments: true,
    settlements: false,
    payables: false,
    disputes: true,
  });

  if (!billing)
    return <EmptyState message="Billing data is not available yet." />;

  function sectionOpen(key: string) {
    return openSections[key] ?? true;
  }

  function toggleSection(key: string) {
    setOpenSections((current) => ({
      ...current,
      [key]: !(current[key] ?? true),
    }));
  }

  async function payInvoice(invoice: BillingInvoice) {
    if (!token) return;
    try {
      const link = await api<RazorpayPaymentLinkResponse>(
        `/api/v1/client/invoices/${invoice.id}/razorpay-payment-link`,
        token,
        { method: "POST" },
      );
      if (!link.paymentUrl) throw new Error("Payment link was not generated");
      window.location.href = link.paymentUrl;
    } catch (error) {
      notice?.(
        error instanceof Error ? error.message : "Unable to open payment link.",
      );
    }
  }
  async function checkPaymentStatus(invoice: BillingInvoice) {
    if (!token || !reload) return;
    try {
      const updated = await api<BillingInvoice>(
        `/api/v1/client/invoices/${invoice.id}/sync-razorpay-payment`,
        token,
        { method: "POST" },
      );
      notice?.(
        updated.status === "PAID"
          ? `${invoice.invoiceNumber} payment confirmed.`
          : `${invoice.invoiceNumber} is still unpaid. Razorpay confirmation may take a moment.`,
      );
      await reload();
    } catch {
      notice?.(
        `${invoice.invoiceNumber} is still unpaid. Razorpay confirmation may take a moment.`,
      );
    }
  }
  async function downloadInvoice(invoice: BillingInvoice) {
    if (!token) return;
    try {
      const prefix = scope === "admin" ? "/api/v1/billing" : "/api/v1/client";
      await downloadProtectedFile(
        `${prefix}/invoices/${invoice.id}/download`,
        token,
      );
    } catch (error) {
      notice?.(
        error instanceof Error ? error.message : "Unable to download invoice.",
      );
    }
  }
  async function markSettlementPaid(settlement: ProviderSettlement) {
    if (!token || !reload) return;
    await api<ProviderSettlement>(
      `/api/v1/billing/provider-settlements/${settlement.id}/record-payment`,
      token,
      {
        method: "POST",
        body: JSON.stringify({ method: "BANK_TRANSFER" }),
      },
    );
    notice?.(
      `${settlement.settlementNumber} marked paid. Renewist pending payable updated.`,
    );
    await reload();
  }
  async function markInvoicePaidManually(invoice: BillingInvoice) {
    if (!token || !reload) return;
    await api<BillingInvoice>(
      `/api/v1/billing/invoices/${invoice.id}/mark-paid-manually`,
      token,
      {
        method: "POST",
        body: JSON.stringify({ method: "MANUAL" }),
      },
    );
    notice?.(`${invoice.invoiceNumber} marked paid manually.`);
    await reload();
  }
  function invoiceActionCell(invoice: BillingInvoice) {
    const paidAmount = (invoice.payments ?? [])
      .filter((payment) => payment.status === "CAPTURED")
      .reduce((sum, payment) => sum + payment.amountMinor, 0);
    const latestPayment = (invoice.payments ?? [])[0];
    const latestOrder =
      invoice.razorpayPaymentLinkId ??
      invoice.paymentLinks?.[0]?.providerLinkId;
    return (
      <div className="min-w-[220px] space-y-2">
        <div className="flex flex-wrap gap-2">
          {scope === "client" && invoice.status !== "PAID" ? (
            <button
              className="rounded-md bg-sky-600 px-3 py-2 text-xs font-bold text-white"
              onClick={() => void payInvoice(invoice)}
              type="button"
            >
              Pay now
            </button>
          ) : null}
          {scope === "client" &&
          invoice.status !== "PAID" &&
          (invoice.razorpayPaymentLinkId || invoice.paymentUrl) ? (
            <button
              className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-bold text-sky-700"
              onClick={() => void checkPaymentStatus(invoice)}
              type="button"
            >
              Check status
            </button>
          ) : null}
          {scope === "admin" && invoice.status !== "PAID" ? (
            <button
              className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-bold text-white"
              onClick={() => void markInvoicePaidManually(invoice)}
              type="button"
            >
              Mark paid manually
            </button>
          ) : null}
          <button
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700"
            onClick={() => void downloadInvoice(invoice)}
            type="button"
          >
            Download invoice
          </button>
        </div>
        <p className="text-xs font-semibold text-slate-500">
          Paid: {moneyMinor(paidAmount, invoice.currency)}
        </p>
        {latestOrder ? (
          <p className="break-all text-[11px] font-semibold text-slate-400">
            Order: {latestOrder}
          </p>
        ) : null}
        {latestPayment?.providerPaymentId ? (
          <p className="break-all text-[11px] font-semibold text-slate-400">
            Txn: {latestPayment.providerPaymentId}
          </p>
        ) : null}
      </div>
    );
  }
  const transactionRows = billing.transactions.map((item) => [
    scope === "admin"
      ? brandText(item.client?.name ?? "Client")
      : item.serviceName,
    item.serviceName,
    workflowLabels[(item.workflowType as WorkflowType) ?? "AI_ONLY"] ??
      item.workflowType,
    item.priority,
    item.units,
    billingAmountLabel(item.unitPriceMinor, item.currency, item.metadata),
    billingAmountLabel(item.amountMinor, item.currency, item.metadata),
    item.invoice?.invoiceNumber ?? item.status,
  ]);
  const pricingGroups = new Map<
    string,
    {
      serviceName: string;
      workflow: string;
      currency: string;
      active: boolean;
      priorities: Partial<Record<string, PricingRule>>;
    }
  >();
  for (const rule of billing.pricingRules) {
    const workflow =
      rule.workflowType === "ANY"
        ? "All workflows"
        : (workflowLabels[(rule.workflowType as WorkflowType) ?? "AI_ONLY"] ??
          rule.workflowType);
    const key = `${rule.serviceName}|${workflow}`;
    const group = pricingGroups.get(key) ?? {
      serviceName: rule.serviceName,
      workflow,
      currency: rule.currency,
      active: true,
      priorities: {},
    };
    group.active = group.active && rule.active;
    group.priorities[rule.priority] = rule;
    pricingGroups.set(key, group);
  }
  const pricingRows = Array.from(pricingGroups.values()).map((group) => {
    const regular = group.priorities.REGULAR;
    const night = group.priorities.NIGHT;
    const urgent = group.priorities.URGENT;
    return [
      group.serviceName,
      group.workflow,
      regular ? moneyMinor(regular.unitPriceMinor, regular.currency) : "-",
      night ? moneyMinor(night.unitPriceMinor, night.currency) : "-",
      urgent ? moneyMinor(urgent.unitPriceMinor, urgent.currency) : "-",
      scope === "admin" && regular
        ? moneyMinor(regular.providerPayableMinor, regular.currency)
        : scope === "admin"
          ? "-"
          : "Hidden",
      scope === "admin" && night
        ? moneyMinor(night.providerPayableMinor, night.currency)
        : scope === "admin"
          ? "-"
          : "Hidden",
      scope === "admin" && urgent
        ? moneyMinor(urgent.providerPayableMinor, urgent.currency)
        : scope === "admin"
          ? "-"
          : "Hidden",
      group.active ? "Active" : "Inactive",
    ];
  });
  const paymentRows = billing.payments.map((payment) => [
    scope === "admin"
      ? brandText(payment.client?.name ?? "Client")
      : (payment.invoice?.invoiceNumber ?? "-"),
    payment.invoice?.invoiceNumber ?? "-",
    payment.provider,
    payment.method ?? "-",
    payment.status,
    moneyMinor(payment.amountMinor, payment.currency),
    toDate(payment.paidAt),
  ]);
  const payableRows = billing.providerPayables.map((item) => [
    item.providerCode,
    item.serviceName,
    workflowLabels[(item.workflowType as WorkflowType) ?? "AI_ONLY"] ??
      item.workflowType,
    item.priority,
    item.units,
    billingAmountLabel(item.amountMinor, item.currency, item.metadata),
    item.status,
  ]);
  const settlementRows = billing.providerSettlements.map((item) => [
    item.settlementNumber,
    item.providerCode,
    `${toDate(item.periodStart)} - ${toDate(item.periodEnd)}`,
    item.status,
    moneyMinor(item.subtotalMinor, item.currency),
    item.paidAt ? toDate(item.paidAt) : "-",
  ]);
  const disputeRows = billing.disputes.map((item) => [
    scope === "admin" ? brandText(item.client?.name ?? "Client") : item.type,
    item.type,
    item.status,
    item.reason,
    toDate(item.createdAt),
  ]);
  const invoiceRows = billing.invoices.map((invoice) => [
    invoice.invoiceNumber,
    scope === "admin"
      ? brandText(invoice.client?.name ?? "Client")
      : `${toDate(invoice.periodStart)} - ${toDate(invoice.periodEnd)}`,
    <StatusBadge status={invoice.status} />,
    moneyMinor(invoice.subtotalMinor, invoice.currency),
    moneyMinor(invoice.taxMinor, invoice.currency),
    moneyMinor(invoice.totalMinor, invoice.currency),
    invoiceActionCell(invoice),
  ]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={CreditCard}
          label="Current estimate"
          value={moneyMinor(
            billing.summary.uninvoicedAmountMinor,
            defaultCurrency,
          )}
          sub={`${billing.summary.transactionCount} transactions`}
        />
        <MetricCard
          icon={FileText}
          label="Invoices"
          value={moneyMinor(
            billing.summary.invoicedAmountMinor,
            defaultCurrency,
          )}
          sub={`${billing.summary.invoiceCount} generated`}
        />
        <MetricCard
          icon={CheckCircle2}
          label="Paid"
          value={moneyMinor(billing.summary.paidAmountMinor, defaultCurrency)}
          sub={`${moneyMinor(billing.summary.outstandingAmountMinor, defaultCurrency)} due`}
        />
        <MetricCard
          icon={AlertTriangle}
          label="Disputes"
          value={String(billing.summary.disputeCount)}
          sub={
            scope === "admin"
              ? `${moneyMinor(billing.summary.providerPayableMinor, defaultCurrency)} payable`
              : "Billing support"
          }
        />
      </div>
      <CollapsibleTable
        title="Monthly invoices"
        columns={[
          "Invoice",
          scope === "admin" ? "Client" : "Period",
          "Status",
          "Subtotal",
          "GST (SGST 9% + CGST 9%)",
          "Total",
          "Pay / download",
        ]}
        rows={invoiceRows}
        open={sectionOpen("invoices")}
        onToggle={() => toggleSection("invoices")}
      />
      <CollapsibleTable
        columns={[
          scope === "admin" ? "Client" : "Service",
          "Service",
          "Workflow",
          "Priority",
          "Units",
          "Rate",
          "Amount",
          "Invoice",
        ]}
        rows={transactionRows}
        title="Usage transactions"
        open={sectionOpen("usage")}
        onToggle={() => toggleSection("usage")}
      />
      {scope === "admin" ? (
        <CollapsibleTable
          columns={[
            "Service",
            "Workflow",
            "Client regular",
            "Client night",
            "Client urgent",
            "Renewist regular",
            "Renewist night",
            "Renewist urgent",
            "Status",
          ]}
          rows={
            pricingRows.length
              ? pricingRows
              : [
                  [
                    "No pricing configured",
                    "-",
                    "-",
                    "-",
                    "-",
                    "-",
                    "-",
                    "-",
                    "-",
                  ],
                ]
          }
          title="Pricing master"
          open={sectionOpen("pricing")}
          onToggle={() => toggleSection("pricing")}
        />
      ) : null}
      <CollapsibleTable
        columns={[
          scope === "admin" ? "Client" : "Invoice",
          "Invoice",
          "Provider",
          "Method",
          "Status",
          "Amount",
          "Paid at",
        ]}
        rows={paymentRows}
        title="Payments"
        open={sectionOpen("payments")}
        onToggle={() => toggleSection("payments")}
      />
      {scope === "admin" ? (
        <>
          <CollapsibleTable
            title="Renewist settlements"
            columns={[
              "Settlement",
              "Provider",
              "Period",
              "Status",
              "Amount",
              "Paid at",
            ]}
            rows={settlementRows}
            open={sectionOpen("settlements")}
            onToggle={() => toggleSection("settlements")}
          />
          <section className="soft-card rounded-lg p-5">
            <h2 className="mb-4 text-lg font-semibold text-slate-950">
              Renewist payment actions
            </h2>
            <div className="flex flex-wrap gap-2">
              {billing.providerSettlements
                .filter((settlement) => settlement.status !== "PAID")
                .map((settlement) => (
                  <button
                    className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-bold text-white"
                    key={settlement.id}
                    onClick={() => void markSettlementPaid(settlement)}
                    type="button"
                  >
                    Mark paid: {settlement.settlementNumber}
                  </button>
                ))}
              {!billing.providerSettlements.some(
                (settlement) => settlement.status !== "PAID",
              ) ? (
                <p className="text-sm font-semibold text-slate-600">
                  No unpaid Renewist settlements.
                </p>
              ) : null}
            </div>
          </section>
        </>
      ) : null}
      {scope === "admin" ? (
        <CollapsibleTable
          columns={[
            "Provider",
            "Service",
            "Workflow",
            "Priority",
            "Units",
            "Payable",
            "Status",
          ]}
          rows={payableRows}
          title="Renewist payables"
          open={sectionOpen("payables")}
          onToggle={() => toggleSection("payables")}
        />
      ) : null}
      <CollapsibleTable
        columns={[
          scope === "admin" ? "Client" : "Scope",
          "Type",
          "Status",
          "Reason",
          "Created",
        ]}
        rows={disputeRows}
        title="Billing disputes"
        open={sectionOpen("disputes")}
        onToggle={() => toggleSection("disputes")}
      />
    </div>
  );
}

function AlertsView({ overview }: { overview: AdminOverview }) {
  const rows = [
    ...overview.clients
      .filter((client) => client.status === "BLOCKED")
      .map((client) => [
        "Blocked client",
        brandText(client.name),
        "Client access is disabled.",
      ]),
    ...overview.jobs
      .filter((job) => job.status === "FAILED")
      .map((job) => [
        "Failed job",
        brandText(job.client?.name ?? "Client"),
        job.error ?? "Review service configuration.",
      ]),
  ];
  return (
    <SimpleTable
      columns={["Alert", "Scope", "Message"]}
      rows={
        rows.length ? rows : [["Healthy", "System", "No active alerts found."]]
      }
    />
  );
}

function ClientDashboard({ client }: { client: Client }) {
  const processingJobs = client.processingJobs ?? [];
  const reports = client.reportReviews ?? [];
  const [caseTimeFilter, setCaseTimeFilter] = useState<"TODAY" | "7D" | "30D" | "ALL">("7D");
  const today = new Date().toISOString().slice(0, 10);
  const filterStart = useMemo(() => {
    const start = new Date();
    if (caseTimeFilter === "TODAY") {
      start.setHours(0, 0, 0, 0);
      return start;
    }
    if (caseTimeFilter === "7D") {
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      return start;
    }
    if (caseTimeFilter === "30D") {
      start.setDate(start.getDate() - 29);
      start.setHours(0, 0, 0, 0);
      return start;
    }
    return null;
  }, [caseTimeFilter]);
  const isInCaseWindow = useCallback((value?: string | null) => {
    if (!filterStart) return true;
    if (!value) return false;
    const time = new Date(value).getTime();
    return Number.isFinite(time) && time >= filterStart.getTime();
  }, [filterStart]);
  const todaySent = reports.filter((report) => {
    const deliveredAt = report.pushedAt ?? report.approvedAt ?? report.updatedAt;
    return ["APPROVED", "PUSHED"].includes(report.status) && deliveredAt?.slice(0, 10) === today;
  }).length;
  const processingCount = processingJobs.filter((job) => {
    const status = job.status.trim().toLowerCase();
    return !["completed", "sent_to_pacs", "failed"].includes(status);
  }).length;
  const readyCount = reports.filter((report) => ["APPROVED", "PUSHED"].includes(report.status)).length;
  const modalityCaseRows = useMemo(() => {
    const rows = new Map<string, { modality: string; received: number; processing: number; reported: number }>();
    const ensure = (modality?: string | null) => {
      const key = (modality || "XRAY").trim().toUpperCase() || "XRAY";
      const existing = rows.get(key);
      if (existing) return existing;
      const created = { modality: key, received: 0, processing: 0, reported: 0 };
      rows.set(key, created);
      return created;
    };
    processingJobs.forEach((job) => {
      const bridgeModality = job.bridgeStudy?.modalities?.[0];
      const row = ensure(bridgeModality ?? job.serviceType);
      if (isInCaseWindow(job.createdAt)) row.received += 1;
      const status = job.status.trim().toLowerCase();
      if (isInCaseWindow(job.updatedAt ?? job.createdAt) && !["completed", "sent_to_pacs", "failed"].includes(status)) row.processing += 1;
    });
    reports.forEach((report) => {
      const deliveredAt = report.pushedAt ?? report.approvedAt ?? report.updatedAt;
      if (!isInCaseWindow(deliveredAt)) return;
      if (!["APPROVED", "PUSHED"].includes(report.status)) return;
      ensure(report.modality ?? report.serviceName).reported += 1;
    });
    return Array.from(rows.values()).sort((a, b) => a.modality.localeCompare(b.modality));
  }, [isInCaseWindow, processingJobs, reports]);
  const availableCount = client.availableBridgeStudies?.filter((study) =>
    study.availabilityStatus === "Available" &&
    ["Available", "DispatchFailed"].includes(study.workflowStatus) &&
    !study.processingJobId
  ).length ?? 0;
  const creditServices = client.services.filter(
    (item) =>
      !isTeleradiologyWorkflowType(
        item.workflowType ?? item.pacsConfig?.workflowType ?? "AI_ONLY",
      ),
  );
  const totalCredits = creditServices.reduce(
    (sum, item) => sum + item.credits,
    0,
  );
  const usedCredits = creditServices.reduce(
    (sum, item) => sum + item.usedCredits,
    0,
  );
  const availableCredits = Math.max(0, totalCredits - usedCredits);
  const teleradiologyCount = client.services.length - creditServices.length;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Send}
          label="Today sent"
          value={String(todaySent)}
          sub="Delivered reports"
        />
        <MetricCard
          icon={Clock}
          label="Processing"
          value={String(processingCount)}
          sub="Active report workflow"
        />
        <MetricCard
          icon={Network}
          label="Available"
          value={String(availableCount)}
          sub="Ready to submit"
        />
        <MetricCard
          icon={CheckCircle2}
          label="Ready"
          value={String(readyCount)}
          sub="View or download"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={ShieldCheck}
          label="Assigned services"
          value={String(client.services.length)}
          sub={client.status}
        />
        <MetricCard
          icon={CreditCard}
          label="Remaining AI credits"
          value={availableCredits.toLocaleString()}
          sub={
            teleradiologyCount
              ? `${teleradiologyCount} postpaid`
              : `${usedCredits.toLocaleString()} used`
          }
        />
        <MetricCard
          icon={CheckCircle2}
          label="Validity"
          value={shortestValidity(creditServices)}
          sub={
            teleradiologyCount
              ? "Teleradiology postpaid"
              : "Earliest service expiry"
          }
        />
        <MetricCard
          icon={ClipboardList}
          label="Jobs"
          value={String(client.jobs?.length ?? 0)}
          sub="Recent"
        />
      </div>
      <SimpleTable
        columns={["Service", "Workflow", "Status", "Credits", "Valid until"]}
        rows={client.services.map((item) => [
          displayServiceName(item.service.name),
          workflowLabels[
            item.workflowType ?? item.pacsConfig?.workflowType ?? "AI_ONLY"
          ],
          item.status,
          isTeleradiologyWorkflowType(
            item.workflowType ?? item.pacsConfig?.workflowType ?? "AI_ONLY",
          )
            ? "Postpaid"
            : `${creditLeft(item).toLocaleString()} / ${item.credits.toLocaleString()}`,
          isTeleradiologyWorkflowType(
            item.workflowType ?? item.pacsConfig?.workflowType ?? "AI_ONLY",
          )
            ? "Monthly billing"
            : toDate(item.validUntil),
        ])}
      />
      <section className="soft-card rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Modality case flow</h2>
            <p className="mt-1 text-sm text-slate-500">Received, processing, and reported cases by modality.</p>
          </div>
          <div className="flex rounded-md border border-slate-200 bg-white p-1">
            {([
              ["TODAY", "Today"],
              ["7D", "7 days"],
              ["30D", "30 days"],
              ["ALL", "All"],
            ] as const).map(([value, label]) => (
              <button
                className={cx(
                  "rounded px-3 py-1.5 text-xs font-bold",
                  caseTimeFilter === value ? "bg-sky-700 text-white" : "text-slate-600 hover:bg-slate-100",
                )}
                key={value}
                onClick={() => setCaseTimeFilter(value)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-5 h-72">
          <ModalityCasesChart data={modalityCaseRows} />
        </div>
      </section>
    </div>
  );
}

function MarengoOrganizationDashboard({
  client,
  token,
  reload,
  notice,
}: {
  client: Client;
  token: string;
  reload: () => Promise<void>;
  notice: (message: string) => void;
}) {
  const totals = client.organization?.totals;
  if (!totals) return <ClientDashboard client={client} />;
  return (
    <div className="org-dashboard">
      <div className="dashboard-metrics">
        <MetricCard
          icon={Building2}
          label="Centers"
          value={String(totals.centers)}
          sub={`${totals.activeCenters} active`}
        />
        <MetricCard
          icon={ShieldCheck}
          label="Configured services"
          value={String(totals.services)}
          sub="Across branches"
        />
        <MetricCard
          icon={UploadCloud}
          label="Studies processed"
          value={String(totals.studies)}
          sub="Network total"
        />
        <MetricCard
          icon={Bell}
          label="Support tickets"
          value={String(totals.tickets)}
          sub="All centers"
        />
      </div>
      <MarengoCentersView
        client={client}
        token={token}
        reload={reload}
        notice={notice}
      />
    </div>
  );
}

function MarengoCentersView({
  client,
  token,
  reload,
  notice,
}: {
  client: Client;
  token: string;
  reload: () => Promise<void>;
  notice: (message: string) => void;
}) {
  const centers = (client.organization?.centers ?? []).filter(
    (center) => center.id !== client.id && center.code !== "MARENGO",
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [userForm, setUserForm] = useState({
    centerId: centers[0]?.id ?? "",
    name: "",
    email: "",
    portalRole: "FRONT_DESK" as ClientPortalRole,
  });
  const [newCenterForm, setNewCenterForm] = useState({
    name: "",
    hospitalSlug: "",
    facilityType: "Hospital",
    primaryContact: "",
    email: "",
  });

  useEffect(() => {
    if (!userForm.centerId && centers[0]?.id)
      setUserForm((current) => ({ ...current, centerId: centers[0].id }));
  }, [centers, userForm.centerId]);

  async function createCenter(event: FormEvent) {
    event.preventDefault();
    const result = await api<{
      client: Client;
      user: User;
      temporaryPassword: string;
    }>("/api/client/organization/centers", token, {
      method: "POST",
      body: JSON.stringify(newCenterForm),
    });
    setSelectedUser(result.user);
    setTemporaryPassword(result.temporaryPassword);
    setNewCenterForm({
      name: "",
      hospitalSlug: "",
      facilityType: "Hospital",
      primaryContact: "",
      email: "",
    });
    notice(
      `Center login created for ${result.user.email}. The one-time password is shown in the center details.`,
    );
    await reload();
  }

  async function createCenterUser(event: FormEvent) {
    event.preventDefault();
    const centerId = userForm.centerId || centers[0]?.id;
    if (!centerId) {
      notice("Create a Marengo center before adding center logins.");
      return;
    }
    const result = await api<{
      center: Pick<Client, "id" | "code" | "name">;
      user: User;
      temporaryPassword: string;
    }>(`/api/client/organization/centers/${centerId}/users`, token, {
      method: "POST",
      body: JSON.stringify({
        name: userForm.name,
        email: userForm.email,
        portalRole: userForm.portalRole,
      }),
    });
    setSelectedUser(result.user);
    setTemporaryPassword(result.temporaryPassword);
    setUserForm({ centerId, name: "", email: "", portalRole: "FRONT_DESK" });
    setCreateOpen(false);
    notice(
      `Center login created for ${brandText(result.center.name)}. The one-time password is shown in the center details.`,
    );
    await reload();
  }

  return (
    <div className="marengo-centers-workspace">
      <section className="center-command-panel marengo-branch-status-panel">
        <div className="panel-heading-row">
          <div>
            <span>Center readiness</span>
            <h2>Branch operating status</h2>
          </div>
          <button
            className="marengo-create-login-button inline-flex items-center justify-center gap-2"
            onClick={() => setCreateOpen(true)}
            type="button"
          >
            <Plus size={16} />
            Create center login
          </button>
        </div>
        <div className="center-grid">
          {centers.map((center) => (
            <article className="center-card" key={center.id}>
              <div className="center-card-top">
                <div>
                  <h3>{brandText(center.name)}</h3>
                  <p>{center.code}</p>
                </div>
                <StatusBadge status={center.status} />
              </div>
              <div className="center-card-stats">
                <span>
                  <b>{center.services}</b>
                  <small>Services</small>
                </span>
                <span>
                  <b>{center.studies}</b>
                  <small>Studies</small>
                </span>
                <span>
                  <b>{center.reports}</b>
                  <small>Reports</small>
                </span>
                <span>
                  <b>{center.tickets}</b>
                  <small>Tickets</small>
                </span>
              </div>
              <div className="center-card-footer">
                <span
                  className={cx(
                    "center-sync-dot",
                    center.studySyncEnabled && "center-sync-dot-active",
                  )}
                />
                <span>
                  {center.studySyncEnabled
                    ? "Study Sync enabled"
                    : "Study Sync pending"}
                </span>
              </div>
            </article>
          ))}
          {!centers.length ? (
            <div className="marengo-empty-panel">
              No center accounts have been created yet.
            </div>
          ) : null}
        </div>
      </section>
      {createOpen ? (
        <Modal title="Create center login" onClose={() => setCreateOpen(false)}>
          <FormCard
            title="Additional center user"
            onSubmit={createCenterUser}
            submitLabel="Create login"
          >
            <SelectInput
              label="Center"
              value={userForm.centerId}
              onChange={(value) =>
                setUserForm({ ...userForm, centerId: value })
              }
              options={centers.map((center) => [
                center.id,
                brandText(center.name),
              ])}
            />
            <TextInput
              label="User name"
              value={userForm.name}
              onChange={(value) => setUserForm({ ...userForm, name: value })}
            />
            <TextInput
              label="Contact email"
              type="email"
              value={userForm.email}
              onChange={(value) => setUserForm({ ...userForm, email: value })}
            />
            <SelectInput
              label="Portal role"
              value={userForm.portalRole}
              onChange={(value) =>
                setUserForm({
                  ...userForm,
                  portalRole: value as ClientPortalRole,
                })
              }
              options={clientPortalRoleOptions}
            />
          </FormCard>
          {!centers.length ? (
            <form
              className="mt-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4"
              onSubmit={createCenter}
            >
              <div className="marengo-section-heading">
                <span>No centers found</span>
                <h2>Create first center</h2>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <TextInput
                  label="Center name"
                  value={newCenterForm.name}
                  onChange={(value) =>
                    setNewCenterForm({ ...newCenterForm, name: value })
                  }
                />
                <TextInput
                  label="Renewist slug"
                  value="marengo"
                  readOnly
                />
                <TextInput
                  label="Facility type"
                  value={newCenterForm.facilityType}
                  onChange={(value) =>
                    setNewCenterForm({ ...newCenterForm, facilityType: value })
                  }
                />
                <TextInput
                  label="Primary contact"
                  value={newCenterForm.primaryContact}
                  onChange={(value) =>
                    setNewCenterForm({
                      ...newCenterForm,
                      primaryContact: value,
                    })
                  }
                />
                <TextInput
                  label="Center contact email"
                  type="email"
                  value={newCenterForm.email}
                  onChange={(value) =>
                    setNewCenterForm({ ...newCenterForm, email: value })
                  }
                />
              </div>
              <div className="marengo-form-actions">
                <button
                  className="inline-flex items-center justify-center gap-2"
                  type="submit"
                >
                  <Plus size={16} />
                  Create first center
                </button>
              </div>
            </form>
          ) : null}
        </Modal>
      ) : null}
      {selectedUser ? (
        <Modal title="Center credentials" onClose={() => setSelectedUser(null)}>
          <div className="grid gap-4">
            <TextInput
              label="Center user"
              value={brandText(selectedUser.name)}
              readOnly
            />
            <TextInput
              label="User ID"
              value={selectedUser.userId ?? "-"}
              readOnly
            />
            <TextInput
              label="Contact email"
              value={selectedUser.email}
              readOnly
            />
            <TextInput
              label="Portal role"
              value={clientPortalRoleLabel(selectedUser.portalRole)}
              readOnly
            />
            <CredentialField
              label="One-time temporary password"
              value={temporaryPassword}
            />
            <p className="text-sm font-semibold text-slate-500">
              Temporary passwords are shown only immediately after creation.
            </p>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
function MarengoMonthlyAnalysisView({ client }: { client: Client }) {
  const centers = (client.organization?.centers ?? []).filter(
    (center) => center.id !== client.id && center.code !== "MARENGO",
  );
  const reports = client.organization?.reports ?? [];
  const jobs = client.organization?.processingJobs ?? [];
  const [centerCode, setCenterCode] = useState("ALL");
  const scopedReports =
    centerCode === "ALL"
      ? reports
      : reports.filter((report) => report.client?.code === centerCode);
  const scopedJobs =
    centerCode === "ALL"
      ? jobs
      : jobs.filter((job) => job.client?.code === centerCode);
  const now = new Date();
  const months = Array.from({ length: 12 }, (_item, offset) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (11 - offset), 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const monthReports = scopedReports.filter((report) =>
      String(report.generatedAt ?? report.createdAt).startsWith(key),
    );
    const monthJobs = scopedJobs.filter((job) => job.createdAt.startsWith(key));
    return {
      key,
      label: date.toLocaleDateString(undefined, {
        month: "short",
        year: "numeric",
      }),
      studies: monthJobs.length,
      reports: monthReports.length,
      completed: monthReports.filter((report) =>
        ["APPROVED", "PUSHED"].includes(report.status),
      ).length,
    };
  });
  const current = months.at(-1) ?? { studies: 0, reports: 0, completed: 0 };
  const selectedCenter = centers.find((center) => center.code === centerCode);
  function exportAnalysis() {
    downloadCsvFile(
      `marengo-monthly-analysis-${centerCode.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        "Scope",
        "Month",
        "Studies uploaded",
        "Reports generated",
        "Completed reports",
        "Completion percent",
      ],
      months.map((month) => [
        selectedCenter?.name ?? "All Marengo centers",
        month.label,
        month.studies,
        month.reports,
        month.completed,
        Math.round((month.completed / Math.max(1, month.reports)) * 100),
      ]),
    );
  }
  return (
    <div className="space-y-6">
      <section className="soft-card rounded-lg p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              Monthly network analysis
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Review a single center or the full Marengo network and export the
              report for operational review.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <SelectInput
              label="Center"
              value={centerCode}
              onChange={setCenterCode}
              options={[
                ["ALL", "All Marengo centers"],
                ...centers.map(
                  (center) => [center.code, center.name] as [string, string],
                ),
              ]}
            />
            <button
              className="inline-flex items-center gap-2 rounded-md bg-sky-700 px-4 py-2.5 text-sm font-bold text-white"
              onClick={exportAnalysis}
              type="button"
            >
              <Download size={15} />
              Export CSV
            </button>
          </div>
        </div>
      </section>
      <div className="dashboard-metrics">
        <MetricCard
          icon={UploadCloud}
          label="Studies this month"
          value={String(current.studies)}
          sub={selectedCenter?.name ?? "All centers"}
        />
        <MetricCard
          icon={FileText}
          label="Reports this month"
          value={String(current.reports)}
          sub="Generated"
        />
        <MetricCard
          icon={CheckCircle2}
          label="Completed this month"
          value={String(current.completed)}
          sub="Approved or returned"
        />
        <MetricCard
          icon={Building2}
          label="Active centers"
          value={String(
            centers.filter((center) => center.status === "ACTIVE").length,
          )}
          sub={`${centers.length} configured`}
        />
      </div>
      <section className="soft-card rounded-lg p-5">
        <h2 className="text-lg font-semibold text-slate-950">
          12-month network trend
        </h2>
        <div className="mt-5 h-80">
          <NetworkTrendChart data={months} />
        </div>
      </section>
      <SimpleTable
        columns={["Month", "Studies", "Reports", "Completed", "Completion"]}
        rows={months.map((month) => [
          month.label,
          month.studies,
          month.reports,
          month.completed,
          `${Math.round((month.completed / Math.max(1, month.reports)) * 100)}%`,
        ])}
        title="Monthly analysis report"
      />
    </div>
  );
}

function GroupStudiesView({
  studies,
  token,
  notice,
}: {
  studies: BridgeStudy[];
  token: string;
  notice: (message: string) => void;
}) {
  const [selected, setSelected] = useState<BridgeStudy | null>(null);
  async function download(study: BridgeStudy) {
    try {
      await downloadProtectedFile(
        `/api/client/organization/studies/${study.id}/download`,
        token,
      );
    } catch (error) {
      notice(
        error instanceof Error
          ? error.message
          : "Unable to download study package.",
      );
    }
  }
  return (
    <div className="space-y-5">
      <div className="dashboard-metrics">
        <MetricCard
          icon={ClipboardList}
          label="Network studies"
          value={String(studies.length)}
          sub="All Marengo centers"
        />
        <MetricCard
          icon={UploadCloud}
          label="Processing"
          value={String(
            studies.filter((study) =>
              ["Queued", "Processing"].includes(study.status ?? ""),
            ).length,
          )}
          sub="Active workflow"
        />
        <MetricCard
          icon={FileText}
          label="With clinical context"
          value={String(
            studies.filter((study) => Boolean(study.clinicalIndication?.trim()))
              .length,
          )}
          sub="Indication supplied"
        />
        <MetricCard
          icon={Download}
          label="Study packages"
          value={String(
            studies.filter((study) => Boolean(study.archiveName)).length,
          )}
          sub="Ready to download"
        />
      </div>
      <section className="soft-card rounded-lg p-5">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-slate-950">
            All center studies
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Network-wide upload register with patient, center, clinical
            indication, supporting files, and processing status.
          </p>
        </div>
        <div className="table-scroll">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                {[
                  "Center",
                  "Patient",
                  "Study",
                  "Status",
                  "Submitted",
                  "Action",
                ].map((column) => (
                  <th className="py-3 pr-4" key={column}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {studies.map((study) => (
                <tr
                  className="border-b border-slate-100 align-top"
                  key={study.id}
                >
                  <td className="py-4 pr-4 text-slate-700">
                    {brandText(study.client?.name ?? "-")}
                  </td>
                  <td className="py-4 pr-4">
                    <b className="text-slate-900">{study.patientName ?? "-"}</b>
                    <div className="text-xs text-slate-500">
                      {study.patientId ?? study.accessionNumber ?? "-"}
                    </div>
                  </td>
                  <td className="py-4 pr-4 text-slate-700">
                    {study.studyDescription ?? study.studyInstanceUid}
                    <div className="text-xs text-slate-500">
                      {study.modalities.join(", ") || "-"}
                    </div>
                  </td>
                  <td className="py-4 pr-4">
                    <StatusBadge
                      status={study.status ?? study.workflowStatus}
                    />
                  </td>
                  <td className="py-4 pr-4 text-slate-700">
                    {toDate(study.submittedAt ?? study.lastSyncedAt)}
                  </td>
                  <td className="py-4 pr-4">
                    <button
                      className="table-view-button"
                      onClick={() => setSelected(study)}
                      type="button"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
              {!studies.length ? (
                <tr>
                  <td
                    className="py-8 text-center text-sm font-semibold text-slate-500"
                    colSpan={6}
                  >
                    No center studies have been uploaded yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
      {selected ? (
        <StudyDetailsModal
          study={selected}
          onClose={() => setSelected(null)}
          onDownload={() => void download(selected)}
        />
      ) : null}
    </div>
  );
}

function marengoReportsForDisplay(client: Client) {
  return client.organization?.reports ?? [];
}

function CenterUsersView({
  client,
  token,
  reload,
  notice,
}: {
  client: Client;
  token: string;
  reload: () => Promise<void>;
  notice: (message: string) => void;
}) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    portalRole: "FRONT_DESK" as ClientPortalRole,
  });
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const users = (client.users ?? []).filter((user) => user.role === "CLIENT_USER");

  async function createUser(event: FormEvent) {
    event.preventDefault();
    const result = await api<{ user: User; temporaryPassword: string }>("/api/client/users", token, {
      method: "POST",
      body: JSON.stringify(form),
    });
    setTemporaryPassword(result.temporaryPassword);
    setForm({ name: "", email: "", portalRole: "FRONT_DESK" });
    notice(`${clientPortalRoleLabel(result.user.portalRole)} login created for ${result.user.email}.`);
    await reload();
  }

  return (
    <div className="space-y-5">
      <section className="soft-card rounded-lg p-5">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-slate-950">Center users</h2>
          <p className="text-sm text-slate-500">
            Create role-based logins for {brandText(client.name)}.
          </p>
        </div>
        <FormCard title="Create user" onSubmit={createUser} submitLabel="Create login">
          <TextInput
            label="User name"
            value={form.name}
            onChange={(value) => setForm({ ...form, name: value })}
          />
          <TextInput
            label="Contact email"
            type="email"
            value={form.email}
            onChange={(value) => setForm({ ...form, email: value })}
          />
          <SelectInput
            label="Portal role"
            value={form.portalRole}
            onChange={(value) => setForm({ ...form, portalRole: value as ClientPortalRole })}
            options={clientPortalRoleOptions}
          />
          {temporaryPassword ? (
            <CredentialField label="One-time temporary password" value={temporaryPassword} />
          ) : null}
        </FormCard>
      </section>
      <SimpleTable
        title="Existing center logins"
        columns={["Name", "User ID", "Email", "Portal role", "Status"]}
        rows={
          users.length
            ? users.map((user) => [
                brandText(user.name),
                user.userId ?? "-",
                user.email,
                clientPortalRoleLabel(user.portalRole),
                <StatusBadge status={user.active === false ? "INACTIVE" : "ACTIVE"} />,
              ])
            : [["No center users found", "-", "-", "-", "-"]]
        }
      />
    </div>
  );
}

function MarengoReportsView({
  client,
  token,
}: {
  client: Client;
  token: string;
}) {
  const [viewerReport, setViewerReport] = useState<ReportReview | null>(null);
  const [selectedReport, setSelectedReport] = useState<ReportReview | null>(
    null,
  );
  const reports = marengoReportsForDisplay(client);
  const centers = (client.organization?.centers ?? []).filter(
    (center) => center.id !== client.id && center.code !== "MARENGO",
  );
  const centerRows = (
    centers.length
      ? centers
      : Array.from(
          new Map(
            reports.map((report) => [
              report.client?.code ?? "CENTER",
              report.client,
            ]),
          ).values(),
        ).map((center, index) => ({
          id: `report-center-${index}`,
          code: center?.code ?? "CENTER",
          name: center?.name ?? "Center",
          status: "ACTIVE" as ClientStatus,
          studySyncEnabled: true,
          services: 0,
          studies: reports.filter(
            (report) => report.client?.code === center?.code,
          ).length,
          reports: reports.filter(
            (report) => report.client?.code === center?.code,
          ).length,
          tickets: 0,
        }))
  ).map((center) => {
    const centerReports = reports.filter(
      (report) => report.client?.code === center.code,
    );
    const completed = centerReports.filter((report) =>
      ["APPROVED", "PUSHED"].includes(report.status),
    ).length;
    return [
      brandText(center.name),
      center.code,
      String(centerReports.length || center.reports),
      String(completed),
      String(
        centerReports.filter((report) =>
          ["PENDING", "IN_REVIEW", "SAVED"].includes(report.status),
        ).length,
      ),
      `${Math.round(((completed || 0) / Math.max(1, centerReports.length || center.reports)) * 100)}%`,
    ];
  });
  const pushed = reports.filter((report) => report.status === "PUSHED").length;
  const approved = reports.filter(
    (report) => report.status === "APPROVED",
  ).length;
  const pending = reports.filter((report) =>
    ["PENDING", "IN_REVIEW", "SAVED"].includes(report.status),
  ).length;
  const modalities = Array.from(
    new Set(reports.map((report) => report.modality ?? "NA")),
  ).filter(Boolean);

  return (
    <div className="space-y-6 marengo-reports-workspace">
      <div className="dashboard-metrics">
        <MetricCard
          icon={FileText}
          label="Total reports"
          value={String(reports.length)}
          sub="Across Marengo centers"
        />
        <MetricCard
          icon={CheckCircle2}
          label="Completed"
          value={String(pushed + approved)}
          sub={`${pushed} returned to PACS`}
        />
        <MetricCard
          icon={Clock}
          label="In workflow"
          value={String(pending)}
          sub="Pending or in review"
        />
        <MetricCard
          icon={Eye}
          label="DICOM coverage"
          value={`${modalities.length} modalities`}
          sub="Viewer-enabled preview"
        />
      </div>

      <SimpleTable
        title="Center-wise report performance"
        columns={[
          "Center",
          "Code",
          "Reports",
          "Completed",
          "In workflow",
          "Completion",
        ]}
        rows={
          centerRows.length
            ? centerRows
            : [["No centers", "-", "-", "-", "-", "-"]]
        }
      />

      <section className="soft-card rounded-lg p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              Network reports
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Network-wide report worklist for Marengo group administration,
              including center, modality, report status, and DICOM viewer
              access.
            </p>
          </div>
          <StatusBadge status="ACTIVE" />
        </div>
        <div className="table-scroll">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                {[
                  "Center",
                  "Patient / report",
                  "Exam",
                  "Status",
                  "Generated",
                  "Action",
                ].map((column) => (
                  <th className="py-3 pr-4" key={column}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr
                  className="border-b border-slate-100 align-top"
                  key={report.id}
                >
                  <td className="py-4 pr-4 text-slate-700">
                    {brandText(report.client?.name ?? "Marengo center")}
                  </td>
                  <td className="py-4 pr-4 text-slate-700">
                    <div className="font-semibold text-slate-900">
                      {report.patientName ?? "-"}
                    </div>
                    <div className="text-xs text-slate-500">
                      {report.patientId ?? report.accession ?? "-"} /{" "}
                      {report.id}
                    </div>
                  </td>
                  <td className="py-4 pr-4 text-slate-700">
                    {reportExamLabel(report)}
                  </td>
                  <td className="py-4 pr-4">
                    <StatusBadge status={report.status} />
                  </td>
                  <td className="py-4 pr-4 text-slate-700">
                    {toDate(report.generatedAt ?? report.createdAt)}
                  </td>
                  <td className="py-4 pr-4">
                    <button
                      className="table-view-button"
                      onClick={() => setSelectedReport(report)}
                      type="button"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selectedReport ? (
        <Modal
          title="Network report details"
          onClose={() => setSelectedReport(null)}
        >
          <div className="record-detail-grid">
            <DetailField label="Report ID" value={selectedReport.id} />
            <DetailField
              label="Center"
              value={brandText(selectedReport.client?.name ?? "Marengo center")}
            />
            <DetailField
              label="Patient"
              value={`${selectedReport.patientName ?? "-"} / ${selectedReport.patientId ?? "-"}`}
            />
            <DetailField
              label="Study UID"
              value={selectedReport.studyUid ?? "-"}
            />
            <DetailField
              label="Modality"
              value={selectedReport.modality ?? "-"}
            />
            <DetailField label="Service" value={selectedReport.serviceName} />
            <DetailField
              label="Radiologist"
              value={selectedReport.radiologist?.fullName ?? "Unassigned"}
            />
            <DetailField
              label="Status"
              value={<StatusBadge status={selectedReport.status} />}
            />
            <DetailField
              label="Generated"
              value={toDate(
                selectedReport.generatedAt ?? selectedReport.createdAt,
              )}
            />
          </div>
          <div className="mt-5 flex justify-end">
            <button
              className="viewer-open-button inline-flex items-center gap-2 rounded-md bg-sky-700 px-3 py-2 text-sm font-bold text-white"
              onClick={() => {
                setViewerReport(selectedReport);
                setSelectedReport(null);
              }}
              type="button"
            >
              <Eye size={15} />
              Open viewer
            </button>
          </div>
        </Modal>
      ) : null}
      {viewerReport ? (
        <MarengoDicomViewerModal
          report={viewerReport}
          token={token}
          onClose={() => setViewerReport(null)}
        />
      ) : null}
    </div>
  );
}

function ShareReportButton({
  report,
  token,
  className,
  compact = false,
  disabled = false,
}: {
  report: ReportReview;
  token: string;
  className?: string;
  compact?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [copied, setCopied] = useState(false);

  async function openShare(regenerate = false) {
    setOpen(true);
    if ((shareUrl && !regenerate) || loading) return;
    setLoading(true);
    setError("");
    setCopied(false);
    try {
      const result = await api<{ token: string; expiresAt?: string; url?: string; qr?: string }>(`/api/reports/${encodeURIComponent(report.id)}/public-share${regenerate ? "?regenerate=true" : ""}`, token, {
        method: "POST",
        body: regenerate ? JSON.stringify({ regenerate: true }) : undefined,
      });
      const url = result.url || `${window.location.origin}/shared/${encodeURIComponent(result.token)}`;
      setShareUrl(url);
      setExpiresAt(result.expiresAt ?? "");
      setQrCode(result.qr ?? await (await import("qrcode")).default.toDataURL(url, { width: 320, margin: 2, errorCorrectionLevel: "M" }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create a share link.");
    } finally {
      setLoading(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
    } catch {
      setError("Could not copy automatically. Select and copy the link below.");
    }
  }

  async function revokeShare() {
    if (loading) return;
    setLoading(true);
    setError("");
    setCopied(false);
    try {
      await api<{ revoked: boolean }>(`/api/reports/${encodeURIComponent(report.id)}/public-share`, token, {
        method: "DELETE",
      });
      setShareUrl("");
      setQrCode("");
      setExpiresAt("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to revoke this share link.");
    } finally {
      setLoading(false);
    }
  }

  function downloadQr() {
    const link = document.createElement("a");
    link.href = qrCode;
    link.download = `report-${report.id}-share-qr.png`;
    link.click();
  }

  return <>
    <button aria-label="Share report" className={className ?? "fullscreen-dicom-close"} disabled={disabled} onClick={() => void openShare()} title="Share report" type="button">
      <Share2 size={compact ? 16 : 18} /> {compact ? null : "Share"}
    </button>
    {open ? <Modal title="Share report and DICOM viewer" onClose={() => setOpen(false)}>
      <p className="mb-4 text-sm text-slate-600">Anyone with this link can open the approved report and DICOM viewer without signing in. Treat it as confidential patient information.</p>
      {loading ? <div className="grid min-h-48 place-items-center text-sm text-slate-500"><LoaderCircle className="animate-spin" size={24} /> Creating secure link…</div> : null}
      {error ? <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {shareUrl ? <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px] sm:items-center">
        <div>
          <label className="block text-xs font-bold uppercase text-slate-500" htmlFor="public-share-link">Share link</label>
          <input className="mt-1 w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm" id="public-share-link" readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} />
          {expiresAt ? <p className="mt-2 text-xs text-slate-500">Valid until {new Date(expiresAt).toLocaleString()}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="table-view-button" onClick={() => void copyLink()} type="button"><Share2 className="mr-1 inline" size={14} /> {copied ? "Copied" : "Copy link"}</button>
            <button className="table-view-button" onClick={downloadQr} type="button"><Download className="mr-1 inline" size={14} /> Download QR</button>
            <button className="table-view-button" disabled={loading} onClick={() => void openShare(true)} type="button"><RefreshCw className="mr-1 inline" size={14} /> Regenerate</button>
            <button className="table-view-button" disabled={loading} onClick={() => void revokeShare()} type="button">Revoke</button>
          </div>
        </div>
        <img alt={`QR code for report ${report.id}`} className="mx-auto w-44 rounded-md border border-slate-200 p-2" src={qrCode} />
      </div> : null}
    </Modal> : null}
  </>;
}



function PublicDecxpertViewerPane({ token }: { token: string }) { return <ExternalViewerPane endpoint={`/api/public/reports/${encodeURIComponent(token)}/viewer-session`} />; }

function PublicSharedReportView({ token }: { token: string }) {
  const [report, setReport] = useState<ReportReview | null>(null);
  const [error, setError] = useState("");
  const [mobilePane, setMobilePane] = useState<"VIEWER" | "REPORT">("VIEWER");
  const [isPhone, setIsPhone] = useState(() => window.matchMedia("(hover: none) and (pointer: coarse)").matches || navigator.maxTouchPoints > 0);
  const [phoneViewport, setPhoneViewport] = useState(() => ({ width: window.visualViewport?.width ?? window.innerWidth, height: window.visualViewport?.height ?? window.innerHeight }));
  useEffect(() => { void api<ReportReview>(`/api/public/reports/${encodeURIComponent(token)}`).then(setReport).catch((reason) => setError(reason instanceof Error ? reason.message : "This shared report is unavailable.")); }, [token]);
  useEffect(() => {
    const update = () => {
      setIsPhone(window.matchMedia("(hover: none) and (pointer: coarse)").matches || navigator.maxTouchPoints > 0);
      setPhoneViewport({ width: window.visualViewport?.width ?? window.innerWidth, height: window.visualViewport?.height ?? window.innerHeight });
    };
    update();
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => { window.removeEventListener("resize", update); window.visualViewport?.removeEventListener("resize", update); };
  }, []);
  if (error) return <main className="app-shell grid min-h-screen place-items-center p-4"><EmptyState message={error} /></main>;
  if (!report) return <main className="app-shell grid min-h-screen place-items-center p-4"><EmptyState message="Opening shared report…" /></main>;
  if (report.includeViewer === false) return <div className="fullscreen-dicom-shell pw-public-shell"><header className="fullscreen-dicom-topbar"><div><p>Shared radiology report</p><span>{report.patientName} / {report.patientId}</span></div></header><div className="pw-public-report"><ReportDocumentPreview report={report} publicToken={token}/></div></div>;
  if (isPhone) return <div className="public-phone-share-shell" style={{ width: `${phoneViewport.width}px`, height: `${phoneViewport.height}px` }}>
    <header className="public-phone-share-header"><p>Shared DICOM Viewer</p><span>{report.patientName ?? "Patient"} · {report.modality ?? "DICOM"}</span></header>
    <nav className="public-phone-share-tabs" aria-label="Shared study workspace">
      <button className={cx(mobilePane === "VIEWER" && "active")} onClick={() => setMobilePane("VIEWER")} type="button">Images</button>
      <button className={cx(mobilePane === "REPORT" && "active")} onClick={() => setMobilePane("REPORT")} type="button">Report</button>
    </nav>
    <main className="public-phone-share-content">
      {mobilePane === "VIEWER" ? <PublicDecxpertViewerPane token={token} /> : <section className="public-phone-report"><div className="public-phone-report-header"><strong>{report.patientName ?? "Patient"}</strong><span>{report.modality ?? "DICOM"} · {report.serviceName}</span></div><ReportDocumentPreview report={report} publicToken={token} /></section>}
    </main>
  </div>;
  return <div className="fullscreen-dicom-shell">
    <div className="fullscreen-dicom-topbar"><div><p>Shared DICOM Viewer</p><span>{brandText(report.client?.name ?? "Radiology center")} / {report.studyUid ?? report.id}</span></div></div>
    <nav className="fullscreen-dicom-mobile-nav" aria-label="Shared study workspace">
      <button className={cx(mobilePane === "VIEWER" && "active")} onClick={() => setMobilePane("VIEWER")} type="button">Images</button>
      <button className={cx(mobilePane === "REPORT" && "active")} onClick={() => setMobilePane("REPORT")} type="button">Report</button>
    </nav>
    <div className="fullscreen-dicom-grid">
      <section className={cx("fullscreen-viewer-pane", mobilePane !== "VIEWER" && "mobile-pane-hidden")}><PublicDecxpertViewerPane token={token} /></section>
      <aside className={cx("fullscreen-report-pane", mobilePane !== "REPORT" && "mobile-pane-hidden")}><div className="dicom-preview-toolbar"><div><p>{report.patientName ?? "Patient"}</p><span>{report.modality ?? "DICOM"} - {report.serviceName}</span></div><StatusBadge status={report.status} /></div><ReportDocumentPreview report={report} publicToken={token} /></aside>
    </div>
  </div>;
}

function MarengoDicomViewerModal({
  report,
  token,
  onClose,
}: {
  report: ReportReview;
  token: string;
  onClose: () => void;
  canViewInternalReports?: boolean;
}) {
  const [bookmark, setBookmark] = useState<"REPORT" | "INDICATION" | "DETAILS">(
    "REPORT",
  );
  const [mobileWorkspacePane, setMobileWorkspacePane] = useState<
    "VIEWER" | "DETAILS"
  >("VIEWER");
  const reportData =
    report.editedReportJson && Object.keys(report.editedReportJson).length
      ? report.editedReportJson
      : report.aiReportJson ?? {};
  const clinicalIndication = [
    reportData.clinicalIndication,
    reportData.clinicalHistory,
    (reportData.dicomMetadata as Record<string, unknown> | undefined)
      ?.clinicalIndication,
  ].find((value) => typeof value === "string" && value.trim()) as
    string | undefined;
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);
  return createPortal(
    <div className="fullscreen-dicom-shell">
      <div className="fullscreen-dicom-topbar">
        <div>
          <p>DICOM Viewer</p>
          <span>
            {brandText(report.client?.name ?? "Marengo center")} /{" "}
            {report.studyUid ?? report.id}
          </span>
        </div>
        <button
          className="fullscreen-dicom-close"
          onClick={onClose}
          type="button"
        >
          <X size={18} /> Close
        </button>
        <ShareReportButton report={report} token={token} />
      </div>
      <nav
        className="fullscreen-dicom-mobile-nav"
        aria-label="Study workspace"
      >
        {([['VIEWER', 'Images'], ['DETAILS', 'Report and details']] as const).map(
          ([key, label]) => (
            <button
              className={cx(mobileWorkspacePane === key && "active")}
              key={key}
              onClick={() => setMobileWorkspacePane(key)}
              type="button"
            >
              {label}
            </button>
          ),
        )}
      </nav>
      <div className="fullscreen-dicom-grid">
        <section
          className={cx(
            "fullscreen-viewer-pane",
            mobileWorkspacePane !== "VIEWER" && "mobile-pane-hidden",
          )}
        >
          <DicomReviewPane
            report={report}
            token={token}
            isLocked
            onInsertSlice={() => undefined}
          />
        </section>

        <aside
          className={cx(
            "fullscreen-report-pane",
            mobileWorkspacePane !== "DETAILS" && "mobile-pane-hidden",
          )}
        >
          <div className="dicom-preview-toolbar">
            <div>
              <p>{report.patientName ?? "Patient"}</p>
              <span>
                {report.modality ?? "DICOM"} - {report.serviceName}
              </span>
            </div>
            <StatusBadge status={report.status} />
          </div>
          <div className="grid grid-cols-3 border-b border-slate-700 bg-slate-900">
            {(
              [
                ["REPORT", "Report"],
                ["INDICATION", "Clinical indication"],
                ["DETAILS", "Study details"],
              ] as const
            ).map(([key, label]) => (
              <button
                className={cx(
                  "border-b-2 px-3 py-3 text-xs font-bold",
                  bookmark === key
                    ? "border-sky-400 bg-slate-800 text-white"
                    : "border-transparent text-slate-400",
                )}
                key={key}
                onClick={() => setBookmark(key)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          {bookmark === "REPORT" ? (
            <ReportDocumentPreview report={report} token={token} />
          ) : null}
          {bookmark === "INDICATION" ? (
            <div className="p-5 text-sm text-slate-200">
              <h3 className="text-xs font-bold uppercase text-slate-400">
                Clinical indication
              </h3>
              <p className="mt-3 whitespace-pre-wrap rounded-md bg-slate-900 p-4">
                {clinicalIndication ||
                  "No clinical indication was recorded with this report."}
              </p>
            </div>
          ) : null}
          {bookmark === "DETAILS" ? (
            <div className="grid gap-3 p-5 text-sm text-slate-200">
              <div>
                <span className="block text-xs font-bold uppercase text-slate-400">
                  Patient
                </span>
                {report.patientName || "-"} / {report.patientId || "-"}
              </div>
              <div>
                <span className="block text-xs font-bold uppercase text-slate-400">
                  Study UID
                </span>
                {report.studyUid || "-"}
              </div>
              <div>
                <span className="block text-xs font-bold uppercase text-slate-400">
                  Accession
                </span>
                {report.accession || "-"}
              </div>
              <div>
                <span className="block text-xs font-bold uppercase text-slate-400">
                  Modality / service
                </span>
                {report.modality || "-"} / {report.serviceName}
              </div>
              <div>
                <span className="block text-xs font-bold uppercase text-slate-400">
                  Radiologist
                </span>
                {report.radiologist?.fullName || "Pending"}
              </div>
            </div>
          ) : null}
        </aside>
      </div>
    </div>,
    document.body,
  );
}

function ReportDocumentPreview({
  report,
  token,
  publicToken,
}: {
  report: Pick<ReportReview, "id" | "updatedAt">;
  token?: string;
  publicToken?: string;
}) {
  const [documentData, setDocumentData] = useState<ArrayBuffer | null>(null);
  const [error, setError] = useState("");
  const [variant, setVariant] = useState('with-letterhead');
  const [zoom, setZoom] = useState(0.85);
  const [documentUrl, setDocumentUrl] = useState('');
  const printFrame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (!documentData) { setDocumentUrl(''); return; }
    const url = URL.createObjectURL(new Blob([documentData], { type: 'application/pdf' }));
    setDocumentUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [documentData]);
  useEffect(() => {
    let cancelled = false;
    const path = publicToken
      ? `/api/public/reports/${encodeURIComponent(publicToken)}/pdf`
      : `/api/reports/${encodeURIComponent(report.id)}/pdf`;
    setError("");
    setDocumentData(null);
    fetch(`${path}?variant=${variant}`, {
      cache: "no-store",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            response.status === 409
              ? "Final signed report is not ready yet."
              : "This report version is unavailable. Try the other letterhead option.",
          );
        return response.arrayBuffer();
      })
      .then((data) => {
        if (cancelled) return;
        setDocumentData(data);
      })
      .catch((reason) => {
        if (!cancelled)
          setError(
            reason instanceof Error
              ? reason.message
              : "Report document is unavailable.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [report.id, report.updatedAt, token, publicToken, variant]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div role="toolbar" aria-label="Report controls" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, padding: '10px 16px', background: '#242c36', color: 'white', flexShrink: 0 }}>
        <label>Report version <select aria-label="Report version" style={{ color: '#111', padding: 6 }} value={variant} onChange={event => setVariant(event.target.value)}>
          <option value="with-letterhead">With letterhead</option><option value="without-letterhead">Without letterhead</option>
        </select></label>
        <label>Zoom <select aria-label="Report zoom" style={{ color: '#111', padding: 6 }} value={zoom} onChange={event => setZoom(Number(event.target.value))}>
          <option value={0.65}>65%</option><option value={0.85}>85%</option><option value={1}>100%</option><option value={1.25}>125%</option>
        </select></label>
        <button type="button" disabled={!documentData || !documentUrl || Boolean(error)} onClick={() => { printFrame.current?.contentWindow?.focus(); printFrame.current?.contentWindow?.print(); }}>Print</button>
        <button type="button" disabled={!documentData || !documentUrl || Boolean(error)} onClick={() => {
          const anchor = document.createElement('a'); anchor.href = documentUrl; anchor.download = `${report.id}-${variant}.pdf`; anchor.click();
        }}>Download PDF</button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      {error ? <p role="alert" style={{ padding: 24 }}>{error}</p> : !documentData ? <p style={{ padding: 24 }}>Loading signed report…</p> : <ResponsivePdfDocument
      data={documentData}
      title={`Radiology report ${report.id}`}
      zoom={zoom}
    />}
      </div>
      {documentData && documentUrl && <iframe ref={printFrame} src={documentUrl} title="Printable report PDF" style={{ position: 'fixed', left: -10000, width: 1, height: 1, border: 0 }} />}
    </div>
  );
}

function ResponsivePdfDocument({
  data,
  title,
  zoom = 0.85,
}: {
  data: ArrayBuffer;
  title: string;
  zoom?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let loadingTask: { destroy: () => Promise<void> } | undefined;

    async function renderDocument() {
      const container = containerRef.current;
      if (!container) return;
      container.replaceChildren();
      setError("");
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        const task = pdfjs.getDocument({ data: data.slice(0) });
        loadingTask = task;
        const pdf = await task.promise;
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          if (cancelled) return;
          const page = await pdf.getPage(pageNumber);
          const baseViewport = page.getViewport({ scale: 1 });
          // iOS can retain a wider layout viewport while Safari is showing
          // its browser controls. Use the visual viewport as the hard cap so
          // every PDF page is rendered within the visible phone width.
          const visibleWidth = window.visualViewport?.width ?? container.clientWidth;
          const cssWidth = Math.max(240, Math.min(container.clientWidth, visibleWidth, 1000) - 32) * zoom;
          const cssScale = cssWidth / baseViewport.width;
          const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
          const viewport = page.getViewport({ scale: cssScale * pixelRatio });
          const canvas = document.createElement("canvas");
          canvas.className = "viewer-report-pdf-page";
          canvas.setAttribute("aria-label", `${title}, page ${pageNumber}`);
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          canvas.style.width = `${Math.round(viewport.width / pixelRatio)}px`;
          canvas.style.height = `${Math.round(viewport.height / pixelRatio)}px`;
          container.appendChild(canvas);
          const context = canvas.getContext("2d");
          if (!context) throw new Error("PDF canvas is unavailable.");
          await page.render({ canvas, canvasContext: context, viewport }).promise;
        }
      } catch (reason) {
        if (!cancelled)
          setError(
            reason instanceof Error ? reason.message : "Unable to display report.",
          );
      }
    }

    void renderDocument();
    return () => {
      cancelled = true;
      void loadingTask?.destroy();
    };
  }, [data, title, zoom]);

  return (
    <div className="viewer-report-pdf-document" ref={containerRef} role="document">
      {error ? <p className="viewer-report-pdf-error">{error}</p> : null}
    </div>
  );
}





function ClientStudySyncView({
  token,
  client,
  reload,
  notice,
  pollIntervalMs = 5000,
}: {
  token: string;
  client: Client;
  reload: () => Promise<void>;
  notice: (message: string) => void;
  pollIntervalMs?: number;
}) {
  const [studies, setStudies] = useState<BridgeStudy[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sendingId, setSendingId] = useState("");
  const [selectedStudy, setSelectedStudy] = useState<BridgeStudy | null>(null);
  const [sendStudy, setSendStudy] = useState<BridgeStudy | null>(null);
  const [sendPriority, setSendPriority] = useState<"REGULAR" | "URGENT">("REGULAR");
  const [removeStudy, setRemoveStudy] = useState<BridgeStudy | null>(null);
  const [clinicalIndication, setClinicalIndication] = useState("");
  const [noClinicalIndication, setNoClinicalIndication] = useState(false);
  const [supportingFiles, setSupportingFiles] = useState<File[]>([]);
  const [matchedPatient, setMatchedPatient] = useState<PatientProfile | null>(null);
  const [patientMatches, setPatientMatches] = useState<PatientProfile[]>([]);
  const [patientQuery, setPatientQuery] = useState("");
  const [patientProfileId, setPatientProfileId] = useState("");
  const [selectedPatientFileIds, setSelectedPatientFileIds] = useState<string[]>([]);
  const [selectedPreviousReportIds, setSelectedPreviousReportIds] = useState<string[]>([]);
  const [activeModality, setActiveModality] = useState<ModalityTab>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortBy, setSortBy] = useState("studyDate");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [filters, setFilters] = useState<Record<string, string>>({
    status: "ALL",
    info: "ALL",
    dateFrom: "",
    dateTo: "",
  });
  const lastStudySyncRef = useRef("");
  const modalityCounts = useMemo(() => {
    const counts = Object.fromEntries(
      modalityTabs.map((tab) => [tab, 0]),
    ) as Record<ModalityTab, number>;
    counts.ALL = studies.length;
    studies.forEach((study) => {
      modalityTabs.slice(1).forEach((tab) => {
        if (modalityMatches(tab, [study.studyDescription, ...study.modalities]))
          counts[tab] += 1;
      });
    });
    return counts;
  }, [studies]);
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredStudies = studies
    .filter((study) =>
      modalityMatches(activeModality, [
        study.studyDescription,
        ...study.modalities,
      ]),
    )
    .filter(
      (study) =>
        !normalizedSearch ||
        searchableText([
          study.patientId,
          study.patientName,
          study.accessionNumber,
          study.studyDescription,
          study.modalities,
          study.studyDate,
          study.status,
          study.availabilityStatus,
        ]).includes(normalizedSearch),
    )
    .filter((study) => {
      const status = (study.status ?? study.availabilityStatus)
        .trim()
        .toUpperCase();
      if (filters.status !== "ALL" && status !== filters.status) return false;
      const hasInfo = Boolean(
        study.clinicalIndication?.trim() || study.attachments?.length,
      );
      if (filters.info === "WITH_INFO" && !hasInfo) return false;
      if (filters.info === "WITHOUT_INFO" && hasInfo) return false;
      if (!dateWithinRange(study.studyDate, filters.dateFrom, filters.dateTo))
        return false;
      return true;
    })
    .sort((a, b) => {
      const sortValues: Record<string, [string | number, string | number]> = {
        studyDate: [parseDateValue(a.studyDate), parseDateValue(b.studyDate)],
        patientName: [a.patientName ?? "", b.patientName ?? ""],
        patientId: [a.patientId ?? "", b.patientId ?? ""],
        study: [a.studyDescription ?? "", b.studyDescription ?? ""],
        series: [a.seriesCount, b.seriesCount],
        images: [a.instanceCount, b.instanceCount],
        status: [
          a.status ?? a.availabilityStatus,
          b.status ?? b.availabilityStatus,
        ],
      };
      const [left, right] = sortValues[sortBy] ?? sortValues.studyDate;
      return compareValues(left, right, sortDirection);
    });

  useEffect(() => {
    void loadBridgeStudies();
    if (pollIntervalMs <= 0) return;
    const interval = window.setInterval(
      () => void loadBridgeStudies(true),
      pollIntervalMs,
    );
    return () => window.clearInterval(interval);
  }, [token, client.id, client.studySyncEnabled, pollIntervalMs]);

  async function loadBridgeStudies(silent = false) {
    if (!silent) setLoading(true);
    try {
      const updatedSince = silent ? lastStudySyncRef.current : "";
      const changedStudies: BridgeStudy[] = [];
      let cursor = "";
      let asOf = "";
      do {
        const params = new URLSearchParams({ limit: "100", _: String(Date.now()) });
        if (updatedSince) params.set("updatedSince", updatedSince);
        if (cursor) params.set("cursor", cursor);
        const result = await api<{
          studies: BridgeStudy[];
          incremental: boolean;
          asOf: string;
          nextCursor?: string | null;
        }>(`/api/client/study-sync/available-studies?${params}`, token, { cache: "no-store" });
        changedStudies.push(...result.studies);
        asOf ||= result.asOf;
        cursor = result.nextCursor ?? "";
      } while (cursor);
      lastStudySyncRef.current = asOf || new Date().toISOString();
      if (!updatedSince) {
        setStudies(changedStudies);
      } else if (changedStudies.length) {
        setStudies((current) => {
          const changedIds = new Set(changedStudies.map((study) => study.id));
          return [
            ...current.filter((study) => !changedIds.has(study.id)),
            ...changedStudies.filter((study) => !study.processingJobId),
          ];
        });
      }
      setError("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load available studies",
      );
    } finally {
      if (!silent) setLoading(false);
    }
  }

  function openSubmission(study: BridgeStudy) {
    setSelectedStudy(study);
    setClinicalIndication(study.clinicalIndication ?? "");
    setNoClinicalIndication(false);
    setSupportingFiles([]);
    setMatchedPatient(null);
    setPatientProfileId("");
    setSelectedPatientFileIds([]);
    setSelectedPreviousReportIds([]);
    void api<{ items: PatientProfile[] }>(
      `/api/patients?q=${encodeURIComponent(study.patientId ?? study.patientName ?? "")}&clientId=${client.id}`,
      token,
    )
      .then(async (result) => {
        const exact = result.items.find((patient) => patient.patientIdentifier.trim().toLowerCase() === study.patientId?.trim().toLowerCase()) ?? result.items[0];
        if (!exact) return;
        const profile = await api<PatientProfile>(`/api/patients/${exact.id}`, token);
        setMatchedPatient(profile);
        setPatientProfileId(profile.id);
      })
      .catch(() => setMatchedPatient(null));
  }

  async function submitStudy(
    study: BridgeStudy,
    indication: string,
    files: File[],
    priority: "REGULAR" | "URGENT",
  ) {
    if (files.length > 5) {
      notice("Upload a maximum of 5 supporting files.");
      return;
    }
    setSendingId(study.id);
    try {
      const form = new FormData();
      form.append("clinical_indication", indication);
      form.append("priority", priority);
      files.forEach((file) => form.append("attachments", file));
      const response = await fetch(
        `/api/client/study-sync/available-studies/${study.id}/submit`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(body?.message ?? "Unable to send study for reporting");
      notice(`Study queued for ${priority === "URGENT" ? "urgent" : "regular"} reporting.`);
      await loadBridgeStudies();
      await reload();
    } catch (err) {
      notice(
        err instanceof Error
          ? err.message
          : "Unable to send study for reporting",
      );
    } finally {
      setSendingId("");
      setSelectedStudy(null);
      setSendStudy(null);
      setClinicalIndication("");
      setNoClinicalIndication(false);
      setSupportingFiles([]);
    }
  }

  async function saveAdditionalInfo(event: FormEvent) {
    event.preventDefault();
    if (!selectedStudy) return;
    if ((selectedStudy.attachments?.length ?? 0) + supportingFiles.length + selectedPatientFileIds.length + selectedPreviousReportIds.length > 5) {
      notice("Upload up to 5 supporting files per study.");
      return;
    }
    setSendingId(selectedStudy.id);
    try {
      if (patientProfileId)
        await api(`/api/studies/${selectedStudy.id}/patient`, token, {
          method: "PATCH",
          body: JSON.stringify({ patientId: patientProfileId }),
        });
      const form = new FormData();
      form.append("clinical_indication", noClinicalIndication ? "" : clinicalIndication);
      form.append("no_clinical_indication", noClinicalIndication ? "true" : "false");
      form.append("patient_archive_file_ids", JSON.stringify(selectedPatientFileIds));
      form.append("patient_report_ids", JSON.stringify(selectedPreviousReportIds));
      form.append("patient_profile_id", patientProfileId);
      supportingFiles.forEach((file) => form.append("attachments", file));
      const response = await fetch(
        `/api/client/study-sync/available-studies/${selectedStudy.id}/additional-info`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(body?.message ?? "Unable to save study details");
      notice("Study details saved. Files are uploaded and ready.");
      await loadBridgeStudies();
      await reload();
      setSelectedStudy(null);
      setClinicalIndication("");
      setNoClinicalIndication(false);
      setSelectedPatientFileIds([]);
      setSelectedPreviousReportIds([]);
      setSupportingFiles([]);
    } catch (err) {
      notice(
        err instanceof Error ? err.message : "Unable to save study details",
      );
    } finally {
      setSendingId("");
    }
  }

  async function confirmRemoveStudy() {
    if (!removeStudy) return;
    setSendingId(removeStudy.id);
    try {
      await api(
        `/api/client/study-sync/available-studies/${removeStudy.id}`,
        token,
        { method: "DELETE" },
      );
      notice("Study removed from Available study.");
      await loadBridgeStudies();
    } catch (err) {
      notice(err instanceof Error ? err.message : "Unable to remove study");
    } finally {
      setSendingId("");
      setRemoveStudy(null);
    }
  }

  const rows = filteredStudies.map((study) => {
    const canSend =
      study.availabilityStatus === "Available" &&
      !study.processingJobId &&
      ["Available", "DispatchFailed"].includes(study.workflowStatus);
    const additionalInfoCount =
      (study.clinicalIndication?.trim() ? 1 : 0) +
      (study.attachments?.length ?? 0);
    return [
      study.patientId ?? "-",
      study.patientName ?? "-",
      study.patientSex ?? "-",
      study.patientAge ?? "-",
      study.studyDescription ?? "-",
      study.modalities.join(", ") || "-",
      study.seriesCount,
      study.instanceCount,
      study.studyDate ?? "-",
      <StatusBadge status={study.status ?? study.availabilityStatus} />,
      <div className="available-study-process-actions flex flex-nowrap items-center gap-2">
        <button
          className="inline-flex items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-2.5 py-2 text-xs font-bold text-sky-700 disabled:opacity-50"
          disabled={!canSend || sendingId === study.id}
          onClick={() => openSubmission(study)}
          title="Add Clinical History"
          type="button"
        >
          <ClipboardList size={15} /> <span>Add Clinical History</span>
        </button>
        {additionalInfoCount ? (
          <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-bold text-sky-700">
            +{additionalInfoCount}
          </span>
        ) : null}
        <button
          className="available-study-send-button inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-2.5 py-2 text-xs font-bold text-white disabled:opacity-50"
          disabled={!canSend || sendingId === study.id}
          onClick={() => { setSendStudy(study); setSendPriority("REGULAR"); }}
          title="Send for reporting"
          type="button"
        >
          <Send size={14} /><span>{sendingId === study.id ? "Sending…" : "Send"}</span>
        </button>
        <button
          aria-label="Remove study"
          className="available-study-remove-button inline-flex h-8 w-8 items-center justify-center rounded-md border border-rose-200 bg-rose-50 text-rose-700 disabled:opacity-50"
          disabled={Boolean(study.processingJobId) || sendingId === study.id}
          onClick={() => setRemoveStudy(study)}
          title="Remove study"
          type="button"
        >
          <X size={14} />
        </button>
      </div>,
    ];
  });
  return (
    <div className="space-y-5">
      {error ? (
        <p className="text-sm font-semibold text-rose-700">{error}</p>
      ) : null}
      <SimpleTable
        title="Available studies"
        controls={
          <>
            <WorklistSearchFilterBar
              query={searchQuery}
              onQueryChange={setSearchQuery}
              onFilterClick={() => setFilterOpen(true)}
              activeFilterCount={activeFilterCount(filters)}
              placeholder="Search patient, accession, study, modality"
            />
            <ModalityBookmarkFilter
              active={activeModality}
              counts={modalityCounts}
              onChange={setActiveModality}
            />
          </>
        }
        columns={[
          "Patient ID",
          "Patient Name",
          "Gender",
          "Age",
          "Study",
          "Modality",
          "Series",
          "Images",
          "Study Date",
          "Status",
          "Study Process",
        ]}
        preserveLastColumn
        rows={rows}
      />
      {!loading && !studies.length ? (
        <EmptyState message="No studies have been uploaded by the bridge application yet." />
      ) : null}
      {!loading && Boolean(studies.length) && !rows.length ? (
        <EmptyState
          message={`No ${activeModality} studies are available for reporting.`}
        />
      ) : null}
      {filterOpen ? (
        <WorklistFilterModal
          title="Filter available studies"
          sortBy={sortBy}
          sortDirection={sortDirection}
          sortOptions={[
            { value: "studyDate", label: "Study date / time" },
            { value: "patientName", label: "Patient name" },
            { value: "patientId", label: "Patient ID" },
            { value: "study", label: "Study" },
            { value: "series", label: "Number of series" },
            { value: "images", label: "Images" },
            { value: "status", label: "Status" },
          ]}
          filterValues={filters}
          filterGroups={[
            {
              key: "status",
              label: "Status",
              options: [
                { value: "ALL", label: "All statuses" },
                { value: "AVAILABLE", label: "Available" },
                { value: "PROCESSING", label: "Processing" },
              ],
            },
            {
              key: "info",
              label: "Additional info",
              options: [
                { value: "ALL", label: "All studies" },
                { value: "WITH_INFO", label: "With info/files" },
                { value: "WITHOUT_INFO", label: "Without info/files" },
              ],
            },
          ]}
          onChangeSortBy={setSortBy}
          onChangeSortDirection={setSortDirection}
          onChangeFilter={(key, value) =>
            setFilters((current) => ({ ...current, [key]: value }))
          }
          onReset={() => {
            setSortBy("studyDate");
            setSortDirection("desc");
            setFilters({
              status: "ALL",
              info: "ALL",
              dateFrom: "",
              dateTo: "",
            });
          }}
          onClose={() => setFilterOpen(false)}
        />
      ) : null}
      {selectedStudy ? (
        <Modal
          title="Study details and patient"
          onClose={() => setSelectedStudy(null)}
        >
          <form onSubmit={saveAdditionalInfo}>
            <p className="text-sm text-slate-500">
              Confirm the patient profile, clinical context, and optional
              supporting documents.
            </p>
            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <p className="font-bold text-slate-950">
                {selectedStudy.patientName ?? "Patient"}
              </p>
              <p className="mt-1">
                Patient ID: {selectedStudy.patientId ?? "-"}
              </p>
              <p>Study: {selectedStudy.studyDescription ?? "-"}</p>
              <p>Modality: {selectedStudy.modalities.join(", ") || "-"}</p>
            </div>
            <label className="hidden">
              Patient profile
              <input
                className="mt-2 w-full rounded-md border border-slate-200 px-3 py-2"
                placeholder="Search Patient ID or name"
                value={patientQuery}
                onChange={(event) => {
                  const value = event.target.value;
                  setPatientQuery(value);
                  void api<{ items: PatientProfile[] }>(
                    `/api/patients?q=${encodeURIComponent(value)}&clientId=${client.id}`,
                    token,
                  ).then((result) => setPatientMatches(result.items));
                }}
              />
              <select
                className="mt-2 w-full rounded-md border border-slate-200 px-3 py-2"
                value={patientProfileId}
                onChange={(event) => setPatientProfileId(event.target.value)}
              >
                <option value="">Keep unlinked DICOM patient metadata</option>
                {patientMatches.map((patient) => (
                  <option key={patient.id} value={patient.id}>
                    {patient.patientIdentifier} · {patient.name}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs font-normal text-slate-500">
                Select an existing profile, or create one from Patients and
                return here. Original DICOM metadata is preserved.
              </span>
            </label>
            <section className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <h3 className="text-sm font-bold text-slate-900">Attach documents from patient profile</h3>
              <p className="mt-1 text-xs text-slate-500">Select existing clinical documents to include with this reporting request.</p>
              {matchedPatient ? (
                <>
                  <div className="mt-3 rounded-md border border-sky-200 bg-white px-3 py-2 text-sm">
                    <strong>{matchedPatient.name}</strong>
                    <span className="ml-2 text-slate-500">Patient ID: {matchedPatient.patientIdentifier}</span>
                  </div>
                  {(matchedPatient.reports ?? []).some((report) => ["APPROVED", "PUSHED"].includes(report.status)) ? (
                    <div className="mt-3">
                      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Previous generated reports</p>
                      <div className="grid gap-2">
                        {(matchedPatient.reports ?? []).filter((report) => ["APPROVED", "PUSHED"].includes(report.status)).map((report) => (
                          <label className="flex cursor-pointer items-center gap-3 rounded-md border border-emerald-200 bg-emerald-50/60 px-3 py-3 text-sm" key={report.id}>
                            <input
                              checked={selectedPreviousReportIds.includes(report.id)}
                              className="h-4 w-4 accent-emerald-600"
                              onChange={(event) => setSelectedPreviousReportIds((current) => event.target.checked ? [...current, report.id].slice(0, 5 - selectedPatientFileIds.length) : current.filter((id) => id !== report.id))}
                              type="checkbox"
                            />
                            <FileText className="shrink-0 text-emerald-700" size={16} />
                            <span className="min-w-0"><strong className="block truncate">{reportExamLabel(report)}</strong><span className="text-xs text-slate-500">{toDate(report.generatedAt)} · Previous signed report</span></span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-3 grid gap-2">
                    {(matchedPatient.archivedStudies ?? []).flatMap((archive) => archive.files.filter((file) => file.role !== "STUDY").map((file) => (
                      <label className="flex cursor-pointer items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-3 text-sm" key={file.id}>
                        <input checked={selectedPatientFileIds.includes(file.id)} className="h-4 w-4 accent-sky-600" onChange={(event) => setSelectedPatientFileIds((current) => event.target.checked ? [...current, file.id].slice(0, 5 - selectedPreviousReportIds.length) : current.filter((id) => id !== file.id))} type="checkbox" />
                        <FileText className="shrink-0 text-sky-600" size={16} />
                        <span className="min-w-0"><strong className="block truncate">{file.originalName}</strong><span className="text-xs text-slate-500">{archive.studyDescription} · {file.role.replaceAll("_", " ")}</span></span>
                      </label>
                    )))}
                    {!(matchedPatient.archivedStudies ?? []).some((archive) => archive.files.some((file) => file.role !== "STUDY")) ? <p className="rounded-md border border-dashed border-slate-300 p-3 text-xs font-semibold text-slate-500">No documents are available in this patient profile.</p> : null}
                  </div>
                </>
              ) : <p className="mt-3 rounded-md border border-dashed border-slate-300 bg-white p-3 text-xs font-semibold text-slate-500">No existing patient profile was found for DICOM Patient ID {selectedStudy.patientId ?? "-"}.</p>}
            </section>
            <label className="mt-4 block text-sm font-semibold text-slate-700">
              Clinical indication
              <textarea
                className="mt-2 min-h-28 w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-500"
                value={clinicalIndication}
                disabled={noClinicalIndication}
                onChange={(event) => setClinicalIndication(event.target.value)}
                placeholder="Type clinical indication or relevant history"
              />
            </label>
            <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-700">
              <input
                checked={noClinicalIndication}
                className="h-4 w-4 accent-sky-600"
                onChange={(event) => {
                  setNoClinicalIndication(event.target.checked);
                  if (event.target.checked) setClinicalIndication("");
                }}
                type="checkbox"
              />
              No clinical indication available
            </label>
            <label className="mt-4 block text-sm font-semibold text-slate-700">
              Supporting files
              <span className="mt-2 flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center transition hover:border-sky-300 hover:bg-sky-50">
                <UploadCloud className="mb-2 text-sky-600" size={22} />
                <span className="rounded-md bg-white px-3 py-2 text-xs font-bold text-slate-800 shadow-sm ring-1 ring-slate-200">
                  Choose files
                </span>
                <span className="mt-2 text-xs font-semibold text-slate-500">
                  {supportingFiles.length
                    ? supportingFiles.map((file) => file.name).join(", ")
                    : "PDF, DOCX, images, or any supporting document"}
                </span>
              </span>
              <input
                className="sr-only"
                multiple
                onChange={(event) =>
                  setSupportingFiles(
                    Array.from(event.target.files ?? []).slice(0, 5),
                  )
                }
                type="file"
              />
            </label>
            <p className="mt-2 text-xs font-semibold text-slate-500">
              Upload up to 5 files.{" "}
              {selectedStudy.attachments?.length
                ? `${selectedStudy.attachments.length} saved. `
                : ""}
              {supportingFiles.length
                ? `${supportingFiles.length} selected.`
                : ""}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="rounded-md border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700"
                disabled={sendingId === selectedStudy.id}
                onClick={() => setSelectedStudy(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-sky-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                disabled={sendingId === selectedStudy.id}
                type="submit"
              >
                {sendingId === selectedStudy.id ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
      {sendStudy ? (
        <Modal title="Send for reporting" onClose={() => setSendStudy(null)}>
          <p className="text-sm text-slate-600">
            Select the reporting priority for <strong>{sendStudy.patientName ?? "this patient"}</strong>.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {(["REGULAR", "URGENT"] as const).map((priority) => (
              <button
                className={cx(
                  "rounded-lg border p-4 text-left transition",
                  sendPriority === priority
                    ? "border-sky-500 bg-sky-50 ring-2 ring-sky-100"
                    : "border-slate-200 bg-white hover:border-sky-300",
                )}
                key={priority}
                onClick={() => setSendPriority(priority)}
                type="button"
              >
                <span className="block font-bold text-slate-900">{priority === "URGENT" ? "Urgent" : "Regular"}</span>
                <span className="mt-1 block text-xs text-slate-500">{priority === "URGENT" ? "Prioritise this study for faster reporting." : "Use the standard reporting queue."}</span>
              </button>
            ))}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button className="rounded-md border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700" onClick={() => setSendStudy(null)} type="button">Cancel</button>
            <button
              className="inline-flex items-center gap-2 rounded-md bg-sky-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              disabled={sendingId === sendStudy.id}
              onClick={() => void submitStudy(sendStudy, sendStudy.clinicalIndication ?? "", [], sendPriority)}
              type="button"
            >
              <Send size={15} /> {sendingId === sendStudy.id ? "Sending…" : `Send ${sendPriority === "URGENT" ? "urgent" : "regular"}`}
            </button>
          </div>
        </Modal>
      ) : null}
      {removeStudy ? (
        <Modal
          title="Remove available study?"
          onClose={() => setRemoveStudy(null)}
        >
          <p className="mt-2 text-sm text-slate-600">
            This will remove the study from the portal Available study list and
            delete its uploaded archive/files. Submitted or processed studies
            cannot be removed.
          </p>
          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <p className="font-bold text-slate-950">
              {removeStudy.patientName ?? "Patient"}
            </p>
            <p className="mt-1">Patient ID: {removeStudy.patientId ?? "-"}</p>
            <p>Study: {removeStudy.studyDescription ?? "-"}</p>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button
              className="rounded-md border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700"
              disabled={sendingId === removeStudy.id}
              onClick={() => setRemoveStudy(null)}
              type="button"
            >
              Cancel
            </button>
            <button
              className="rounded-md bg-rose-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              disabled={sendingId === removeStudy.id}
              onClick={() => void confirmRemoveStudy()}
              type="button"
            >
              {sendingId === removeStudy.id ? "Removing..." : "Remove study"}
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function ReportFormatView({
  token,
  client,
  reload,
  notice,
}: {
  token: string;
  client: Client;
  reload: () => Promise<void>;
  notice: (message: string) => void;
}) {
  const firstService = client.services[0]?.service.name ?? "";
  const [serviceName, setServiceName] = useState(firstService);
  const setting = client.reportSettings?.find(
    (item) => item.serviceName === serviceName,
  );
  const [mode, setMode] = useState<"Comprehensive" | "Custom">(
    setting?.reportMode ?? "Comprehensive",
  );
  const [returnFormat, setReturnFormat] = useState<ReturnFormat>(
    setting?.dicomReturnFormat ?? "DICOM_ENCAPSULATED_PDF",
  );
  const [sections, setSections] = useState<string[]>(
    setting?.enabledSections?.length ? setting.enabledSections : reportSections,
  );
  const [includeSignature, setIncludeSignature] = useState(
    setting?.includeRadiologistSignature !== false,
  );
  const [signatureDetailFields, setSignatureDetailFields] = useState<string[]>(
    setting?.signatureDetailFields?.length
      ? setting.signatureDetailFields
      : [
          "fullName",
          "qualification",
          "medicalRegistrationNumber",
          "organisationName",
        ],
  );

  useEffect(() => {
    setMode(setting?.reportMode ?? "Comprehensive");
    setReturnFormat(setting?.dicomReturnFormat ?? "DICOM_ENCAPSULATED_PDF");
    setSections(
      setting?.enabledSections?.length
        ? setting.enabledSections
        : reportSections,
    );
    setIncludeSignature(setting?.includeRadiologistSignature !== false);
    setSignatureDetailFields(
      setting?.signatureDetailFields?.length
        ? setting.signatureDetailFields
        : [
            "fullName",
            "qualification",
            "medicalRegistrationNumber",
            "organisationName",
          ],
    );
  }, [
    serviceName,
    setting?.id,
    setting?.reportMode,
    setting?.dicomReturnFormat,
    setting?.enabledSections?.join("|"),
    setting?.includeRadiologistSignature,
    setting?.signatureDetailFields?.join("|"),
  ]);

  async function save(event: FormEvent) {
    event.preventDefault();
    const enabledSections =
      mode === "Comprehensive" ? reportSections : sections;
    await api<ReportSetting>("/api/client/report-format", token, {
      method: "PUT",
      body: JSON.stringify({
        serviceName,
        dicomReturnFormat: returnFormat,
        reportMode: mode,
        radiologistReviewEnabled: Boolean(setting?.radiologistReviewEnabled),
        includeRadiologistSignature: includeSignature,
        signatureDetailFields,
        enabledSections,
        structuredHeaderJson: { sections: enabledSections },
      }),
    });
    notice("Report format saved.");
    await reload();
  }

  if (!firstService)
    return (
      <EmptyState message="No service is available for report formatting yet." />
    );
  return (
    <form className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]" onSubmit={save}>
      <section className="soft-card rounded-lg p-5">
        <h2 className="text-lg font-semibold text-slate-950">Report format</h2>
        <div className="mt-5 grid gap-4">
          <SelectInput
            label="Service"
            value={serviceName}
            onChange={setServiceName}
            options={client.services.map((item) => [
              item.service.name,
              item.service.name,
            ])}
          />
          <SelectInput
            label="PACS report format"
            value={returnFormat}
            onChange={(value) => setReturnFormat(value as ReturnFormat)}
            options={Object.entries(formatLabels).filter(([key]) =>
              ["DICOM_ENCAPSULATED_PDF", "DICOM_SECONDARY_CAPTURE"].includes(
                key,
              ),
            )}
          />
          <SelectInput
            label="Report mode"
            value={mode}
            onChange={(value) => {
              setMode(value as "Comprehensive" | "Custom");
              if (value === "Comprehensive") setSections(reportSections);
            }}
            options={[
              ["Comprehensive", "Comprehensive"],
              ["Custom", "Custom"],
            ]}
          />
        </div>
        <div className="mt-5 grid gap-2">
          {reportSections.map((section) => (
            <label
              className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
              key={section}
            >
              <input
                checked={sections.includes(section)}
                disabled={mode === "Comprehensive"}
                onChange={(event) =>
                  setSections(
                    event.target.checked
                      ? [...sections, section]
                      : sections.filter((item) => item !== section),
                  )
                }
                type="checkbox"
              />
              {section}
            </label>
          ))}
        </div>
        <div className="mt-5 rounded-lg border border-slate-200 bg-white p-4">
          <label className="flex items-center gap-2 text-sm font-bold text-slate-800">
            <input
              checked={includeSignature}
              onChange={(event) => setIncludeSignature(event.target.checked)}
              type="checkbox"
            />
            Include radiologist signature after approval
          </label>
          <div className="mt-3 grid gap-2">
            {signatureDetailOptions.map(([value, label]) => (
              <label
                className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700"
                key={value}
              >
                <input
                  checked={signatureDetailFields.includes(value)}
                  disabled={!includeSignature}
                  onChange={(event) =>
                    setSignatureDetailFields(
                      event.target.checked
                        ? [...signatureDetailFields, value]
                        : signatureDetailFields.filter(
                            (item) => item !== value,
                          ),
                    )
                  }
                  type="checkbox"
                />
                {label}
              </label>
            ))}
          </div>
        </div>
        <button
          className="mt-5 inline-flex items-center gap-2 rounded-md bg-sky-600 px-4 py-3 text-sm font-bold text-white"
          type="submit"
        >
          <Save size={16} />
          Save report format
        </button>
      </section>
      <section className="soft-card rounded-lg p-5">
        <h2 className="text-lg font-semibold text-slate-950">Live preview</h2>
        <iframe
          className="mt-5 h-[720px] w-full rounded-lg border border-slate-200 bg-white"
          srcDoc={buildReportFormatPreview(
            serviceName,
            mode === "Comprehensive" ? reportSections : sections,
          )}
          title="Report format preview"
        />
      </section>
    </form>
  );
}

function buildReportFormatPreview(serviceName: string, sections: string[]) {
  const sectionSet = new Set(sections);
  const bodySections = [
    sectionSet.has("AI Triage")
      ? '<div class="ai-triage" data-section="AI Triage"><span><strong>Classification:</strong> AI classification</span><span><strong>Severity Score:</strong> 2</span><span><strong>Confidence:</strong> 0.91</span></div>'
      : "",
    sectionSet.has("Image Quality")
      ? '<h2 data-section="Image Quality">Image Quality:</h2><div class="section-body"><p>Diagnostic image quality is adequate for interpretation.</p></div>'
      : "",
    sectionSet.has("Findings")
      ? '<h2 data-section="Findings">OBSERVATION:</h2><div class="section-body"><p class="finding-line"><strong>Lower Thorax:</strong> Sample observation text appears here when provided.</p><p class="finding-line"><strong>Liver:</strong> Organ-by-organ findings follow the same clinical paragraph format.</p></div>'
      : "",
    sectionSet.has("Systematic Sweep")
      ? '<h2 data-section="Systematic Sweep">Systematic Sweep:</h2><div class="section-body"><p class="finding-line"><strong>Checklist:</strong> Systematic sweep details appear here.</p></div>'
      : "",
    sectionSet.has("Abnormality Candidates")
      ? '<h2 data-section="Abnormality Candidates">Abnormality Candidates:</h2><div class="section-body"><p class="finding-line"><strong>Candidate:</strong> Candidate abnormality details appear here.</p></div>'
      : "",
    sectionSet.has("Comparison")
      ? '<h2 data-section="Comparison">Comparison:</h2><div class="section-body"><p>Comparison with prior imaging appears here when provided.</p></div>'
      : "",
    sectionSet.has("Impression")
      ? '<h2 data-section="Impression">IMPRESSION: -</h2><div class="section-body"><ol class="impression-list"><li>Impression generated from accepted AI response.</li><li>Additional impression lines remain numbered and aligned.</li></ol></div>'
      : "",
    sectionSet.has("Recommendation")
      ? '<h2 data-section="Recommendation">Adv: -</h2><div class="section-body"><p>Kindly review with clinical findings.</p></div>'
      : "",
    sectionSet.has("Disclaimer")
      ? '<h2 data-section="Disclaimer">Disclaimer:</h2><div class="section-body"><p>Configured disclaimer language appears here when provided.</p></div>'
      : "",
  ]
    .filter(Boolean)
    .join("");

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><title>DecXpert Preview</title><style>
  :root{--ink:#111827;--muted:#4b5563;--line:#111827;--soft-line:#cbd5e1}
  *{box-sizing:border-box} body{margin:0;background:#f3f4f6;color:var(--ink);font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45}
  .page{width:794px;min-height:1123px;margin:24px auto;background:#fff;border:1px solid var(--soft-line);box-shadow:0 10px 30px rgba(15,23,42,.08)}
  .inner{padding:44px 54px 42px}table{width:100%;border-collapse:collapse;margin:0 0 24px}th,td{border:1px solid var(--line);padding:7px 9px;vertical-align:top}th{width:18%;background:#fff;color:var(--ink);text-align:left;font-size:13px;font-weight:700}td{width:32%;background:#fff;font-size:13px;font-weight:400}
  .study-title{margin:20px 0 18px;text-align:center;font-size:16px;font-weight:700;text-transform:uppercase}.report-card{margin:0;background:#fff}.ai-triage{margin:0 0 16px;color:var(--muted);font-size:12px}.ai-triage span{display:inline-block;margin-right:18px}
  h2{margin:16px 0 8px;color:var(--ink);font-size:14px;font-weight:700;text-transform:uppercase}p{margin:0 0 9px;font-size:14px;line-height:1.5}.section-body{margin-bottom:8px}.finding-line strong{font-weight:700}.impression-list{margin:0 0 10px 0;padding:0;list-style:none;counter-reset:item}.impression-list li{margin:0 0 7px;padding-left:0;font-size:14px;line-height:1.5;counter-increment:item}.impression-list li:before{content:counter(item) ". ";font-weight:400}.footer-note{margin-top:26px;border-top:1px solid var(--soft-line);padding-top:10px;color:var(--muted);font-size:11px;line-height:1.35}
  </style></head><body><main class="page"><div class="inner">
  <table class="patient-grid"><tbody><tr><th>Patient ID</th><td>From DICOM metadata</td><th>Age/Sex</th><td>From DICOM metadata</td></tr><tr><th>Patient Name</th><td>From DICOM metadata</td><th>Reported Date</th><td>Preview</td></tr></tbody></table>
  <section class="report-card"><div class="study-title">${escapeHtmlText(serviceName || "Accepted upstream response")}</div>${bodySections}</section>
  <div class="footer-note">This report was generated using DecXpert AI-assisted radiology analysis software developed by Dectrocel Healthcare and Research. The output is intended for clinical workflow assistance only and must be reviewed, interpreted, and validated by a qualified radiologist or licensed medical practitioner prior to clinical use.</div></div></main></body></html>`;
}

function escapeHtmlText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeHtmlAttributeText(value: string) {
  return escapeHtmlText(value).replaceAll("`", "&#096;");
}

function ProfileView({
  client,
  token,
  user,
}: {
  client: Client;
  token: string;
  user: User;
}) {
  const [syncConfig, setSyncConfig] = useState<StudySyncConfig | null>(null);
  const [syncConfigError, setSyncConfigError] = useState("");

  useEffect(() => {
    if (!client.studySyncEnabled) {
      setSyncConfig(null);
      setSyncConfigError("");
      return;
    }
    let cancelled = false;
    api<StudySyncConfig>("/api/client/study-sync/config", token)
      .then((config) => {
        if (!cancelled) {
          setSyncConfig(config);
          setSyncConfigError("");
        }
      })
      .catch((error) => {
        if (!cancelled)
          setSyncConfigError(
            error instanceof Error
              ? error.message
              : "Unable to load bridge API settings",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [client.studySyncEnabled, token]);

  return (
    <section className="profile-workspace grid gap-6 xl:grid-cols-2">
      <div className="soft-card rounded-lg p-5">
        <h2 className="text-lg font-semibold text-slate-950">Client profile</h2>
        <div className="mt-5 grid gap-4">
          <TextInput
            label="Facility name"
            value={brandText(client.name)}
            readOnly
          />
          <TextInput label="Client code" value={client.code} readOnly />
          <TextInput
            label="Primary contact"
            value={client.primaryContact}
            readOnly
          />
          <TextInput label="Email" value={client.email} readOnly />
          <TextInput
            label="Facility type"
            value={client.facilityType}
            readOnly
          />
          <TextInput
            label="Demo mode"
            value={client.demoModeEnabled ? "Enabled" : "Disabled"}
            readOnly
          />
          <TextInput
            label="Demo studies"
            value={
              client.demoModeEnabled
                ? `${client._count?.processingJobs ?? 0}${client.demoStudyLimit == null ? "" : ` / ${client.demoStudyLimit}`}`
                : "-"
            }
            readOnly
          />
        </div>
      </div>
      <div className="soft-card rounded-lg p-5">
        <h2 className="text-lg font-semibold text-slate-950">Portal user</h2>
        <div className="mt-5 grid gap-4">
          <TextInput label="Name" value={brandText(user.name)} readOnly />
          <TextInput label="User ID" value={user.userId ?? "-"} readOnly />
          <TextInput label="Contact email" value={user.email} readOnly />
          <TextInput label="Role" value={user.role} readOnly />
          <TextInput label="Status" value={client.status} readOnly />
        </div>
      </div>
      <div className="soft-card rounded-lg p-5 xl:col-span-2">
        <h2 className="text-lg font-semibold text-slate-950">
          Integration settings
        </h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold uppercase text-slate-600">
                Bridge API
              </h3>
              <StatusBadge
                status={client.studySyncEnabled ? "ENABLED" : "DISABLED"}
              />
            </div>
            {client.studySyncEnabled ? (
              syncConfig ? (
                <div className="mt-4 grid gap-3">
                  <TextInput
                    label="Center code"
                    value={syncConfig.centerCode ?? syncConfig.clientId}
                    readOnly
                  />
                  <TextInput
                    label="Auth header"
                    value="Authorization: Bearer <bridge_token>"
                    readOnly
                  />
                  {Object.entries(syncConfig.endpoints).map(([key, endpoint]) => (
                    <TextInput
                      key={key}
                      label={`${key} ${endpoint.method}`}
                      value={endpoint.url}
                      readOnly
                    />
                  ))}
                  <p className="text-xs font-semibold leading-5 text-slate-500">
                    Bridge-enabled studies are parked in Available study. The
                    user submits them from the portal to generate AI/reporting
                    output.
                  </p>
                </div>
              ) : (
                <p className="mt-3 text-sm font-semibold text-slate-500">
                  {syncConfigError || "Loading bridge API settings..."}
                </p>
              )
            ) : (
              <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">
                Bridge is disabled. Configure your PACS modality to send DICOM
                studies directly to the portal receive endpoint shown per
                service.
              </p>
            )}
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-bold uppercase text-slate-600">
              Direct PACS routing
            </h3>
            <div className="mt-4">
              <DirectPacsSetup services={client.services} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function compactTableColumnIndexes(columns: string[]) {
  if (columns.length <= 4) return columns.map((_column, index) => index);
  const selected = new Set<number>([0]);
  const priorities = [
    /patient name|radiologist|client|center/i,
    /study|report|service|modality/i,
    /status|result/i,
    /amount|total|payable|updated|date|created/i,
  ];
  for (const pattern of priorities) {
    const index = columns.findIndex(
      (column, columnIndex) =>
        !selected.has(columnIndex) && pattern.test(column),
    );
    if (index >= 0) selected.add(index);
    if (selected.size >= 4) break;
  }
  for (let index = 1; selected.size < 4 && index < columns.length; index += 1)
    selected.add(index);
  return [...selected].sort((left, right) => left - right);
}

function SimpleTable({
  columns,
  rows,
  title,
  controls,
  preserveLastColumn = false,
}: {
  columns: string[];
  rows: Array<Array<ReactNode>>;
  title?: string;
  controls?: ReactNode;
  preserveLastColumn?: boolean;
}) {
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const compact = columns.length > 4;
  const visibleColumnIndexes = compactTableColumnIndexes(columns);
  const renderedColumnIndexes = preserveLastColumn
    ? Array.from(new Set([...visibleColumnIndexes, columns.length - 1]))
    : visibleColumnIndexes;
  const selectedRow = selectedRowIndex === null ? null : rows[selectedRowIndex];
  return (
    <section className="soft-card worklist-card compact-data-table rounded-lg p-5">
      {title || controls ? (
        <div className="table-panel-heading">
          {title ? (
            <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
          ) : null}
          {controls}
        </div>
      ) : null}
      <div className="table-scroll no-x-scroll">
        <table
          aria-label={title ?? "Portal records"}
          className={cx(
            "report-table w-full text-left text-sm",
            title === "Available studies" && "available-studies-table",
          )}
        >
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
              {(compact
                ? renderedColumnIndexes.map((index) => columns[index])
                : columns
              ).map((column) => (
                <th className="py-3 pr-4" key={column} scope="col">
                  {column}
                </th>
              ))}
              {compact && !preserveLastColumn ? (
                <th className="py-3 pr-4" scope="col">
                  Action
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr
                className="border-b border-slate-100 align-top"
                key={rowIndex}
              >
                {(compact
                  ? renderedColumnIndexes.map((index) => row[index])
                  : row
                ).map((cell, cellIndex) => (
                  <td className="py-4 pr-4 text-slate-700" key={cellIndex}>
                    {cell}
                  </td>
                ))}
                {compact && !preserveLastColumn ? (
                  <td className="py-4 pr-4">
                    <button
                      aria-label={`View ${title ?? "record"} ${rowIndex + 1} details`}
                      className="table-view-button"
                      onClick={() => setSelectedRowIndex(rowIndex)}
                      type="button"
                    >
                      View
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td
                  className="py-8 text-center text-sm font-semibold text-slate-500"
                  colSpan={
                    compact ? renderedColumnIndexes.length + (preserveLastColumn ? 0 : 1) : columns.length
                  }
                >
                  No records are available yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {selectedRow ? (
        <Modal
          title={`${title ?? "Record"} details`}
          onClose={() => setSelectedRowIndex(null)}
        >
          <div className="record-detail-grid">
            {columns.map((column, index) => (
              <div className="record-detail-field" key={column}>
                <span>{column}</span>
                <div>{selectedRow[index] ?? "-"}</div>
              </div>
            ))}
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

function CollapsibleTable({
  columns,
  rows,
  title,
  open,
  onToggle,
}: {
  columns: string[];
  rows: Array<Array<ReactNode>>;
  title: string;
  open: boolean;
  onToggle: () => void;
}) {
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const compact = columns.length > 4;
  const visibleColumnIndexes = compactTableColumnIndexes(columns);
  const selectedRow = selectedRowIndex === null ? null : rows[selectedRowIndex];
  return (
    <section className="soft-card collapsible-table-card rounded-lg p-5">
      <button
        aria-expanded={open}
        className="collapsible-table-header"
        onClick={onToggle}
        type="button"
      >
        <span>{title}</span>
        <ChevronRight
          aria-hidden="true"
          className={cx(open && "collapsible-table-chevron-open")}
          size={18}
        />
      </button>
      {open ? (
        <div className="table-scroll no-x-scroll">
          <table
            aria-label={title}
            className="report-table w-full text-left text-sm"
          >
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                {(compact
                  ? visibleColumnIndexes.map((index) => columns[index])
                  : columns
                ).map((column) => (
                  <th className="py-3 pr-4" key={column} scope="col">
                    {column}
                  </th>
                ))}
                {compact ? (
                  <th className="py-3 pr-4" scope="col">
                    Action
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr
                  className="border-b border-slate-100 align-top"
                  key={rowIndex}
                >
                  {(compact
                    ? visibleColumnIndexes.map((index) => row[index])
                    : row
                  ).map((cell, cellIndex) => (
                    <td className="py-4 pr-4 text-slate-700" key={cellIndex}>
                      {cell}
                    </td>
                  ))}
                  {compact ? (
                    <td className="py-4 pr-4">
                      <button
                        aria-label={`View ${title} record ${rowIndex + 1} details`}
                        className="table-view-button"
                        onClick={() => setSelectedRowIndex(rowIndex)}
                        type="button"
                      >
                        View
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td
                    className="py-8 text-center text-sm font-semibold text-slate-500"
                    colSpan={
                      compact ? visibleColumnIndexes.length + 1 : columns.length
                    }
                  >
                    No records are available yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}
      {selectedRow ? (
        <Modal
          title={`${title} details`}
          onClose={() => setSelectedRowIndex(null)}
        >
          <div className="record-detail-grid">
            {columns.map((column, index) => (
              <div className="record-detail-field" key={column}>
                <span>{column}</span>
                <div>{selectedRow[index] ?? "-"}</div>
              </div>
            ))}
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

function AuditLogsView({ logs, title }: { logs: AuditLog[]; title: string }) {
  const [query, setQuery] = useState("");
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredLogs = normalizedQuery
    ? logs.filter((item) => auditLogSearchText(item).includes(normalizedQuery))
    : logs;
  return (
    <section className="soft-card worklist-card rounded-lg p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
          <p className="mt-1 text-sm text-slate-500">
            Search action, client, actor, status, path, or metadata. Audit
            history is retained permanently.
          </p>
        </div>
        <label className="relative block w-full lg:w-96">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            size={16}
          />
          <input
            className="w-full rounded-md border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400"
            placeholder="Search logs..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      <div className="mt-5 table-scroll no-x-scroll">
        <table className="report-table w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
              {["Time", "Action", "Client", "Status", "Details"].map(
                (column) => (
                  <th className="py-3 pr-4" key={column}>
                    {column}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {filteredLogs.map((item) => (
              <tr className="border-b border-slate-100 align-top" key={item.id}>
                <td className="py-4 pr-4 text-slate-700">
                  {toDate(item.createdAt)}{" "}
                  {new Date(item.createdAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
                <td className="py-4 pr-4 font-semibold text-slate-900">
                  {item.action}
                </td>
                <td className="py-4 pr-4 text-slate-700">
                  {brandText(item.client?.name ?? item.clientId ?? "-")}
                </td>
                <td className="py-4 pr-4 text-slate-700">
                  {String((item.metadata ?? {}).statusCode ?? "-")}
                </td>
                <td className="py-4 pr-4">
                  <button
                    className="table-view-button"
                    onClick={() => setSelectedLog(item)}
                    type="button"
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
            {!filteredLogs.length ? (
              <tr>
                <td
                  className="py-6 text-sm font-semibold text-slate-500"
                  colSpan={5}
                >
                  No matching logs found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {selectedLog ? (
        <Modal title="Audit event details" onClose={() => setSelectedLog(null)}>
          <div className="record-detail-grid">
            <DetailField
              label="Time"
              value={`${toDate(selectedLog.createdAt)} ${new Date(selectedLog.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
            />
            <DetailField label="Action" value={selectedLog.action} />
            <DetailField
              label="Client"
              value={brandText(
                selectedLog.client?.name ?? selectedLog.clientId ?? "-",
              )}
            />
            <DetailField label="Actor" value={selectedLog.actorUserId ?? "-"} />
            <DetailField
              label="Status"
              value={String((selectedLog.metadata ?? {}).statusCode ?? "-")}
            />
            <DetailField
              label="Path"
              value={String((selectedLog.metadata ?? {}).path ?? "-")}
            />
            <DetailField
              label="IP address"
              value={selectedLog.ipAddress ?? "-"}
            />
          </div>
          <div className="mt-5">
            <h3 className="text-sm font-bold text-slate-900">Metadata</h3>
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-xs text-slate-700">
              {formatJson(selectedLog.metadata)}
            </pre>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

function auditLogSearchText(item: AuditLog) {
  return [
    item.action,
    brandText(item.client?.name),
    item.client?.code,
    item.clientId,
    item.actorUserId,
    item.ipAddress,
    formatJson(item.metadata),
    item.createdAt,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function EmptyState({ message, title }: { message: string; title?: string }) {
  const normalized = message.trim().toLowerCase();
  const loading =
    normalized.startsWith("loading") || normalized.startsWith("restoring");
  const restricted =
    normalized.includes("available only") || normalized.includes("not enabled");
  const unavailable =
    normalized.includes("not available") || normalized.includes("unavailable");
  const heading =
    title ??
    (loading
      ? "Preparing your workspace"
      : restricted
        ? "Access is limited"
        : unavailable
          ? "Currently unavailable"
          : normalized.startsWith("create ")
            ? "Ready for setup"
            : "No records to show");
  return (
    <section
      aria-busy={loading}
      aria-live={loading ? "polite" : undefined}
      className="soft-card grid min-h-36 place-items-center rounded-xl p-6 text-center sm:p-8"
    >
      <div className="flex max-w-md flex-col items-center">
        <span
          className={cx(
            "mb-4 grid h-12 w-12 place-items-center rounded-2xl ring-1",
            loading
              ? "bg-sky-50 text-sky-700 ring-sky-100"
              : restricted
                ? "bg-amber-50 text-amber-700 ring-amber-100"
                : "bg-slate-50 text-slate-500 ring-slate-200",
          )}
        >
          {loading ? (
            <LoaderCircle
              aria-hidden="true"
              className="animate-spin"
              size={22}
            />
          ) : restricted ? (
            <ShieldCheck aria-hidden="true" size={22} />
          ) : (
            <ClipboardList aria-hidden="true" size={22} />
          )}
        </span>
        <h2 className="text-base font-extrabold text-slate-900">{heading}</h2>
        <p className="mt-1.5 text-sm font-medium leading-6 text-slate-500">
          {message}
        </p>
      </div>
    </section>
  );
}

function WhatsAppBotView({
  token,
  notice,
  physicianConfiguration = false,
  centers = [],
}: {
  token: string;
  notice: (message: string) => void;
  physicianConfiguration?: boolean;
  centers?: Array<{ id: string; name: string }>;
}) {
  const [config, setConfig] = useState<WhatsAppBotConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    role: physicianConfiguration ? "REFERRING_PHYSICIAN" : "DECTROCEL",
    clientId: "",
    organization: "DECTROCEL",
    userId: "",
    phoneE164: "",
    verificationStatus: "PENDING",
    consentConfirmed: false,
    consentSource: "",
    notificationCategories: ["ALL"],
    accessCategories: ["NOTIFICATIONS"],
  });

  async function loadConfig() {
    const next = await api<WhatsAppBotConfig>("/api/v1/whatsapp/config", token);
    setConfig(next);
  }

  useEffect(() => {
    void loadConfig();
  }, [token]);

  async function addRecipient(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await api<NotificationRecipient>("/api/v1/whatsapp/recipients", token, {
        method: "POST",
        body: JSON.stringify({
          ...form,
          active: true,
          consentStatus: "OPTED_IN",
        }),
      });
      setForm({ ...form, name: "", userId: "", phoneE164: "", consentConfirmed: false, consentSource: "", verificationStatus: "PENDING" });
      notice("WhatsApp recipient added.");
      await loadConfig();
    } catch (error) {
      notice(
        error instanceof Error
          ? error.message
          : "Unable to add WhatsApp recipient.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleRecipient(recipient: NotificationRecipient) {
    await api<NotificationRecipient>(
      `/api/v1/whatsapp/recipients/${recipient.id}`,
      token,
      {
        method: "PATCH",
        body: JSON.stringify({ active: !recipient.active }),
      },
    );
    await loadConfig();
  }

  async function removeRecipient(recipient: NotificationRecipient) {
    if (!window.confirm(`Remove ${recipient.name} from the WhatsApp whitelist?`)) return;
    await api(`/api/v1/whatsapp/recipients/${recipient.id}`, token, { method: "DELETE" });
    notice("WhatsApp whitelist entry removed.");
    await loadConfig();
  }

  async function processOutbox() {
    await api<{ processed: boolean }>(
      "/api/v1/whatsapp/outbox/process",
      token,
      { method: "POST" },
    );
    notice("WhatsApp outbox processed.");
    await loadConfig();
  }

  const payloadMessage = (payload: unknown) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      return "-";
    const message = (payload as Record<string, unknown>).message;
    return typeof message === "string" ? message : "-";
  };

  if (!config)
    return <EmptyState message="Loading WhatsApp bot configuration..." />;

  return (
    <div className="grid gap-6 pw-whatsapp-sections">
      <details><summary>Connection and delivery settings</summary><section className="soft-card rounded-lg p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              {physicianConfiguration ? "WhatsApp Configuration" : "WhatsApp chatbot"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Cloud API setup, notification recipients, and bot command
              delivery.
            </p>
          </div>
          <button
            className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700"
            onClick={() => void loadConfig()}
            type="button"
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <MetricCard
            icon={Bell}
            label="Mode"
            value={config.cloudApiEnabled ? "Live" : "Demo"}
            sub={
              config.outboundReady
                ? "Compliant outbound ready"
                : config.cloudApiEnabled
                  ? "Configuration incomplete"
                : "Messages logged locally"
            }
          />
          <MetricCard
            icon={Phone}
            label="Recipients"
            value={String(
              config.recipients.filter((item) => item.active).length,
            )}
            sub={`${config.recipients.length} configured`}
          />
          <MetricCard
            icon={ClipboardList}
            label="Outbox"
            value={String(config.summary.pendingCount)}
            sub={`${config.summary.sentCount} sent, ${config.summary.failedCount} failed`}
          />
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <TextInput
            label="Callback URL"
            value={config.callbackUrl ?? config.webhookUrl}
            readOnly
          />
          <CredentialField
            label="Verify token"
            value={config.webhookVerifyToken ?? ""}
            emptyText={config.hasWebhookVerifyToken ? "Configured" : "Missing"}
          />
          <TextInput
            label="Bot command"
            value={config.commandExample}
            readOnly
          />
          <TextInput
            label="API token"
            value={config.hasCloudApiToken ? "Configured" : "Missing"}
            readOnly
          />
          <TextInput
            label="Phone number ID"
            value={config.hasPhoneNumberId ? "Configured" : "Missing"}
            readOnly
          />
          <TextInput
            label="Webhook app secret"
            value={config.hasAppSecret ? "Configured" : "Missing"}
            readOnly
          />
          <TextInput
            label="Approved utility template"
            value={config.hasUtilityTemplate ? "Configured" : "Missing"}
            readOnly
          />
        </div>
      </section></details>

      {physicianConfiguration && <section className="soft-card rounded-lg p-5">
        <h3 className="font-semibold">Referring physician reports</h3>
        <p className="mt-2 text-sm">Match the physician name to the study’s referring-physician DICOM tag. Approved reports are sent only to the matching verified recipient. Duplicate names require a center selection to distinguish them.</p>
        <p className="mt-2 text-sm">{config.physicianReportReady ? "Report-link delivery is configured." : "Report-link delivery is waiting for the WhatsApp app secret and approved report-ready template."}</p>
        <h3 className="mt-5 font-semibold">Radiologist call requests</h3>
        <p className="text-sm">Superadmin and the assigned radiologist receive a portal notification when a physician requests a call.</p>
        {config.callRequests?.length ? <div className="mt-3 grid gap-3">{config.callRequests.map(request => <div key={request.id} className="rounded border p-3 text-sm">
          <p>{request.message}</p><p className="mt-1 text-slate-500">{request.status} · {new Date(request.createdAt).toLocaleString()}</p>
          {request.status === "PENDING" && <button type="button" className="mt-2 font-semibold text-sky-700" onClick={() => void api(`/api/v1/whatsapp/physician-calls/${request.id}`, token, { method: "PATCH", body: JSON.stringify({ status: "COMPLETED" }) }).then(loadConfig).catch(error => notice(error instanceof Error ? error.message : "Unable to update call request"))}>Mark handled</button>}
        </div>)}</div> : <p className="mt-3 text-sm text-slate-500">No physician call requests yet.</p>}
      </section>}

      <details><summary>Add notification recipient</summary><FormCard
        title="Add WhatsApp recipient"
        onSubmit={addRecipient}
        submitLabel={saving ? "Saving..." : "Add recipient"}
      >
        <TextInput
          label="Name"
          value={form.name}
          onChange={(value) => setForm({ ...form, name: value })}
        />
        <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
          Role
          <select className="rounded-md border border-slate-200 bg-white px-3 py-2" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value, organization: event.target.value === "REFERRING_PHYSICIAN" ? "DECTROCEL" : event.target.value })}>
            {physicianConfiguration && <option value="REFERRING_PHYSICIAN">Referring physician</option>}
            <option value="DECTROCEL">Dectrocel</option>
            <option value="RENEWIST">Renewist</option>
            <option value="MARENGO_MANAGEMENT">Marengo Management</option>
          </select>
        </label>
        {form.role === "REFERRING_PHYSICIAN" && <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
          Center scope
          <select className="rounded-md border border-slate-200 bg-white px-3 py-2" value={form.clientId} onChange={event => setForm({ ...form, clientId: event.target.value })}>
            <option value="">All centers (unique physician name required)</option>
            {centers.map(center => <option key={center.id} value={center.id}>{center.name}</option>)}
          </select>
        </label>}
        <TextInput
          label="Assigned user ID (optional)"
          value={form.userId}
          onChange={(value) => setForm({ ...form, userId: value })}
        />
        <TextInput
          label="Phone (+country code or 10-digit Indian number)"
          value={form.phoneE164}
          onChange={(value) => setForm({ ...form, phoneE164: value })}
        />
        <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
          Categories
          <select
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-400"
            value={form.notificationCategories.join(",")}
            onChange={(event) =>
              setForm({
                ...form,
                notificationCategories: event.target.value
                  .split(",")
                  .filter(Boolean),
              })
            }
          >
            <option value="ALL">All notifications</option>
            <option value="STUDY_STATUS,CALL_BOOKING">Study status + calls</option>
            <option value="STUDY_STATUS">Study status only</option>
            <option value="CALL_BOOKING">Call booking only</option>
            <option value="QUERY,DEMO_REQUEST">Queries + demo requests</option>
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
          Verification
          <select className="rounded-md border border-slate-200 bg-white px-3 py-2" value={form.verificationStatus} onChange={(event) => setForm({ ...form, verificationStatus: event.target.value })}>
            <option value="VERIFIED">Verified</option><option value="PENDING">Pending</option><option value="REJECTED">Rejected</option>
          </select>
        </label>
        <TextInput
          label="Consent source (required)"
          value={form.consentSource}
          onChange={(value) => setForm({ ...form, consentSource: value })}
        />
        <label className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          <input
            className="mt-1"
            type="checkbox"
            checked={form.consentConfirmed}
            onChange={(event) => setForm({ ...form, consentConfirmed: event.target.checked })}
            required
          />
          <span>
            {form.role === "REFERRING_PHYSICIAN" ? "I confirm this physician agreed to receive report links and call-request updates on this number and was told how to opt out." : "I confirm this person explicitly agreed to receive the selected Dectrocel WhatsApp notifications and was told how to opt out."}
          </span>
        </label>
        <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
          Authorized access
          <select className="rounded-md border border-slate-200 bg-white px-3 py-2" value={form.accessCategories.join(",")} onChange={(event) => setForm({ ...form, accessCategories: event.target.value.split(",").filter(Boolean) })}>
            <option value="NOTIFICATIONS">Notifications</option>
            <option value="NOTIFICATIONS,STATISTICS,MANAGEMENT_BOT">Notifications + statistics + bot</option>
            <option value="NOTIFICATIONS,BILLING,STATISTICS,MANAGEMENT_BOT">Management access</option>
            <option value="ALL">All authorized features</option>
          </select>
        </label>
      </FormCard></details>

      <SimpleTable
        title="Notification recipients"
        columns={["Name", "Category", "Phone", "Access", "Consent", "Verification", "Last notified", "Status", "Actions"]}
        rows={
          config.recipients.length
            ? config.recipients.map((recipient) => [
                recipient.name,
                recipient.role,
                recipient.phoneE164 ?? "-",
                recipient.accessCategories.join(", "),
                recipient.consentAt ? `${toDate(recipient.consentAt)} · ${recipient.consentSource ?? "Recorded"}` : "Not recorded",
                <StatusBadge status={recipient.verificationStatus} />,
                recipient.lastNotificationAt ? toDate(recipient.lastNotificationAt) : "Never",
                <StatusBadge
                  status={recipient.active ? "ACTIVE" : "INACTIVE"}
                />,
                <div className="flex gap-2"><button className="rounded-md border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700" onClick={() => void toggleRecipient(recipient)} type="button">{recipient.active ? "Disable" : "Enable"}</button><button className="rounded-md border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700" onClick={() => void removeRecipient(recipient)} type="button">Remove</button></div>,
              ])
            : [["No recipients configured", "-", "-", "-", "-", "-", "-", "-", "-"]]
        }
      />

      <section className="soft-card rounded-lg p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-950">
            Recent WhatsApp outbox
          </h2>
          <button
            className="inline-flex items-center gap-2 rounded-md bg-sky-600 px-3 py-2 text-sm font-bold text-white"
            onClick={() => void processOutbox()}
            type="button"
          >
            <RefreshCw size={16} />
            Process now
          </button>
        </div>
        <div className="table-scroll no-x-scroll">
          <table className="report-table w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                <th className="py-3 pr-4">Event</th>
                <th className="py-3 pr-4">Status</th>
                <th className="py-3 pr-4">Attempts</th>
                <th className="py-3 pr-4">Message</th>
                <th className="py-3 pr-4">Created</th>
              </tr>
            </thead>
            <tbody>
              {config.outbox.map((item) => (
                <tr
                  className="border-b border-slate-100 align-top"
                  key={item.id}
                >
                  <td className="py-4 pr-4 font-semibold text-slate-800">
                    {item.eventType}
                  </td>
                  <td className="py-4 pr-4">
                    <StatusBadge status={item.status} />
                  </td>
                  <td className="py-4 pr-4 text-slate-700">{item.attempts}</td>
                  <td className="py-4 pr-4 text-slate-700">
                    <span className="line-clamp-3 whitespace-pre-wrap">
                      {payloadMessage(item.payload)}
                    </span>
                  </td>
                  <td className="py-4 pr-4 text-slate-700">
                    {toDate(item.createdAt)}
                  </td>
                </tr>
              ))}
              {!config.outbox.length ? (
                <tr>
                  <td className="py-4 text-slate-600" colSpan={5}>
                    No WhatsApp notifications queued yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SupportCenterView({
  token,
  role,
  client,
  clients = [],
  notice,
}: {
  token: string;
  role: "admin" | "client" | "provider";
  client?: Client;
  clients?: Array<Pick<Client, "id" | "name" | "code">>;
  notice: (message: string) => void;
}) {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [internalNote, setInternalNote] = useState(false);
  const [form, setForm] = useState({
    clientId: client?.id ?? "",
    category: "Operations",
    priority: "MEDIUM",
    subject: "",
    description: "",
    assignedTeam: role === "provider" ? "RENEWIST" : "DECTROCEL",
  });
  const selectedTicket =
    tickets.find((ticket) => ticket.id === selectedTicketId) ??
    tickets[0] ??
    null;

  async function loadSupport() {
    const ticketRows = await api<SupportTicket[]>(
      "/api/v1/support/tickets",
      token,
    );
    setTickets(ticketRows);
    if (!selectedTicketId && ticketRows[0])
      setSelectedTicketId(ticketRows[0].id);
  }

  useEffect(() => {
    void loadSupport();
  }, [token]);

  async function createTicket(event: FormEvent) {
    event.preventDefault();
    const isGroupClient = role === "client" && client?.code === "MARENGO";
    const payload = {
      ...form,
      clientId:
        role === "client"
          ? isGroupClient
            ? form.clientId || undefined
            : undefined
          : form.clientId || undefined,
      assignedTeam: form.assignedTeam as "DECTROCEL" | "RENEWIST",
      priority: form.priority as "LOW" | "MEDIUM" | "HIGH" | "URGENT",
    };
    const created = await api<SupportTicket>("/api/v1/support/tickets", token, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setForm({ ...form, subject: "", description: "" });
    setSelectedTicketId(created.id);
    notice(`Support ticket ${created.ticketNumber} created.`);
    await loadSupport();
  }

  async function addMessage(event: FormEvent) {
    event.preventDefault();
    if (!selectedTicket || !messageBody.trim()) return;
    await api<SupportTicketMessage>(
      `/api/v1/support/tickets/${selectedTicket.id}/messages`,
      token,
      {
        method: "POST",
        body: JSON.stringify({
          body: messageBody,
          visibility: internalNote ? "INTERNAL" : "PUBLIC",
        }),
      },
    );
    setMessageBody("");
    setInternalNote(false);
    await loadSupport();
  }

  return (
    <div className="support-workspace">
      <div className="support-compose-column">
        <FormCard
          className="support-create-ticket-card"
          title="Create support ticket"
          onSubmit={createTicket}
          submitLabel="Create ticket"
        >
          {role === "admin" || client?.code === "MARENGO" ? (
            <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
              Center / client
              <select
                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-400"
                value={form.clientId}
                onChange={(event) =>
                  setForm({ ...form, clientId: event.target.value })
                }
              >
                <option value="">
                  {client?.code === "MARENGO"
                    ? "Organization-wide support"
                    : "Platform / no center"}
                </option>
                {clients.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.code})
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <TextInput
            label="Category"
            value={form.category}
            onChange={(value) => setForm({ ...form, category: value })}
          />
          <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
            Priority
            <select
              className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-400"
              value={form.priority}
              onChange={(event) =>
                setForm({ ...form, priority: event.target.value })
              }
            >
              {["LOW", "MEDIUM", "HIGH", "URGENT"].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <TextInput
            label="Subject"
            value={form.subject}
            onChange={(value) => setForm({ ...form, subject: value })}
          />
          <label className="support-description-field grid gap-1.5 text-sm font-semibold text-slate-700 md:col-span-2">
            Description
            <textarea
              className="min-h-32 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-400"
              value={form.description}
              onChange={(event) =>
                setForm({ ...form, description: event.target.value })
              }
            />
          </label>
        </FormCard>
      </div>

      <section className="support-ticket-panel">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              Support tickets
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Portal conversation history, internal notes, status, and assigned
              team.
            </p>
          </div>
          <button
            className="rounded-md border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700"
            onClick={() => void loadSupport()}
            type="button"
          >
            Refresh
          </button>
        </div>
        <div className="support-ticket-layout">
          <div className="support-ticket-list">
            {tickets.map((ticket) => (
              <button
                className={cx(
                  "w-full rounded-md border p-3 text-left text-sm transition",
                  selectedTicket?.id === ticket.id
                    ? "border-sky-200 bg-sky-50"
                    : "border-slate-200 bg-white hover:bg-slate-50",
                )}
                key={ticket.id}
                onClick={() => setSelectedTicketId(ticket.id)}
                type="button"
              >
                <div className="font-bold text-slate-950">
                  {ticket.ticketNumber}
                </div>
                <div className="mt-1 text-slate-600">{ticket.subject}</div>
                <div className="mt-2 flex items-center justify-between gap-2 text-xs font-bold text-slate-500">
                  <span>{ticket.priority}</span>
                  <span>{ticket.status}</span>
                </div>
              </button>
            ))}
            {!tickets.length ? (
              <EmptyState message="No support tickets yet." />
            ) : null}
          </div>
          <div className="support-conversation-panel">
            {selectedTicket ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-bold text-slate-950">
                      {selectedTicket.subject}
                    </h3>
                    <p className="mt-1 text-xs font-semibold text-slate-500">
                      {selectedTicket.ticketNumber} /{" "}
                      {brandText(
                        selectedTicket.client?.name ??
                          client?.name ??
                          "Platform",
                      )}{" "}
                      / {toDate(selectedTicket.updatedAt)}
                    </p>
                  </div>
                  <StatusBadge status={selectedTicket.status} />
                </div>
                <div className="mt-4 space-y-3">
                  {selectedTicket.messages.map((message) => (
                    <div
                      className={cx(
                        "rounded-md border p-3 text-sm",
                        message.visibility === "INTERNAL"
                          ? "border-amber-200 bg-amber-50 text-amber-950"
                          : "border-slate-200 bg-white text-slate-700",
                      )}
                      key={message.id}
                    >
                      <div className="mb-1 text-xs font-bold uppercase text-slate-500">
                        {message.authorRole ?? "System"} / {message.visibility}{" "}
                        / {toDate(message.createdAt)}
                      </div>
                      <p className="whitespace-pre-wrap">{message.body}</p>
                    </div>
                  ))}
                </div>
                <form className="mt-4 grid gap-3" onSubmit={addMessage}>
                  <textarea
                    className="min-h-24 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-400"
                    placeholder="Add a reply"
                    value={messageBody}
                    onChange={(event) => setMessageBody(event.target.value)}
                  />
                  {role !== "client" ? (
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
                      <input
                        checked={internalNote}
                        onChange={(event) =>
                          setInternalNote(event.target.checked)
                        }
                        type="checkbox"
                      />
                      Internal note
                    </label>
                  ) : null}
                  <button
                    className="justify-self-start rounded-md bg-slate-900 px-4 py-2 text-sm font-bold text-white"
                    type="submit"
                  >
                    Add message
                  </button>
                </form>
              </>
            ) : (
              <EmptyState message="Select a ticket to view the conversation." />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function PatientsView({
  token,
  clientId,
  notice,
}: {
  token: string;
  clientId?: string;
  notice: (message: string) => void;
}) {
  const emptyForm = {
    patientIdentifier: "",
    name: "",
    dateOfBirth: "",
    age: "",
    gender: "",
    phone: "",
    clinicalHistory: "",
    medicalHistory: "",
  };
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<PatientProfile | null>(null);
  const [, setCreatingRecord] = useState(false);
  async function load(q = query) {
    const result = await api<{ items: PatientProfile[] }>(
      `/api/patients?q=${encodeURIComponent(q)}${clientId ? `&clientId=${encodeURIComponent(clientId)}` : ""}`,
      token,
    );
    setPatients(result.items);
  }
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [query, token, clientId]);
  async function create(event: FormEvent) {
    event.preventDefault();
    try {
      await api("/api/patients", token, {
        method: "POST",
        body: JSON.stringify({ ...form, clientId: clientId || undefined }),
      });
      setCreating(false);
      setForm(emptyForm);
      await load("");
      notice("Patient profile created.");
    } catch (error) {
      notice(
        error instanceof Error ? error.message : "Unable to create patient.",
      );
    }
  }
  async function open(patient: PatientProfile) {
    try {
      setSelected(
        await api<PatientProfile>(`/api/patients/${patient.id}`, token),
      );
    } catch (error) {
      notice(
        error instanceof Error ? error.message : "Unable to open patient.",
      );
    }
  }
  return (
    <div className="space-y-5">
      <section className="soft-card rounded-lg p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Patients</h2>
            <p className="mt-1 text-sm text-slate-500">
              Search patient profiles and open longitudinal study and report
              history.
            </p>
          </div>
          <button
            className="rounded-md bg-sky-700 px-4 py-2 text-sm font-bold text-white"
            onClick={() => setCreating(true)}
            type="button"
          >
            <Plus className="mr-1 inline" size={15} />
            Add patient
          </button>
        </div>
        <div className="mb-4">
          <TextInput
            label="Search by patient ID or name"
            value={query}
            onChange={setQuery}
          />
        </div>
        <div className="table-scroll">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                {[
                  "Patient",
                  "DOB / age",
                  "Sex / gender",
                  "Center",
                  "History",
                  "Action",
                ].map((x) => (
                  <th className="py-3 pr-4" key={x}>
                    {x}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {patients.map((p) => (
                <tr className="border-b border-slate-100" key={p.id}>
                  <td className="py-4 pr-4">
                    <strong className="block">{p.name}</strong>
                    <span className="text-xs text-slate-500">
                      {p.patientIdentifier}
                    </span>
                  </td>
                  <td className="py-4 pr-4">
                    {p.dateOfBirth ? toDate(p.dateOfBirth) : p.age || "-"}
                  </td>
                  <td className="py-4 pr-4">{p.sex || p.gender || "-"}</td>
                  <td className="py-4 pr-4">
                    {brandText(p.client?.name ?? "-")}
                  </td>
                  <td className="py-4 pr-4">
                    {p._count?.studies ?? 0} studies / {p._count?.reports ?? 0}{" "}
                    reports
                  </td>
                  <td>
                    <button
                      className="table-view-button"
                      onClick={() => void open(p)}
                      type="button"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {creating ? (
        <Modal title="Add patient" onClose={() => setCreating(false)}>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={create}>
            <TextInput
              label="Patient ID"
              value={form.patientIdentifier}
              onChange={(v) => setForm({ ...form, patientIdentifier: v })}
            />
            <TextInput
              label="Patient name"
              value={form.name}
              onChange={(v) => setForm({ ...form, name: v })}
            />
            <TextInput
              label="Date of birth"
              type="date"
              value={form.dateOfBirth}
              onChange={(v) => setForm({ ...form, dateOfBirth: v })}
            />
            <TextInput
              label="Age"
              value={form.age}
              onChange={(v) => setForm({ ...form, age: v })}
            />
            <TextInput
              label="Gender / sex"
              value={form.gender}
              onChange={(v) => setForm({ ...form, gender: v })}
            />
            <TextInput
              label="Contact"
              value={form.phone}
              onChange={(v) => setForm({ ...form, phone: v })}
            />
            <label className="md:col-span-2 text-sm font-semibold">
              Clinical history
              <textarea
                className="mt-1 min-h-24 w-full rounded-md border border-slate-200 p-3"
                value={form.clinicalHistory}
                onChange={(e) =>
                  setForm({ ...form, clinicalHistory: e.target.value })
                }
              />
            </label>
            <button
              className="rounded-md bg-sky-700 px-4 py-2 font-bold text-white"
              type="submit"
            >
              Create patient
            </button>
          </form>
        </Modal>
      ) : null}
      {selected ? (
        <Modal title="Patient details" onClose={() => setSelected(null)} wide>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
            <div>
              <button
                className="mb-2 text-sm font-bold text-sky-700"
                onClick={() => setSelected(null)}
                type="button"
              >
                ← Back to patients
              </button>
              <h2 className="text-2xl font-bold text-slate-950">
                {selected.name} · {selected.patientIdentifier}
              </h2>
              <p className="text-sm text-slate-500">
                Patient PACS profile and longitudinal study records
              </p>
            </div>
            {clientId ? (
              <button
                className="rounded-md bg-sky-700 px-4 py-2 text-sm font-bold text-white"
                onClick={() => setCreatingRecord(true)}
                type="button"
              >
                <Plus className="mr-1 inline" size={15} />
                New record
              </button>
            ) : null}
          </div>
          <div className="record-detail-grid">
            <DetailField
              label="Date of birth / age"
              value={
                selected.dateOfBirth
                  ? toDate(selected.dateOfBirth)
                  : selected.age || "-"
              }
            />
            <DetailField
              label="Gender / sex"
              value={selected.sex || selected.gender || "-"}
            />
            <DetailField
              label="Clinical history"
              value={selected.clinicalHistory || "-"}
            />
            <DetailField
              label="Medical history"
              value={selected.medicalHistory || "-"}
            />
          </div>
          <SimpleTable
            title="Chronological studies and reports"
            columns={["Date", "Modality / service", "Status", "Record"]}
            rows={[
              ...(selected.studies ?? []).map((s) => [
                toDate(s.createdAt),
                s.modality,
                s.status,
                `Study ${s.id}`,
              ]),
              ...(selected.reports ?? []).map((r) => [
                toDate(r.createdAt),
                r.serviceName,
                r.status,
                `Report ${r.id}`,
              ]),
            ].sort((a, b) => String(b[0]).localeCompare(String(a[0])))}
          />
        </Modal>
      ) : null}
    </div>
  );
}


function FeedbackDashboard({
  token,
  notice,
}: {
  token: string;
  notice: (message: string) => void;
}) {
  const [items, setItems] = useState<RadiologistFeedbackItem[]>([]);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  async function load() {
    setItems(
      await api<RadiologistFeedbackItem[]>(
        `/api/feedback?status=${status}&q=${encodeURIComponent(query)}`,
        token,
      ),
    );
  }
  useEffect(() => {
    const t = window.setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [token, status, query]);
  async function update(id: string, next: string) {
    await api(`/api/feedback/${id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ status: next }),
    });
    notice("Feedback status updated.");
    await load();
  }
  return (
    <section className="soft-card rounded-lg p-5">
      <div>
        <h2 className="text-lg font-semibold">Radiologist Feedback</h2>
        <p className="text-sm text-slate-500">
          Review feedback tied to the exact center, patient, study, report, and
          radiologist.
        </p>
      </div>
      <div className="my-4 grid gap-3 md:grid-cols-2">
        <TextInput
          label="Search report or comment"
          value={query}
          onChange={setQuery}
        />
        <label className="text-sm font-semibold">
          Status
          <select
            className="mt-1 w-full rounded-md border p-3"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All</option>
            {["NEW", "REVIEWED", "IN_PROGRESS", "RESOLVED", "CLOSED"].map(
              (x) => (
                <option key={x}>{x}</option>
              ),
            )}
          </select>
        </label>
      </div>
      <div className="table-scroll">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              {[
                "Center / patient",
                "Report",
                "Radiologist",
                "Type",
                "Comment",
                "Created",
                "Status",
              ].map((x) => (
                <th className="border-b py-3 pr-4" key={x}>
                  {x}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((x) => (
              <tr className="border-b align-top" key={x.id}>
                <td className="py-4 pr-4">
                  {brandText(x.client?.name ?? "-")}
                  <div>{x.patient?.name ?? "-"}</div>
                </td>
                <td>{x.reportId}</td>
                <td>{x.radiologist?.name ?? "-"}</td>
                <td>{x.feedbackType.replaceAll("_", " ")}</td>
                <td className="max-w-xs whitespace-pre-wrap">{x.comment}</td>
                <td>{toDate(x.createdAt)}</td>
                <td>
                  <select
                    className="rounded border p-2"
                    value={x.status}
                    onChange={(e) => void update(x.id, e.target.value)}
                  >
                    {[
                      "NEW",
                      "REVIEWED",
                      "IN_PROGRESS",
                      "RESOLVED",
                      "CLOSED",
                    ].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

void PatientsView;



function ProcessingJobViewerPane({ job, token }: { job: ProcessingJob; token: string }) { return <ExternalViewerPane endpoint={`/api/processing-jobs/${encodeURIComponent(job.id)}/viewer-session`} token={token} />; }



function ArchivedStudyViewerPane({ archive, token }: { archive: PatientStudyArchive; token: string }) { return <ExternalViewerPane endpoint={`/api/patient-study-archives/${encodeURIComponent(archive.id)}/viewer-session`} token={token} />; }

function ArchivedDocumentPreview({
  archive,
  file,
  token,
}: {
  archive: PatientStudyArchive;
  file: PatientArchiveFile;
  token: string;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let objectUrl = "";
    let cancelled = false;
    fetch(
      `/api/patient-study-archives/${archive.id}/files/${file.id}/preview`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("Document preview is unavailable.");
        return response.blob();
      })
      .then((blob) => {
        if (!cancelled) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      })
      .catch((reason) => {
        if (!cancelled)
          setError(
            reason instanceof Error
              ? reason.message
              : "Document preview is unavailable.",
          );
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [archive.id, file.id, token]);
  if (error) return <EmptyState message={error} />;
  if (!url)
    return (
      <p className="py-10 text-center text-sm font-semibold text-slate-500">
        Loading document...
      </p>
    );
  return (
    <iframe
      className="h-[calc(100dvh-9rem)] w-full border-0 bg-white"
      src={url}
      title={file.originalName}
    />
  );
}

function PatientPacsStudies({
  patient,
  token,
  onViewReport,
  onViewArchiveFile,
}: {
  patient: PatientProfile;
  token: string;
  onViewReport: (report: ReportReview) => void;
  onViewArchiveFile: (
    archive: PatientStudyArchive,
    file: PatientArchiveFile,
  ) => void;
}) {
  const [selectedRecordId, setSelectedRecordId] = useState("");
  const reports = patient.reports ?? [];
  function reportForJob(job: ProcessingJob) {
    return (
      reports.find(
        (report) =>
          (getReportProcessingJobId(report.aiReportJson) ??
            getReportProcessingJobId(report.editedReportJson)) === job.id,
      ) ??
      reports.find((report) =>
        Boolean(
          report.studyUid &&
          job.bridgeStudy?.studyInstanceUid &&
          report.studyUid === job.bridgeStudy.studyInstanceUid,
        ),
      )
    );
  }
  function clinicalIndication(job: ProcessingJob) {
    if (job.bridgeStudy?.clinicalIndication)
      return job.bridgeStudy.clinicalIndication;
    if (
      job.upstreamStatus &&
      typeof job.upstreamStatus === "object" &&
      !Array.isArray(job.upstreamStatus)
    ) {
      const value = (job.upstreamStatus as Record<string, unknown>)
        .clinicalIndication;
      if (typeof value === "string") return value;
    }
    return "-";
  }
  const archives = patient.archivedStudies ?? [];
  const jobs = (patient.processingJobs ?? []).filter(
    (job) =>
      job.status.toLowerCase() !== "failed" || Boolean(reportForJob(job)),
  );
  const [recordTab, setRecordTab] = useState<
    "REPORT" | "INDICATION" | "DETAILS" | "FILES"
  >("REPORT");
  useEffect(() => {
    if (!selectedRecordId) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [selectedRecordId]);
  const selectedArchive = archives.find(
    (archive) => archive.id === selectedRecordId,
  );
  const selectedJob = jobs.find((job) => job.id === selectedRecordId);
  if (selectedArchive || selectedJob) {
    const report = selectedJob ? reportForJob(selectedJob) : undefined;
    const bridge = selectedJob?.bridgeStudy;
    const studyFile = selectedArchive?.files.find(
      (file) => file.role === "STUDY",
    );
    const reportFile = selectedArchive?.files.find(
      (file) => file.role === "REPORT",
    );
    const indicationFile = selectedArchive?.files.find(
      (file) => file.role === "CLINICAL_INDICATION",
    );
    const indication =
      selectedArchive?.clinicalIndication ||
      (selectedJob ? clinicalIndication(selectedJob) : "-");
    const title =
      selectedArchive?.studyDescription ||
      bridge?.studyDescription ||
      selectedJob?.uploadName ||
      "Study record";
    return createPortal(
      <div className="fixed inset-0 z-[1400] flex h-dvh flex-col overflow-hidden bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700 bg-[#0b1117] px-4 py-3">
          <div>
            <button
              className="mb-1 text-sm font-bold text-sky-300"
              onClick={() => setSelectedRecordId("")}
              type="button"
            >
              Back to study list
            </button>
            <h3 className="text-lg font-bold text-slate-100">{title}</h3>
            <p className="text-xs text-slate-400">
              {selectedArchive?.studyInstanceUid ||
                bridge?.studyInstanceUid ||
                report?.studyUid ||
                selectedJob?.id}
            </p>
          </div>
          <StatusBadge
            status={
              selectedArchive
                ? "Archived"
                : (report?.status ?? selectedJob?.status ?? "-")
            }
          />
        </div>
        <div className="grid min-h-0 flex-1 lg:grid-cols-2">
          <section className="min-h-0 bg-slate-950">
            {report ? (
              <DicomReviewPane
                report={report}
                token={token}
                isLocked
                onInsertSlice={() => undefined}
              />
            ) : selectedJob ? (
              <ProcessingJobViewerPane job={selectedJob} token={token} />
            ) : selectedArchive && studyFile ? (
              <ArchivedStudyViewerPane archive={selectedArchive} token={token} />
            ) : (
              <div className="grid h-full place-items-center p-8 text-center text-slate-400">
                <div>
                  <Eye className="mx-auto mb-3" size={36} />
                  <p className="font-bold">
                    DICOM viewer is unavailable for this failed processing
                    record.
                  </p>
                  <p className="mt-2 text-sm">
                    No usable report or image set was produced.
                  </p>
                </div>
              </div>
            )}
          </section>
          <aside className="decxpert-context-panel border-l border-slate-700">
            <div className="grid grid-cols-2 border-b border-slate-700 xl:grid-cols-4">
              {(
                [
                  ["REPORT", "Report"],
                  ["INDICATION", "Clinical indication"],
                  ["DETAILS", "Details"],
                  ["FILES", "Files"],
                ] as const
              ).map(([key, label]) => (
                <button
                  className={cx(
                    "border-b-2 px-2 py-3 text-xs font-bold transition",
                    recordTab === key
                      ? "border-sky-400 bg-slate-800 text-sky-300"
                      : "border-transparent text-slate-400 hover:bg-slate-800 hover:text-slate-200",
                  )}
                  key={key}
                  onClick={() => setRecordTab(key)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="decxpert-context-body h-[calc(100dvh-7rem)] overflow-y-auto p-4">
              {recordTab === "REPORT" ? (
                report ? (
                  <ReportDocumentPreview report={report} token={token} />
                ) : reportFile && selectedArchive ? (
                  <ArchivedDocumentPreview
                    archive={selectedArchive}
                    file={reportFile}
                    token={token}
                  />
                ) : (
                  <EmptyState message="No report is available for this record." />
                )
              ) : null}
              {recordTab === "INDICATION" ? (
                indicationFile && selectedArchive ? (
                  <ArchivedDocumentPreview
                    archive={selectedArchive}
                    file={indicationFile}
                    token={token}
                  />
                ) : (
                  <p className="whitespace-pre-wrap rounded-md bg-slate-50 p-4 text-sm text-slate-700">
                    {indication || "-"}
                  </p>
                )
              ) : null}
              {recordTab === "DETAILS" ? (
                <div className="record-detail-grid">
                  <DetailField
                    label="Study date"
                    value={
                      selectedArchive?.studyDate
                        ? toDate(selectedArchive.studyDate)
                        : bridge?.studyDate
                          ? toDate(bridge.studyDate)
                          : selectedJob
                            ? toDate(selectedJob.createdAt)
                            : "-"
                    }
                  />
                  <DetailField
                    label="Modality"
                    value={
                      selectedArchive?.modality ||
                      bridge?.modalities?.join(", ") ||
                      report?.modality ||
                      "-"
                    }
                  />
                  <DetailField
                    label="Accession"
                    value={
                      selectedArchive?.accessionNumber ||
                      bridge?.accessionNumber ||
                      report?.accession ||
                      "-"
                    }
                  />
                  <DetailField
                    label="Series / images"
                    value={`${selectedArchive?.seriesCount ?? bridge?.seriesCount ?? "-"} / ${selectedArchive?.instanceCount ?? bridge?.instanceCount ?? selectedJob?.imageCount ?? "-"}`}
                  />
                  <DetailField
                    label="Institution"
                    value={
                      selectedArchive?.institutionName ||
                      bridge?.institutionName ||
                      patient.client?.name ||
                      "-"
                    }
                  />
                  <DetailField
                    label="Referring physician"
                    value={
                      selectedArchive?.referringPhysician ||
                      bridge?.referringPhysician ||
                      "-"
                    }
                  />
                </div>
              ) : null}
              {recordTab === "FILES" ? (
                <div className="space-y-2">
                  {selectedArchive?.files.map((file) => (
                    <button
                      className="flex w-full justify-between rounded-md border border-slate-200 p-3 text-left text-sm"
                      key={file.id}
                      onClick={() => onViewArchiveFile(selectedArchive, file)}
                      type="button"
                    >
                      <span>
                        {file.role}: {file.originalName}
                      </span>
                      <Eye size={15} />
                    </button>
                  ))}
                  {bridge?.attachments?.map((file) => (
                    <div
                      className="rounded-md border border-slate-200 p-3 text-sm"
                      key={file.id}
                    >
                      {file.originalName}
                    </div>
                  ))}
                  {!selectedArchive?.files.length &&
                  !bridge?.attachments?.length ? (
                    <EmptyState message="No files are attached." />
                  ) : null}
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      </div>,
      document.body,
    );
  }
  return (
    <section className="mt-5">
      <div className="mb-3">
        <h3 className="text-base font-bold text-slate-950">
          PACS study history
        </h3>
        <p className="text-sm text-slate-500">
          Study metadata, clinical indication, images, existing reports, and
          supporting files stay together in one patient record.
        </p>
      </div>
      <div className="table-scroll overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[1050px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              {[
                "Study date",
                "Study / description",
                "Modality",
                "Accession",
                "Clinical indication",
                "Report",
                "Status",
                "Actions",
              ].map((column) => (
                <th
                  className="border-b border-slate-200 px-3 py-3"
                  key={column}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {archives.map((archive) => {
              const reportFile = archive.files.find(
                (file) => file.role === "REPORT",
              );
              return (
                <tr
                  className="border-b border-slate-100 align-top"
                  key={archive.id}
                >
                  <td className="px-3 py-4">
                    {archive.studyDate
                      ? toDate(archive.studyDate)
                      : toDate(archive.createdAt)}
                  </td>
                  <td className="px-3 py-4">
                    <strong className="block text-slate-900">
                      {archive.studyDescription}
                    </strong>
                    <span className="text-xs text-slate-500">
                      {archive.studyInstanceUid || archive.id}
                    </span>
                  </td>
                  <td className="px-3 py-4">{archive.modality || "-"}</td>
                  <td className="px-3 py-4">
                    {archive.accessionNumber || "-"}
                  </td>
                  <td className="max-w-52 px-3 py-4">
                    <span className="line-clamp-2">
                      {archive.clinicalIndication || "-"}
                    </span>
                  </td>
                  <td className="px-3 py-4">{reportFile ? "Attached" : "-"}</td>
                  <td className="px-3 py-4">
                    <StatusBadge status="Archived" />
                  </td>
                  <td className="px-3 py-4">
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="table-view-button"
                        onClick={() =>
                          setSelectedRecordId(
                            selectedRecordId === archive.id ? "" : archive.id,
                          )
                        }
                        type="button"
                      >
                        View
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {jobs.map((job) => {
              const bridge = job.bridgeStudy;
              const report = reportForJob(job);
              return (
                <tr
                  className="border-b border-slate-100 align-top"
                  key={job.id}
                >
                  <td className="px-3 py-4">
                    {bridge?.studyDate
                      ? toDate(bridge.studyDate)
                      : toDate(job.createdAt)}
                  </td>
                  <td className="px-3 py-4">
                    <strong className="block text-slate-900">
                      {bridge?.studyDescription ?? job.uploadName}
                    </strong>
                    <span className="text-xs text-slate-500">
                      {bridge?.studyInstanceUid ?? report?.studyUid ?? job.id}
                    </span>
                  </td>
                  <td className="px-3 py-4">
                    {bridge?.modalities?.join(", ") ||
                      report?.modality ||
                      serviceTypeLabels[job.serviceType] ||
                      job.serviceType}
                  </td>
                  <td className="px-3 py-4">
                    {bridge?.accessionNumber ?? report?.accession ?? "-"}
                  </td>
                  <td className="max-w-52 px-3 py-4">
                    <span className="line-clamp-2">
                      {clinicalIndication(job)}
                    </span>
                  </td>
                  <td className="px-3 py-4">
                    {report ? report.status : "Pending"}
                  </td>
                  <td className="px-3 py-4">
                    <StatusBadge status={report?.status ?? job.status} />
                  </td>
                  <td className="px-3 py-4">
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="table-view-button"
                        onClick={() =>
                          setSelectedRecordId(
                            selectedRecordId === job.id ? "" : job.id,
                          )
                        }
                        type="button"
                      >
                        View
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="space-y-3">
        {archives
          .filter((archive) => archive.id === selectedRecordId)
          .map((archive) => (
            <details
              className="overflow-hidden rounded-lg border border-slate-200 bg-white"
              key={archive.id}
            >
              <summary className="grid cursor-pointer list-none gap-3 bg-slate-50 px-4 py-4 md:grid-cols-[1.4fr_1fr_1fr_auto] md:items-center">
                <div>
                  <strong className="block text-slate-950">
                    {archive.studyDescription}
                  </strong>
                  <span className="text-xs text-slate-500">
                    {archive.studyInstanceUid || archive.id}
                  </span>
                </div>
                <div className="text-sm text-slate-700">
                  <span className="block text-xs font-bold uppercase text-slate-400">
                    Study date
                  </span>
                  {archive.studyDate
                    ? toDate(archive.studyDate)
                    : toDate(archive.createdAt)}
                </div>
                <div className="text-sm text-slate-700">
                  <span className="block text-xs font-bold uppercase text-slate-400">
                    Modality
                  </span>
                  {archive.modality || "-"}
                </div>
                <StatusBadge status="Archived" />
              </summary>
              <div className="grid gap-4 border-t border-slate-200 p-4 lg:grid-cols-2">
                <div className="record-detail-grid">
                  <DetailField
                    label="Accession"
                    value={archive.accessionNumber || "-"}
                  />
                  <DetailField
                    label="Series / images"
                    value={`${archive.seriesCount ?? "-"} / ${archive.instanceCount ?? "-"}`}
                  />
                  <DetailField
                    label="Body region"
                    value={archive.bodyRegion || "-"}
                  />
                  <DetailField
                    label="Institution"
                    value={
                      archive.institutionName || patient.client?.name || "-"
                    }
                  />
                  <DetailField
                    label="Referring physician"
                    value={archive.referringPhysician || "-"}
                  />
                  <DetailField
                    label="Record type"
                    value="Historical study (no reporting workflow)"
                  />
                </div>
                <div>
                  <h4 className="text-xs font-bold uppercase text-slate-500">
                    Clinical indication
                  </h4>
                  <p className="mt-2 min-h-20 whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                    {archive.clinicalIndication || "-"}
                  </p>
                  <h4 className="mt-4 text-xs font-bold uppercase text-slate-500">
                    Study, report, and supporting files
                  </h4>
                  <div className="mt-2 space-y-2">
                    {archive.files.map((file) => (
                      <div
                        className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm"
                        key={file.id}
                      >
                        <div>
                          <span className="mr-2 rounded bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">
                            {file.role}
                          </span>
                          {file.originalName}
                          <span className="ml-2 text-xs text-slate-400">
                            ({Math.ceil(Number(file.sizeBytes) / 1024)} KB)
                          </span>
                        </div>
                        <button
                          className="shrink-0 font-bold text-sky-700"
                          onClick={() => onViewArchiveFile(archive, file)}
                          type="button"
                        >
                          <Eye className="mr-1 inline" size={14} />
                          View
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </details>
          ))}
        {jobs
          .filter((job) => job.id === selectedRecordId)
          .map((job) => {
            const bridge = job.bridgeStudy;
            const report = reportForJob(job);
            return (
              <details
                className="overflow-hidden rounded-lg border border-slate-200 bg-white"
                key={job.id}
              >
                <summary className="grid cursor-pointer list-none gap-3 bg-slate-50 px-4 py-4 md:grid-cols-[1.4fr_1fr_1fr_auto] md:items-center">
                  <div>
                    <strong className="block text-slate-950">
                      {bridge?.studyDescription ?? job.uploadName}
                    </strong>
                    <span className="text-xs text-slate-500">
                      {bridge?.studyInstanceUid ?? report?.studyUid ?? job.id}
                    </span>
                  </div>
                  <div className="text-sm text-slate-700">
                    <span className="block text-xs font-bold uppercase text-slate-400">
                      Study date
                    </span>
                    {bridge?.studyDate
                      ? toDate(bridge.studyDate)
                      : toDate(job.createdAt)}
                  </div>
                  <div className="text-sm text-slate-700">
                    <span className="block text-xs font-bold uppercase text-slate-400">
                      Modality / service
                    </span>
                    {bridge?.modalities?.join(", ") ||
                      report?.modality ||
                      serviceTypeLabels[job.serviceType] ||
                      job.serviceType}
                  </div>
                  <StatusBadge status={report?.status ?? job.status} />
                </summary>
                <div className="grid gap-4 border-t border-slate-200 p-4 lg:grid-cols-2">
                  <div className="record-detail-grid">
                    <DetailField
                      label="Accession"
                      value={
                        bridge?.accessionNumber ?? report?.accession ?? "-"
                      }
                    />
                    <DetailField
                      label="Series / images"
                      value={`${bridge?.seriesCount ?? "-"} / ${bridge?.instanceCount ?? job.imageCount ?? "-"}`}
                    />
                    <DetailField
                      label="Institution"
                      value={
                        bridge?.institutionName ?? patient.client?.name ?? "-"
                      }
                    />
                    <DetailField
                      label="Referring physician"
                      value={bridge?.referringPhysician ?? "-"}
                    />
                    <DetailField label="Processing job" value={job.id} />
                    <DetailField
                      label="Report"
                      value={report?.id ?? "Pending"}
                    />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold uppercase text-slate-500">
                      Clinical indication
                    </h4>
                    <p className="mt-2 min-h-20 whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                      {clinicalIndication(job)}
                    </p>
                    <h4 className="mt-4 text-xs font-bold uppercase text-slate-500">
                      Attached files
                    </h4>
                    <div className="mt-2 space-y-1 text-sm text-slate-700">
                      {(bridge?.attachments ?? []).map((file) => (
                        <p key={file.id}>
                          {file.originalName}{" "}
                          <span className="text-xs text-slate-400">
                            ({Math.ceil(Number(file.sizeBytes) / 1024)} KB)
                          </span>
                        </p>
                      ))}
                      {!bridge?.attachments?.length ? <p>-</p> : null}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-3">
                  <span className="text-xs font-semibold text-slate-500">
                    {report
                      ? `${report.serviceName} · ${report.radiologist?.fullName ?? "Radiologist pending"}`
                      : "Report will appear here after processing."}
                  </span>
                  {report ? (
                    <button
                      className="rounded-md bg-sky-700 px-3 py-2 text-xs font-bold text-white"
                      onClick={() => onViewReport(report)}
                      type="button"
                    >
                      <Eye className="mr-1 inline" size={14} />
                      Open study and report viewer
                    </button>
                  ) : null}
                </div>
              </details>
            );
          })}
        {!archives.length && !jobs.length ? (
          <EmptyState message="No studies are attached to this patient yet." />
        ) : null}
      </div>
    </section>
  );
}

function PatientArchiveFileModal({
  archive,
  file,
  token,
  onClose,
}: {
  archive: PatientStudyArchive;
  file: PatientArchiveFile;
  token: string;
  onClose: () => void;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const path = `/api/patient-study-archives/${encodeURIComponent(archive.id)}/files/${encodeURIComponent(file.id)}`;
  useEffect(() => {
    let objectUrl = "";
    void fetch(path, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to open this file.");
        objectUrl = URL.createObjectURL(await response.blob());
        setUrl(objectUrl);
      })
      .catch((reason) =>
        setError(
          reason instanceof Error
            ? reason.message
            : "Unable to open this file.",
        ),
      );
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, token]);
  const previewable = Boolean(
    file.mimeType?.startsWith("image/") ||
    file.mimeType === "application/pdf" ||
    file.mimeType?.startsWith("text/"),
  );
  return (
    <Modal
      title={`${archive.studyDescription} · ${file.originalName}`}
      onClose={onClose}
      wide
    >
      {error ? (
        <EmptyState message={error} />
      ) : !url ? (
        <p className="py-10 text-center text-sm text-slate-500">
          Loading file...
        </p>
      ) : previewable ? (
        <iframe
          className="h-[70vh] w-full rounded-md border border-slate-200 bg-slate-50"
          src={url}
          title={file.originalName}
        />
      ) : (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center">
          <p className="font-semibold text-slate-800">
            This study file type opens in a DICOM workstation or its native
            application.
          </p>
          <p className="mt-2 text-sm text-slate-500">
            Download {file.originalName} to open it locally.
          </p>
          <a
            className="mt-5 inline-block rounded-md bg-sky-700 px-4 py-2 font-bold text-white"
            download={file.originalName}
            href={url}
          >
            Download file
          </a>
        </div>
      )}
    </Modal>
  );
}

function PatientProfilesView({
  token,
  clientId,
  notice,
}: {
  token: string;
  clientId?: string;
  notice: (message: string) => void;
}) {
  const blank = {
    patientIdentifier: "",
    name: "",
    age: "",
    gender: "",
    phone: "",
    clinicalHistory: "",
  };
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState(blank);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<PatientProfile | null>(null);
  const [creatingRecord, setCreatingRecord] = useState(false);
  const [viewerReport, setViewerReport] = useState<ReportReview | null>(null);
  const [archiveViewer, setArchiveViewer] = useState<{
    archive: PatientStudyArchive;
    file: PatientArchiveFile;
  } | null>(null);
  const [studyFile, setStudyFile] = useState<File | null>(null);
  const [reportFile, setReportFile] = useState<File | null>(null);
  const [supportingFiles, setSupportingFiles] = useState<File[]>([]);
  const [archiveForm, setArchiveForm] = useState({
    studyDescription: "",
    modality: "",
    studyDate: "",
    accessionNumber: "",
    clinicalIndication: "",
    bodyRegion: "",
    studyInstanceUid: "",
  });
  const [uploading, setUploading] = useState(false);
  async function load(search = query) {
    const result = await api<{ items: PatientProfile[] }>(
      `/api/patients?q=${encodeURIComponent(search)}${clientId ? `&clientId=${encodeURIComponent(clientId)}` : ""}`,
      token,
    );
    setPatients(result.items);
  }
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [query, token, clientId]);
  async function createPatient(event: FormEvent) {
    event.preventDefault();
    try {
      await api("/api/patients", token, {
        method: "POST",
        body: JSON.stringify({ ...form, clientId }),
      });
      setForm(blank);
      setCreating(false);
      await load("");
      notice("Patient profile created.");
    } catch (error) {
      notice(
        error instanceof Error ? error.message : "Unable to create patient.",
      );
    }
  }
  async function openPatient(patient: PatientProfile) {
    try {
      setSelected(
        await api<PatientProfile>(`/api/patients/${patient.id}`, token),
      );
      setStudyFile(null);
      setReportFile(null);
      setSupportingFiles([]);
    } catch (error) {
      notice(
        error instanceof Error ? error.message : "Unable to open patient.",
      );
    }
  }
  async function uploadStudy(event: FormEvent) {
    event.preventDefault();
    if (!selected || !studyFile || !archiveForm.studyDescription.trim()) return;
    setUploading(true);
    try {
      const data = new FormData();
      Object.entries(archiveForm).forEach(([key, value]) =>
        data.append(key, value),
      );
      data.append("study", studyFile);
      if (reportFile) data.append("report", reportFile);
      supportingFiles.forEach((file) => data.append("attachments", file));
      const response = await fetch(
        `/api/patients/${encodeURIComponent(selected.id)}/archive-studies`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: data,
        },
      );
      const result = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(result?.message ?? "Unable to archive study");
      setStudyFile(null);
      setReportFile(null);
      setSupportingFiles([]);
      setArchiveForm({
        studyDescription: "",
        modality: "",
        studyDate: "",
        accessionNumber: "",
        clinicalIndication: "",
        bodyRegion: "",
        studyInstanceUid: "",
      });
      setSelected(
        await api<PatientProfile>(`/api/patients/${selected.id}`, token),
      );
      setCreatingRecord(false);
      await load();
      notice(
        "Historical study, report, indication, and files saved without starting reporting.",
      );
    } catch (error) {
      notice(
        error instanceof Error ? error.message : "Unable to archive study.",
      );
    } finally {
      setUploading(false);
    }
  }
  return (
    <div className="space-y-5">
      {!selected ? (
        <section className="soft-card rounded-lg p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Patients</h2>
              <p className="mt-1 text-sm text-slate-500">
                Patient history, attached studies, reports, and clinical viewer.
              </p>
            </div>
            <button
              className="rounded-md bg-sky-700 px-4 py-2 text-sm font-bold text-white"
              onClick={() => setCreating(true)}
              type="button"
            >
              <Plus className="mr-1 inline" size={15} />
              Add patient
            </button>
          </div>
          <TextInput
            label="Search by patient ID, name, or age"
            value={query}
            onChange={setQuery}
          />
          <div className="table-scroll mt-4">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-xs uppercase text-slate-500">
                  {[
                    "Patient",
                    "Age",
                    "Sex / gender",
                    "Center",
                    "History",
                    "Action",
                  ].map((label) => (
                    <th className="py-3 pr-4" key={label}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {patients.map((patient) => (
                  <tr className="border-b" key={patient.id}>
                    <td className="py-4 pr-4">
                      <strong className="block">{patient.name}</strong>
                      <span className="text-xs text-slate-500">
                        {patient.patientIdentifier}
                      </span>
                    </td>
                    <td>{patient.age || "-"}</td>
                    <td>{patient.sex || patient.gender || "-"}</td>
                    <td>{brandText(patient.client?.name ?? "-")}</td>
                    <td>
                      {(patient._count?.studies ?? 0) +
                        (patient._count?.archivedStudies ?? 0)}{" "}
                      studies / {patient._count?.reports ?? 0} reports
                    </td>
                    <td>
                      <button
                        className="table-view-button"
                        onClick={() => void openPatient(patient)}
                        type="button"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      {creating ? (
        <Modal title="Add patient" onClose={() => setCreating(false)}>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={createPatient}>
            <TextInput
              label="Patient ID"
              value={form.patientIdentifier}
              onChange={(value) =>
                setForm({ ...form, patientIdentifier: value })
              }
            />
            <TextInput
              label="Patient name"
              value={form.name}
              onChange={(value) => setForm({ ...form, name: value })}
            />
            <TextInput
              label="Age"
              value={form.age}
              onChange={(value) => setForm({ ...form, age: value })}
            />
            <TextInput
              label="Gender / sex"
              value={form.gender}
              onChange={(value) => setForm({ ...form, gender: value })}
            />
            <TextInput
              label="Contact"
              value={form.phone}
              onChange={(value) => setForm({ ...form, phone: value })}
            />
            <label className="md:col-span-2 text-sm font-semibold">
              Clinical history
              <textarea
                className="mt-1 min-h-24 w-full rounded-md border border-slate-200 p-3"
                value={form.clinicalHistory}
                onChange={(event) =>
                  setForm({ ...form, clinicalHistory: event.target.value })
                }
              />
            </label>
            <button
              className="rounded-md bg-sky-700 px-4 py-2 font-bold text-white"
              type="submit"
            >
              Create patient
            </button>
          </form>
        </Modal>
      ) : null}
      {selected ? (
        <section className="soft-card min-h-[calc(100vh-9rem)] rounded-lg p-5">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
            <div>
              <button
                className="mb-2 text-sm font-bold text-sky-700"
                onClick={() => setSelected(null)}
                type="button"
              >
                ← Back to patients
              </button>
              <h2 className="text-2xl font-bold text-slate-950">
                {selected.name} · {selected.patientIdentifier}
              </h2>
              <p className="text-sm text-slate-500">
                Patient PACS profile and longitudinal study records
              </p>
            </div>
            {clientId ? (
              <button
                className="rounded-md bg-sky-700 px-4 py-2 text-sm font-bold text-white"
                onClick={() => setCreatingRecord(true)}
                type="button"
              >
                <Plus className="mr-1 inline" size={15} />
                New record
              </button>
            ) : null}
          </div>
          <div className="record-detail-grid">
            <DetailField label="Age" value={selected.age || "-"} />
            <DetailField
              label="Gender / sex"
              value={selected.sex || selected.gender || "-"}
            />
            <DetailField
              label="Clinical history"
              value={selected.clinicalHistory || "-"}
            />
            <DetailField
              label="Medical history"
              value={selected.medicalHistory || "-"}
            />
          </div>
          {clientId && creatingRecord ? (
            <Modal
              title="New patient record"
              onClose={() => setCreatingRecord(false)}
              wide
            >
              <form
                className="rounded-lg border border-sky-100 bg-sky-50 p-4"
                onSubmit={uploadStudy}
              >
                <h3 className="font-bold text-slate-950">
                  Add historical PACS study
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  Store a prior study with its existing report, clinical
                  indication, and supporting files. This does not start
                  reporting or use reporting credits.
                </p>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <TextInput
                    label="Study description"
                    value={archiveForm.studyDescription}
                    onChange={(value) =>
                      setArchiveForm({
                        ...archiveForm,
                        studyDescription: value,
                      })
                    }
                  />
                  <TextInput
                    label="Modality"
                    value={archiveForm.modality}
                    onChange={(value) =>
                      setArchiveForm({ ...archiveForm, modality: value })
                    }
                  />
                  <TextInput
                    label="Study date"
                    type="date"
                    value={archiveForm.studyDate}
                    onChange={(value) =>
                      setArchiveForm({ ...archiveForm, studyDate: value })
                    }
                  />
                  <TextInput
                    label="Accession number"
                    value={archiveForm.accessionNumber}
                    onChange={(value) =>
                      setArchiveForm({ ...archiveForm, accessionNumber: value })
                    }
                  />
                  <TextInput
                    label="Body region"
                    value={archiveForm.bodyRegion}
                    onChange={(value) =>
                      setArchiveForm({ ...archiveForm, bodyRegion: value })
                    }
                  />
                  <TextInput
                    label="Study instance UID"
                    value={archiveForm.studyInstanceUid}
                    onChange={(value) =>
                      setArchiveForm({
                        ...archiveForm,
                        studyInstanceUid: value,
                      })
                    }
                  />
                  <label className="md:col-span-2 text-sm font-semibold">
                    Clinical indication
                    <textarea
                      className="mt-1 min-h-20 w-full rounded-md border border-slate-200 bg-white p-3"
                      value={archiveForm.clinicalIndication}
                      onChange={(event) =>
                        setArchiveForm({
                          ...archiveForm,
                          clinicalIndication: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="text-sm font-semibold">
                    Study file (DICOM, ZIP, image)
                    <input
                      className="mt-1 block w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-normal"
                      required
                      type="file"
                      onChange={(event) =>
                        setStudyFile(event.target.files?.[0] ?? null)
                      }
                    />
                  </label>
                  <label className="text-sm font-semibold">
                    Existing report (optional)
                    <input
                      className="mt-1 block w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-normal"
                      type="file"
                      accept=".pdf,.doc,.docx,image/*"
                      onChange={(event) =>
                        setReportFile(event.target.files?.[0] ?? null)
                      }
                    />
                  </label>
                  <label className="md:col-span-2 text-sm font-semibold">
                    Supporting files (optional)
                    <input
                      className="mt-1 block w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-normal"
                      multiple
                      type="file"
                      onChange={(event) =>
                        setSupportingFiles(Array.from(event.target.files ?? []))
                      }
                    />
                  </label>
                  <button
                    className="justify-self-start rounded-md bg-sky-700 px-4 py-2 font-bold text-white disabled:opacity-50"
                    disabled={
                      uploading ||
                      !studyFile ||
                      !archiveForm.studyDescription.trim()
                    }
                    type="submit"
                  >
                    {uploading ? "Saving..." : "Save to patient history"}
                  </button>
                </div>
              </form>
            </Modal>
          ) : null}
          <PatientPacsStudies
            patient={selected}
            token={token}
            onViewReport={setViewerReport}
            onViewArchiveFile={(archive, file) =>
              setArchiveViewer({ archive, file })
            }
          />
        </section>
      ) : null}
      {viewerReport ? (
        <MarengoDicomViewerModal
          report={viewerReport}
          token={token}
          onClose={() => setViewerReport(null)}
        />
      ) : null}
      {archiveViewer ? (
        <PatientArchiveFileModal
          archive={archiveViewer.archive}
          file={archiveViewer.file}
          token={token}
          onClose={() => setArchiveViewer(null)}
        />
      ) : null}
    </div>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */


function NotificationCenterView({ token, category = "" }: { token: string; category?: string }) {
  const [items, setItems] = useState<PortalNotification[]>([]);
  const [filter, setFilter] = useState(category ? "CATEGORY" : "ALL");
  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (filter === "UNREAD") params.set("unread", "true");
    if (filter === "CATEGORY" && category) params.set("category", category);
    setItems(await api<PortalNotification[]>(`/api/notifications?${params}`, token));
  }, [category, filter, token]);
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 15000); return () => window.clearInterval(timer); }, [load]);
  async function read(item: PortalNotification) { if (item.readAt) return; await api(`/api/notifications/${item.id}/read`, token, { method: "PATCH" }); await load(); }
  async function readAll() { await api('/api/notifications/read-all', token, { method: 'PATCH' }); await load(); }
  return <section className="soft-card rounded-lg p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-950">Notification center</h2><p className="mt-1 text-sm text-slate-500">Persistent operational events and delivery history.</p></div><button className="rounded-md border border-slate-200 px-3 py-2 text-sm font-bold" onClick={() => void readAll()} type="button">Mark all read</button></div>
    <div className="mt-4 flex flex-wrap gap-2">{["ALL", "UNREAD", ...(category ? ["CATEGORY"] : [])].map((value) => <button className={cx("rounded-full px-3 py-1.5 text-xs font-bold", filter === value ? "bg-sky-700 text-white" : "bg-slate-100 text-slate-600")} key={value} onClick={() => setFilter(value)} type="button">{value === "CATEGORY" ? category.replaceAll('_', ' ') : value}</button>)}</div>
    <div className="mt-4 grid gap-3">{items.map((item) => <button className={cx("rounded-lg border p-4 text-left", item.readAt ? "border-slate-200 bg-white" : "border-sky-200 bg-sky-50")} key={item.id} onClick={() => void read(item)} type="button"><div className="flex justify-between gap-3"><strong className="text-sm text-slate-950">{item.event.title}</strong><StatusBadge status={item.event.status} /></div><p className="mt-2 text-sm text-slate-600">{item.event.message}</p><span className="mt-2 block text-xs font-semibold text-slate-400">{toDate(item.event.occurredAt)}</span></button>)}{!items.length ? <EmptyState message="No notifications match this filter." /> : null}</div>
  </section>;
}

function CallRequestsView({ token, notice, reports }: { token: string; notice: (message: string) => void; reports?: ReportReview[] }) {
  const [items, setItems] = useState<ReportCallBooking[]>([]);
  const [form, setForm] = useState({ reportId: reports?.[0]?.id ?? "", reason: "", preferredAt: "", message: "", urgency: "ROUTINE" });
  const load = useCallback(async () => setItems(await api<ReportCallBooking[]>("/api/operations/call-requests", token)), [token]);
  useEffect(() => { void load(); }, [load]);
  async function create(event: FormEvent) {
    event.preventDefault();
    try {
      await api("/api/operations/call-requests", token, { method: "POST", body: JSON.stringify({ ...form, preferredAt: new Date(form.preferredAt).toISOString() }) });
      setForm({ ...form, reason: "", message: "", preferredAt: "" }); notice("Call request created and notifications queued."); await load();
    } catch (error) { notice(error instanceof Error ? error.message : "Unable to request call."); }
  }
  async function transition(id: string, action: "confirm" | "cancel") {
    try { await api(`/api/operations/call-requests/${id}/${action}`, token, { method: "POST", body: action === "cancel" ? JSON.stringify({ reason: "Cancelled from portal" }) : undefined }); notice(`Call request ${action}ed.`); await load(); }
    catch (error) { notice(error instanceof Error ? error.message : `Unable to ${action} call.`); }
  }
  return <div className="space-y-5">{reports ? <form className="soft-card rounded-lg p-5" onSubmit={create}><h2 className="text-lg font-semibold">Request a call</h2><p className="mt-1 text-sm text-slate-500">Renewist and Dectrocel are notified immediately.</p><div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3"><label className="grid gap-1 text-sm font-semibold">AI report<select className="rounded-md border px-3 py-2" required value={form.reportId} onChange={(e) => setForm({ ...form, reportId: e.target.value })}><option value="">Select report</option>{reports.map((report) => <option key={report.id} value={report.id}>{report.patientId ?? report.id} - {report.serviceName}</option>)}</select></label><TextInput label="Preferred date/time" type="datetime-local" required value={form.preferredAt} onChange={(value) => setForm({ ...form, preferredAt: value })} /><label className="grid gap-1 text-sm font-semibold">Urgency<select className="rounded-md border px-3 py-2" value={form.urgency} onChange={(e) => setForm({ ...form, urgency: e.target.value })}><option>ROUTINE</option><option>PRIORITY</option><option>URGENT</option></select></label><TextInput label="Reason" required value={form.reason} onChange={(value) => setForm({ ...form, reason: value })} /><TextInput label="Optional message" value={form.message} onChange={(value) => setForm({ ...form, message: value })} /><button className="self-end rounded-md bg-sky-700 px-4 py-2 font-bold text-white">Request call</button></div></form> : null}<section className="soft-card rounded-lg p-5"><h2 className="text-lg font-semibold">Call requests</h2><div className="table-scroll mt-4"><table className="w-full text-left text-sm"><thead><tr className="border-b text-xs uppercase text-slate-500"><th className="py-3">Study / patient</th><th>Reason</th><th>Preferred time</th><th>Urgency</th><th>Status</th><th>Actions</th></tr></thead><tbody>{items.map((item) => <tr className="border-b" key={item.id}><td className="py-3 pr-3 font-semibold">{item.report?.patientId ?? item.reportId}</td><td className="pr-3">{item.reason ?? "-"}</td><td className="pr-3">{toDate(item.slotStart)}</td><td className="pr-3">{item.urgency ?? "ROUTINE"}</td><td className="pr-3"><StatusBadge status={item.status} /></td><td><div className="flex gap-2">{reports && ["REQUESTED","RESCHEDULED"].includes(item.status) ? <button className="rounded border border-emerald-200 px-2 py-1 font-bold text-emerald-700" onClick={() => void transition(item.id,"confirm")} type="button">Confirm</button> : null}{!["CANCELLED","COMPLETED"].includes(item.status) ? <button className="rounded border border-rose-200 px-2 py-1 font-bold text-rose-700" onClick={() => void transition(item.id,"cancel")} type="button">Cancel</button> : null}</div></td></tr>)}</tbody></table></div>{!items.length ? <EmptyState message="No call requests found." /> : null}</section></div>;
}

function OperationsRecordsView({ token, kind, notice }: { token: string; kind: "queries" | "demo-requests" | "call-requests"; notice: (message: string) => void }) {
  const [items, setItems] = useState<Array<Record<string, any>>>([]);
  const [query, setQuery] = useState("");
  const load = useCallback(async () => setItems(await api<Array<Record<string, any>>>(`/api/operations/${kind}`, token)), [kind, token]);
  useEffect(() => { void load(); }, [load]);
  const shown = items.filter((item) => JSON.stringify(item).toLowerCase().includes(query.toLowerCase()));
  async function updateStatus(item: Record<string, any>, status: string) { try { await api(`/api/operations/${kind}/${item.id}${kind === 'queries' ? '/status' : ''}`, token, { method: 'PATCH', body: JSON.stringify({ status }) }); notice('Status updated.'); await load(); } catch (error) { notice(error instanceof Error ? error.message : 'Unable to update status.'); } }
  const title = kind === 'queries' ? 'Queries' : kind === 'demo-requests' ? 'Demo requests' : 'Radiologist call requests';
  return <section className="soft-card rounded-lg p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-950">{title}</h2><p className="mt-1 text-sm text-slate-500">Role-scoped records with persistent status and audit history.</p></div><input className="rounded-md border border-slate-200 px-3 py-2 text-sm" onChange={(event) => setQuery(event.target.value)} placeholder="Search records" value={query} /></div><div className="table-scroll mt-4"><table className="w-full text-left text-sm"><thead><tr className="border-b text-xs uppercase text-slate-500"><th className="py-3">Reference</th><th>Details</th><th>Organisation</th><th>Status</th><th>Created</th><th>Action</th></tr></thead><tbody>{shown.map((item) => <tr className="border-b align-top" key={item.id}><td className="py-3 pr-3 font-bold">{item.ticketNumber ?? item.requestNumber ?? item.id}</td><td className="max-w-md pr-3">{item.subject ?? item.purpose ?? item.reason ?? item.report?.serviceName ?? '-'}</td><td className="pr-3">{item.organization ?? item.client?.name ?? '-'}</td><td><StatusBadge status={item.status} /></td><td>{toDate(item.createdAt)}</td><td>{kind === 'demo-requests' ? <select className="rounded border px-2 py-1" value={item.status} onChange={(event) => void updateStatus(item, event.target.value)}>{['NEW','CONTACTED','SCHEDULED','COMPLETED','CANCELLED'].map((s) => <option key={s}>{s}</option>)}</select> : kind === 'queries' ? <select className="rounded border px-2 py-1" value={item.status} onChange={(event) => void updateStatus(item, event.target.value)}>{['NEW','ACKNOWLEDGED','IN_PROGRESS','RESOLVED','CLOSED'].map((s) => <option key={s}>{s}</option>)}</select> : '-'}</td></tr>)}</tbody></table></div>{!shown.length ? <EmptyState message={`No ${title.toLowerCase()} found.`} /> : null}</section>;
}

function ManagementAnalyticsView({ token, section }: { token: string; section: "usage" | "reporting" | "billing" | "centers" }) {
  const now = new Date(); const [start, setStart] = useState(`${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}-01`); const [end, setEnd] = useState(now.toISOString().slice(0,10)); const [data, setData] = useState<any>(null);
  const load = useCallback(async () => setData(await api(`/api/management/${section}?start=${start}&end=${end}T23:59:59.999Z`, token)), [end, section, start, token]);
  useEffect(() => { void load(); }, [load]);
  async function downloadMisExcel() {
    const query = new URLSearchParams({ start, end });
    const response = await fetch(`/api/analytics/mis.xlsx?${query.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? "Unable to download MIS Excel.");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `marengo-mis-${start}-to-${end}.xls`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
  const cards = section === 'usage' && data ? [['Total studies',data.totalStudies],['Completed',data.completed],['Failed',data.failed],['Completion rate',`${data.completionRate}%`],['Average processing',data.averageProcessingMinutes == null ? '-' : `${data.averageProcessingMinutes} min`]] : section === 'reporting' && data ? [['Reports generated',data.generated],['Completed',data.completed],['Reviewed',data.reviewed],['Pending',data.pending],['Average TAT',data.averageReportingTatMinutes == null ? '-' : `${data.averageReportingTatMinutes} min`]] : section === 'billing' && data ? [['Transactions',data.transactionCount],['Units',data.units],['Overall billing',moneyMinor(data.amountMinor,data.currency)]] : [];
  return <div className="space-y-5"><section className="soft-card rounded-lg p-5"><div className="flex flex-wrap items-end gap-3"><TextInput label="Start date" type="date" value={start} onChange={setStart} /><TextInput label="End date" type="date" value={end} onChange={setEnd} /><button className="rounded-md bg-sky-700 px-4 py-2 text-sm font-bold text-white" onClick={() => void load()} type="button">Apply</button><button className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-700" onClick={() => void downloadMisExcel().catch((error) => alert(error instanceof Error ? error.message : "Unable to download MIS Excel."))} type="button"><Download className="mr-1 inline" size={15} /> MIS Excel</button></div></section>{section === 'centers' ? <section className="grid gap-4 md:grid-cols-2">{Array.isArray(data) ? data.map((row:any) => <div className="soft-card rounded-lg p-5" key={row.client.id}><h3 className="font-bold">{brandText(row.client.name)}</h3><p className="mt-3 text-sm">Studies: {row.usage.totalStudies} · Reports: {row.reporting.generated}</p><p className="mt-1 text-sm">Billing: {moneyMinor(row.billing.amountMinor,row.billing.currency)}</p></div>) : null}</section> : <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label,value]) => <div className="soft-card rounded-lg p-5" key={String(label)}><p className="text-xs font-bold uppercase text-slate-500">{label}</p><p className="mt-2 text-2xl font-extrabold text-slate-950">{value}</p></div>)}</section>}</div>;
}

function RadiologistFeedbackByPatientView({ token, notice }: { token: string; notice: (message: string) => void }) {
  const [patientId, setPatientId] = useState(""); const [reports, setReports] = useState<ReportReview[]>([]); const [selected, setSelected] = useState(""); const [feedbackType, setFeedbackType] = useState("GENERAL"); const [rating, setRating] = useState("5"); const [comment, setComment] = useState("");
  async function search(event: FormEvent) { event.preventDefault(); try { setReports(await api<ReportReview[]>(`/api/operations/radiologist/patient-reports?patientId=${encodeURIComponent(patientId)}`, token)); } catch (error) { notice(error instanceof Error ? error.message : 'Search failed.'); } }
  async function submit(event: FormEvent) { event.preventDefault(); if (!selected) return notice('Select an AI report first.'); try { await api(`/api/radiologist/reports/${selected}/feedback`, token, { method: 'POST', body: JSON.stringify({ feedbackType, overallRating: Number(rating), comment }) }); setComment(''); notice('AI report feedback submitted.'); } catch (error) { notice(error instanceof Error ? error.message : 'Feedback submission failed.'); } }
  return <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]"><form className="soft-card rounded-lg p-5" onSubmit={search}><h2 className="text-lg font-semibold">Find AI reports by Patient ID</h2><div className="mt-4 flex gap-2"><input className="min-w-0 flex-1 rounded-md border px-3 py-2" onChange={(e) => setPatientId(e.target.value)} required value={patientId} /><button className="rounded-md bg-sky-700 px-4 py-2 font-bold text-white">Search</button></div><div className="mt-4 grid gap-2">{reports.map((report) => <button className={cx('rounded-md border p-3 text-left',selected===report.id?'border-sky-500 bg-sky-50':'border-slate-200')} key={report.id} onClick={() => setSelected(report.id)} type="button"><strong>{report.serviceName}</strong><span className="block text-xs text-slate-500">{report.id} · {toDate(report.generatedAt)}</span></button>)}</div></form><form className="soft-card rounded-lg p-5" onSubmit={submit}><h2 className="text-lg font-semibold">Structured feedback</h2><div className="mt-4 grid gap-4"><label className="grid gap-1 text-sm font-semibold">Feedback category<select className="rounded-md border px-3 py-2" value={feedbackType} onChange={(e) => setFeedbackType(e.target.value)}>{['GENERAL','INCORRECT_FINDING','MISSING_FINDING','INCORRECT_SEVERITY_URGENCY','INCORRECT_TERMINOLOGY','FORMATTING_REPORTING_ISSUE','OTHER'].map((value)=><option key={value}>{value}</option>)}</select></label><label className="grid gap-1 text-sm font-semibold">Overall rating<select className="rounded-md border px-3 py-2" value={rating} onChange={(e)=>setRating(e.target.value)}>{['5','4','3','2','1'].map((value)=><option key={value}>{value}</option>)}</select></label><label className="grid gap-1 text-sm font-semibold">Comments<textarea className="min-h-36 rounded-md border px-3 py-2" required value={comment} onChange={(e)=>setComment(e.target.value)} /></label><button className="rounded-md bg-sky-700 px-4 py-2 font-bold text-white">Submit feedback</button></div></form></div>;
}

function ManagementBotView({ token }: { token: string }) {
  const [question,setQuestion]=useState(''); const [answer,setAnswer]=useState('Ask about study usage, reporting statistics, billing, or center comparisons.'); const [loading,setLoading]=useState(false);
  async function ask(event:FormEvent){event.preventDefault();setLoading(true);try{const q=question.toLowerCase();const section=q.includes('bill')?'billing':q.includes('report')?'reporting':q.includes('center')?'centers':'usage';const modality=q.includes('ct')?'&modality=CT':'';const data:any=await api(`/api/management/${section}?${modality}`,token);if(section==='billing')setAnswer(`For the current month: ${data.transactionCount} billing transactions, ${data.units} units, overall billing ${moneyMinor(data.amountMinor,data.currency)}.`);else if(section==='reporting')setAnswer(`For the current month: ${data.generated} reports generated, ${data.completed} completed, ${data.pending} pending. Average reporting TAT: ${data.averageReportingTatMinutes ?? 'not available'} minutes.`);else if(section==='centers')setAnswer(data.map((row:any)=>`${brandText(row.client.name)}: ${row.usage.totalStudies} studies, ${row.reporting.generated} reports, ${moneyMinor(row.billing.amountMinor,row.billing.currency)}`).join('\n')||'No center data is available for this period.');else setAnswer(`For the current month${q.includes('ct')?' (CT)':''}: ${data.totalStudies} studies processed, ${data.completed} completed, ${data.failed} failed. Completion rate: ${data.completionRate}%.`);}catch(error){setAnswer(error instanceof Error?error.message:'Statistics are unavailable.');}finally{setLoading(false)}}
  return <section className="soft-card rounded-lg p-5"><h2 className="text-lg font-semibold">Management bot</h2><p className="mt-1 text-sm text-slate-500">Answers use authorized portal statistics only; no figures are estimated.</p><div className="mt-5 whitespace-pre-wrap rounded-lg bg-slate-950 p-5 text-sm leading-6 text-slate-100">{answer}</div><form className="mt-4 flex gap-2" onSubmit={ask}><input className="min-w-0 flex-1 rounded-md border px-3 py-2" onChange={(e)=>setQuestion(e.target.value)} placeholder="How many CTs were processed this month?" required value={question}/><button className="rounded-md bg-sky-700 px-4 py-2 font-bold text-white" disabled={loading}>{loading?'Checking…':'Ask'}</button></form></section>;
}

/* eslint-enable @typescript-eslint/no-explicit-any */
function AdminContent({
  active,
  overview,
  token,
  reload,
  notice,
  onNavigate,
}: {
  active: string;
  overview: AdminOverview;
  token: string;
  reload: () => Promise<void>;
  notice: (message: string) => void;
  onNavigate: (section: string) => void;
}) {
  if (active === "Processing Notifications") return <NotificationCenterView token={token} category="STUDY_STATUS" />;
  if (active === "Notification History") return <NotificationCenterView token={token} />;
  if (active === "Queries") return <OperationsRecordsView token={token} kind="queries" notice={notice} />;
  if (active === "Demo Requests") return <OperationsRecordsView token={token} kind="demo-requests" notice={notice} />;
  if (active === "Call Requests") return <CallRequestsView token={token} notice={notice} />;
  if (active === "AI Report Feedback") return <FeedbackDashboard token={token} notice={notice} />;
  if (active === "Patients")
    return <PatientProfilesView token={token} notice={notice} />;
  if (active === "Follow-ups")
    return <FollowUpsView token={token} notice={notice} />;
  if (active === "Radiologist Feedback")
    return <FeedbackDashboard token={token} notice={notice} />;
  if (active === "Centers")
    return (
      <ClientsView
        token={token}
        overview={overview}
        reload={reload}
        notice={notice}
      />
    );
  if (active === "Services")
    return <ServicesView services={overview.services} />;
  if (active === "Analytics") return <AnalyticsView overview={overview} />;
  if (active === "Plans") return <PlansView services={overview.services} />;
  if (active === "Renewist")
    return <RenewistAdminView token={token} notice={notice} />;
  if (active === "Billing")
    return (
      <BillingView
        billing={overview.billing}
        scope="admin"
        token={token}
        reload={reload}
        notice={notice}
      />
    );
  if (active === "Subscriptions")
    return <SubscriptionsView clients={overview.clients} />;
  if (active === "Credits") return <CreditsView clients={overview.clients} />;
  if (active === "Jobs") return <JobsView jobs={overview.jobs} />;
  if (active === "Studies")
    return (
      <AdminProcessingView
        jobs={overview.processingJobs ?? []}
        bridgeStudies={overview.availableBridgeStudies ?? []} reload={reload}
        token={token}
        notice={notice}
        mode="studies"
      />
    );
  if (active === "Processing")
    return (
      <AdminProcessingView
        jobs={overview.processingJobs ?? []}
        bridgeStudies={overview.availableBridgeStudies ?? []} reload={reload}
        token={token}
        notice={notice}
        mode="processing"
      />
    );
  if (active === "Radiologists")
    return (
      <AdminRadiologistsView
        token={token}
        overview={overview}
        reload={reload}
        notice={notice}
      />
    );
  if (active === "Group Admins")
    return <AdminGroupAdminsView token={token} notice={notice} />;
  if (active === "Bridge Studies")
    return (
      <AdminProcessingView
        jobs={overview.processingJobs ?? []}
        bridgeStudies={overview.availableBridgeStudies ?? []} reload={reload}
        token={token}
        notice={notice}
        mode="studies"
      />
    );
  if (active === "Reports")
    return (
      <AdminReportsView
        reports={overview.reportReviews}
        token={token}
        notice={notice}
        reload={reload}
      />
    );
  if (active === "Usage") return <UsageView logs={overview.usageLogs} />;
  if (active === "Support")
    return (
      <SupportCenterView
        token={token}
        role="admin"
        clients={overview.clients}
        notice={notice}
      />
    );
  if (active === "WhatsApp Bot" || active === "WhatsApp Whitelist" || active === "WhatsApp Configuration")
    return <WhatsAppBotView token={token} notice={notice} physicianConfiguration centers={overview.clients} />;
  if (active === "Alerts") return <AlertsView overview={overview} />;
  if (active === "Audit Logs") {
    return (
      <AuditLogsView
        title="Portal audit logs"
        logs={overview.auditLogs ?? []}
      />
    );
  }
  return <AdminDashboard overview={overview} onNavigate={onNavigate} />;
}

function AdminProcessingView({
  jobs,
  bridgeStudies,
  token,
  notice,
  reload,
  mode = "both",
}: {
  jobs: ProcessingJob[];
  bridgeStudies: BridgeStudy[];
  token: string;
  notice: (message: string) => void;
  reload: () => Promise<void>;
  mode?: "studies" | "processing" | "both";
}) {
  const [selectedStudy, setSelectedStudy] = useState<BridgeStudy | null>(null);
  const [selectedJob, setSelectedJob] = useState<ProcessingJob | null>(null);

  async function downloadBridgeBundle(study: BridgeStudy) {
    try {
      await downloadProtectedFile(
        `/api/admin/bridge-studies/${study.id}/download`,
        token,
      );
    } catch (err) {
      notice(
        err instanceof Error
          ? err.message
          : "Unable to download bridge study bundle",
      );
    }
  }

  return (
    <div className="space-y-5">
      {mode !== "processing" ? (
        <section className="soft-card worklist-card rounded-lg p-5">
          <div className="worklist-panel-heading mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">
                Bridge available studies
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Uploaded bridge studies, clinical indication, supporting files,
                and processing handoff.
              </p>
            </div>
            <StatusBadge
              status={
                bridgeStudies.some(
                  (study) => study.availabilityStatus === "Receiving",
                )
                  ? "RECEIVING"
                  : "ACTIVE"
              }
            />
          </div>
          <div className="table-scroll">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  {[
                    "Center",
                    "Patient",
                    "Study",
                    "Status",
                    "Updated",
                    "Action",
                  ].map((column) => (
                    <th className="py-3 pr-4" key={column}>
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bridgeStudies.map((study) => (
                  <tr
                    className="border-b border-slate-100 align-top"
                    key={study.id}
                  >
                    <td className="py-4 pr-4 text-slate-700">
                      {study.client
                        ? `${brandText(study.client.name)} (${study.client.code})`
                        : "-"}
                    </td>
                    <td className="py-4 pr-4 text-slate-700">
                      {study.patientName ?? "-"}
                      <div className="text-xs text-slate-500">
                        {study.patientId ?? "-"}
                      </div>
                    </td>
                    <td className="py-4 pr-4 text-slate-700">
                      {study.studyDescription ??
                        study.archiveName ??
                        study.studyInstanceUid}
                    </td>
                    <td className="py-4 pr-4">
                      <StatusBadge
                        status={study.status ?? study.availabilityStatus}
                      />
                    </td>
                    <td className="py-4 pr-4 text-slate-700">
                      {toDate(study.lastSyncedAt)}
                    </td>
                    <td className="py-4 pr-4">
                      <button
                        className="table-view-button"
                        onClick={() => setSelectedStudy(study)}
                        type="button"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
                {!bridgeStudies.length && (
                  <tr>
                    <td
                      className="py-6 text-sm font-semibold text-slate-500"
                      colSpan={6}
                    >
                      No bridge studies have been uploaded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      {mode !== "studies" ? (
        <section className="soft-card rounded-lg p-5">
          <div className="worklist-panel-heading mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">
                All client processing jobs
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Monitor study receipt, active processing, upstream endpoint
                decisions, and final delivery state.
              </p>
            </div>
            <StatusBadge
              status={
                jobs.some((job) =>
                  ["queued", "processing"].includes(job.status),
                )
                  ? "PROCESSING"
                  : "ACTIVE"
              }
            />
          </div>
          <div className="table-scroll no-x-scroll">
            <table className="report-table admin-report-table w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  {[
                    "Center",
                    "Study / upload",
                    "Exam",
                    "Status",
                    "Updated",
                    "Action",
                  ].map((column) => (
                    <th className="py-3 pr-4" key={column}>
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr
                    className="border-b border-slate-100 align-top"
                    key={job.id}
                  >
                    <td className="py-4 pr-4 text-slate-700">
                      {job.client
                        ? `${brandText(job.client.name)} (${job.client.code})`
                        : (job.clientId ?? "-")}
                    </td>
                    <td className="py-4 pr-4 text-slate-700">
                      {job.uploadName}
                    </td>
                    <td className="py-4 pr-4 text-slate-700">
                      {processingJobExamLabel(job)}
                    </td>
                    <td className="py-4 pr-4">
                      <StatusBadge status={job.status} />
                    </td>
                    <td className="py-4 pr-4 text-slate-700">
                      {toDate(job.updatedAt)}
                    </td>
                    <td className="py-4 pr-4">
                      <button
                        className="table-view-button"
                        onClick={() => setSelectedJob(job)}
                        type="button"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
                {!jobs.length && (
                  <tr>
                    <td
                      className="py-6 text-sm font-semibold text-slate-500"
                      colSpan={6}
                    >
                      No processing jobs found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      {selectedStudy ? (
        <Modal
          title="Bridge study details"
          onClose={() => setSelectedStudy(null)}
          wide
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold text-slate-950">
                Study package
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                {selectedStudy.publicStudyId} ·{" "}
                {selectedStudy.client
                  ? `${brandText(selectedStudy.client.name)} (${selectedStudy.client.code})`
                  : "-"}
              </p>
            </div>
            <button
              className="rounded-md border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700"
              onClick={() => setSelectedStudy(null)}
              type="button"
            >
              Close
            </button>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <TextInput
              label="Patient"
              value={`${selectedStudy.patientName ?? "-"} / ${selectedStudy.patientId ?? "-"}`}
              readOnly
            />
            <TextInput
              label="Study UID"
              value={selectedStudy.studyInstanceUid}
              readOnly
            />
            <TextInput
              label="Study"
              value={selectedStudy.studyDescription ?? "-"}
              readOnly
            />
            <TextInput
              label="Source AE"
              value={
                selectedStudy.localAeTitle ??
                selectedStudy.agentName ??
                selectedStudy.agentId
              }
              readOnly
            />
            <TextInput
              label="Archive"
              value={selectedStudy.archiveName ?? "-"}
              readOnly
            />
            <TextInput
              label="Processing job"
              value={selectedStudy.processingJobId ?? "-"}
              readOnly
            />
          </div>
          <div className="mt-4">
            <h3 className="text-sm font-bold text-slate-900">
              Clinical indication
            </h3>
            <pre className="mt-2 whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              {selectedStudy.clinicalIndication || "-"}
            </pre>
          </div>
          <SimpleTable
            title="Supporting files"
            columns={["File", "Type", "Size", "Uploaded"]}
            rows={(selectedStudy.attachments ?? []).map((file) => [
              file.originalName,
              file.mimeType ?? "-",
              `${Math.ceil(Number(file.sizeBytes) / 1024)} KB`,
              toDate(file.createdAt),
            ])}
          />
          <div className="mt-5 flex justify-end">
            <button
              className="rounded-md bg-sky-600 px-4 py-2 text-sm font-bold text-white"
              onClick={() => void downloadBridgeBundle(selectedStudy)}
              type="button"
            >
              Download everything
            </button>
          </div>
        </Modal>
      ) : null}
      {selectedJob ? (
        <Modal
          title="Processing job details"
          onClose={() => setSelectedJob(null)}
          wide
        >
          <ProcessingActions key={selectedJob.id} study={bridgeStudies.find(study => study.processingJobId === selectedJob.id) ?? selectedJob.bridgeStudy} token={token} reload={reload}/>
          <div className="record-detail-grid">
            <DetailField
              label="Center"
              value={
                selectedJob.client
                  ? `${brandText(selectedJob.client.name)} (${selectedJob.client.code})`
                  : (selectedJob.clientId ?? "-")
              }
            />
            <DetailField label="Job ID" value={selectedJob.id} />
            <DetailField label="Upload" value={selectedJob.uploadName} />
            <DetailField
              label="Service"
              value={
                serviceTypeLabels[selectedJob.serviceType] ??
                selectedJob.serviceType
              }
            />
            <DetailField
              label="Images"
              value={String(selectedJob.imageCount)}
            />
            <DetailField
              label="Priority"
              value={selectedJob.priority ?? "REGULAR"}
            />
            <DetailField
              label="Status"
              value={<StatusBadge status={selectedJob.status} />}
            />
            <DetailField
              label="Updated"
              value={toDate(selectedJob.updatedAt)}
            />
            <DetailField label="Error" value={selectedJob.error ?? "-"} />
          </div>
          <div className="mt-5">
            <h3 className="text-sm font-bold text-slate-900">
              Upstream processing details
            </h3>
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-xs text-slate-700">
              {formatJson(selectedJob.upstreamStatus)}
            </pre>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function AdminReportsView({
  reports,
  token,
  notice,
  reload,
}: {
  reports: ReportReview[];
  token: string;
  notice: (message: string) => void;
  reload: () => Promise<void>;
}) {
  const [viewerReport, setViewerReport] = useState<ReportReview | null>(null);
  const [selectedReport, setSelectedReport] = useState<ReportReview | null>(
    null,
  );
  const [manualWithLetterhead, setManualWithLetterhead] = useState<File | null>(
    null,
  );
  const [manualWithoutLetterhead, setManualWithoutLetterhead] =
    useState<File | null>(null);
  const [manualReason, setManualReason] = useState("");
  const [manualUploading, setManualUploading] = useState(false);

  function openReportHtml(report: ReportReview, version: "initial" | "final") {
    const html = String(
      version === "initial"
        ? (report.aiReportJson?.htmlReport ?? "")
        : (report.editedReportJson?.htmlReport ?? ""),
    );
    if (!html) {
      notice(
        `${version === "initial" ? "Initial" : "Final"} report HTML is not available.`,
      );
      return;
    }
    window.open(
      URL.createObjectURL(new Blob([html], { type: "text/html" })),
      "_blank",
    );
  }

  async function uploadManualReportPdf() {
    if (!selectedReport) return;
    if (!manualWithLetterhead) {
      notice("Upload the signed PDF with letterhead first.");
      return;
    }
    const invalid = [manualWithLetterhead, manualWithoutLetterhead].filter(
      (file): file is File => Boolean(file && file.type && file.type !== "application/pdf"),
    );
    if (invalid.length) {
      notice("Manual report upload accepts PDF files only.");
      return;
    }
    const form = new FormData();
    form.append("report", manualWithLetterhead);
    if (manualWithoutLetterhead) form.append("report_wlh", manualWithoutLetterhead);
    if (manualReason.trim()) form.append("reason", manualReason.trim());
    setManualUploading(true);
    try {
      const response = await fetch(
        `/api/admin/reports/${encodeURIComponent(selectedReport.id)}/manual-pdf`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.message ?? "Unable to upload manual report PDF.");
      notice("Manual signed report approved and visible in client reports.");
      setManualWithLetterhead(null);
      setManualWithoutLetterhead(null);
      setManualReason("");
      setSelectedReport(body as ReportReview);
      await reload();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to upload manual report PDF.";
      notice(message);
      window.alert(message);
    } finally {
      setManualUploading(false);
    }
  }

  return (
    <section className="soft-card rounded-lg p-5">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-950">
          Initial and final reports
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Super admin visibility across clients, radiologists, AI initial
          versions, and final saved/approved versions.
        </p>
      </div>
      <div className="table-scroll">
        <table className="report-table w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
              {[
                "Center",
                "Patient / report",
                "Study",
                "Status",
                "Updated",
                "Action",
              ].map((column) => (
                <th className="py-3 pr-4" key={column}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {reports.map((report) => (
              <tr className="border-b border-slate-100" key={report.id}>
                <td className="py-4 pr-4 text-slate-700">
                  {report.client
                    ? `${brandText(report.client.name)} (${report.client.code})`
                    : report.clientId}
                </td>
                <td className="py-4 pr-4 text-slate-700">
                  <strong className="block text-slate-900">
                    {report.patientName ?? "-"}
                  </strong>
                  <span className="text-xs text-slate-500">
                    {report.patientId ?? "-"} / {report.id}
                  </span>
                </td>
                <td className="py-4 pr-4 text-slate-700">
                  {report.studyUid ?? report.id}
                </td>
                <td className="py-4 pr-4">
                  <StatusBadge status={report.status} />
                </td>
                <td className="py-4 pr-4 text-slate-700">
                  {toDate(report.updatedAt)}
                </td>
                <td className="py-4 pr-4">
                  <button
                    className="table-view-button"
                    onClick={() => setSelectedReport(report)}
                    type="button"
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
            {!reports.length && (
              <tr>
                <td
                  className="py-6 text-sm font-semibold text-slate-500"
                  colSpan={6}
                >
                  No radiologist reports have been created yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {selectedReport ? (
        <Modal title="Report details" onClose={() => setSelectedReport(null)}>
          <div className="record-detail-grid">
            <DetailField
              label="Center"
              value={
                selectedReport.client
                  ? `${brandText(selectedReport.client.name)} (${selectedReport.client.code})`
                  : selectedReport.clientId
              }
            />
            <DetailField label="Report ID" value={selectedReport.id} />
            <DetailField
              label="Generated"
              value={toDate(
                selectedReport.generatedAt ?? selectedReport.createdAt,
              )}
            />
            <DetailField
              label="Study UID"
              value={selectedReport.studyUid ?? "-"}
            />
            <DetailField
              label="Patient"
              value={`${selectedReport.patientName ?? "-"} / ${selectedReport.patientId ?? "-"}`}
            />
            <DetailField label="Service" value={selectedReport.serviceName} />
            <DetailField
              label="Radiologist"
              value={selectedReport.radiologist?.fullName ?? "Unassigned"}
            />
            <DetailField
              label="Status"
              value={<StatusBadge status={selectedReport.status} />}
            />
            <DetailField
              label="Updated"
              value={toDate(selectedReport.updatedAt)}
            />
          </div>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button
              className="table-view-button"
              onClick={() => openReportHtml(selectedReport, "initial")}
              type="button"
            >
              Initial report
            </button>
            <button
              className="table-view-button"
              onClick={() => openReportHtml(selectedReport, "final")}
              type="button"
            >
              Final report
            </button>
            <button
              className="viewer-open-button inline-flex items-center gap-2 rounded-md bg-sky-700 px-3 py-2 text-sm font-bold text-white"
              onClick={() => {
                setViewerReport(selectedReport);
                setSelectedReport(null);
              }}
              type="button"
            >
              <Eye size={15} />
              Open viewer
            </button>
          </div>
          <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-extrabold text-slate-950">
                  Manual signed PDF push
                </h3>
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  Upload final PDFs for this study and make them visible in client reports.
                </p>
              </div>
              <StatusBadge status={selectedReport.status} />
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-sm font-bold text-slate-700">
                With letterhead PDF
                <input
                  accept="application/pdf,.pdf"
                  className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                  disabled={manualUploading}
                  onChange={(event) =>
                    setManualWithLetterhead(event.target.files?.[0] ?? null)
                  }
                  type="file"
                />
              </label>
              <label className="grid gap-1 text-sm font-bold text-slate-700">
                Without letterhead PDF
                <input
                  accept="application/pdf,.pdf"
                  className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                  disabled={manualUploading}
                  onChange={(event) =>
                    setManualWithoutLetterhead(event.target.files?.[0] ?? null)
                  }
                  type="file"
                />
              </label>
            </div>
            <label className="mt-3 grid gap-1 text-sm font-bold text-slate-700">
              Remarks
              <textarea
                className="min-h-20 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                disabled={manualUploading}
                maxLength={1000}
                onChange={(event) => setManualReason(event.target.value)}
                placeholder="Reason for manual upload or corrected report"
                value={manualReason}
              />
            </label>
            <div className="mt-4 flex justify-end">
              <button
                className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
                disabled={manualUploading || !manualWithLetterhead}
                onClick={() => void uploadManualReportPdf()}
                type="button"
              >
                <UploadCloud size={15} />
                {manualUploading ? "Uploading..." : "Upload and push"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
      {viewerReport ? (
        <MarengoDicomViewerModal
          report={viewerReport}
          token={token}
          canViewInternalReports
          onClose={() => setViewerReport(null)}
        />
      ) : null}
    </section>
  );
}

function ClientContent({
  active,
  token,
  client,
  user,
  reload,
  notice,
  onNavigate,
  availableTabs,
}: {
  active: string;
  token: string;
  client: Client;
  user: User;
  reload: () => Promise<void>;
  notice: (message: string) => void;
  onNavigate: (section: string) => void;
  availableTabs: string[];
}) {
  if (active === "Notifications") return <NotificationCenterView token={token} />;
  if (active === "Analytics") return <ManagementAnalyticsView token={token} section="reporting" />;
  if (active === "AI Usage") return <ManagementAnalyticsView token={token} section="usage" />;
  if (active === "Reporting Statistics") return <ManagementAnalyticsView token={token} section="reporting" />;
  if (active === "Center Analytics") return <ManagementAnalyticsView token={token} section="centers" />;
  if (active === "Management Bot") return <ManagementBotView token={token} />;
  if (active === "Patients")
    return (
      <PatientProfilesView
        token={token}
        clientId={client.kind === "CENTER" ? client.id : undefined}
        notice={notice}
      />
    );
  if (active === "Follow-ups")
    return <FollowUpsView token={token} notice={notice} />;
  if (client.kind === "GROUP" || client.code === "MARENGO") {
    const groupJobs = client.organization?.processingJobs ?? [];
    if (active === "Dashboard")
      return (
        <MarengoOrganizationDashboard
          client={client}
          token={token}
          reload={reload}
          notice={notice}
        />
      );
    if (active === "Centers")
      return (
        <MarengoCentersView
          client={client}
          token={token}
          reload={reload}
          notice={notice}
        />
      );
    if (active === "Studies" || active === "Available studies")
      return (
        <GroupStudiesView
          studies={client.organization?.bridgeStudies ?? []}
          token={token}
          notice={notice}
        />
      );
    if (active === "Processing")
      return (
        <ClientProcessingView
          token={token}
          processingJobs={groupJobs}
          reload={reload}
          notice={notice}
          readOnly
        />
      );
    if (active === "Radiologists")
      return (
        <ClientRadiologistsView
          token={token}
          client={{
            ...client,
            radiologists:
              client.organization?.radiologists ?? client.radiologists ?? [],
            reportReviews:
              client.organization?.reports ?? client.reportReviews ?? [],
          }}
          reload={reload}
          notice={notice}
        />
      );
    if (active === "Monthly Analysis")
      return <MarengoMonthlyAnalysisView client={client} />;
    if (active === "Reports" || active === "Generated reports" || active === "Report")
      return <MarengoReportsView client={client} token={token} />;
    if (active === "Support")
      return (
        <SupportCenterView
          token={token}
          role="client"
          client={client}
          clients={client.organization?.centers ?? []}
          notice={notice}
        />
      );
    if (active === "Billing")
      return client.billing ? (
        <BillingView
          token={token}
          billing={client.billing}
          scope="client"
          notice={notice}
        />
      ) : (
        <EmptyState message="Billing data is not available yet." />
      );
    if (active === "Profile")
      return <ProfileView client={client} token={token} user={user} />;
    return (
      <MarengoOrganizationDashboard
        client={client}
        token={token}
        reload={reload}
        notice={notice}
      />
    );
  }
  if (active === "Users")
    return <CenterUsersView client={client} token={token} reload={reload} notice={notice} />;
  if (active === "Manual upload")
    return <ManualStudyUploadView token={token} client={client} reload={reload} notice={notice} />;
  if (active === "Available study" || active === "Available Studies" || active === "Available studies" || active === "Worklist")
    return <MarengoUnifiedWorklist token={token} client={client} user={user} reload={reload} notice={notice} onNavigate={onNavigate} availableTabs={availableTabs} />;
  if (active === "Study sync")
    return (
      <ClientStudySyncView
        token={token}
        client={client}
        reload={reload}
        notice={notice}
        pollIntervalMs={user.deploymentFeatures?.availableStudiesPollMs}
      />
    );
  if (
    active === "Processing studies" ||
    active === "Studies" ||
    active === "Processing"
  )
    return (
      <ClientProcessingView
        token={token}
        processingJobs={client.processingJobs ?? []}
        reload={reload}
        notice={notice}
      />
    );
  if (active === "Generated Reports" || active === "Generated reports" || active === "Reports" || active === "Report")
    return (
      <ClientReportsView
        token={token}
        reports={client.reportReviews ?? []}
        processingJobs={client.processingJobs ?? []}
        notice={notice}
      />
    );
  if (active === "Support")
    return (
      <SupportCenterView
        token={token}
        role="client"
        client={client}
        notice={notice}
      />
    );
  if (active === "Logs") return <UsageView logs={client.usageLogs ?? []} />;
  if (active === "Profile") return <ProfileView client={client} token={token} user={user} />;
  return <ClientDashboard client={client} />;
}



function WorkspaceReports({ reports, token, permissions, onPreview, onAction, onManage }: {
  reports: ReportReview[]; token: string; permissions: ReturnType<typeof workspacePermissions>;
  onPreview: (report: ReportReview) => void; onAction: (action: WorkspaceAction) => void;
  onManage?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const filtered = reports.filter((report) => ["APPROVED", "PUSHED"].includes(report.status))
    .filter((report) => [report.patientName, report.patientId, report.accession, report.serviceName, report.client?.name].join(" ").toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => new Date(b.approvedAt ?? b.generatedAt).getTime() - new Date(a.approvedAt ?? a.generatedAt).getTime());
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 25) - 1));
  async function download(report: ReportReview, variant: "with-letterhead" | "without-letterhead") {
    setBusy(`${report.id}:${variant}`); setError("");
    try { await downloadProtectedFile(`/api/reports/${report.id}/pdf?variant=${variant}&download=1`, token); }
    catch (err) { setError(err instanceof Error ? err.message : "Download unavailable."); }
    finally { setBusy(""); }
  }
  return <>
    <div className="pw-heading"><div><div className="pw-breadcrumb">Radiology / Reports</div><h1>Report library <span>{filtered.length}</span></h1></div>{onManage && <button onClick={onManage}><FileText size={16}/>Manage reports</button>}</div>
    <div className="pw-toolbar"><label className="pw-search"><Search size={16}/><input aria-label="Search reports" placeholder="Search patient, ID, accession..." value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }}/></label></div>
    {error && <div className="pw-alert" role="alert">{error}</div>}
    <div className="pw-table-scroll"><table className="pw-data-table pw-report-table"><thead><tr><th>Patient</th><th>Accession number</th><th>Study</th><th>Reported (IST)</th><th>Radiologist</th><th>Download PDF</th><th>Actions</th></tr></thead><tbody>
      {filtered.slice(currentPage * 25, currentPage * 25 + 25).map((report) => <tr key={report.id}><td><strong>{report.patientName || "Unknown patient"}</strong><small>{report.patientId || "-"}</small><small className="pw-report-mobile-study">{report.serviceName}</small></td><td>{report.accession || "-"}</td><td><strong>{report.serviceName}</strong><small>{report.modality} {report.client?.name}</small></td><td>{istTimestamp(report.approvedAt ?? report.generatedAt).full}</td><td>{report.radiologist?.fullName || "-"}</td><td><div className="pw-downloads">{(["with-letterhead", "without-letterhead"] as const).map((variant) => <button key={variant} aria-label={`Download report ${variant.replaceAll("-", " ")} for ${report.patientName}`} disabled={Boolean(busy)} onClick={() => void download(report, variant)}>{busy === `${report.id}:${variant}` ? <LoaderCircle className="pw-spinning" size={14}/> : <Download size={14}/>}<span>{variant === "with-letterhead" ? "With letterhead" : "Without letterhead"}</span></button>)}</div></td><td><div className="pw-inline-actions">
        <button title="View report" aria-label={`View report for ${report.patientName}`} onClick={() => onPreview(report)}><Eye size={15}/></button>
        {permissions.share && <button title="Share report" aria-label={`Share report for ${report.patientName}`} onClick={() => onAction({ kind: "share", report })}><Share2 size={15}/></button>}
        {permissions.schedule && <button title="Schedule call" aria-label={`Schedule call for ${report.patientName}`} onClick={() => onAction({ kind: "call", report })}><Phone size={15}/></button>}
      </div></td></tr>)}
      {!filtered.length && <tr><td colSpan={7}><div className="pw-empty"><FileText size={24}/><h2>No finalized reports found</h2></div></td></tr>}
    </tbody></table></div>
    <footer className="pw-footer"><span>{filtered.length} finalized reports</span><div className="pw-pagination"><button aria-label="Previous reports page" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16}/></button><span>{currentPage + 1} / {Math.max(1, Math.ceil(filtered.length / 25))}</span><button aria-label="Next reports page" disabled={(currentPage + 1) * 25 >= filtered.length} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16}/></button></div></footer>
  </>;
}

function WorkspaceUsers({ client, token, reload, canManage }: { client: Client; token: string; reload: () => Promise<void>; canManage: boolean }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", portalRole: "FRONT_DESK" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [credential, setCredential] = useState("");
  const [directory, setDirectory] = useState<{ users: User[]; centers: { id: string; name: string }[] }>({ users: [], centers: [] });
  const [centerId, setCenterId] = useState(client.kind === "GROUP" ? "" : client.id);
  const [loaded, setLoaded] = useState(false);
  const [syncError, setSyncError] = useState("");
  async function refreshDirectory(signal?: AbortSignal) {
    try {
      const result = await api<typeof directory>("/api/workspace/users", token, { signal, cache: "no-store" });
      if (signal?.aborted) return;
      setDirectory(result); setLoaded(true); setSyncError("");
    } catch (err) { if (!signal?.aborted) setSyncError(err instanceof Error ? err.message : "User directory unavailable."); throw err; }
  }
  useLiveRefresh(refreshDirectory, { enabled: canManage, refreshKey: client.id });
  const users = directory.users.filter((user) => (!centerId || user.clientId === centerId) && [user.name, user.email, user.userId].join(" ").toLowerCase().includes(query.toLowerCase()));
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const endpoint = client.kind === "GROUP" ? `/api/client/organization/centers/${encodeURIComponent(centerId)}/users` : "/api/client/users";
      const result = await api<{ temporaryPassword: string }>(endpoint, token, { method: "POST", body: JSON.stringify(form) });
      setCredential(result.temporaryPassword); setOpen(false); setForm({ name: "", email: "", portalRole: "FRONT_DESK" }); await refreshDirectory(); await reload();
    } catch (err) { setError(err instanceof Error ? err.message : "User creation failed."); }
    finally { setBusy(false); }
  }
  return <><div className="pw-heading"><div><div className="pw-breadcrumb">Administration / Users</div><h1>Center users <span>{users.length}</span></h1></div>{canManage && <button className="pw-primary" onClick={() => { setOpen(!open); setCredential(""); }}><Plus size={16}/>Add user</button>}</div>
    {syncError && <div className="pw-alert" role="alert">{syncError}</div>}
    <div className="pw-toolbar"><label className="pw-search"><Search size={16}/><input aria-label="Search users" placeholder="Search name, email, user ID..." value={query} onChange={(e) => setQuery(e.target.value)}/></label>{client.kind === "GROUP" && <select aria-label="User center" value={centerId} onChange={e => setCenterId(e.target.value)}><option value="">All centers</option>{directory.centers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</div>
    {error && <div className="pw-alert" role="alert">{error}</div>}
    {credential && <div className="pw-credential" role="status"><strong>User created. One-time temporary password</strong><code>{credential}</code><button onClick={() => setCredential("")}>Dismiss</button></div>}
    {open && canManage && <form className="pw-user-form" onSubmit={(e) => void submit(e)}><label className="pw-field">Full name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}/></label><label className="pw-field">Email<input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}/></label><label className="pw-field">Role<select value={form.portalRole} onChange={(e) => setForm({ ...form, portalRole: e.target.value })}>{clientPortalRoleOptions.filter(([value]) => assignableCenterRoles(client.kind === "GROUP").includes(value)).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{client.kind === "GROUP" && <label className="pw-field">Center<select required value={centerId} onChange={e => setCenterId(e.target.value)}><option value="">Select center</option>{directory.centers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}<button className="pw-primary" disabled={busy}>{busy ? "Creating..." : "Create user"}</button></form>}
    <div className="pw-table-scroll"><table className="pw-data-table"><thead><tr><th>Name</th><th>User ID</th><th>Email</th><th>Role</th>{client.kind === "GROUP" && <th>Center</th>}<th>Status</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><strong>{user.name}</strong></td><td>{user.userId || "-"}</td><td>{user.email}</td><td>{clientPortalRoleLabel(user.portalRole)}</td>{client.kind === "GROUP" && <td>{directory.centers.find(c => c.id === user.clientId)?.name ?? "-"}</td>}<td><span className={`pw-status ${user.active === false ? "available" : "reported"}`}><i/>{user.active === false ? "Inactive" : "Active"}</span></td></tr>)}{!users.length && <tr><td colSpan={client.kind === "GROUP" ? 6 : 5}><div className="pw-empty">{loaded ? "No matching users" : "Loading users..."}</div></td></tr>}</tbody></table></div><footer className="pw-footer">{client.name}</footer>
  </>;
}

function WorkspaceActionDialog({ action, token, onClose, onSaved }: { action: WorkspaceAction; token: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [includeViewer, setIncludeViewer] = useState(false);
  const [share, setShare] = useState<{ url: string; qr: string; expiresAt: string } | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [options, setOptions] = useState<CallOptions | null>(null);
  const [bookings, setBookings] = useState<ReportCallBooking[]>([]);
  const [duration, setDuration] = useState(15);
  const [slotId, setSlotId] = useState("");
  const [mode, setMode] = useState("BUILT_IN_MEETING");
  const [phone, setPhone] = useState("");
  const [loadingSlots, setLoadingSlots] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const reportId = action.kind === "attach" ? "" : action.report.id;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    if (action.kind !== "call") return;
    setLoadingSlots(true); setOptions(null); setSlotId(""); setError("");
  }, [action.kind, reportId, duration, token]);
  useLiveRefresh(async (signal) => {
    try {
      const data = await api<CallOptions>(`/api/client/reports/${reportId}/call-options?durationMinutes=${duration}`, token, { cache: "no-store", signal });
      const calls = await api<ReportCallBooking[]>(`/api/client/reports/${reportId}/call-bookings`, token, { cache: "no-store", signal });
      if (signal.aborted) return;
      setOptions(data); setBookings(calls); setError("");
      setSlotId((selected) => data.slots.some((slot) => slot.id === selected) ? selected : "");
    } catch (err) {
      if (!signal.aborted || signal.reason?.name === "TimeoutError") setError(err instanceof Error ? err.message : "Call availability unavailable.");
      throw err;
    } finally { if (!signal.aborted) setLoadingSlots(false); }
  }, { enabled: action.kind === "call" && !busy, refreshKey: `${reportId}:${duration}` });
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setSuccess("");
    try {
      if (action.kind === "share") {
        const result = await api<{ token: string; expiresAt: string; url: string; qr: string }>(`/api/reports/${reportId}/public-share`, token, { method: "POST", body: JSON.stringify({ includeViewer }) });
        const url = result.url || `${window.location.origin}/shared/${encodeURIComponent(result.token)}`;
        setShare({ url, qr: result.qr, expiresAt: result.expiresAt });
      } else if (action.kind === "attach") {
        if (!files.length || files.length > 5) throw new Error("Select between one and five supporting files.");
        const body = new FormData();
        files.forEach((file) => body.append("attachments", file));
        if (action.study.clinicalIndication) body.append("clinical_indication", action.study.clinicalIndication);
        const response = await fetch(`/api/client/study-sync/available-studies/${action.study.id}/additional-info`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body });
        if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.message || "Attachment upload failed."); }
        setFiles([]); setSuccess("Supporting investigations attached."); await onSaved();
      } else {
        const slot = options?.slots.find((item) => item.id === slotId);
        if (!slot) throw new Error("Select a preferred time window.");
        const booking = await api<ReportCallBooking>(`/api/client/reports/${reportId}/call-bookings`, token, { method: "POST", body: JSON.stringify({ availabilityId: slot.id, slotStart: slot.slotStart, durationMinutes: duration, communicationMode: mode, phoneNumber: phone }) });
        setBookings((items) => [booking, ...items]); setSlotId(""); setSuccess("Call requested. Confirmation is pending."); await onSaved();
      }
    } catch (err) { setError(err instanceof Error ? err.message : "The action could not be completed."); }
    finally { setBusy(false); }
  }
  async function revoke() {
    setBusy(true); setError("");
    try { await api(`/api/reports/${reportId}/public-share`, token, { method: "DELETE" }); setShare(null); setSuccess("All existing share links for this report have been revoked."); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not revoke links."); }
    finally { setBusy(false); }
  }
  return <div className="pw-overlay pw-action-overlay"><div ref={panelRef} className="pw-drawer" role="dialog" aria-modal="true" aria-labelledby="pw-action-title" tabIndex={-1} onKeyDown={(event) => {
    if (event.key === "Escape") { event.stopPropagation(); if (!busy) onClose(); return; }
    if (event.key === "Tab") {
      const elements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]')).filter((el) => el.getClientRects().length);
      const first = elements[0], last = elements.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === event.currentTarget)) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <header className="pw-drawer-header"><h2 id="pw-action-title">{action.kind === "share" ? "Share report" : action.kind === "call" ? "Schedule call" : "Supporting investigations"}</h2><button className="pw-icon" aria-label="Close action" disabled={busy} onClick={onClose}><X size={18}/></button></header>
    <form className="pw-action-form" onSubmit={(event) => void submit(event)}><div className="pw-drawer-body">
      <div className="pw-action-patient"><strong>{action.kind === "attach" ? action.study.patientName : action.report.patientName}</strong><span>{action.kind === "attach" ? action.study.accessionNumber : action.report.accession}</span></div>
      {error && <div className="pw-alert" role="alert">{error}</div>}{success && <div className="pw-alert success" role="status">{success}</div>}
      {action.kind === "share" && <><label className="pw-check"><input type="checkbox" checked={includeViewer} disabled={busy} onChange={(e) => { setIncludeViewer(e.target.checked); setShare(null); setSuccess(""); }}/>Include DICOM viewer</label><p className="pw-help">Anyone with this link can access the {includeViewer ? "report and images" : "report"} until it expires or is revoked.</p>
        {share && <div className="pw-share-result"><img src={share.qr} alt="QR code for shared report" width={240} height={240}/><label className="pw-field">Shareable link<input aria-label="Shareable link" readOnly value={share.url} onFocus={(e) => e.target.select()}/></label><div className="pw-inline-actions"><button type="button" onClick={() => { void navigator.clipboard.writeText(share.url).then(() => setSuccess("Link copied."), () => setError("Clipboard unavailable. Select and copy the link.")); }}>Copy link</button><a href={share.qr} download="marengo-report-qr.png">Download QR</a></div><p className="pw-help">Expires {istTimestamp(share.expiresAt).full}</p></div>}
        <button type="button" className="pw-revoke" disabled={busy} onClick={() => void revoke()}>Revoke existing links</button></>}
      {action.kind === "attach" && <><label className="pw-upload-zone"><UploadCloud size={28}/><strong>Supporting files</strong><span>Up to 5 files, 512 MB per file</span><input aria-label="Supporting files" type="file" multiple disabled={busy} onChange={(e) => { const selected = Array.from(e.target.files ?? []); if (selected.length > 5 || selected.some((file) => file.size > 512 * 1024 * 1024)) { setError("Choose up to 5 files, each no larger than 512 MB."); setFiles([]); } else { setError(""); setFiles(selected); } }}/></label><ul className="pw-file-list">{files.map((file, index) => <li key={`${file.name}-${index}`}><FileText size={15}/><span>{file.name}</span><button type="button" aria-label={`Remove ${file.name}`} disabled={busy} onClick={() => setFiles(files.filter((_, i) => i !== index))}><X size={14}/></button></li>)}</ul></>}
      {action.kind === "call" && <><label className="pw-field">Duration<select value={duration} disabled={busy} onChange={(e) => setDuration(Number(e.target.value))}>{[5, 10, 15, 20, 30, 60].map((value) => <option key={value} value={value}>{value} minutes</option>)}</select></label>
        <label className="pw-field">Preferred time window (IST)<select aria-label="Preferred time window (IST)" required value={slotId} disabled={busy || loadingSlots} onChange={(e) => setSlotId(e.target.value)}><option value="">{loadingSlots ? "Loading appointments..." : "Select preferred time"}</option>{options?.slots.map((slot) => <option key={slot.id} value={slot.id}>{istTimestamp(slot.slotStart).full} - {slot.radiologist?.fullName || "Radiologist"}</option>)}</select></label>
        {!loadingSlots && options && !options.slots.length && <p className="pw-help">No appointments available for this duration.</p>}
        <label className="pw-field">Call type<select aria-label="Call type" value={mode} disabled={busy} onChange={(e) => setMode(e.target.value)}><option value="BUILT_IN_MEETING">Screen call</option><option value="PHONE_CALL">Phone call</option></select></label>
        {mode === "PHONE_CALL" && <label className="pw-field">Phone number<input type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)}/></label>}
        {bookings.length > 0 && <><h4>Call requests</h4><ul className="pw-file-list">{bookings.map((booking) => <li key={booking.id}><CalendarDays size={15}/><span>{istTimestamp(booking.slotStart).full}<small>{booking.status?.replaceAll("_", " ")}</small>{booking.communicationMode === "PHONE_CALL" ? <a href={`tel:${booking.phoneNumber}`}>Call {booking.phoneNumber}</a> : booking.meetingUrl && <a href={booking.meetingUrl} target="_blank" rel="noreferrer">Join screen call</a>}</span></li>)}</ul></>}
      </>}
    </div><footer className="pw-drawer-footer"><button type="button" disabled={busy} onClick={onClose}>Close</button><button className="pw-primary" disabled={busy || (action.kind === "attach" && !files.length) || (action.kind === "call" && (!slotId || loadingSlots))}>{busy ? <LoaderCircle size={16} className="pw-spinning"/> : action.kind === "share" ? <Share2 size={16}/> : action.kind === "call" ? <Phone size={16}/> : <UploadCloud size={16}/>}{action.kind === "share" ? "Generate link" : action.kind === "call" ? "Request call" : "Attach files"}</button></footer></form>
  </div></div>;
}

function WorkspaceAccountDetails({ client, user, roleLabel, token }: { client: Client; user: User; roleLabel: string; token: string }) {
  const [integrationOpen, setIntegrationOpen] = useState(false);
  const [config, setConfig] = useState<StudySyncConfig | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!integrationOpen || !client.studySyncEnabled) return;
    let cancelled = false;
    void api<StudySyncConfig>("/api/client/study-sync/config", token).then((data) => { if (!cancelled) setConfig(data); }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Integration settings unavailable."); });
    return () => { cancelled = true; };
  }, [integrationOpen, client.studySyncEnabled, token]);
  return <>
    <dl className="pw-account-details"><dt>Name</dt><dd>{user.name}</dd><dt>User ID</dt><dd>{user.userId || "-"}</dd><dt>Email</dt><dd>{user.email}</dd><dt>Role</dt><dd>{roleLabel}</dd><dt>Status</dt><dd>{user.active === false ? "Inactive" : "Active"}</dd></dl>
    {user.role === "CLIENT_USER" && <><details className="pw-account-section"><summary>Facility details</summary><dl className="pw-account-details"><dt>Facility</dt><dd>{client.name}</dd><dt>Client code</dt><dd>{client.code}</dd><dt>Primary contact</dt><dd>{client.primaryContact || "-"}</dd><dt>Email</dt><dd>{client.email}</dd><dt>Facility type</dt><dd>{client.facilityType || "-"}</dd><dt>Status</dt><dd>{client.status}</dd><dt>Demo mode</dt><dd>{client.demoModeEnabled ? "Enabled" : "Disabled"}</dd>{client.demoModeEnabled && <><dt>Demo studies</dt><dd>{client._count?.processingJobs ?? 0}{client.demoStudyLimit == null ? "" : ` / ${client.demoStudyLimit}`}</dd></>}</dl></details>
      <details className="pw-account-section" onToggle={(event) => setIntegrationOpen(event.currentTarget.open)}><summary>Integration settings</summary><dl className="pw-account-details"><dt>Study sync</dt><dd>{client.studySyncEnabled ? "Enabled" : "Disabled"}</dd>{config && <><dt>Center code</dt><dd>{config.centerCode ?? config.clientId}</dd>{Object.entries(config.endpoints).map(([key, endpoint]) => <div className="pw-account-endpoint" key={key}><dt>{key} / {endpoint.method}</dt><dd>{endpoint.url}</dd></div>)}</>}</dl>{error && <p role="alert">{error}</p>}{integrationOpen && client.studySyncEnabled && !config && !error && <p>Loading integration settings...</p>}{integrationOpen && <div className="pw-account-routing"><h4>Direct PACS routing</h4><DirectPacsSetup services={client.services}/></div>}</details></>}
  </>;
}

// Incremental polls cannot see deleted studies; reload the full list at least this often.
const WORKLIST_FULL_RELOAD_MS = 5 * 60_000;

function MarengoUnifiedWorklist({
  token,
  client,
  user,
  reload,
  notice,
  onNavigate,
  availableTabs,
  activeSection = "Available studies",
  sectionContent,
  workspaceNotice,
  workspaceSyncError,
}: {
  token: string;
  client: Client;
  user: User;
  reload: () => Promise<void>;
  notice: (message: string) => void;
  onNavigate: (section: string) => void;
  availableTabs: string[];
  activeSection?: string;
  sectionContent?: ReactNode;
  workspaceNotice?: string;
  workspaceSyncError?: string;
}) {
  const permissions = workspacePermissions(user.role, user.portalRole, client.kind === "GROUP");
  const isReports = ["Reports", "Report", "Generated reports", "Generated Reports"].includes(activeSection);
  const isUsers = activeSection === "Users";
  const isWorklist = user.role !== "RADIOLOGIST" && !user.role.startsWith("PROVIDER_") && ["Available studies", "Available Studies", "Available study", "Worklist", "Studies"].includes(activeSection);
  const worklistSection = availableTabs.find((item) => ["Available studies", "Available Studies", "Studies", "Pushed Studies"].includes(item));
  const reportsSection = availableTabs.find((item) => ["Generated reports", "Generated Reports", "Reports"].includes(item));
  const [actionDialog, setActionDialog] = useState<WorkspaceAction | null>(null);
  const [manageReports, setManageReports] = useState(false);
  useEffect(() => { setManageReports(false); }, [activeSection]);
  const roleLabel = user.role === "CLIENT_USER" ? client.kind === "GROUP" ? "Marengo Management" : clientPortalRoleLabel(user.portalRole) : user.role.replaceAll("_", " ").toLowerCase();
  const initialStudies = useMemo(
    () => client.availableBridgeStudies ?? client.organization?.bridgeStudies ?? [],
    [client.availableBridgeStudies, client.organization?.bridgeStudies],
  );
  const jobs = useMemo(() => [...new Map([...(client.processingJobs ?? []), ...(client.organization?.processingJobs ?? [])].map(job => [job.id, job])).values()], [client.processingJobs, client.organization?.processingJobs]);
  const reports = useMemo(() => [...new Map([...(client.reportReviews ?? []), ...(client.organization?.reports ?? [])].map(report => [report.id, report])).values()], [client.reportReviews, client.organization?.reports]);
  const [worklistStudies, setWorklistStudies] = useState<BridgeStudy[]>(initialStudies);
  const [prioritySaving, setPrioritySaving] = useState<Set<string>>(new Set());
  const priorityRequests = useRef(new Set<string>());
  const priorityRevision = useRef(0);
  const [studyLoading, setStudyLoading] = useState(!initialStudies.length);
  const [studyError, setStudyError] = useState("");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"ALL" | "AVAILABLE" | "REPORTING" | "REPORTED" | "URGENT" | "FAILED">("ALL");
  const [dateFilter, setDateFilter] = useState<"ALL" | "TODAY" | "WEEK">("ALL");
  const [modalityFilter, setModalityFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "AVAILABLE" | "REPORTING" | "REPORTED" | "FAILED">("ALL");
  const [priorityFilter, setPriorityFilter] = useState<"ALL" | "REGULAR" | "URGENT">("ALL");
  const [sendStudy, setSendStudy] = useState<BridgeStudy | null>(null);
  const [studyMedia, setStudyMedia] = useState<WorklistMedia | null>(null);
  const [clockTime, setClockTime] = useState(Date.now());
  const [priority, setPriority] = useState<"REGULAR" | "URGENT">("REGULAR");
  const [indication, setIndication] = useState("");
  const [sending, setSending] = useState(false);
  const [downloadingStudyId, setDownloadingStudyId] = useState<string | null>(null);
  const studyDownloadInFlight = useRef(false);
  const [terminatingStudyId, setTerminatingStudyId] = useState<string | null>(null);
  const [uploadingStudy, setUploadingStudy] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailStudy, setDetailStudy] = useState<BridgeStudy | null>(null);
  const [sort, setSort] = useState<{ key: "received" | "processed" | "patient" | "modality" | "priority"; ascending: boolean }>({ key: "received", ascending: false });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadModality, setUploadModality] = useState("XRAY");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("marengo-sidebar-collapsed") === "true");
  const accountRef = useRef<HTMLDivElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  useEffect(() => { localStorage.setItem("marengo-sidebar-collapsed", String(sidebarCollapsed)); }, [sidebarCollapsed]);
  useEffect(() => {
    if (!profileOpen) return;
    const dismiss = (event: PointerEvent) => { if (!accountRef.current?.contains(event.target as Node)) setProfileOpen(false); };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [profileOpen]);
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null);
  const worklistLoadingRef = useRef(false);
  const hasWorklistSnapshot = useRef(initialStudies.length > 0);
  const worklistSyncRef = useRef<{ asOf: string; fullAt: number } | null>(null);

  const loadWorklistStudies = useCallback(async (silent = false, signal?: AbortSignal) => {
    if (!["SUPER_ADMIN", "CLIENT_USER"].includes(user.role)) { setStudyLoading(false); return; }
    if (worklistLoadingRef.current) return;
    worklistLoadingRef.current = true;
    const startedPriorityRevision = priorityRevision.current;
    if (!silent || !hasWorklistSnapshot.current) setStudyLoading(true);
    if (!silent) setStudyError("");
    try {
      // The server's asOf (taken before its query) from the first page is the next updatedSince.
      let asOf = "";
      let resync = false;
      const fetchPage = (updatedSince?: string) => async (cursor: string, limit: number) => {
        const params = new URLSearchParams({ limit: String(limit), includeProcessed: "1", view: "worklist" });
        if (updatedSince) params.set("updatedSince", updatedSince);
        if (cursor) params.set("cursor", cursor);
        const result = await api<{ studies: BridgeStudy[]; nextCursor?: string | null; asOf: string; resync?: boolean }>(`/api/client/study-sync/available-studies?${params}`, token, { cache: "no-store", signal });
        if (!cursor) { asOf = result.asOf; resync = Boolean(result.resync); }
        return result;
      };
      // Silent polls fetch only studies whose row, job or report changed; a periodic full load drops deleted studies.
      const sync = worklistSyncRef.current;
      if (silent && hasWorklistSnapshot.current && sync && Date.now() - sync.fullAt < WORKLIST_FULL_RELOAD_MS) {
        const changes = await loadStudyPages<BridgeStudy>(fetchPage(sync.asOf), { signal, firstPageSize: 500 });
        if (signal?.aborted) return;
        if (!resync) {
          // A priority change during the request may be newer than these rows; keep the cursor so the next poll re-reads them.
          if (startedPriorityRevision === priorityRevision.current) {
            setWorklistStudies((previous) => mergeStudies(previous, changes));
            worklistSyncRef.current = { asOf, fullAt: sync.fullAt };
          }
          setLastSync(new Date());
          setStudyError("");
          return;
        }
      }
      const studies = await loadStudyPages<BridgeStudy>(fetchPage(), { signal, firstPageSize: hasWorklistSnapshot.current ? 500 : 100, onFirstPage: firstPage => { if (!hasWorklistSnapshot.current && startedPriorityRevision === priorityRevision.current) { setWorklistStudies(firstPage); hasWorklistSnapshot.current = firstPage.length > 0; } } });
      if (signal?.aborted) return;
      if (startedPriorityRevision === priorityRevision.current) {
        setWorklistStudies(studies); hasWorklistSnapshot.current = true;
        worklistSyncRef.current = { asOf, fullAt: Date.now() };
      }
      setLastSync(new Date());
      setStudyError("");
    } catch (error) {
      if (signal?.aborted && signal.reason?.name !== "TimeoutError") throw error;
      const message = error instanceof Error ? error.message : "Unable to load worklist studies";
      setStudyError(message);
      if (signal) throw error;
    } finally {
      worklistLoadingRef.current = false;
      if (!signal?.aborted || signal.reason?.name === "TimeoutError") setStudyLoading(false);
    }
  }, [token, user.role]);

  useLiveRefresh((signal) => loadWorklistStudies(true, signal), { enabled: ["SUPER_ADMIN", "CLIENT_USER"].includes(user.role), intervalMs: user.deploymentFeatures?.availableStudiesPollMs ?? 30000 });

  const reportByUid = useMemo(
    () => new Map(reports.filter((report) => report.studyUid).map((report) => [report.studyUid!, report])),
    [reports],
  );
  const jobByStudyId = useMemo(
    () => new Map(jobs.filter((job) => job.bridgeStudy?.id).map((job) => [job.bridgeStudy!.id!, job])),
    [jobs],
  );
  const rows = useMemo(() => worklistStudies.map((study) => {
    const job = jobByStudyId.get(study.id);
    // Slim worklist rows carry their report; older full-shape rows fall back to the dashboard reports.
    const report: ReportSummary | undefined = study.report !== undefined ? study.report ?? undefined : reportByUid.get(study.studyInstanceUid);
    const state = worklistStatus({ reportStatus: report?.status, workflowStatus: study.workflowStatus, processingJobId: study.processingJobId ?? job?.id, submittedAt: study.submittedAt });
    // The row's embedded job is fresher than the (cached) dashboard job list.
    const needsAttention = /fail|error/i.test(`${study.processingJob?.status ?? job?.status ?? ""} ${study.workflowStatus}`);
    const receivedAt = study.receivedAt ?? study.lastSyncedAt;
    const tatStartAt = worklistTatStart(state, study.submittedAt);
    const processedAt = worklistTatEnd(state,
      report && ["APPROVED", "PUSHED"].includes(report.status) ? reportTatCompletedAt(report) : null,
      study.processingJob?.completedAt ?? job?.completedAt);
    const referringDoctor = study.referringPhysician ?? job?.bridgeStudy?.referringPhysician ?? "";
    const priority = worklistPriority(study.priority ?? study.processingJob?.priority ?? job?.priority);
    return { study, job, report, state, needsAttention, receivedAt, tatStartAt, processedAt, referringDoctor, priority };
  }), [jobByStudyId, reportByUid, worklistStudies]);

  const modalityOptions = useMemo(() => Array.from(new Set(['XR', 'CT', 'MR', 'SPECIALXRAY', ...rows.flatMap(({ study }) => (study.modalities ?? []).map(worklistModality).filter(Boolean))])).sort(), [rows]);
  const searchedRows = useMemo(() => rows.filter(({ study, referringDoctor }) => searchableText([
        referringDoctor,
        study.patientName,
        study.patientId,
        study.accessionNumber,
        study.studyDescription,
        study.studyInstanceUid,
        ...(study.modalities ?? []),
      ]).includes(query.trim().toLowerCase())), [rows, query]);
  const istDay = Math.floor((clockTime + 19800000) / 86400000);
  const { scopedRows, counts, modalityCounts, receivedCount } = useMemo(() => worklistFacets(searchedRows, dateFilter, modalityFilter, istDay * 86400000 - 19800000), [searchedRows, dateFilter, modalityFilter, istDay]);
  const filtered = useMemo(() => scopedRows.filter(({ state, needsAttention, priority }) =>
    (tab === "ALL" || (tab === "FAILED" ? needsAttention : tab === "URGENT" ? priority === "URGENT" : state === tab)) &&
    (statusFilter === "ALL" || state === statusFilter) &&
    (priorityFilter === "ALL" || priority === priorityFilter)), [scopedRows, tab, statusFilter, priorityFilter]);

  async function submitForReporting() {
    if (!sendStudy) return;
    setFeedback(null);
    setSending(true);
    try {
      const form = new FormData();
      form.append("clinical_indication", indication || sendStudy.clinicalIndication || "No clinical indication available");
      form.append("priority", priority);
      const response = await fetch(`/api/client/study-sync/available-studies/${encodeURIComponent(sendStudy.id)}/submit`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.message ?? "Unable to send study for reporting");
      notice(`Study sent for ${priority === "URGENT" ? "urgent " : ""}teleradiology reporting.`);
      setSendStudy(null);
      setDetailStudy(null);
      setFeedback({ text: "Study sent for reporting.", error: false });
      setIndication("");
      setPriority("REGULAR");
      await Promise.all([reload(), loadWorklistStudies(true)]);
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : "Unable to send study for reporting", error: true });
      notice(error instanceof Error ? error.message : "Unable to send study for reporting");
    } finally {
      setSending(false);
    }
  }

  async function uploadStudyFile(file: File | null) {
    if (!file) return;
    setFeedback(null);
    const modality = uploadModality;
    setUploadingStudy(true);
    try {
      const form = new FormData();
      form.append("study", file);
      const response = await fetch(`/api/client/study-sync/manual-upload/${modality}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.message ?? "Unable to upload study");
      notice("Study uploaded and added to the PACS worklist.");
      setUploadOpen(false);
      setUploadFile(null);
      setFeedback({ text: "Study uploaded and added to the worklist.", error: false });
      await Promise.all([reload(), loadWorklistStudies(true)]);
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : "Unable to upload study", error: true });
      notice(error instanceof Error ? error.message : "Unable to upload study");
    } finally {
      setUploadingStudy(false);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  }

  function displayedStatus(state: string) {
    if (state === "REPORTED") return { label: "Reported", className: "reported" };
    if (state === "REPORTING") return { label: "Reporting", className: "ai-processing" };
    return { label: "Available", className: "available" };
  }

  useEffect(() => {
    const timer = window.setInterval(() => setClockTime(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    document.body.classList.add("pacs-reference-mode");
    return () => document.body.classList.remove("pacs-reference-mode");
  }, []);

  const queueItems = [
    { key: "ALL", label: "All studies", icon: ClipboardList },
    { key: "AVAILABLE", label: "Available", icon: Clock },
    { key: "REPORTING", label: "Reporting", icon: Activity },
    { key: "REPORTED", label: "Reported", icon: CheckCircle2 },
    { key: "URGENT", label: "Urgent", icon: AlertTriangle },
    { key: "FAILED", label: "Needs attention", icon: AlertTriangle },
  ] as const;
  const ordered = useMemo(() => [...filtered].sort((a, b) => {
    const comparison = sort.key === "received"
      ? new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime()
      : sort.key === "processed" ? (Date.parse(a.processedAt ?? "") || 0) - (Date.parse(b.processedAt ?? "") || 0)
      : sort.key === "priority" ? Number(a.priority === "URGENT") - Number(b.priority === "URGENT")
      : (sort.key === "patient" ? a.study.patientName ?? "" : a.study.modalities.join(",")).localeCompare(
        sort.key === "patient" ? b.study.patientName ?? "" : b.study.modalities.join(","));
    if (sort.key === "priority" && !comparison) return (Date.parse(b.receivedAt) - Date.parse(a.receivedAt)) || a.study.id.localeCompare(b.study.id);
    return sort.ascending ? comparison : -comparison;
  }), [filtered, sort]);
  const pageCount = Math.max(1, Math.ceil(ordered.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = ordered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const selectedRows = rows.filter(({ study }) => selectedIds.has(study.id));
  const detailRow = rows.find(({ study }) => study.id === detailStudy?.id);
  // Rows are slim; the drawer loads clinical history, attachments and errors for the open study only.
  const [studyDetail, setStudyDetail] = useState<BridgeStudy | null>(null);
  const [studyDetailError, setStudyDetailError] = useState("");
  const indicationPrefilledFor = useRef("");
  const drawerStudyId = (sendStudy ?? detailStudy)?.id ?? "";
  const drawerRowStudy = drawerStudyId ? rows.find(({ study }) => study.id === drawerStudyId)?.study : undefined;
  const drawerDetailKey = `${drawerStudyId}:${drawerRowStudy?.updatedAt ?? ""}:${drawerRowStudy?.processingJob?.status ?? ""}`;
  const drawerDetailReady = !drawerStudyId || studyDetail?.id === drawerStudyId || Boolean(studyDetailError) || Array.isArray((drawerRowStudy ?? sendStudy ?? detailStudy)?.attachments);
  useEffect(() => {
    if (!drawerStudyId || !["SUPER_ADMIN", "CLIENT_USER"].includes(user.role)) return;
    const controller = new AbortController();
    setStudyDetailError("");
    api<{ study: BridgeStudy }>(`/api/client/study-sync/available-studies/${encodeURIComponent(drawerStudyId)}`, token, { cache: "no-store", signal: controller.signal })
      .then(({ study }) => { if (!controller.signal.aborted) setStudyDetail(study); })
      .catch((error) => { if (!controller.signal.aborted) setStudyDetailError(error instanceof Error ? error.message : "Study details are unavailable."); });
    return () => controller.abort();
  }, [drawerStudyId, drawerDetailKey, token, user.role]);
  useEffect(() => {
    // Prefill the send form's clinical history once per study, when its detail arrives.
    if (!sendStudy || studyDetail?.id !== sendStudy.id || indicationPrefilledFor.current === sendStudy.id) return;
    indicationPrefilledFor.current = sendStudy.id;
    setIndication((current) => current || studyDetail.clinicalIndication || "");
  }, [sendStudy, studyDetail]);
  const hasFilters = Boolean(query || dateFilter !== "ALL" || modalityFilter !== "ALL" || statusFilter !== "ALL" || priorityFilter !== "ALL");
  const initials = user.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase();

  useEffect(() => { setPage(0); }, [query, tab, dateFilter, modalityFilter, statusFilter, priorityFilter, pageSize, sort]);
  useEffect(() => {
    setSelectedIds((previous) => new Set([...previous].filter((id) => worklistStudies.some((study) => study.id === id))));
  }, [worklistStudies]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !sending && !uploadingStudy) {
        if (actionDialog) setActionDialog(null);
        else if (studyMedia) setStudyMedia(null);
        else { setDetailStudy(null); setSendStudy(null); setUploadOpen(false); if (profileOpen) accountButtonRef.current?.focus(); setProfileOpen(false); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sending, uploadingStudy, studyMedia, actionDialog, profileOpen]);

  function toggleStudy(id: string) {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function resetFilters() {
    setQuery(""); setDateFilter("ALL"); setModalityFilter("ALL"); setStatusFilter("ALL"); setPriorityFilter("ALL");
  }
  function changeSort(key: typeof sort.key) {
    setSort((previous) => ({ key, ascending: previous.key === key ? !previous.ascending : key !== "priority" }));
  }

  async function changeStudyPriority(study: BridgeStudy, priority: "URGENT" | "REGULAR") {
    if (!permissions.submit || priorityRequests.current.has(study.id)) return;
    priorityRequests.current.add(study.id);
    setPrioritySaving(new Set(priorityRequests.current));
    setFeedback(null);
    try {
      const result = await api<{ priority: "URGENT" | "REGULAR"; message: string }>(`/api/workspace/studies/${encodeURIComponent(study.id)}/priority`, token, { method: "POST", body: JSON.stringify({ priority }) });
      priorityRevision.current += 1;
      setWorklistStudies(previous => previous.map(item => item.id === study.id ? { ...item, priority: result.priority, processingJob: item.processingJob ? { ...item.processingJob, priority: result.priority } : item.processingJob } : item));
      setFeedback({ text: result.message, error: false });
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : "Unable to update priority. Please try again.", error: true });
    } finally {
      priorityRequests.current.delete(study.id);
      setPrioritySaving(new Set(priorityRequests.current));
    }
  }

  function priorityBadge(study: BridgeStudy, urgent: boolean, reported: boolean, mobile = false) {
    const className = `${mobile ? "pw-mobile-priority" : "pw-priority"} ${urgent ? "urgent" : "routine"}`;
    if (reported || !permissions.submit) return <span className={className} title={reported ? "Reported study priority is read-only" : undefined}>{urgent ? <><AlertTriangle size={12}/>Urgent</> : "Routine"}</span>;
    const nextLabel = urgent ? "Routine" : "Urgent";
    return <button className={className} disabled={prioritySaving.has(study.id)} aria-busy={prioritySaving.has(study.id)} aria-label={`Mark ${study.patientName || study.id} ${nextLabel}`} title={`Mark this study ${nextLabel}`} onDoubleClick={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); void changeStudyPriority(study, urgent ? "REGULAR" : "URGENT"); }}>{prioritySaving.has(study.id) ? <LoaderCircle size={12} className="pw-spinning"/> : urgent ? <><AlertTriangle size={12}/>Urgent</> : "Routine"}</button>;
  }
  function beginSend(study: BridgeStudy) {
    setFeedback(null);
    setSendStudy(study);
    setIndication(study.clinicalIndication ?? "");
    setPriority(worklistPriority(study.priority ?? study.processingJob?.priority ?? jobByStudyId.get(study.id)?.priority));
  }
  function exportSelection() {
    const safeCell = (value: string) => {
      const safe = /^[=+@\-\t\r]/.test(value) ? "'" + value : value;
      return '"' + safe.replaceAll('"', '""') + '"';
    };
    const records = [["Patient name", "Patient ID", "Accession number", "Referring doctor", "Modality", "Study description", "Received (IST)", "Sent for reporting (IST)", "Reported (IST)", "TAT (HH:MM:SS)", "Status"],
      ...selectedRows.map(({ study, state, receivedAt, tatStartAt, processedAt, referringDoctor }) => [
        study.patientName ?? "", study.patientId ?? "", study.accessionNumber ?? "", referringDoctor,
        study.modalities.join(", "), study.studyDescription ?? "", istTimestamp(receivedAt).full,
        istTimestamp(tatStartAt).full, istTimestamp(processedAt).full, worklistDuration(tatStartAt, processedAt, clockTime), displayedStatus(state).label,
      ])];
    const url = URL.createObjectURL(new Blob([records.map((record) => record.map(safeCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = "marengo-selected-studies.csv"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function downloadStudyBundle(study: BridgeStudy) {
    if (studyDownloadInFlight.current) return;
    studyDownloadInFlight.current = true;
    setDownloadingStudyId(study.id);
    setFeedback(null);
    try {
      const response = await fetch(`/api/client/study-sync/available-studies/${encodeURIComponent(study.id)}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const blob = await response.blob();
      if (!response.ok) {
        const text = await blob.text().catch(() => "");
        let message = "Study download is not available";
        try {
          message = JSON.parse(text)?.message || message;
        } catch {
          if (text.trim()) message = text.trim();
        }
        throw new Error(message);
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${study.publicStudyId || study.accessionNumber || study.id}-bundle.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : "Unable to download study. Please try again.", error: true });
    } finally {
      studyDownloadInFlight.current = false;
      setDownloadingStudyId(null);
    }
  }
  async function terminateProcessing(study: BridgeStudy) {
    if (user.role !== "SUPER_ADMIN" || !study.processingJobId || terminatingStudyId) return;
    const reason = window.prompt("Reason for terminating this processing job before repush:", "Super admin terminated processing for repush");
    if (reason === null) return;
    setFeedback(null);
    setTerminatingStudyId(study.id);
    try {
      const result = await api<{ message: string }>(`/api/workspace/studies/${encodeURIComponent(study.id)}/terminate-processing`, token, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      setFeedback({ text: result.message, error: false });
      notice(result.message);
      await Promise.all([loadWorklistStudies(true), reload()]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to terminate processing.";
      setFeedback({ text: message, error: true });
      notice(message);
    } finally {
      setTerminatingStudyId(null);
    }
  }
  const sortIcon = (key: typeof sort.key) => sort.key === key
    ? (sort.ascending ? <ArrowUp size={13} /> : <ArrowDown size={13} />)
    : <ChevronDown size={13} />;
  const closeOverlays = () => {
    if (!sending && !uploadingStudy) { setSendStudy(null); setDetailStudy(null); setUploadOpen(false); setProfileOpen(false); }
  };

  return createPortal(
    <WorkspaceDrawerContext.Provider value={true}>
    <section className={`pacs-workspace${sidebarCollapsed ? " pw-sidebar-collapsed" : ""}`} aria-label="Marengo PACS workstation">
      <header className="pw-header">
        <button className="pw-icon pw-sidebar-toggle" aria-label={sidebarCollapsed ? "Expand sidebar" : "Minimize sidebar"} title={sidebarCollapsed ? "Expand sidebar" : "Minimize sidebar"} aria-expanded={!sidebarCollapsed} aria-controls="pw-workspace-navigation" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>{sidebarCollapsed ? <PanelLeftOpen size={18}/> : <PanelLeftClose size={18}/>}</button>
        <div className="pw-brand"><img src={marengoSmallLogo} alt="" width={36} height={40} /><div><strong>Marengo Asia Hospitals</strong><span>RADIOLOGY WORKSPACE</span></div></div>
        <div className="pw-center"><Building2 size={16} /><span>{client.name}</span></div>
        <div className="pw-header-actions">
          <span className={!online || studyError || workspaceSyncError ? "pw-connection error" : "pw-connection"} title="Automatic updates while this window is active"><i />{!online ? "Offline" : studyError || workspaceSyncError ? "Reconnecting" : !["SUPER_ADMIN", "CLIENT_USER"].includes(user.role) ? "Live updates" : lastSync ? "Connected" : "Connecting"}</span>
          {permissions.upload && <button className="pw-primary" onClick={() => setUploadOpen(true)}><Plus size={16} />Upload study</button>}
          <div className="pw-account-wrap" ref={accountRef} onBlur={(event) => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setProfileOpen(false); }}>
            <button ref={accountButtonRef} className="pw-account" aria-label="Open account" aria-expanded={profileOpen} aria-controls="pw-account-dropdown" aria-haspopup="dialog" title={user.name} onClick={() => setProfileOpen(!profileOpen)}><b>{initials}</b><span>{user.name}<small>{roleLabel}</small></span><ChevronDown size={14} /></button>
            {profileOpen && <section id="pw-account-dropdown" className="pw-account-dropdown" role="dialog" aria-label="Account"><header><h2>Account</h2><button className="pw-icon" aria-label="Close account" onClick={() => { setProfileOpen(false); accountButtonRef.current?.focus(); }}><X size={16}/></button></header><div className="pw-account-body"><WorkspaceAccountDetails client={client} user={user} roleLabel={roleLabel} token={token}/></div><footer><button onClick={() => { localStorage.removeItem(tokenKey); window.location.reload(); }}><LogOut size={15}/>Sign out</button></footer></section>}
          </div>
        </div>
      </header>
      <aside className="pw-sidebar" id="pw-workspace-navigation" aria-label="Workspace navigation">
        <div className="pw-section-label">WORKSPACE</div>
        {worklistSection && <button title="Worklist" aria-label="Worklist" className={activeSection === worklistSection ? "pw-nav active" : "pw-nav"} onClick={() => { onNavigate(worklistSection); setTab("ALL"); resetFilters(); }}><ClipboardList size={17} /><span className="pw-nav-label">Worklist</span><span className="pw-count">{rows.length}</span></button>}
        {reportsSection && <button title="Reports" aria-label="Reports" className={isReports ? "pw-nav active" : "pw-nav"} onClick={() => onNavigate(reportsSection)}><FileText size={17} /><span className="pw-nav-label">Reports</span></button>}
        {availableTabs.filter((item) => !["Report","Reports","Generated reports","Generated Reports","Available studies","Available Studies","Studies","Pushed Studies"].includes(item)).map((item) => <button key={item} title={item} aria-label={item} className={activeSection === item ? "pw-nav active" : "pw-nav"} onClick={() => onNavigate(item)}>{item === "Users" || item.includes("Admin") ? <UserCog size={17}/> : item === "Analytics" ? <BarChart3 size={17}/> : item === "Healthcheck" ? <Activity size={17}/> : item === "Billing" ? <CreditCard size={17}/> : <LayoutDashboard size={17}/>}<span className="pw-nav-label">{item}</span></button>)}
        <div className="pw-sidebar-bottom"><ShieldCheck size={17} /><div><strong>Marengo PACS</strong><span>Powered by Dectrocel</span></div></div>
      </aside>
      <div className="pw-content">
        {!online && <div className="pw-alert" role="alert">You are offline. Showing the last received data; updates will resume when connected.</div>}
        {workspaceNotice && <div className="pw-alert success" role="status">{workspaceNotice}</div>}
        {workspaceSyncError && <div className="pw-alert" role="alert"><RefreshCw size={15}/><span>Automatic updates interrupted. Retrying; previously loaded data is still shown.</span></div>}
        {isReports ? manageReports ? <><div className="pw-heading"><h1>Report management</h1><button onClick={() => setManageReports(false)}><ChevronLeft size={16}/>Report library</button></div><div className="pw-legacy">{sectionContent}</div></> : <WorkspaceReports reports={reports} token={token} permissions={permissions} onPreview={(report) => setStudyMedia({ kind: "report", report, title: "Radiology report" })} onAction={setActionDialog} onManage={user.role !== "CLIENT_USER" ? () => setManageReports(true) : undefined}/>
          : isUsers && user.role === "CLIENT_USER" && permissions.manageUsers ? <WorkspaceUsers client={client} token={token} reload={reload} canManage={permissions.manageUsers}/>
          : activeSection === "Analytics" && permissions.analytics ? <WorkspaceStatistics key="analytics" token={token} mode="analytics"/>
          : activeSection === "Billing" && permissions.billing ? <WorkspaceBilling token={token} adminContent={user.role === "SUPER_ADMIN" ? sectionContent : undefined}/>
          : activeSection === "Healthcheck" && permissions.healthcheck ? <WorkspaceHealthcheck token={token}/>
          : activeSection === "Technical Alerts" && user.role === "SUPER_ADMIN" ? <TechnicalAlerts token={token}/>
          : user.role === "SUPER_ADMIN" && activeSection === "Dashboard" ? <AdminConsole token={token} onNavigate={onNavigate}/>
          : user.role === "SUPER_ADMIN" && activeSection === "Audit Logs" ? <AdminEvidence token={token}/>
          : !isWorklist ? <><div className="pw-heading"><h1>{activeSection}</h1></div><div className="pw-legacy">{sectionContent}</div></>
          : <>
        <div className="pw-heading">
          <div><span className="pw-breadcrumb">Radiology / Worklist</span><h1>{queueItems.find((item) => item.key === tab)?.label}<span>{filtered.length}</span></h1></div>
          <button className="pw-refresh" disabled={studyLoading} onClick={() => void loadWorklistStudies()}><RefreshCw size={15} className={studyLoading ? "pw-spinning" : ""} />{studyLoading ? "Refreshing" : "Refresh"}</button>
        </div>
        <nav className="pw-queues pw-worklist-queues" aria-label="Study queues">
          {queueItems.map(({ key, label, icon: Icon }) => <button key={key} className={tab === key ? "active" : ""} aria-pressed={tab === key} onClick={() => { setTab(key); setStatusFilter("ALL"); setPriorityFilter("ALL"); }}><Icon size={15}/><span>{label}</span><b className={(key === "FAILED" || key === "URGENT") && counts[key] ? "pw-error-count" : ""}>{counts[key]}</b></button>)}
        </nav>
        <div className="pw-modality-strip">
          <nav aria-label="Modality queues"><button className={modalityFilter === "ALL" ? "active" : ""} aria-pressed={modalityFilter === "ALL"} onClick={() => setModalityFilter("ALL")}>All modalities<b>{receivedCount}</b></button>{modalityOptions.map(code => <button key={code} className={modalityFilter === code ? "active" : ""} aria-pressed={modalityFilter === code} onClick={() => setModalityFilter(code)}>{worklistModalityLabel(code)}<b>{modalityCounts[code] ?? 0}</b></button>)}</nav>
          <span className="pw-received-scope">{dateFilter === "TODAY" ? "Received today" : dateFilter === "WEEK" ? "Received last 7 days" : "All received dates"} / IST</span>
        </div>
        <div className="pw-toolbar">
          <label className="pw-search"><Search size={17} /><input aria-label="Search studies" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search patient, ID, accession, doctor..." />{query && <button title="Clear search" aria-label="Clear search" onClick={() => setQuery("")}><X size={14} /></button>}</label>
          <label className="pw-filter"><CalendarDays size={15} /><select aria-label="Date range" value={dateFilter} onChange={(event) => setDateFilter(event.target.value as typeof dateFilter)}><option value="ALL">All dates</option><option value="TODAY">Today</option><option value="WEEK">Last 7 days</option></select><ChevronDown size={13} /></label>
          <label className="pw-filter"><Network size={15} /><select aria-label="Modality" value={modalityFilter} onChange={(event) => setModalityFilter(event.target.value)}><option value="ALL">All modalities</option>{modalityOptions.map((modality) => <option value={modality} key={modality}>{worklistModalityLabel(modality)}</option>)}</select><ChevronDown size={13} /></label>
          <label className="pw-filter"><Filter size={15} /><select aria-label="Status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>{queueItems.filter(({key}) => key !== "FAILED" && key !== "URGENT").map(({key, label}) => <option key={key} value={key}>{key === "ALL" ? "All statuses" : label}</option>)}</select><ChevronDown size={13} /></label>
          <label className="pw-filter"><AlertTriangle size={15}/><select aria-label="Priority" value={priorityFilter} onChange={event => setPriorityFilter(event.target.value as typeof priorityFilter)}><option value="ALL">All priorities</option><option value="REGULAR">Routine</option><option value="URGENT">Urgent</option></select><ChevronDown size={13}/></label>
          <label className="pw-filter pw-mobile-sort"><select aria-label="Sort studies" value={`${sort.key}:${sort.ascending ? "asc" : "desc"}`} onChange={event => { const [key, direction] = event.target.value.split(":"); setSort({ key: key as typeof sort.key, ascending: direction === "asc" }); }}><option value="received:desc">Newest received</option><option value="received:asc">Oldest received</option><option value="priority:desc">Urgent first</option><option value="priority:asc">Routine first</option><option value="patient:asc">Patient A-Z</option><option value="patient:desc">Patient Z-A</option><option value="modality:asc">Modality A-Z</option><option value="modality:desc">Modality Z-A</option><option value="processed:desc">Latest processed</option><option value="processed:asc">Earliest processed</option></select><ChevronDown size={13}/></label>
          {hasFilters && <button className="pw-text-button" onClick={resetFilters}>Clear filters</button>}
        </div>
        {studyError && <div role="alert" className="pw-alert"><AlertTriangle size={16} /><span>Worklist refresh failed. {studyError}</span><button onClick={() => void loadWorklistStudies()}>Try again</button></div>}
        {feedback && !sendStudy && !uploadOpen && <div role="status" className={feedback.error ? "pw-alert" : "pw-alert success"}><span>{feedback.text}</span><button aria-label="Dismiss message" onClick={() => setFeedback(null)}><X size={14}/></button></div>}
        {selectedRows.length > 0 && <div className="pw-selection"><strong>{selectedRows.length} selected</strong><button onClick={exportSelection}><Download size={14} />Export CSV</button><button className="pw-icon" aria-label="Clear selection" title="Clear selection" onClick={() => setSelectedIds(new Set())}><X size={15} /></button></div>}
        <div className="pw-table-scroll" aria-label="Study list" aria-busy={studyLoading}>
          <table className="pw-table">
            <colgroup><col style={{width:34}}/><col style={{width:90}}/><col style={{width:150}}/><col style={{width:100}}/><col style={{width:118}}/><col style={{width:140}}/><col style={{width:82}}/><col/><col style={{width:124}}/><col style={{width:124}}/><col style={{width:94}}/><col style={{width:130}}/><col style={{width:108}}/></colgroup>
            <thead><tr>
              <th><input type="checkbox" aria-label="Select all visible studies" checked={visible.length > 0 && visible.every(({study}) => selectedIds.has(study.id))} ref={(node) => { if (node) node.indeterminate = visible.some(({study}) => selectedIds.has(study.id)) && !visible.every(({study}) => selectedIds.has(study.id)); }} onChange={(event) => setSelectedIds((previous) => { const next = new Set(previous); visible.forEach(({study}) => event.target.checked ? next.add(study.id) : next.delete(study.id)); return next; })} /></th>
              <th aria-sort={sort.key === "priority" ? sort.ascending ? "ascending" : "descending" : "none"}><button title={sort.key === "priority" && !sort.ascending ? "Sort routine first" : "Sort urgent first"} onClick={() => changeSort("priority")}>Priority{sortIcon("priority")}</button></th>
              <th aria-sort={sort.key === "patient" ? sort.ascending ? "ascending" : "descending" : "none"}><button onClick={() => changeSort("patient")}>Patient name{sortIcon("patient")}</button></th>
              <th>Patient ID</th><th>Accession number</th><th>Referring doctor</th>
              <th aria-sort={sort.key === "modality" ? sort.ascending ? "ascending" : "descending" : "none"}><button onClick={() => changeSort("modality")}>Modality{sortIcon("modality")}</button></th>
              <th>Study description</th>
              <th aria-sort={sort.key === "received" ? sort.ascending ? "ascending" : "descending" : "none"}><button onClick={() => changeSort("received")}>Received <small>IST</small>{sortIcon("received")}</button></th>
              <th aria-sort={sort.key === "processed" ? sort.ascending ? "ascending" : "descending" : "none"}><button onClick={() => changeSort("processed")}>Reported <small>IST</small>{sortIcon("processed")}</button></th>
              <th>TAT</th><th>Status</th><th>Action</th>
            </tr></thead>
            <tbody>{visible.map(({ study, state, receivedAt, tatStartAt, processedAt, referringDoctor, needsAttention, priority }) => {
              const status = displayedStatus(state);
              const urgent = priority === "URGENT";
              return <tr key={study.id} data-study-id={study.id} className={selectedIds.has(study.id) ? "selected" : ""} onDoubleClick={() => setDetailStudy(study)}>
                <td><input type="checkbox" aria-label={`Select ${study.patientName || study.id}`} checked={selectedIds.has(study.id)} onChange={() => toggleStudy(study.id)} /></td>
                <td>{priorityBadge(study, urgent, state === "REPORTED")}</td>
                <td><button className="pw-patient" onClick={() => setDetailStudy(study)} title={study.patientName ?? "Unknown patient"}>{study.patientName || "Unknown patient"}</button><span className="pw-mobile-study">{priorityBadge(study, urgent, state === "REPORTED", true)} / {study.modalities.join(", ")} / {study.studyDescription || "Imaging study"}</span></td>
                <td className="pw-numeric">{study.patientId || "-"}</td>
                <td className="pw-numeric">{study.accessionNumber || "-"}</td>
                <td title={referringDoctor}>{referringDoctor || "-"}</td>
                <td><span className="pw-modality">{study.modalities?.includes("MG") ? "Mammogram" : study.modalities?.join(", ") || "-"}</span></td>
                <td title={study.studyDescription ?? ""}><span className="pw-description">{study.studyDescription || "Imaging study"}</span>{isSpecialXrayStudy(study) && <span className="pw-modality" title="Requires manual submission; automatic processing is disabled">Special X-ray</span>}</td>
                <td className="pw-received" title={istTimestamp(receivedAt).full}>{istTimestamp(receivedAt).date}<span>{istTimestamp(receivedAt).time}</span></td>
                <td className="pw-received" title={istTimestamp(processedAt).full}>{istTimestamp(processedAt).date}<span>{istTimestamp(processedAt).time}</span></td>
                <td className="pw-numeric pw-tat" title="Duration (HH:MM:SS)">{worklistDuration(tatStartAt, processedAt, clockTime)}</td>
                <td><span className={`pw-status ${status.className}`}><i/>{status.label}</span>{needsAttention && <AlertTriangle className="pw-workflow-warning" size={13} aria-label="Workflow needs attention" />}</td>
                <td><button className="pw-row-action send" onClick={() => { setFeedback(null); setDetailStudy(study); }}>Send<ArrowUpRight size={15} aria-hidden="true"/></button></td>
              </tr>;
            })}</tbody>
          </table>
          {!visible.length && <div className="pw-empty">{studyLoading ? <LoaderCircle className="pw-spinning" size={28}/> : <Search size={28}/>}<h2>{studyLoading ? "Loading studies" : hasFilters ? "No matching studies" : "No studies in this queue"}</h2>{hasFilters && <button onClick={resetFilters}>Clear filters</button>}</div>}
        </div>
        <footer className="pw-footer">
          <span className="pw-results">{ordered.length ? currentPage * pageSize + 1 : 0}-{Math.min((currentPage + 1) * pageSize, ordered.length)} of {ordered.length} studies{studyLoading && !lastSync ? " (loading more...)" : ""}</span>
          <span className="pw-sync">{studyError ? "Refresh interrupted" : lastSync ? `Updated ${istTimestamp(lastSync.toISOString()).time + " IST"}` : "Awaiting sync"}</span>
          <div className="pw-pagination"><label>Rows<select aria-label="Rows per page" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>{[10,25,50,100].map((size) => <option key={size}>{size}</option>)}</select></label><button title="Previous page" aria-label="Previous page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16}/></button><span>{currentPage + 1} / {pageCount}</span><button title="Next page" aria-label="Next page" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16}/></button></div>
        </footer>
        </>}
      </div>
      {(detailStudy || sendStudy || uploadOpen) && <div className="pw-overlay" onMouseDown={(event) => { if (event.currentTarget === event.target) closeOverlays(); }}>
        <section className="pw-drawer" role="dialog" aria-modal="true" aria-label={sendStudy ? "Send for teleradiology" : uploadOpen ? "Upload study" : "Study details"} ref={(node) => { if (node && !studyMedia && !actionDialog && !node.contains(document.activeElement)) node.focus(); }} tabIndex={-1} onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'));
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }}>
          <div className="pw-drawer-header"><h2>{sendStudy ? "Send for teleradiology" : uploadOpen ? "Upload study" : "Study details"}</h2><button className="pw-icon" title="Close" aria-label="Close dialog" disabled={sending || uploadingStudy} onClick={closeOverlays}><X size={18}/></button></div>
          <div className="pw-drawer-body">
            {feedback?.error && <div className="pw-alert" role="alert">{feedback.text}</div>}
            {uploadOpen ? <>
              <label className="pw-field">Modality<select value={uploadModality} onChange={(event) => setUploadModality(event.target.value)} disabled={uploadingStudy}><option value="XRAY">X-ray</option><option value="CT">CT</option><option value="MRI">MRI</option></select></label>
              <label className="pw-upload-zone"><UploadCloud size={32}/><strong>{uploadFile?.name ?? "Choose study file"}</strong><span>{uploadFile ? `${(uploadFile.size / 1024 / 1024).toFixed(1)} MB` : "DICOM, ZIP, JPG or PNG"}</span><input ref={uploadInputRef} aria-label="Study file" accept=".zip,.dcm,.dicom,.jpg,.jpeg,.png" type="file" disabled={uploadingStudy} onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}/></label>
            </> : (() => {
              const currentStudy = rows.find((row) => row.study.id === (sendStudy ?? detailStudy)?.id)?.study;
              if (!currentStudy && lastSync && !studyError) return <div className="pw-empty" role="status">This study is no longer available in your worklist.</div>;
              const baseStudy = currentStudy ?? sendStudy ?? detailStudy!;
              const detail = studyDetail?.id === baseStudy.id ? studyDetail : null;
              // Row fields are the freshest; the detail fills in what slim rows leave out.
              const study: BridgeStudy = detail ? { ...detail, ...baseStudy } : baseStudy;
              const detailReady = Boolean(detail) || Array.isArray(baseStudy.attachments);
              const attachments = study.attachments ?? [];
              const pending = studyDetailError || "Loading...";
              return <><div className="pw-detail-patient"><span className="pw-modality">{study.modalities.join(", ")}</span><h3>{study.patientName || "Unknown patient"}</h3><p>{study.patientAge || (detailReady ? "Age unavailable" : pending)} / {study.patientSex || "-"}<span>Patient ID {study.patientId || "-"}</span></p></div>
                <dl className="pw-details"><dt>Accession number</dt><dd>{study.accessionNumber || "-"}</dd><dt>Referring doctor</dt><dd>{detailRow?.referringDoctor || study.referringPhysician || "-"}</dd><dt>Study</dt><dd>{study.studyDescription || "-"}</dd><dt>Received (IST)</dt><dd>{istTimestamp(detailRow?.receivedAt ?? study.receivedAt ?? study.lastSyncedAt).full}</dd><dt>Sent for reporting (IST)</dt><dd>{istTimestamp(detailRow?.tatStartAt).full}</dd><dt>Reported (IST)</dt><dd>{istTimestamp(detailRow?.processedAt).full}</dd><dt>TAT duration</dt><dd>{worklistDuration(detailRow?.tatStartAt, detailRow?.processedAt, clockTime)}</dd><dt>Series / images</dt><dd>{detailReady ? `${study.seriesCount} / ${study.instanceCount}` : pending}</dd><dt>Study UID</dt><dd>{study.studyInstanceUid}</dd></dl>
                {!sendStudy && <div className="pw-study-tools" aria-label="Study actions">
                  <div className="pw-study-tool-row">
                    {permissions.attach && <button onClick={() => setActionDialog({ kind: "attach", study })}><Plus size={14}/>Supporting investigation</button>}
                    <button className="pw-primary" disabled={!permissions.submit || detailRow?.state !== "AVAILABLE" || Boolean(study.processingJobId)} title={detailRow?.state !== "AVAILABLE" ? "Study has already entered reporting" : "Send study for reporting"} onClick={() => beginSend(study)}><Send size={14}/>Send for reporting</button>
                    {user.role === "SUPER_ADMIN" && detailRow?.state === "REPORTING" && study.processingJobId && <button className="pw-danger" disabled={terminatingStudyId === study.id} title="Cancel this processing job and make the study available to send again" onClick={() => void terminateProcessing(study)}><X size={14}/>{terminatingStudyId === study.id ? "Terminating..." : "Terminate processing"}</button>}
                  </div>
                  <div className="pw-study-tool-row">
                    <button onClick={() => setStudyMedia({ kind: "dicom", studyId: study.id, title: study.studyDescription || "DICOM study" })}><Eye size={14}/>DICOM viewer</button>
                    <button disabled={!detailRow?.report || !["APPROVED","PUSHED"].includes(detailRow.report.status)} title={detailRow?.state === "REPORTED" ? "View final report" : "Report is not available yet"} onClick={() => { if (detailRow?.report) setStudyMedia({ kind: "report", report: detailRow.report, title: "Radiology report" }); }}><FileText size={14}/>Report</button>
                  </div>
                  <div className="pw-study-tool-row">
                    <button disabled={Boolean(downloadingStudyId)} onClick={() => void downloadStudyBundle(study)}>{downloadingStudyId === study.id ? <LoaderCircle className="pw-spinning" size={14}/> : <Download size={14}/>} {downloadingStudyId === study.id ? "Downloading study..." : "Download study"}</button>
                    {permissions.share && <button disabled={!detailRow?.report || !["APPROVED","PUSHED"].includes(detailRow.report.status)} title={!detailRow?.report ? "A report is required to share this case" : "Share report"} onClick={() => { if (detailRow?.report) setActionDialog({ kind: "share", report: detailRow.report }); }}><Share2 size={14}/>Share</button>}
                    {permissions.schedule && <button disabled={!detailRow?.report} title={!detailRow?.report ? "Call scheduling becomes available when the case has a report" : "Schedule a radiologist call"} onClick={() => { if (detailRow?.report) setActionDialog({ kind: "call", report: detailRow.report }); }}><Phone size={14}/>Schedule the call</button>}
                  </div>
                </div>}
                <div className="pw-attachment-heading"><h4>Attachments</h4><span>{detailReady ? attachments.length : study.attachmentCount ?? 0}</span></div>
                <ul className="pw-attachments">{attachments.map((file) => <li key={file.id}><FileText size={16}/><div><strong title={file.originalName}>{file.originalName}</strong><small>{Math.max(1, Math.ceil(Number(file.sizeBytes) / 1024))} KB</small></div><button aria-label={`View ${file.originalName}`} onClick={() => setStudyMedia({ kind: "attachment", studyId: study.id, attachment: file, title: file.originalName })}><Eye size={13}/>View</button></li>)}</ul>
                {!attachments.length && <p className="pw-history">{detailReady ? "No attachments" : pending}</p>}
                {sendStudy ? <><fieldset className="pw-priority-field"><legend>Priority</legend><label><input type="radio" name="priority" disabled={sending} checked={priority === "REGULAR"} onChange={() => setPriority("REGULAR")}/>Routine</label><label><input type="radio" name="priority" disabled={sending} checked={priority === "URGENT"} onChange={() => setPriority("URGENT")}/>Urgent</label></fieldset><label className="pw-field">Clinical history<textarea aria-label="Clinical history" disabled={sending} value={indication} onChange={(event) => setIndication(event.target.value)} rows={5} /></label><label className="pw-field">Reporting partner<div className="pw-partner"><ShieldCheck size={16}/>Dectrocel Teleradiology</div></label></> : <><h4>Clinical history</h4><p className="pw-history">{detailReady ? study.clinicalIndication || "Not supplied" : pending}</p><h4>Workflow</h4><p className="pw-history">{study.workflowStatus?.replaceAll("_", " ") || "Available"}</p>{(detail?.processingJob?.error || detailRow?.job?.error || study.latestDispatch?.lastErrorMessage) && <div className="pw-alert">{detail?.processingJob?.error || detailRow?.job?.error || study.latestDispatch?.lastErrorMessage}</div>}{detailRow?.needsAttention && <p className="pw-history">Review the failure with your PACS administrator before resubmitting.</p>}</>}
              </>;
            })()}
          </div>
          <div className="pw-drawer-footer"><button onClick={closeOverlays} disabled={sending || uploadingStudy}>Close</button>{uploadOpen ? <button className="pw-primary" disabled={!uploadFile || uploadingStudy} onClick={() => void uploadStudyFile(uploadFile)}><UploadCloud size={15}/>{uploadingStudy ? "Uploading..." : "Upload study"}</button> : sendStudy ? <button className="pw-primary" disabled={sending || !drawerDetailReady} title={drawerDetailReady ? undefined : "Loading study details..."} onClick={() => void submitForReporting()}><Send size={15}/>{sending ? "Sending..." : "Send for reporting"}</button> : null}</div>
        </section>
      </div>}
      {actionDialog && <WorkspaceActionDialog action={actionDialog} token={token} onClose={() => setActionDialog(null)} onSaved={async () => { await loadWorklistStudies(true); await reload(); }}/>}
      {studyMedia && <WorklistMediaPreview media={studyMedia.kind === "report" ? { ...studyMedia, report: reports.find((report) => report.id === studyMedia.report.id) ?? studyMedia.report } : studyMedia} token={token} onClose={() => setStudyMedia(null)} />}
    </section></WorkspaceDrawerContext.Provider>, document.body
  );
}



function WorklistMediaPreview({ media, token, onClose }: { media: WorklistMedia; token: string; onClose: () => void }) {
  const [error, setError] = useState("");
  const [file, setFile] = useState<{ url: string; type: string; data: ArrayBuffer; text?: string } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    const controller = new AbortController();
    setError(""); setFile(null);
    if (media.kind !== "attachment") return;
    async function load() {
      try {
        if (media.kind === "attachment") {
          const response = await fetch(`/api/client/study-sync/available-studies/${encodeURIComponent(media.studyId)}/attachments/${encodeURIComponent(media.attachment.id)}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
          if (!response.ok) {
            const body = await response.json().catch(() => null);
            throw new Error(body?.message || "Attachment could not be opened");
          }
          const type = response.headers.get("Content-Type")?.split(";")[0] || "application/octet-stream";
          const data = await response.arrayBuffer();
          if (cancelled) return;
          objectUrl = URL.createObjectURL(new Blob([data], { type }));
          setFile({ url: objectUrl, type, data, ...(type === "text/plain" ? { text: new TextDecoder().decode(data) } : {}) });
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Unable to open preview");
      }
    }
    void load();
    return () => { cancelled = true; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [media, token]);
  return <div className="pw-overlay pw-media-overlay">
    <div className="pw-media" role="dialog" aria-modal="true" aria-label={media.kind === "dicom" ? "DICOM viewer" : media.kind === "report" ? "Report preview" : "Attachment preview"} ref={panelRef} tabIndex={-1} onKeyDown={(event) => {
      if (event.key !== "Tab") return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], iframe, [tabindex="0"]'));
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <header><h2>{media.title}</h2>{file && <a href={file.url} download={media.title}><Download size={15}/>Download</a>}<button aria-label="Close preview" onClick={onClose}><X size={17}/>Close</button></header>
      <div className="pw-media-body">
        {error ? <div className="pw-empty" role="alert"><AlertTriangle size={24}/><p>{error}</p></div>
          : media.kind === "report" ? <ReportDocumentPreview report={media.report} token={token}/>
          : media.kind === "dicom" ? <ExternalViewerPane endpoint={`/api/client/study-sync/available-studies/${encodeURIComponent(media.studyId)}/viewer-session`} token={token}/>
          : file ? file.type === "application/pdf" ? <ResponsivePdfDocument data={file.data} title={media.title}/>
            : ["image/png", "image/jpeg", "image/webp"].includes(file.type) ? <img src={file.url} alt={media.title}/>
            : file.type === "text/plain" ? <pre>{file.text}</pre>
            : <div className="pw-empty"><FileText size={24}/><p>Preview is not available for this file type.</p><a href={file.url} download={media.title}>Download attachment</a></div>
          : <div className="pw-empty"><LoaderCircle size={24} className="pw-spinning"/><p>Loading attachment...</p></div>}
      </div>
    </div>
  </div>;
}

function ProviderContent({
  active,
  dashboard,
  token,
  reload,
  notice,
  user,
}: {
  active: string;
  dashboard: ProviderDashboard;
  token: string;
  reload: () => Promise<void>;
  notice: (message: string) => void;
  user: User;
}) {
  if (active === "Processing Notifications") return <NotificationCenterView token={token} category="STUDY_STATUS" />;
  if (active === "Notification History") return <NotificationCenterView token={token} />;
  if (active === "Call Requests") return <CallRequestsView token={token} notice={notice} />;
  if (active === "AI Report Feedback") return <FeedbackDashboard token={token} notice={notice} />;
  if (active === "Analytics") return <ManagementAnalyticsView token={token} section="reporting" />;
  if (active === "WhatsApp Whitelist") return <WhatsAppBotView token={token} notice={notice} />;
  if (active === "Radiologist Feedback")
    return <FeedbackDashboard token={token} notice={notice} />;
  if (active === "Managers")
    return user.role === "PROVIDER_ADMIN" ? (
      <ProviderManagersView
        token={token}
        dashboard={dashboard}
        reload={reload}
        notice={notice}
      />
    ) : (
      <EmptyState message="Manager creation is available only to Renewist sub-admin." />
    );
  if (active === "Radiologists")
    return (
      <ProviderRadiologistsView
        token={token}
        dashboard={dashboard}
        reload={reload}
        notice={notice}
      />
    );
  if (active === "Calls")
    return (
      <ProviderCallsView
        token={token}
        dashboard={dashboard}
        reload={reload}
        notice={notice}
      />
    );
  if (active === "Pushed Studies")
    return (
      <RenewistStudiesView
        studies={dashboard.studies}
        token={token}
        notice={notice}
      />
    );
  if (active === "Reports") {
    return (
      <div className="space-y-5">
        <SimpleTable
          title="Reports submitted"
          columns={[
            "Portal job",
            "Renewist job",
            "Status",
            "Type",
            "Format",
            "Submitted",
          ]}
          rows={dashboard.reports.map((item) => [
            item.dectrocelJobId,
            item.renewistJobId,
            item.reportStatus,
            item.reportType,
            item.reportFormat,
            toDate(item.receivedAt),
          ])}
        />
        <ReportReviewsTable
          reports={dashboard.reportReviews ?? []}
          token={token}
          canViewInternalReports
        />
      </div>
    );
  }
  if (active === "Activity")
    return (
      <AuditLogsView
        title="Renewist study activity"
        logs={dashboard.portalLogs ?? []}
      />
    );
  if (active === "Usage") {
    return (
      <SimpleTable
        title="Renewist usage and payable"
        columns={[
          "Service",
          "Workflow",
          "Priority",
          "Units",
          "Payable",
          "Status",
        ]}
        rows={dashboard.usage.map((item) => [
          item.serviceName,
          providerWorkflowLabels[item.workflowType] ?? "Teleradiology",
          item.priority,
          item.units,
          billingAmountLabel(item.amountMinor, item.currency, item.metadata),
          item.status,
        ])}
      />
    );
  }
  if (active === "Client Bills") {
    return (
      <div className="space-y-5">
        <SimpleTable
          title="Client invoices"
          columns={["Client", "Invoice", "Status", "Period", "Total"]}
          rows={(dashboard.clientInvoices ?? []).map((item) => [
            brandText(item.client?.name ?? item.clientId ?? "-"),
            item.invoiceNumber,
            item.status,
            `${toDate(item.periodStart)} - ${toDate(item.periodEnd)}`,
            moneyMinor(item.totalMinor, item.currency),
          ])}
        />
        <SimpleTable
          title="Teleradiology client transactions"
          columns={[
            "Client",
            "Service",
            "Workflow",
            "Units",
            "Amount",
            "Invoice",
          ]}
          rows={(dashboard.clientTransactions ?? []).map((item) => [
            brandText(item.client?.name ?? item.clientId ?? "-"),
            item.serviceName,
            item.workflowType,
            item.units,
            billingAmountLabel(item.amountMinor, item.currency, item.metadata),
            item.invoice?.invoiceNumber ?? item.status,
          ])}
        />
      </div>
    );
  }
  if (active === "Settlements") {
    return (
      <SimpleTable
        title="Monthly settlements"
        columns={["Settlement", "Period", "Status", "Amount"]}
        rows={dashboard.settlements.map((item) => [
          item.settlementNumber,
          `${toDate(item.periodStart)} - ${toDate(item.periodEnd)}`,
          item.status,
          moneyMinor(item.subtotalMinor, item.currency),
        ])}
      />
    );
  }
  if (active === "Disputes") {
    return (
      <SimpleTable
        title="Provider disputes"
        columns={["Type", "Status", "Reason", "Created"]}
        rows={dashboard.disputes.map((item) => [
          item.type,
          item.status,
          item.reason,
          toDate(item.createdAt),
        ])}
      />
    );
  }
  if (active === "Support")
    return <SupportCenterView token={token} role="provider" notice={notice} />;
  if (active === "WhatsApp Bot")
    return <WhatsAppBotView token={token} notice={notice} />;
  if (active === "Portal Logs") {
    return (
      <AuditLogsView
        title="Renewist teleradiology logs"
        logs={dashboard.portalLogs ?? []}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={ClipboardList}
          label="Studies pushed"
          value={String(dashboard.summary.assignedStudies)}
          sub="Renewist worklist"
        />
        <MetricCard
          icon={Download}
          label="Packages ready"
          value={String(
            dashboard.studies.filter((study) => Boolean(study.bundleStudyId))
              .length,
          )}
          sub="Archive, files, and indication"
        />
        <MetricCard
          icon={FileText}
          label="Reports returned"
          value={String(dashboard.summary.reportsSubmitted)}
          sub="Provider callbacks"
        />
        <MetricCard
          icon={Clock}
          label="Active studies"
          value={String(
            dashboard.studies.filter(
              (study) =>
                !["REPORT_DELIVERED", "PUSHED", "COMPLETED"].includes(
                  study.status.toUpperCase(),
                ),
            ).length,
          )}
          sub="In provider workflow"
        />
      </div>
      <SimpleTable
        title="Recent assigned studies"
        columns={["Portal job", "Renewist job", "Status", "Updated"]}
        rows={dashboard.studies
          .slice(0, 10)
          .map((item) => [
            item.dectrocelJobId,
            item.providerJobId ?? "-",
            item.status,
            toDate(item.updatedAt),
          ])}
      />
      <SimpleTable
        title="Recent API logs"
        columns={["Request ID", "Endpoint", "Status", "Response", "Created"]}
        rows={dashboard.apiLogs
          .slice(0, 10)
          .map((item) => [
            item.requestId,
            item.endpoint,
            item.status,
            item.responseCode ?? "-",
            toDate(item.createdAt),
          ])}
      />
    </div>
  );
}

function RenewistStudiesView({
  studies,
  token,
  notice,
}: {
  studies: ProviderDashboard["studies"];
  token: string;
  notice: (message: string) => void;
}) {
  const [selected, setSelected] = useState<
    ProviderDashboard["studies"][number] | null
  >(null);
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = studies.filter(
    (study) =>
      !normalizedQuery ||
      searchableText([
        study.dectrocelJobId,
        study.providerJobId,
        study.patientName,
        study.patientId,
        study.accessionNumber,
        study.studyDescription,
        study.modalities,
        study.client?.name,
        study.client?.code,
        study.processingStatus,
      ]).includes(normalizedQuery),
  );
  async function download(study: ProviderDashboard["studies"][number]) {
    if (!study.bundleStudyId) {
      notice(
        "The complete study package is not available for this routed study.",
      );
      return;
    }
    try {
      await downloadProtectedFile(
        `/api/provider/studies/${study.bundleStudyId}/download`,
        token,
      );
    } catch (error) {
      notice(
        error instanceof Error
          ? error.message
          : "Unable to download the study package.",
      );
    }
  }
  const asBridgeStudy = (
    study: ProviderDashboard["studies"][number],
  ): BridgeStudy => ({
    id: study.bundleStudyId ?? study.id,
    publicStudyId: study.dectrocelJobId,
    agentId: "",
    studyInstanceUid: "",
    patientName: study.patientName,
    patientId: study.patientId,
    accessionNumber: study.accessionNumber,
    studyDescription: study.studyDescription,
    modalities: study.modalities ?? [],
    seriesCount: 0,
    instanceCount: study.imageCount ?? 0,
    archiveName: study.archiveName,
    clinicalIndication: study.clinicalIndication,
    priority: study.priority,
    status: study.processingStatus,
    availabilityStatus: study.status,
    workflowStatus: study.status,
    lastSyncedAt: study.updatedAt,
    submittedAt: study.pushedAt,
    attachments: study.attachments,
    client: study.client,
  });
  return (
    <div className="space-y-5">
      <div className="dashboard-metrics">
        <MetricCard
          icon={Send}
          label="Studies pushed"
          value={String(studies.length)}
          sub="Renewist worklist"
        />
        <MetricCard
          icon={Clock}
          label="Active"
          value={String(
            studies.filter(
              (study) =>
                !["REPORT_DELIVERED", "PUSHED", "completed"].includes(
                  study.status,
                ),
            ).length,
          )}
          sub="Awaiting completion"
        />
        <MetricCard
          icon={FileText}
          label="Clinical indications"
          value={String(
            studies.filter((study) => Boolean(study.clinicalIndication?.trim()))
              .length,
          )}
          sub="Included as text"
        />
        <MetricCard
          icon={Download}
          label="Packages ready"
          value={String(
            studies.filter((study) => Boolean(study.bundleStudyId)).length,
          )}
          sub="Archive and attachments"
        />
      </div>
      <section className="soft-card rounded-lg p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              Pushed study register
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Only studies explicitly routed to Renewist are shown.
            </p>
          </div>
          <label className="portal-global-search">
            <Search size={15} />
            <input
              placeholder="Search patient, accession, center…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
        <div className="table-scroll">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                {[
                  "Center",
                  "Patient",
                  "Study",
                  "Status",
                  "Pushed",
                  "Action",
                ].map((column) => (
                  <th className="py-3 pr-4" key={column}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((study) => (
                <tr
                  className="border-b border-slate-100 align-top"
                  key={study.id}
                >
                  <td className="py-4 pr-4 text-slate-700">
                    {brandText(study.client?.name ?? "-")}
                  </td>
                  <td className="py-4 pr-4">
                    <b>{study.patientName ?? "-"}</b>
                    <div className="text-xs text-slate-500">
                      {study.patientId ?? study.accessionNumber ?? "-"}
                    </div>
                  </td>
                  <td className="py-4 pr-4 text-slate-700">
                    {study.studyDescription ?? study.dectrocelJobId}
                    <div className="text-xs text-slate-500">
                      {study.modalities?.join(", ") || "-"}
                    </div>
                  </td>
                  <td className="py-4 pr-4">
                    <StatusBadge
                      status={study.processingStatus ?? study.status}
                    />
                  </td>
                  <td className="py-4 pr-4 text-slate-700">
                    {toDate(study.pushedAt ?? study.updatedAt)}
                  </td>
                  <td className="py-4 pr-4">
                    <button
                      className="table-view-button"
                      onClick={() => setSelected(study)}
                      type="button"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
              {!filtered.length ? (
                <tr>
                  <td
                    className="py-8 text-center text-sm font-semibold text-slate-500"
                    colSpan={6}
                  >
                    No pushed studies match this view.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
      {selected ? (
        <StudyDetailsModal
          study={asBridgeStudy(selected)}
          onClose={() => setSelected(null)}
          onDownload={
            selected.bundleStudyId ? () => void download(selected) : undefined
          }
        />
      ) : null}
    </div>
  );
}

function StudyDetailsModal({
  study,
  onClose,
  onDownload,
}: {
  study: BridgeStudy;
  onClose: () => void;
  onDownload?: () => void;
}) {
  return (
    <Modal title="Study package details" onClose={onClose}>
      <div className="grid gap-4 md:grid-cols-2">
        <TextInput
          label="Center"
          value={brandText(study.client?.name ?? "-")}
          readOnly
        />
        <TextInput
          label="Patient"
          value={`${study.patientName ?? "-"} / ${study.patientId ?? "-"}`}
          readOnly
        />
        <TextInput
          label="Accession"
          value={study.accessionNumber ?? "-"}
          readOnly
        />
        <TextInput
          label="Study"
          value={study.studyDescription ?? study.studyInstanceUid ?? "-"}
          readOnly
        />
        <TextInput
          label="Modality"
          value={study.modalities.join(", ") || "-"}
          readOnly
        />
        <TextInput
          label="Priority"
          value={study.priority ?? "REGULAR"}
          readOnly
        />
        <TextInput
          label="Status"
          value={study.status ?? study.workflowStatus}
          readOnly
        />
        <TextInput
          label="Supporting files"
          value={String(study.attachments?.length ?? 0)}
          readOnly
        />
        <TextInput
          label="Submitted"
          value={toDate(study.submittedAt ?? study.lastSyncedAt)}
          readOnly
        />
      </div>
      <div className="mt-4">
        <h3 className="text-sm font-bold text-slate-900">
          Clinical indication
        </h3>
        <pre className="mt-2 whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          {study.clinicalIndication || "Not supplied"}
        </pre>
      </div>
      <SimpleTable
        title="Supporting files"
        columns={["File", "Type", "Size", "Uploaded"]}
        rows={(study.attachments ?? []).map((file) => [
          file.originalName,
          file.mimeType ?? "-",
          `${Math.ceil(Number(file.sizeBytes) / 1024)} KB`,
          toDate(file.createdAt),
        ])}
      />
      {onDownload ? (
        <div className="mt-5 flex justify-end">
          <button
            className="rounded-md bg-sky-700 px-4 py-2 text-sm font-bold text-white"
            onClick={onDownload}
            type="button"
          >
            <Download className="mr-2 inline" size={15} />
            Download complete package
          </button>
        </div>
      ) : null}
    </Modal>
  );
}

function ProviderManagersView({
  token,
  dashboard,
  reload,
  notice,
}: {
  token: string;
  dashboard: ProviderDashboard;
  reload: () => Promise<void>;
  notice: (message: string) => void;
}) {
  const [form, setForm] = useState({ name: "", email: "" });
  const [selectedManager, setSelectedManager] = useState<User | null>(null);
  const [managerPassword, setManagerPassword] = useState("");
  const { passwordPrompt } = usePasswordConfirmation();
  async function createManager(event: FormEvent) {
    event.preventDefault();
    const result = await api<{ user: User; temporaryPassword: string }>(
      "/api/provider/managers",
      token,
      { method: "POST", body: JSON.stringify(form) },
    );
    notice(
      `Manager login created for ${result.user.email}. The one-time password is shown in the account details.`,
    );
    setSelectedManager(result.user);
    setManagerPassword(result.temporaryPassword);
    setForm({ name: "", email: "" });
    await reload();
  }
  async function resetManagerPassword(manager: User) {
    const result = await api<{ user: User; temporaryPassword: string }>(
      `/api/provider/managers/${manager.id}/reset-password`,
      token,
      { method: "POST" },
    );
    setSelectedManager(result.user);
    setManagerPassword(result.temporaryPassword);
    notice(`New manager password generated for ${result.user.email}.`);
    await reload();
  }
  return (
    <>
      <div className="grid gap-5 xl:grid-cols-[0.75fr_1.25fr]">
        <FormCard
          title="Create teleradiology manager"
          onSubmit={createManager}
          submitLabel="Create manager"
        >
          <TextInput
            label="Manager name"
            value={form.name}
            onChange={(value) => setForm({ ...form, name: value })}
          />
          <TextInput
            label="Email"
            value={form.email}
            onChange={(value) => setForm({ ...form, email: value })}
          />
        </FormCard>
        <section className="soft-card rounded-lg p-5">
          <h2 className="text-lg font-semibold text-slate-950">
            Manager logins
          </h2>
          <div className="mt-5 table-scroll no-x-scroll">
            <table className="report-table w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  {["Name", "Email", "Status", "Created", "Actions"].map(
                    (column) => (
                      <th className="py-3 pr-4" key={column}>
                        {column}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {(dashboard.managers ?? []).map((manager) => (
                  <tr
                    className="border-b border-slate-100 align-top"
                    key={manager.id}
                  >
                    <td className="py-4 pr-4 font-semibold text-slate-900">
                      {manager.name}
                    </td>
                    <td className="py-4 pr-4 text-slate-700">
                      {manager.email}
                    </td>
                    <td className="py-4 pr-4 text-slate-700">
                      {manager.active ? "Active" : "Inactive"}
                    </td>
                    <td className="py-4 pr-4 text-slate-700">
                      {toDate(manager.createdAt ?? "")}
                    </td>
                    <td className="py-4 pr-4">
                      <div className="flex flex-wrap gap-2">
                        <button
                          className="rounded-md bg-slate-900 px-3 py-2 text-xs font-bold text-white"
                          onClick={() => void resetManagerPassword(manager)}
                          type="button"
                        >
                          Reset password
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!(dashboard.managers ?? []).length ? (
                  <tr>
                    <td
                      className="py-6 text-sm font-semibold text-slate-500"
                      colSpan={5}
                    >
                      No manager logins yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      {selectedManager ? (
        <Modal
          title="Manager credentials"
          onClose={() => setSelectedManager(null)}
        >
          <div className="grid gap-4">
            <TextInput label="Manager" value={selectedManager.name} readOnly />
            <TextInput
              label="User ID"
              value={selectedManager.userId ?? "-"}
              readOnly
            />
            <TextInput
              label="Contact email"
              value={selectedManager.email}
              readOnly
            />
            <CredentialField
              label="Latest one-time temporary password"
              value={managerPassword}
            />
            <p className="text-sm font-semibold text-slate-500">
              Temporary passwords are shown only immediately after creation or
              reset.
            </p>
          </div>
        </Modal>
      ) : null}
      {passwordPrompt}
    </>
  );
}

function ProviderCallsView({
  token,
  dashboard,
  reload,
  notice,
}: {
  token: string;
  dashboard: ProviderDashboard;
  reload: () => Promise<void>;
  notice: (message: string) => void;
}) {
  const [durationById, setDurationById] = useState<Record<string, string>>({});
  const [selectedBooking, setSelectedBooking] =
    useState<ReportCallBooking | null>(null);
  async function acceptManager(booking: ReportCallBooking) {
    await api<ReportCallBooking>(
      `/api/provider/call-bookings/${booking.id}/accept-manager`,
      token,
      { method: "POST" },
    );
    notice("Call request accepted by manager.");
    await reload();
  }
  async function completeCall(booking: ReportCallBooking) {
    const actualDurationMinutes = Number(
      durationById[booking.id] || booking.requestedDurationMinutes || 15,
    );
    if (!Number.isFinite(actualDurationMinutes) || actualDurationMinutes <= 0) {
      notice("Enter a valid call duration.");
      return;
    }
    await api<ReportCallBooking>(
      `/api/provider/call-bookings/${booking.id}/complete`,
      token,
      { method: "POST", body: JSON.stringify({ actualDurationMinutes }) },
    );
    notice("Call completed and added to client bill.");
    await reload();
  }
  const calls = dashboard.callBookings ?? [];
  return (
    <section className="soft-card rounded-lg p-5">
      <h2 className="text-lg font-semibold text-slate-950">
        Teleradiology call requests
      </h2>
      <div className="mt-5 table-scroll">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
              {["Time", "Center", "Patient", "Status", "Action"].map(
                (column) => (
                  <th className="py-3 pr-4" key={column}>
                    {column}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {calls.map((booking) => (
              <tr
                className="border-b border-slate-100 align-top"
                key={booking.id}
              >
                <td className="py-4 pr-4 font-semibold text-slate-900">
                  {toDate(booking.slotStart)}{" "}
                  {new Date(booking.slotStart).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
                <td className="py-4 pr-4 text-slate-700">
                  {brandText(
                    booking.client?.name ?? booking.client?.code ?? "-",
                  )}
                </td>
                <td className="py-4 pr-4 text-slate-700">
                  {booking.report?.patientName ?? "-"}
                </td>
                <td className="py-4 pr-4">
                  <StatusBadge status={booking.status} />
                </td>

                <td className="py-4 pr-4">
                  <button
                    className="table-view-button"
                    onClick={() => setSelectedBooking(booking)}
                    type="button"
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
            {!calls.length ? (
              <tr>
                <td
                  className="py-6 text-sm font-semibold text-slate-500"
                  colSpan={6}
                >
                  No call requests yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {selectedBooking ? (
        <Modal
          title="Call request details"
          onClose={() => setSelectedBooking(null)}
        >
          <div className="record-detail-grid">
            <DetailField
              label="Time"
              value={`${toDate(selectedBooking.slotStart)} ${new Date(selectedBooking.slotStart).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
            />
            <DetailField
              label="Center"
              value={brandText(
                selectedBooking.client?.name ??
                  selectedBooking.client?.code ??
                  "-",
              )}
            />
            <DetailField
              label="Patient"
              value={selectedBooking.report?.patientName ?? "-"}
            />
            <DetailField
              label="Radiologist"
              value={selectedBooking.radiologist?.fullName ?? "-"}
            />
            <DetailField
              label="Mode"
              value={
                selectedBooking.communicationMode === "PHONE_CALL"
                  ? `Phone: ${selectedBooking.phoneNumber ?? "-"}`
                  : "Built-in meeting"
              }
            />

            <DetailField
              label="Status"
              value={<StatusBadge status={selectedBooking.status} />}
            />
          </div>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            {!selectedBooking.managerAcceptedAt &&
            ["REQUESTED", "RADIOLOGIST_ACCEPTED"].includes(
              selectedBooking.status,
            ) ? (
              <button
                className="rounded-md bg-sky-600 px-3 py-2 text-sm font-bold text-white"
                onClick={() => void acceptManager(selectedBooking)}
                type="button"
              >
                Manager accept
              </button>
            ) : null}
            {selectedBooking.status === "BOOKED" &&
            selectedBooking.communicationMode !== "PHONE_CALL" ? (
              <button
                className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-bold text-white"
                onClick={() =>
                  window.open(selectedBooking.meetingUrl, "_blank")
                }
                type="button"
              >
                Join
              </button>
            ) : null}
            {selectedBooking.status === "BOOKED" ? (
              <>
                <input
                  className="w-24 rounded-md border border-slate-200 px-2 py-2 text-sm"
                  placeholder="Minutes"
                  value={durationById[selectedBooking.id] ?? ""}
                  onChange={(event) =>
                    setDurationById({
                      ...durationById,
                      [selectedBooking.id]: event.target.value.replace(
                        /\D/g,
                        "",
                      ),
                    })
                  }
                />
                <button
                  className="rounded-md bg-slate-900 px-3 py-2 text-sm font-bold text-white"
                  onClick={() => void completeCall(selectedBooking)}
                  type="button"
                >
                  Complete
                </button>
              </>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

function AvailabilityCalendarScheduler({
  token,
  dashboard,
  reload,
  notice,
}: {
  token: string;
  dashboard: ProviderDashboard;
  reload: () => Promise<void>;
  notice: (message: string) => void;
}) {
  const radiologists = dashboard.radiologists ?? [];
  const slots = dashboard.availabilitySlots ?? [];
  const defaultAvailability = useMemo(() => nextAvailabilityDefaults(), []);
  const [radiologistId, setRadiologistId] = useState(radiologists[0]?.id ?? "");
  const [selectedDate, setSelectedDate] = useState(defaultAvailability.date);
  const [startTime, setStartTime] = useState(defaultAvailability.startTime);
  const [endTime, setEndTime] = useState(defaultAvailability.endTime);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!radiologistId && radiologists[0]?.id)
      setRadiologistId(radiologists[0].id);
  }, [radiologistId, radiologists]);

  const selectedRadiologist = radiologists.find(
    (item) => item.id === radiologistId,
  );
  const weekStart = startOfWeekDate(selectedDate);
  const weekDays = Array.from({ length: 7 }, (_item, index) =>
    addCalendarDays(weekStart, index),
  );
  const calendarRowHeight = 80;
  const calendarStartMinutes = 8 * 60;
  const visibleTimes = Array.from({ length: 26 }, (_item, index) => {
    const hour = 8 + Math.floor(index / 2);
    const minute = index % 2 === 0 ? "00" : "30";
    return `${String(hour).padStart(2, "0")}:${minute}`;
  });
  const visibleSlots = slots.filter(
    (slot) => !radiologistId || slot.radiologistId === radiologistId,
  );
  const selectedStart = new Date(`${selectedDate}T${startTime}:00`);
  const selectedEnd = new Date(`${selectedDate}T${endTime}:00`);
  const windowMinutes = Math.round(
    (selectedEnd.getTime() - selectedStart.getTime()) / 60000,
  );
  const upcomingForRadiologist = slots
    .filter((slot) => !radiologistId || slot.radiologistId === radiologistId)
    .sort(
      (a, b) =>
        new Date(a.slotStart).getTime() - new Date(b.slotStart).getTime(),
    )
    .slice(0, 8);

  function moveWeek(delta: number) {
    setSelectedDate(
      localDateInputValue(addCalendarDays(weekStart, delta * 7).toISOString()),
    );
  }

  function selectToday() {
    const next = nextAvailabilityDefaults();
    setSelectedDate(next.date);
    setStartTime(next.startTime);
    setEndTime(next.endTime);
  }

  async function addAvailability(event: FormEvent) {
    event.preventDefault();
    if (!radiologistId) {
      notice("Select a radiologist.");
      return;
    }
    if (!selectedDate || !startTime || !endTime) {
      notice("Select a calendar time.");
      return;
    }
    if (!Number.isFinite(windowMinutes) || windowMinutes < 5) {
      notice("End time must be after start time.");
      return;
    }
    if (selectedStart.getTime() <= Date.now()) {
      notice(
        "Choose a future availability time. For today, start time must be after the current time.",
      );
      return;
    }
    if (windowMinutes > 720) {
      notice("Availability window cannot be longer than 12 hours.");
      return;
    }
    setSaving(true);
    try {
      await api<RadiologistAvailability>(
        `/api/provider/radiologists/${radiologistId}/availability`,
        token,
        {
          method: "POST",
          body: JSON.stringify({
            slotStart: selectedStart.toISOString(),
            slotEnd: selectedEnd.toISOString(),
          }),
        },
      );
      notice("Radiologist availability added.");
      await reload();
    } catch (error) {
      notice(
        error instanceof Error ? error.message : "Unable to save availability.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (!radiologists.length)
    return (
      <EmptyState message="Create a radiologist login before punching availability." />
    );

  return (
    <section className="soft-card rounded-lg p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">
            Radiologist availability calendar
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Select a doctor, click a time block, then save the slot for client
            call scheduling.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700"
            onClick={selectToday}
            type="button"
          >
            Today
          </button>
          <button
            className="grid h-10 w-10 place-items-center rounded-md border border-slate-200 bg-white text-slate-700"
            onClick={() => moveWeek(-1)}
            title="Previous week"
            type="button"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            className="grid h-10 w-10 place-items-center rounded-md border border-slate-200 bg-white text-slate-700"
            onClick={() => moveWeek(1)}
            title="Next week"
            type="button"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
            <div>
              <p className="text-sm font-bold text-slate-950">
                {formatCalendarWeekRange(weekDays)}
              </p>
              <p className="text-xs font-semibold text-slate-500">
                {selectedRadiologist?.fullName ?? "Radiologist"}
              </p>
            </div>
            <SelectInput
              label="Radiologist"
              value={radiologistId}
              onChange={setRadiologistId}
              options={radiologists.map((item) => [item.id, item.fullName])}
            />
          </div>
          <div className="min-w-[860px]">
            <div className="grid grid-cols-[76px_repeat(7,minmax(96px,1fr))]">
              <div className="border-b border-slate-200 bg-white" />
              {weekDays.map((day) => {
                const key = localDateInputValue(day.toISOString());
                return (
                  <button
                    className={cx(
                      "border-b border-l border-slate-200 px-2 py-3 text-center",
                      selectedDate === key
                        ? "bg-sky-50 text-sky-700"
                        : "bg-white text-slate-700",
                    )}
                    key={key}
                    onClick={() => setSelectedDate(key)}
                    type="button"
                  >
                    <span className="block text-xs font-bold uppercase">
                      {day.toLocaleDateString([], { weekday: "short" })}
                    </span>
                    <span className="mt-1 inline-grid h-8 w-8 place-items-center rounded-full text-sm font-black">
                      {day.getDate()}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-[76px_repeat(7,minmax(96px,1fr))]">
              <div>
                {visibleTimes.map((time) => (
                  <div
                    className="border-b border-slate-100 bg-slate-50 px-2 py-3 text-right text-[11px] font-bold text-slate-400"
                    key={time}
                    style={{ height: calendarRowHeight }}
                  >
                    {formatTimeLabel(time)}
                  </div>
                ))}
              </div>
              {weekDays.map((day) => {
                const date = localDateInputValue(day.toISOString());
                const daySlots = visibleSlots.filter(
                  (slot) => localDateInputValue(slot.slotStart) === date,
                );
                return (
                  <div
                    className="relative border-l border-slate-100 bg-white"
                    key={date}
                    style={{ height: visibleTimes.length * calendarRowHeight }}
                  >
                    {visibleTimes.map((time) => {
                      const selected =
                        selectedDate === date && startTime === time;
                      return (
                        <button
                          className={cx(
                            "block w-full border-b border-slate-100 bg-transparent text-left transition hover:bg-sky-50/70",
                            selected && "ring-2 ring-inset ring-sky-400",
                          )}
                          key={`${date}-${time}`}
                          onClick={() => {
                            setSelectedDate(date);
                            setStartTime(time);
                            setEndTime(addMinutesToTime(time, 120));
                          }}
                          style={{ height: calendarRowHeight }}
                          type="button"
                        />
                      );
                    })}
                    {daySlots.map((slot) => {
                      const slotStart = new Date(slot.slotStart);
                      const slotEnd = new Date(slot.slotEnd);
                      const startMinutes =
                        slotStart.getHours() * 60 + slotStart.getMinutes();
                      const endMinutes =
                        slotEnd.getHours() * 60 + slotEnd.getMinutes();
                      const top = Math.max(
                        0,
                        ((startMinutes - calendarStartMinutes) / 30) *
                          calendarRowHeight,
                      );
                      const height = Math.max(
                        26,
                        ((endMinutes - startMinutes) / 30) * calendarRowHeight,
                      );
                      return (
                        <div
                          className={cx(
                            "pointer-events-none absolute left-1 right-1 z-10 rounded-md border px-2 py-2 text-[11px] font-bold leading-4 shadow-sm",
                            availabilityEventClass(slot.status),
                          )}
                          key={slot.id}
                          style={{ top, height }}
                        >
                          {slotStart.toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}{" "}
                          -{" "}
                          {slotEnd.toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <form
          className="rounded-lg border border-slate-200 bg-white p-4"
          onSubmit={addAvailability}
        >
          <div className="flex items-center gap-2 text-slate-950">
            <CalendarDays size={18} />
            <h3 className="text-base font-bold">Punch availability</h3>
          </div>
          <div className="mt-4 grid gap-3">
            <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
              Date
              <input
                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-400"
                type="date"
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
              Start time
              <input
                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-400"
                type="time"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
              End time
              <input
                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-400"
                type="time"
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
              />
            </label>
            <div className="rounded-md border border-sky-100 bg-sky-50 p-3 text-sm font-semibold text-sky-800">
              <Clock className="mb-2" size={16} />
              <p>
                {selectedStart.toLocaleDateString()} -{" "}
                {selectedStart.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                to{" "}
                {Number.isFinite(selectedEnd.getTime())
                  ? selectedEnd.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "-"}
              </p>
              <p className="mt-1 text-xs text-sky-700">
                Clients will see bookable 15 minute starts within this
                availability window.
              </p>
            </div>
            <button
              className="inline-flex items-center justify-center gap-2 rounded-md bg-sky-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
              disabled={saving}
              type="submit"
            >
              <Plus size={16} />
              {saving ? "Saving..." : "Save availability"}
            </button>
          </div>

          <div className="mt-5 border-t border-slate-200 pt-4">
            <h4 className="text-sm font-bold text-slate-950">Upcoming slots</h4>
            <div className="mt-3 space-y-2">
              {upcomingForRadiologist.map((slot) => (
                <div
                  className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-700"
                  key={slot.id}
                >
                  <p className="text-slate-950">
                    {toDate(slot.slotStart)} -{" "}
                    {new Date(slot.slotStart).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    -{" "}
                    {new Date(slot.slotEnd).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                  <p className="mt-1">{slot.status}</p>
                </div>
              ))}
              {!upcomingForRadiologist.length ? (
                <p className="text-sm font-semibold text-slate-500">
                  No upcoming slots for this radiologist.
                </p>
              ) : null}
            </div>
          </div>
        </form>
      </div>
    </section>
  );
}

function AdminGroupAdminsView({
  token,
  notice,
}: {
  token: string;
  notice: (message: string) => void;
}) {
  const [groupAdmins, setGroupAdmins] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedAdmin, setSelectedAdmin] = useState<User | null>(null);
  const [generatedPassword, setGeneratedPassword] = useState("");
  const [form, setForm] = useState({ name: "", email: "" });
  const { confirmPassword, passwordPrompt } = usePasswordConfirmation();

  async function loadGroupAdmins() {
    setLoading(true);
    setLoadError("");
    try {
      const result = await api<{ groupAdmins: User[] }>(
        "/api/admin/group-admins",
        token,
      );
      setGroupAdmins(result.groupAdmins);
      setSelectedAdmin((current) =>
        current
          ? (result.groupAdmins.find((item) => item.id === current.id) ??
            current)
          : null,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to load Marengo group administrators.";
      setLoadError(message);
      notice(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setLoadError("");
    api<{ groupAdmins: User[] }>("/api/admin/group-admins", token)
      .then((result) => {
        if (mounted) setGroupAdmins(result.groupAdmins);
      })
      .catch((error: unknown) => {
        if (mounted)
          setLoadError(
            error instanceof Error
              ? error.message
              : "Unable to load Marengo group administrators.",
          );
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [token]);

  async function createGroupAdmin(event: FormEvent) {
    event.preventDefault();
    const result = await api<{ user: User; temporaryPassword: string }>(
      "/api/admin/group-admins",
      token,
      {
        method: "POST",
        body: JSON.stringify(form),
      },
    );
    setForm({ name: "", email: "" });
    setCreateOpen(false);
    setSelectedAdmin(result.user);
    setGeneratedPassword(result.temporaryPassword);
    notice(`Marengo group administrator created: ${result.user.email}.`);
    await loadGroupAdmins();
  }

  async function toggleGroupAdminStatus(groupAdmin: User) {
    const active = groupAdmin.active === false;
    await api(`/api/admin/group-admins/${groupAdmin.id}/status`, token, {
      method: "PATCH",
      body: JSON.stringify({ active }),
    });
    setSelectedAdmin({ ...groupAdmin, active });
    notice(`${groupAdmin.name} ${active ? "activated" : "blocked"}.`);
    await loadGroupAdmins();
  }

  async function resetGroupAdminPassword(groupAdmin: User) {
    const result = await api<{ user: User; temporaryPassword: string }>(
      `/api/admin/group-admins/${groupAdmin.id}/reset-password`,
      token,
      { method: "POST" },
    );
    setGeneratedPassword(result.temporaryPassword);
    setSelectedAdmin(result.user);
    notice(`A new one-time password was generated for ${result.user.email}.`);
    await loadGroupAdmins();
  }

  async function deleteGroupAdmin(groupAdmin: User) {
    if (
      !window.confirm(
        `Delete ${groupAdmin.name}? This permanently removes the Marengo group administrator login.`,
      )
    )
      return;
    const password = await confirmPassword(
      "Confirm deletion",
      `Enter your current password to permanently delete ${groupAdmin.name}.`,
    );
    if (!password) return;
    await api<{ deleted: boolean }>(
      `/api/admin/group-admins/${groupAdmin.id}`,
      token,
      {
        method: "DELETE",
        body: JSON.stringify({ password }),
      },
    );
    setSelectedAdmin(null);
    setGeneratedPassword("");
    notice(`Marengo group administrator ${groupAdmin.name} deleted.`);
    await loadGroupAdmins();
  }

  return (
    <div className="space-y-5">
      <section className="soft-card rounded-lg p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              Marengo group administrators
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Provision network administrators who can monitor every Marengo
              center, study, processing status, and report.
            </p>
          </div>
          <button
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-sky-600 px-4 py-3 text-sm font-bold text-white sm:w-auto"
            onClick={() => setCreateOpen(true)}
            type="button"
          >
            <Plus size={16} />
            Create group admin
          </button>
        </div>
      </section>

      <section className="soft-card rounded-lg p-5">
        <table className="w-full table-fixed text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
              <th className="w-[42%] py-3 pr-3">Administrator</th>
              <th className="w-[25%] py-3 pr-3">Access</th>
              <th className="w-[18%] py-3 pr-3">Status</th>
              <th className="w-[15%] py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {groupAdmins.map((item) => (
              <tr className="border-b border-slate-100" key={item.id}>
                <td className="py-4 pr-3">
                  <p className="truncate font-semibold text-slate-950">
                    {item.name}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {item.email}
                  </p>
                </td>
                <td className="py-4 pr-3 text-slate-700">
                  All Marengo centers
                </td>
                <td className="py-4 pr-3">
                  <StatusBadge
                    status={item.active === false ? "BLOCKED" : "ACTIVE"}
                  />
                </td>
                <td className="py-4 text-right">
                  <button
                    className="rounded-md border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 hover:border-sky-300 hover:text-sky-700"
                    onClick={() => {
                      setGeneratedPassword("");
                      setSelectedAdmin(item);
                    }}
                    type="button"
                  >
                    Details
                  </button>
                </td>
              </tr>
            ))}
            {!groupAdmins.length && !loading && !loadError ? (
              <tr>
                <td
                  className="py-6 text-sm font-semibold text-slate-500"
                  colSpan={4}
                >
                  No Marengo group administrators have been created yet.
                </td>
              </tr>
            ) : null}
            {loading ? (
              <tr>
                <td
                  className="py-6 text-sm font-semibold text-slate-500"
                  colSpan={4}
                >
                  Loading administrators...
                </td>
              </tr>
            ) : null}
            {loadError ? (
              <tr>
                <td
                  className="py-6 text-sm font-semibold text-rose-700"
                  colSpan={4}
                >
                  {loadError}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      {createOpen ? (
        <Modal
          title="Create Marengo group administrator"
          onClose={() => setCreateOpen(false)}
        >
          <FormCard
            title="Administrator login"
            onSubmit={createGroupAdmin}
            submitLabel="Create login"
          >
            <TextInput
              label="Full name"
              value={form.name}
              onChange={(name) => setForm({ ...form, name })}
            />
            <TextInput
              label="Email"
              type="email"
              value={form.email}
              onChange={(email) => setForm({ ...form, email })}
            />
          </FormCard>
        </Modal>
      ) : null}

      {selectedAdmin ? (
        <Modal
          title="Group administrator details"
          onClose={() => setSelectedAdmin(null)}
        >
          <div className="grid gap-5">
            <section className="rounded-lg border border-slate-200 bg-white p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-lg font-semibold text-slate-950">
                    {selectedAdmin.name}
                  </h3>
                  <p className="mt-1 break-all text-sm text-slate-500">
                    {selectedAdmin.email}
                  </p>
                </div>
                <StatusBadge
                  status={selectedAdmin.active === false ? "BLOCKED" : "ACTIVE"}
                />
              </div>
              <div className="mt-5 grid gap-3 text-sm">
                <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2">
                  <span className="font-semibold text-slate-600">Role</span>
                  <span>Marengo Group Admin</span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2">
                  <span className="font-semibold text-slate-600">Access</span>
                  <span>All Marengo centers</span>
                </div>
                {selectedAdmin.createdAt ? (
                  <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2">
                    <span className="font-semibold text-slate-600">
                      Created
                    </span>
                    <span>{toDate(selectedAdmin.createdAt)}</span>
                  </div>
                ) : null}
                <CredentialField
                  label="Latest one-time temporary password"
                  value={generatedPassword}
                />
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <button
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-3 text-sm font-bold text-white"
                  onClick={() => void resetGroupAdminPassword(selectedAdmin)}
                  type="button"
                >
                  <KeyRound size={16} />
                  Generate password
                </button>
                <button
                  className="rounded-md border border-amber-200 px-4 py-3 text-sm font-bold text-amber-800"
                  onClick={() => void toggleGroupAdminStatus(selectedAdmin)}
                  type="button"
                >
                  {selectedAdmin.active === false
                    ? "Activate login"
                    : "Block login"}
                </button>
                <button
                  className="rounded-md border border-rose-200 px-4 py-3 text-sm font-bold text-rose-700 sm:col-span-2"
                  onClick={() => void deleteGroupAdmin(selectedAdmin)}
                  type="button"
                >
                  Delete group administrator
                </button>
              </div>
            </section>
          </div>
        </Modal>
      ) : null}
      {passwordPrompt}
    </div>
  );
}

function AdminRadiologistsView({
  token,
  overview,
  reload,
  notice,
}: {
  token: string;
  overview: AdminOverview;
  reload: () => Promise<void>;
  notice: (message: string) => void;
}) {
  const [radiologists, setRadiologists] = useState<RadiologistProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedRadiologist, setSelectedRadiologist] =
    useState<RadiologistProfile | null>(null);
  const [generatedPassword, setGeneratedPassword] = useState("");
  const [signatureFileName, setSignatureFileName] = useState("");
  const [documentFileName, setDocumentFileName] = useState("");
  const { confirmPassword, passwordPrompt } = usePasswordConfirmation();
  const [form, setForm] = useState({
    scope: "MARENGO_GROUP" as "MARENGO_GROUP" | "RENEWIST",
    fullName: "",
    email: "",
    phone: "",
    qualification: "",
    medicalRegistrationNumber: "",
    organisationName: "Marengo Asia Hospitals",
    signatureImageData: "",
    documentData: "",
    documentName: "",
  });

  async function loadRadiologists() {
    setLoading(true);
    setLoadError("");
    try {
      const result = await api<{ radiologists: RadiologistProfile[] }>(
        "/api/admin/radiologists",
        token,
      );
      setRadiologists(result.radiologists);
      setSelectedRadiologist((current) =>
        current
          ? (result.radiologists.find((item) => item.id === current.id) ??
            current)
          : null,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to load managed radiologists.";
      setLoadError(message);
      notice(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let mounted = true;
    api<{ radiologists: RadiologistProfile[] }>(
      "/api/admin/radiologists",
      token,
    )
      .then((result) => {
        if (mounted) setRadiologists(result.radiologists);
      })
      .catch((error: unknown) => {
        if (mounted)
          setLoadError(
            error instanceof Error
              ? error.message
              : "Unable to load managed radiologists.",
          );
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [token]);

  async function createRadiologist(event: FormEvent) {
    event.preventDefault();
    const result = await api<{
      profile: RadiologistProfile;
      temporaryPassword: string;
    }>("/api/admin/radiologists", token, {
      method: "POST",
      body: JSON.stringify(form),
    });
    setCreateOpen(false);
    setSelectedRadiologist(result.profile);
    setGeneratedPassword(result.temporaryPassword);
    setSignatureFileName("");
    setDocumentFileName("");
    setForm({
      scope: "MARENGO_GROUP",
      fullName: "",
      email: "",
      phone: "",
      qualification: "",
      medicalRegistrationNumber: "",
      organisationName: "Marengo Asia Hospitals",
      signatureImageData: "",
      documentData: "",
      documentName: "",
    });
    notice(
      `${form.scope === "RENEWIST" ? "Renewist" : "Marengo"} radiologist login created: ${result.profile.email}.`,
    );
    await reload();
    await loadRadiologists();
  }

  async function uploadSignature(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const signatureImageData = await readSignatureFile(file);
      setForm((current) => ({ ...current, signatureImageData }));
      setSignatureFileName(file.name);
    } catch (error) {
      notice(
        error instanceof Error
          ? error.message
          : "Unable to upload signature image.",
      );
      event.target.value = "";
    }
  }

  async function uploadDocument(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const documentData = await readRadiologistDocument(file);
      setForm((current) => ({
        ...current,
        documentData,
        documentName: file.name,
      }));
      setDocumentFileName(file.name);
    } catch (error) {
      notice(
        error instanceof Error ? error.message : "Unable to upload document.",
      );
      event.target.value = "";
    }
  }

  async function resetRadiologistPassword(radiologist: RadiologistProfile) {
    const result = await api<{ user: User; temporaryPassword: string }>(
      `/api/admin/radiologists/${radiologist.id}/reset-password`,
      token,
      { method: "POST" },
    );
    setGeneratedPassword(result.temporaryPassword);
    notice(`A new one-time password was generated for ${result.user.email}.`);
    await reload();
    await loadRadiologists();
  }

  async function toggleRadiologistStatus(radiologist: RadiologistProfile) {
    const active = !radiologist.active;
    await api(`/api/admin/radiologists/${radiologist.id}/status`, token, {
      method: "PATCH",
      body: JSON.stringify({ active }),
    });
    setSelectedRadiologist({ ...radiologist, active });
    notice(`${radiologist.fullName} ${active ? "activated" : "blocked"}.`);
    await reload();
    await loadRadiologists();
  }

  async function deleteRadiologist(radiologist: RadiologistProfile) {
    if (
      !window.confirm(
        `Delete ${radiologist.fullName}? This permanently removes the radiologist login and profile.`,
      )
    )
      return;
    const password = await confirmPassword(
      "Confirm deletion",
      `Enter your current password to permanently delete ${radiologist.fullName}.`,
    );
    if (!password) return;
    await api<{ deleted: boolean }>(
      `/api/admin/radiologists/${radiologist.id}`,
      token,
      {
        method: "DELETE",
        body: JSON.stringify({ password }),
      },
    );
    setSelectedRadiologist(null);
    setGeneratedPassword("");
    notice(`Radiologist ${radiologist.fullName} deleted.`);
    await reload();
    await loadRadiologists();
  }

  return (
    <div className="space-y-5">
      <section className="soft-card rounded-lg p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              Radiologist access
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Create and manage Marengo group viewers or Renewist reporting
              radiologists from Super Admin.
            </p>
          </div>
          <button
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-sky-600 px-4 py-3 text-sm font-bold text-white sm:w-auto"
            onClick={() => setCreateOpen(true)}
            type="button"
          >
            <Plus size={16} />
            Create radiologist
          </button>
        </div>
      </section>

      <section className="soft-card rounded-lg p-5">
        <table className="w-full table-fixed text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
              <th className="w-[48%] py-3 pr-3">Radiologist</th>
              <th className="w-[22%] py-3 pr-3">Scope</th>
              <th className="w-[15%] py-3 pr-3">Status</th>
              <th className="w-[15%] py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {radiologists.map((item) => (
              <tr className="border-b border-slate-100" key={item.id}>
                <td className="py-4 pr-3">
                  <p className="truncate font-semibold text-slate-950">
                    {item.fullName}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {item.email}
                  </p>
                </td>
                <td className="py-4 pr-3 text-slate-700">
                  {item.scope === "RENEWIST" || item.providerCode
                    ? "Renewist"
                    : "Marengo group"}
                </td>
                <td className="py-4 pr-3">
                  <StatusBadge status={item.active ? "ACTIVE" : "BLOCKED"} />
                </td>
                <td className="py-4 text-right">
                  <button
                    className="rounded-md border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 hover:border-sky-300 hover:text-sky-700"
                    onClick={() => {
                      setGeneratedPassword("");
                      setSelectedRadiologist(item);
                    }}
                    type="button"
                  >
                    Details
                  </button>
                </td>
              </tr>
            ))}
            {!radiologists.length && !loading && !loadError ? (
              <tr>
                <td
                  className="py-6 text-sm font-semibold text-slate-500"
                  colSpan={4}
                >
                  No radiologists have been created yet.
                </td>
              </tr>
            ) : null}
            {loading ? (
              <tr>
                <td
                  className="py-6 text-sm font-semibold text-slate-500"
                  colSpan={4}
                >
                  Loading radiologists...
                </td>
              </tr>
            ) : null}
            {loadError ? (
              <tr>
                <td
                  className="py-6 text-sm font-semibold text-rose-700"
                  colSpan={4}
                >
                  {loadError}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      {createOpen ? (
        <Modal
          title="Create radiologist login"
          onClose={() => setCreateOpen(false)}
          wide
        >
          <FormCard
            title="Radiologist profile"
            onSubmit={createRadiologist}
            submitLabel="Create login"
          >
            <SelectInput
              label="Workspace"
              value={form.scope}
              onChange={(scope) =>
                setForm({
                  ...form,
                  scope: scope as "MARENGO_GROUP" | "RENEWIST",
                  organisationName:
                    scope === "RENEWIST"
                      ? "Renewist"
                      : "Marengo Asia Hospitals",
                })
              }
              options={[
                ["MARENGO_GROUP", "Marengo group — read only"],
                ["RENEWIST", "Renewist — reporting workflow"],
              ]}
            />
            <TextInput
              label="Full name"
              value={form.fullName}
              onChange={(fullName) => setForm({ ...form, fullName })}
            />
            <TextInput
              label="Email"
              type="email"
              value={form.email}
              onChange={(email) => setForm({ ...form, email })}
            />
            <TextInput
              label="Phone"
              value={form.phone}
              onChange={(phone) => setForm({ ...form, phone })}
            />
            <TextInput
              label="Qualification"
              value={form.qualification}
              onChange={(qualification) => setForm({ ...form, qualification })}
            />
            <TextInput
              label="Medical registration number"
              value={form.medicalRegistrationNumber}
              onChange={(medicalRegistrationNumber) =>
                setForm({ ...form, medicalRegistrationNumber })
              }
            />
            <TextInput
              label="Organisation name"
              value={form.organisationName}
              onChange={(organisationName) =>
                setForm({ ...form, organisationName })
              }
            />
            <FileInput
              label="Signature image"
              fileName={signatureFileName}
              onChange={uploadSignature}
            />
            <FileInput
              accept={radiologistDocumentTypes.join(",")}
              fileName={documentFileName}
              hint="Optional image, PDF, DOC, or DOCX up to 8 MB"
              label="Optional document"
              onChange={uploadDocument}
            />
          </FormCard>
        </Modal>
      ) : null}

      {selectedRadiologist ? (
        <RadiologistDetailModal
          documentDownloadPath={`/api/admin/radiologists/${selectedRadiologist.id}/document`}
          generatedPassword={generatedPassword}
          onClose={() => setSelectedRadiologist(null)}
          onDelete={() => deleteRadiologist(selectedRadiologist)}
          onResetPassword={() => resetRadiologistPassword(selectedRadiologist)}
          onToggleStatus={() => toggleRadiologistStatus(selectedRadiologist)}
          radiologist={
            radiologists.find((item) => item.id === selectedRadiologist.id) ??
            selectedRadiologist
          }
          reports={overview.reportReviews}
          token={token}
          viewOnlyNetwork={!selectedRadiologist.providerCode}
        />
      ) : null}
      {passwordPrompt}
    </div>
  );
}

function ProviderRadiologistsView({
  token,
  dashboard,
  reload,
  notice,
}: {
  token: string;
  dashboard: ProviderDashboard;
  reload: () => Promise<void>;
  notice: (message: string) => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedRadiologist, setSelectedRadiologist] =
    useState<RadiologistProfile | null>(null);
  const [generatedPassword, setGeneratedPassword] = useState("");
  const [signatureFileName, setSignatureFileName] = useState("");
  const { confirmPassword, passwordPrompt } = usePasswordConfirmation();
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    qualification: "",
    medicalRegistrationNumber: "",
    organisationName: "CONSULTANT RADIOLOGIST",
    signatureImageUrl: "",
    signatureImageData: "",
    documentData: "",
    documentName: "",
  });

  async function createRadiologist(event: FormEvent) {
    event.preventDefault();
    const result = await api<{
      profile: RadiologistProfile;
      temporaryPassword: string;
    }>("/api/provider/radiologists", token, {
      method: "POST",
      body: JSON.stringify(form),
    });
    notice(
      `Renewist radiologist login created for ${result.profile.email}. The one-time password is shown in the profile details.`,
    );
    setGeneratedPassword(result.temporaryPassword);
    setSelectedRadiologist(result.profile);
    setForm({
      fullName: "",
      email: "",
      phone: "",
      qualification: "",
      medicalRegistrationNumber: "",
      organisationName: "CONSULTANT RADIOLOGIST",
      signatureImageUrl: "",
      signatureImageData: "",
      documentData: "",
      documentName: "",
    });
    setSignatureFileName("");
    setCreateOpen(false);
    await reload();
  }

  async function uploadSignature(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const signatureImageData = await readSignatureFile(file);
      setForm((current) => ({
        ...current,
        signatureImageData,
        signatureImageUrl: "",
      }));
      setSignatureFileName(file.name);
    } catch (error) {
      notice(
        error instanceof Error
          ? error.message
          : "Unable to upload signature image.",
      );
      event.target.value = "";
    }
  }

  async function resetRadiologistPassword(radiologist: RadiologistProfile) {
    const result = await api<{ user: User; temporaryPassword: string }>(
      `/api/provider/radiologists/${radiologist.id}/reset-password`,
      token,
      { method: "POST" },
    );
    setGeneratedPassword(result.temporaryPassword);
    notice(`A new one-time password was generated for ${result.user.email}.`);
    await reload();
  }

  async function deleteRadiologist(radiologist: RadiologistProfile) {
    const confirmed = window.confirm(
      `Delete ${radiologist.fullName}? This removes the Renewist radiologist login and releases any unlocked claimed reports.`,
    );
    if (!confirmed) return;
    const password = await confirmPassword(
      "Confirm deletion",
      `Enter your current password to permanently delete ${radiologist.fullName}.`,
    );
    if (!password) return;
    await api<{ deleted: boolean }>(
      `/api/provider/radiologists/${radiologist.id}`,
      token,
      { method: "DELETE", body: JSON.stringify({ password }) },
    );
    notice(`Renewist radiologist ${radiologist.fullName} deleted.`);
    setGeneratedPassword("");
    setSelectedRadiologist(null);
    await reload();
  }

  return (
    <div className="space-y-5">
      <section className="soft-card rounded-lg p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              Renewist radiologist logins
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Create radiologist accounts for claiming AI-generated
              teleradiology reports, editing, and signing before PACS push-back.
            </p>
          </div>
          <button
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-sky-600 px-4 py-3 text-sm font-bold text-white sm:w-auto"
            onClick={() => setCreateOpen(true)}
            type="button"
          >
            <Plus size={16} />
            Create radiologist
          </button>
        </div>
      </section>
      <AvailabilityCalendarScheduler
        token={token}
        dashboard={dashboard}
        reload={reload}
        notice={notice}
      />
      <RadiologistListing
        reports={dashboard.reportReviews ?? []}
        radiologists={dashboard.radiologists ?? []}
        onView={(radiologist) => {
          setGeneratedPassword("");
          setSelectedRadiologist(radiologist);
        }}
      />
      {createOpen && (
        <Modal
          title="Create Renewist radiologist"
          onClose={() => setCreateOpen(false)}
          wide
        >
          <form
            className="grid gap-5 xl:grid-cols-[1fr_0.9fr]"
            onSubmit={createRadiologist}
          >
            <section className="rounded-lg border border-slate-200 bg-white p-5">
              <h2 className="text-lg font-semibold text-slate-950">
                Radiologist profile
              </h2>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <TextInput
                  label="Full name"
                  value={form.fullName}
                  onChange={(value) => setForm({ ...form, fullName: value })}
                />
                <TextInput
                  label="Email"
                  value={form.email}
                  onChange={(value) => setForm({ ...form, email: value })}
                />
                <TextInput
                  label="Phone"
                  value={form.phone}
                  onChange={(value) => setForm({ ...form, phone: value })}
                />
                <TextInput
                  label="Qualification"
                  value={form.qualification}
                  onChange={(value) =>
                    setForm({ ...form, qualification: value })
                  }
                />
                <TextInput
                  label="Registration number"
                  value={form.medicalRegistrationNumber}
                  onChange={(value) =>
                    setForm({ ...form, medicalRegistrationNumber: value })
                  }
                />
                <TextInput
                  label="Designation"
                  value={form.organisationName}
                  onChange={(value) =>
                    setForm({ ...form, organisationName: value })
                  }
                />
                <FileInput
                  label="Digital signature"
                  fileName={signatureFileName}
                  onChange={uploadSignature}
                />
              </div>
              <button
                className="mt-5 inline-flex items-center gap-2 rounded-md bg-sky-600 px-4 py-3 text-sm font-bold text-white"
                type="submit"
              >
                <Plus size={16} />
                Create login
              </button>
            </section>
            <SignaturePreview
              fullName={form.fullName || "DR. RADIOLOGIST NAME"}
              qualification={form.qualification || "MBBS, MD RADIODIAGNOSIS"}
              registration={form.medicalRegistrationNumber || "REGISTRATION NO"}
              designation={form.organisationName || "CONSULTANT RADIOLOGIST"}
              signatureImageUrl={
                form.signatureImageData || form.signatureImageUrl
              }
            />
          </form>
        </Modal>
      )}
      {selectedRadiologist && (
        <RadiologistDetailModal
          generatedPassword={generatedPassword}
          onClose={() => setSelectedRadiologist(null)}
          onResetPassword={() => resetRadiologistPassword(selectedRadiologist)}
          onDelete={() => deleteRadiologist(selectedRadiologist)}
          reports={dashboard.reportReviews ?? []}
          token={token}
          radiologist={
            (dashboard.radiologists ?? []).find(
              (item) => item.id === selectedRadiologist.id,
            ) ?? selectedRadiologist
          }
        />
      )}
      {passwordPrompt}
    </div>
  );
}

function SignaturePreview({
  fullName,
  qualification,
  registration,
  designation,
  signatureImageUrl,
}: {
  fullName: string;
  qualification: string;
  registration: string;
  designation: string;
  signatureImageUrl?: string | null;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-slate-950">
        Signature preview
      </h2>
      <div className="mt-5 grid min-h-[360px] place-items-center rounded-lg border border-slate-200 bg-white p-8 text-center">
        <div>
          <div className="mx-auto flex h-32 items-end justify-center">
            {signatureImageUrl ? (
              <img
                alt="Digital signature preview"
                className="max-h-28 max-w-72 object-contain"
                src={signatureImageUrl}
              />
            ) : (
              <span className="text-sm font-semibold text-slate-400">
                Upload signature
              </span>
            )}
          </div>
          <div className="mt-9 space-y-2 font-serif text-slate-950">
            <p className="text-xl font-bold uppercase">{fullName}</p>
            <p className="text-lg font-bold uppercase">{qualification}</p>
            <p className="text-base">Reg No. {registration}</p>
            <p className="text-lg uppercase">{designation}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function ClientRadiologistsView({
  token,
  client,
  reload,
  notice,
}: {
  token: string;
  client: Client;
  reload: () => Promise<void>;
  notice: (message: string) => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedRadiologist, setSelectedRadiologist] =
    useState<RadiologistProfile | null>(null);
  const [generatedPassword, setGeneratedPassword] = useState("");
  const { confirmPassword, passwordPrompt } = usePasswordConfirmation();
  const isMarengoGroup = client.code === "MARENGO";
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    qualification: "",
    medicalRegistrationNumber: "",
    organisationName: client.name,
    signatureImageUrl: "",
    signatureImageData: "",
    documentData: "",
    documentName: "",
  });
  const [signatureFileName, setSignatureFileName] = useState("");
  const [documentFileName, setDocumentFileName] = useState("");
  const assignedServiceNames = client.services.map(
    (service) => service.service.name,
  );
  const reviewEnabled = Boolean(
    client.reportSettings?.some((setting) => setting.radiologistReviewEnabled),
  );

  async function toggleReview(enabled: boolean) {
    if (!assignedServiceNames.length) {
      notice("Assign a PACS service before enabling radiologist review.");
      return;
    }
    await Promise.all(
      assignedServiceNames.map((serviceName) => {
        const setting = client.reportSettings?.find(
          (item) => item.serviceName === serviceName,
        );
        const enabledSections = setting?.enabledSections?.length
          ? setting.enabledSections
          : reportSections;
        return api<ReportSetting>("/api/client/report-format", token, {
          method: "PUT",
          body: JSON.stringify({
            serviceName,
            dicomReturnFormat:
              setting?.dicomReturnFormat ?? "DICOM_ENCAPSULATED_PDF",
            reportMode: setting?.reportMode ?? "Comprehensive",
            radiologistReviewEnabled: enabled,
            includeRadiologistSignature:
              setting?.includeRadiologistSignature !== false,
            signatureDetailFields: setting?.signatureDetailFields?.length
              ? setting.signatureDetailFields
              : [
                  "fullName",
                  "qualification",
                  "medicalRegistrationNumber",
                  "organisationName",
                ],
            enabledSections,
            structuredHeaderJson: { sections: enabledSections },
          }),
        });
      }),
    );
    notice(
      enabled
        ? "Radiologist review enabled. Reports will park for review before PACS push-back."
        : "Radiologist review disabled. Reports will send directly to PACS.",
    );
    await reload();
  }

  async function createRadiologist(event: FormEvent) {
    event.preventDefault();
    const result = await api<{
      profile: RadiologistProfile;
      temporaryPassword: string;
    }>("/api/client/radiologists", token, {
      method: "POST",
      body: JSON.stringify(form),
    });
    notice(
      `Radiologist login created for ${result.profile.email}. The one-time password is shown in the profile details.`,
    );
    setGeneratedPassword(result.temporaryPassword);
    setSelectedRadiologist(result.profile);
    setForm({
      fullName: "",
      email: "",
      phone: "",
      qualification: "",
      medicalRegistrationNumber: "",
      organisationName: client.name,
      signatureImageUrl: "",
      signatureImageData: "",
      documentData: "",
      documentName: "",
    });
    setSignatureFileName("");
    setDocumentFileName("");
    setCreateOpen(false);
    await reload();
  }

  async function uploadSignature(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const signatureImageData = await readSignatureFile(file);
      setForm((current) => ({
        ...current,
        signatureImageData,
        signatureImageUrl: "",
      }));
      setSignatureFileName(file.name);
    } catch (error) {
      notice(
        error instanceof Error
          ? error.message
          : "Unable to upload signature image.",
      );
      event.target.value = "";
    }
  }

  async function uploadDocument(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const documentData = await readRadiologistDocument(file);
      setForm((current) => ({
        ...current,
        documentData,
        documentName: file.name,
      }));
      setDocumentFileName(file.name);
    } catch (error) {
      notice(
        error instanceof Error ? error.message : "Unable to upload document.",
      );
      event.target.value = "";
    }
  }

  async function resetRadiologistPassword(radiologist: RadiologistProfile) {
    const result = await api<{ user: User; temporaryPassword: string }>(
      `/api/client/radiologists/${radiologist.id}/reset-password`,
      token,
      { method: "POST" },
    );
    setGeneratedPassword(result.temporaryPassword);
    notice(`A new one-time password was generated for ${result.user.email}.`);
    await reload();
  }

  async function deleteRadiologist(radiologist: RadiologistProfile) {
    const confirmed = window.confirm(
      `Delete ${radiologist.fullName}? This permanently removes the radiologist login and profile.`,
    );
    if (!confirmed) return;
    const password = await confirmPassword(
      "Confirm deletion",
      `Enter your current password to permanently delete ${radiologist.fullName}.`,
    );
    if (!password) return;
    await api<{ deleted: boolean }>(
      `/api/client/radiologists/${radiologist.id}`,
      token,
      { method: "DELETE", body: JSON.stringify({ password }) },
    );
    notice(`Radiologist ${radiologist.fullName} deleted.`);
    setGeneratedPassword("");
    setSelectedRadiologist(null);
    await reload();
  }

  return (
    <div
      className={cx(
        "space-y-5",
        isMarengoGroup && "marengo-radiologists-workspace",
      )}
    >
      <section className="soft-card rounded-lg p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          {isMarengoGroup ? (
            <div className="marengo-section-heading">
              <span>View-only access</span>
              <h2>Radiologist report viewers</h2>
              <p>
                Create Marengo radiologist logins that can open studies and
                generated reports across all group centers in read-only mode.
              </p>
            </div>
          ) : (
            <label className="flex max-w-3xl items-start gap-3">
              <input
                checked={reviewEnabled}
                className="toggle-input sr-only"
                onChange={(event) => toggleReview(event.target.checked)}
                type="checkbox"
              />
              <span className="toggle-track mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full p-1 transition">
                <span className="toggle-thumb h-4 w-4 rounded-full bg-white shadow-sm transition" />
              </span>
              <span>
                <span className="block text-sm font-bold text-slate-950">
                  Radiologist review before PACS push-back
                </span>
                <span className="mt-1 block text-sm leading-6 text-slate-600">
                  When enabled, generated reports are parked for radiologist
                  review. When disabled, reports are sent directly to PACS in
                  the selected output format.
                </span>
              </span>
            </label>
          )}
          <button
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-sky-600 px-4 py-3 text-sm font-bold text-white sm:w-auto"
            onClick={() => setCreateOpen(true)}
            type="button"
          >
            <Plus size={16} />
            Create radiologist
          </button>
        </div>
      </section>
      <RadiologistListing
        reports={client.reportReviews ?? []}
        radiologists={client.radiologists ?? []}
        viewOnlyNetwork={isMarengoGroup}
        onView={(radiologist) => {
          setGeneratedPassword("");
          setSelectedRadiologist(radiologist);
        }}
      />
      {createOpen && (
        <Modal
          title={
            isMarengoGroup
              ? "Create view-only radiologist"
              : "Create radiologist user"
          }
          onClose={() => setCreateOpen(false)}
        >
          <FormCard
            title="Radiologist profile"
            onSubmit={createRadiologist}
            submitLabel="Create login"
          >
            <TextInput
              label="Full name"
              value={form.fullName}
              onChange={(value) => setForm({ ...form, fullName: value })}
            />
            <TextInput
              label="Email"
              value={form.email}
              onChange={(value) => setForm({ ...form, email: value })}
            />
            <TextInput
              label="Phone"
              value={form.phone}
              onChange={(value) => setForm({ ...form, phone: value })}
            />
            <TextInput
              label="Qualification"
              value={form.qualification}
              onChange={(value) => setForm({ ...form, qualification: value })}
            />
            <TextInput
              label="Medical registration number"
              value={form.medicalRegistrationNumber}
              onChange={(value) =>
                setForm({ ...form, medicalRegistrationNumber: value })
              }
            />
            <TextInput
              label="Organisation name"
              value={form.organisationName}
              onChange={(value) =>
                setForm({ ...form, organisationName: value })
              }
            />
            <FileInput
              label="Signature image"
              fileName={signatureFileName}
              onChange={uploadSignature}
            />
            <FileInput
              accept={radiologistDocumentTypes.join(",")}
              fileName={documentFileName}
              hint="Optional image, PDF, DOC, or DOCX up to 8 MB"
              label="Optional document"
              onChange={uploadDocument}
            />
          </FormCard>
        </Modal>
      )}
      {selectedRadiologist && (
        <RadiologistDetailModal
          generatedPassword={generatedPassword}
          onClose={() => setSelectedRadiologist(null)}
          onResetPassword={() => resetRadiologistPassword(selectedRadiologist)}
          onDelete={() => deleteRadiologist(selectedRadiologist)}
          reports={client.reportReviews ?? []}
          token={token}
          viewOnlyNetwork={isMarengoGroup}
          radiologist={
            (client.radiologists ?? []).find(
              (item) => item.id === selectedRadiologist.id,
            ) ?? selectedRadiologist
          }
        />
      )}
      {passwordPrompt}
    </div>
  );
}

function reportsVisibleToRadiologist(
  reports: ReportReview[],
  radiologist: RadiologistProfile,
  viewOnlyNetwork = false,
) {
  if (viewOnlyNetwork)
    return reports.filter((report) =>
      ["APPROVED", "PUSHED"].includes(report.status),
    );
  return reports.filter(
    (report) =>
      report.radiologistId === radiologist.id ||
      (!report.radiologistId &&
        radiologist.active &&
        ["PENDING", "IN_REVIEW", "SAVED"].includes(report.status)),
  );
}

void ReportFormatView;
void ClientRadiologistsView;

function RadiologistListing({
  radiologists,
  reports,
  viewOnlyNetwork = false,
  onView,
}: {
  radiologists: RadiologistProfile[];
  reports: ReportReview[];
  viewOnlyNetwork?: boolean;
  onView: (radiologist: RadiologistProfile) => void;
}) {
  return (
    <section className="soft-card rounded-lg p-5">
      {viewOnlyNetwork ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <MetricTile
            label="Radiologists"
            value={String(radiologists.length)}
          />
          <MetricTile
            label="Signed reports"
            value={String(
              reports.filter((report) =>
                ["APPROVED", "PUSHED"].includes(report.status),
              ).length,
            )}
          />
          <MetricTile
            label="Centers covered"
            value={String(
              new Set(reports.map((report) => report.clientId)).size,
            )}
          />
        </div>
      ) : null}
      <div className="table-scroll">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
              {[
                "Radiologist / login",
                "Credentials",
                viewOnlyNetwork ? "Signed reports" : "Reports",
                "Status",
                "Action",
              ].map((column) => (
                <th className="py-3 pr-4" key={column}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {radiologists.map((item) => (
              <tr className="border-b border-slate-100 align-top" key={item.id}>
                <td className="py-4 pr-4 text-slate-700">
                  <strong className="block text-slate-900">
                    {item.fullName}
                  </strong>
                  <span className="text-xs text-slate-500">{item.email}</span>
                </td>
                <td className="py-4 pr-4 text-slate-700">
                  {item.qualification}
                  <div className="text-xs text-slate-500">
                    {item.medicalRegistrationNumber}
                  </div>
                </td>
                <td className="py-4 pr-4 text-slate-700">
                  {
                    reportsVisibleToRadiologist(reports, item, viewOnlyNetwork)
                      .length
                  }
                </td>
                <td className="py-4 pr-4">
                  <StatusBadge status={item.active ? "ACTIVE" : "BLOCKED"} />
                </td>
                <td className="py-4 pr-4">
                  <button
                    className="rounded-md border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 hover:border-sky-300 hover:text-sky-700"
                    onClick={() => onView(item)}
                    type="button"
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
            {!radiologists.length && (
              <tr>
                <td
                  className="py-6 text-sm font-semibold text-slate-500"
                  colSpan={5}
                >
                  No radiologists have been created yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RadiologistDetailModal({
  radiologist,
  reports: clientReports,
  generatedPassword,
  token,
  documentDownloadPath,
  viewOnlyNetwork = false,
  onResetPassword,
  onToggleStatus,
  onDelete,
  onClose,
}: {
  radiologist: RadiologistProfile;
  reports: ReportReview[];
  generatedPassword: string;
  token: string;
  documentDownloadPath?: string;
  viewOnlyNetwork?: boolean;
  onResetPassword: () => Promise<void>;
  onToggleStatus?: () => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const [viewerReport, setViewerReport] = useState<ReportReview | null>(null);
  const [documentError, setDocumentError] = useState("");
  const reports = reportsVisibleToRadiologist(
    clientReports,
    radiologist,
    viewOnlyNetwork,
  );
  const pending = reports.filter((report) =>
    ["PENDING", "IN_REVIEW", "SAVED"].includes(report.status),
  );
  const approved = reports.filter((report) =>
    ["APPROVED", "PUSHED"].includes(report.status),
  );
  const rejected = reports.filter((report) => report.status === "FAILED");
  function openReportHtml(report: ReportReview) {
    const html = String(
      report.editedReportJson?.htmlReport ??
        report.aiReportJson?.htmlReport ??
        "",
    );
    if (!html) return;
    window.open(
      URL.createObjectURL(new Blob([html], { type: "text/html" })),
      "_blank",
    );
  }

  return (
    <Modal title="Radiologist profile" onClose={onClose} wide>
      <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-slate-950">
                {radiologist.fullName}
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                {radiologist.qualification} -{" "}
                {radiologist.medicalRegistrationNumber}
              </p>
            </div>
            <StatusBadge status={radiologist.active ? "ACTIVE" : "BLOCKED"} />
          </div>
          <div className="mt-5 grid gap-3">
            <TextInput
              label="User ID"
              value={radiologist.user?.userId ?? "-"}
              readOnly
            />
            <TextInput
              label="Contact email"
              value={radiologist.email}
              readOnly
            />
            <CredentialField
              label="Latest one-time temporary password"
              value={generatedPassword}
            />
            <button
              className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-3 text-sm font-bold text-white"
              onClick={onResetPassword}
              type="button"
            >
              <KeyRound size={16} />
              Generate new password
            </button>
            {onToggleStatus ? (
              <button
                className="inline-flex items-center justify-center rounded-md border border-amber-200 px-4 py-3 text-sm font-bold text-amber-800"
                onClick={onToggleStatus}
                type="button"
              >
                {radiologist.active ? "Block login" : "Activate login"}
              </button>
            ) : null}
            <button
              className="inline-flex items-center justify-center rounded-md border border-rose-200 px-4 py-3 text-sm font-bold text-rose-700"
              onClick={onDelete}
              type="button"
            >
              Delete radiologist
            </button>
          </div>
          <div className="mt-5 grid gap-3 text-sm">
            <div className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
              <span className="font-semibold text-slate-600">Phone</span>
              <span>{radiologist.phone || "-"}</span>
            </div>
            <div className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
              <span className="font-semibold text-slate-600">Organisation</span>
              <span>{brandText(radiologist.organisationName)}</span>
            </div>
            <div className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
              <span className="font-semibold text-slate-600">Signature</span>
              <span>
                {radiologist.signatureImageUrl ? "Uploaded" : "Missing"}
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2">
              <span className="font-semibold text-slate-600">Document</span>
              {radiologist.documentUrl ? (
                documentDownloadPath ? (
                  <button
                    className="max-w-full break-words text-right font-semibold text-sky-700 hover:text-sky-900"
                    onClick={() => {
                      setDocumentError("");
                      void downloadProtectedFile(
                        documentDownloadPath,
                        token,
                      ).catch((error) =>
                        setDocumentError(
                          error instanceof Error
                            ? error.message
                            : "Download failed",
                        ),
                      );
                    }}
                    type="button"
                  >
                    {radiologist.documentName || "Download uploaded document"}
                  </button>
                ) : (
                  <span className="max-w-full break-words text-right font-semibold text-slate-700">
                    {radiologist.documentName || "Uploaded"}
                  </span>
                )
              ) : (
                <span>Not uploaded</span>
              )}
            </div>
            {documentError ? (
              <p className="text-sm font-semibold text-rose-700">
                {documentError}
              </p>
            ) : null}
          </div>
        </section>
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h3 className="text-lg font-semibold text-slate-950">
            {viewOnlyNetwork ? "Signed report access" : "Report status"}
          </h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <MetricTile
              label={viewOnlyNetwork ? "Visible signed" : "Pending"}
              value={String(viewOnlyNetwork ? reports.length : pending.length)}
            />
            <MetricTile label="Approved" value={String(approved.length)} />
            <MetricTile label="Rejected" value={String(rejected.length)} />
          </div>
          <div className="mt-5 table-scroll">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  {[
                    "Report ID",
                    "Study",
                    "Patient",
                    "Exam",
                    "Status",
                    viewOnlyNetwork ? "Access" : "Updated",
                  ].map((column) => (
                    <th className="py-3 pr-4" key={column}>
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reports.map((report) => (
                  <tr className="border-b border-slate-100" key={report.id}>
                    <td className="py-4 pr-4 font-semibold text-slate-900">
                      {report.id}
                    </td>
                    <td className="py-4 pr-4 text-slate-700">
                      {report.studyUid ?? report.id}
                    </td>
                    <td className="py-4 pr-4 text-slate-700">
                      {report.patientName ?? "-"}
                    </td>
                    <td className="py-4 pr-4 text-slate-700">
                      {reportExamLabel(report)}
                    </td>
                    <td className="py-4 pr-4">
                      <StatusBadge
                        status={
                          report.status === "FAILED"
                            ? "REJECTED"
                            : report.status
                        }
                      />
                    </td>
                    <td className="py-4 pr-4 text-slate-700">
                      {viewOnlyNetwork ? (
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="rounded-md border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700"
                            onClick={() => openReportHtml(report)}
                            type="button"
                          >
                            Report
                          </button>
                          <button
                            className="viewer-open-button inline-flex items-center gap-2 rounded-md bg-sky-700 px-3 py-2 text-xs font-bold text-white"
                            onClick={() => setViewerReport(report)}
                            type="button"
                          >
                            <Eye size={14} /> Study
                          </button>
                        </div>
                      ) : (
                        toDate(report.updatedAt)
                      )}
                    </td>
                  </tr>
                ))}
                {!reports.length && (
                  <tr>
                    <td
                      className="py-6 text-sm font-semibold text-slate-500"
                      colSpan={6}
                    >
                      No reports assigned to this radiologist yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      {viewerReport ? (
        <MarengoDicomViewerModal
          report={viewerReport}
          token={token}
          canViewInternalReports
          onClose={() => setViewerReport(null)}
        />
      ) : null}
    </Modal>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-bold uppercase text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function ReportReviewsTable({
  reports,
  token,
  canViewInternalReports = true,
}: {
  reports: ReportReview[];
  token: string;
  canViewInternalReports?: boolean;
}) {
  const [viewerReport, setViewerReport] = useState<ReportReview | null>(null);
  return (
    <>
      <SimpleTable
        columns={[
          "Report ID",
          "Generated",
          "Study",
          "Patient ID",
          "Patient Name",
          "Service",
          "Radiologist",
          "Status",
          "Output",
          "Viewer",
          "Updated",
        ]}
        rows={reports.map((report) => [
          report.id,
          toDate(report.generatedAt ?? report.createdAt),
          report.studyUid ?? report.id,
          report.patientId ?? "-",
          report.patientName ?? "-",
          report.serviceName,
          report.radiologist?.fullName ?? "Unassigned",
          report.status,
          formatLabels[report.outputFormat],
          <button
            className="viewer-open-button inline-flex items-center gap-2 rounded-md bg-sky-700 px-3 py-2 text-xs font-bold text-white"
            onClick={() => setViewerReport(report)}
            type="button"
          >
            <Eye size={14} /> Open viewer
          </button>,
          toDate(report.updatedAt),
        ])}
      />
      {viewerReport ? (
        <MarengoDicomViewerModal
          report={viewerReport}
          token={token}
          canViewInternalReports={canViewInternalReports}
          onClose={() => setViewerReport(null)}
        />
      ) : null}
    </>
  );
}

function ManualStudyUploadView({ token, client, reload, notice }: { token: string; client: Client; reload: () => Promise<void>; notice: (message: string) => void }) {
  const [modality, setModality] = useState("XRAY");
  const services = [
    { serviceType: "XRAY", name: "X-ray" },
    { serviceType: "CT", name: "CT" },
    { serviceType: "MRI", name: "MRI" },
  ];
  const serviceType = modality;
  const setServiceType = setModality;
  const [studyFile, setStudyFile] = useState<File | null>(null);
  const [selectedStudyMetadata, setSelectedStudyMetadata] = useState<Partial<BridgeStudy> | null>(null);
  const [metadataMessage, setMetadataMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function inspectStudyFile(file: File | null) {
    setStudyFile(file);
    setSelectedStudyMetadata(null);
    setMetadataMessage("");
    if (!file) return;
    if (/\.(jpe?g|png)$/i.test(file.name)) {
      setMetadataMessage("This image does not contain DICOM patient tags. Patient details can be linked from Available study.");
      return;
    }
    try {
      const dicomParser = await import("dicom-parser");
      const { BlobReader, Uint8ArrayWriter, ZipReader } = await import("@zip.js/zip.js");
      let dicomBytes: Uint8Array;
      if (/\.zip$/i.test(file.name)) {
        setMetadataMessage("Opening ZIP and locating DICOM metadata…");
        const reader = new ZipReader(new BlobReader(file));
        try {
          const entries = (await reader.getEntries()).filter((entry) => !entry.directory);
          const ordered = [...entries.filter((entry) => /\.(dcm|dicom)$/i.test(entry.filename)), ...entries.filter((entry) => !/\.(dcm|dicom)$/i.test(entry.filename))];
          let parsed: ReturnType<typeof dicomParser.parseDicom> | null = null;
          let selectedBytes: Uint8Array | null = null;
          for (const entry of ordered.slice(0, 30)) {
            if (!entry.getData || entry.uncompressedSize > 64 * 1024 * 1024) continue;
            try {
              const bytes = await entry.getData(new Uint8ArrayWriter());
              parsed = dicomParser.parseDicom(bytes);
              selectedBytes = bytes;
              break;
            } catch { /* Try the next archive entry. */ }
          }
          if (!parsed || !selectedBytes) throw new Error("No readable DICOM instance was found in the ZIP archive.");
          dicomBytes = selectedBytes;
        } finally {
          await reader.close();
        }
      } else {
        dicomBytes = new Uint8Array(await file.arrayBuffer());
      }
      const dataSet = dicomParser.parseDicom(dicomBytes);
      const text = (tag: string) => dataSet.string(tag)?.trim() || undefined;
      setSelectedStudyMetadata({
        patientName: text("x00100010")?.replace(/\^/g, " "),
        patientId: text("x00100020"),
        patientAge: text("x00101010"),
        patientSex: text("x00100040"),
        studyDescription: text("x00081030") || text("x0008103e"),
        modalities: [text("x00080060") || (modality === "XRAY" ? "DX" : modality === "MRI" ? "MR" : "CT")],
        studyDate: text("x00080020"),
        accessionNumber: text("x00080050"),
        studyInstanceUid: text("x0020000d"),
      });
      setMetadataMessage("");
    } catch (error) {
      setMetadataMessage(error instanceof Error ? error.message : "Patient metadata could not be read from this study.");
    }
  }

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!studyFile) return notice("Select a study file.");
    setUploading(true);
    try {
      const form = new FormData(); form.append("study", studyFile);
      const response = await fetch(`/api/client/study-sync/manual-upload/${modality}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.message ?? "Unable to upload study.");
      setSelectedStudyMetadata(body.study as BridgeStudy);
      setStudyFile(null); if (inputRef.current) inputRef.current.value = "";
      notice("Study uploaded to Available study. Open it there to add details and continue processing."); await reload();
    } catch (error) { notice(error instanceof Error ? error.message : "Unable to upload study."); }
    finally { setUploading(false); }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
      <form className="soft-card rounded-lg p-5" onSubmit={upload}>
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-lg bg-sky-50 text-sky-700"><UploadCloud size={22} /></span>
          <div><h2 className="text-lg font-semibold text-slate-950">Manual study upload</h2><p className="mt-1 text-sm text-slate-500">Park a study securely in {brandText(client.name)}'s Available study worklist. Uploading here does not start reporting.</p></div>
        </div>
        <div className="mt-5 grid gap-4">
          <label className="grid gap-1.5 text-sm font-semibold text-slate-700">Modality<select className="rounded-md border border-slate-200 bg-white px-3 py-2.5" required value={serviceType} onChange={(event) => setServiceType(event.target.value)}>{services.map((service) => <option key={service.serviceType} value={service.serviceType}>{service.name}</option>)}</select></label>
          <div className="grid gap-2">
            <span className="text-sm font-semibold text-slate-700">Study file</span>
            <label className="group flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-sky-300 bg-sky-50/60 p-4 transition hover:border-sky-500 hover:bg-sky-50">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-white text-sky-700 shadow-sm"><UploadCloud size={20} /></span>
              <span className="min-w-0 flex-1"><span className="block truncate font-semibold text-slate-800">{studyFile ? studyFile.name : "Choose study file"}</span><span className="mt-0.5 block text-xs font-normal text-slate-500">{studyFile ? `${(studyFile.size / 1024 / 1024).toFixed(1)} MB · Click to replace` : "DICOM, ZIP, JPG or PNG"}</span></span>
              <span className="shrink-0 rounded-md border border-sky-200 bg-white px-3 py-2 text-xs font-bold text-sky-700">Browse</span>
              <input ref={inputRef} accept=".zip,.dcm,.dicom,.jpg,.jpeg,.png,application/zip,application/dicom,image/jpeg,image/png" className="sr-only" required type="file" onChange={(event) => void inspectStudyFile(event.target.files?.[0] ?? null)} />
            </label>
          </div>
          <button className="inline-flex items-center justify-center gap-2 rounded-md bg-sky-700 px-4 py-3 font-bold text-white disabled:opacity-60" disabled={uploading || !studyFile} type="submit"><UploadCloud size={17} />{uploading ? "Uploading…" : "Upload to Available study"}</button>
        </div>
      </form>
      <section className="soft-card rounded-lg p-5">
        <div className="flex items-center justify-between gap-3"><div><h3 className="font-semibold text-slate-950">Patient information</h3><p className="mt-1 text-xs text-slate-500">Read automatically from the selected study's DICOM metadata</p></div>{selectedStudyMetadata ? <StatusBadge status="Metadata read" /> : null}</div>
        {selectedStudyMetadata ? (
          <div className="mt-5 grid grid-cols-2 gap-3">
            {[
              ["Patient name", selectedStudyMetadata.patientName],
              ["Patient ID", selectedStudyMetadata.patientId],
              ["Age", selectedStudyMetadata.patientAge],
              ["Sex", selectedStudyMetadata.patientSex],
              ["Study", selectedStudyMetadata.studyDescription],
              ["Modality", selectedStudyMetadata.modalities?.join(", ")],
              ["Study date", selectedStudyMetadata.studyDate],
              ["Accession", selectedStudyMetadata.accessionNumber],
            ].map(([label, value]) => <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3" key={label}><span className="block text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</span><span className="mt-1 block break-words text-sm font-semibold text-slate-800">{value || "Not available"}</span></div>)}
          </div>
        ) : (
          <div className="mt-5 grid min-h-48 place-items-center rounded-lg border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center"><div><span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-white text-slate-400 shadow-sm"><UserRound size={20} /></span><p className="mt-3 text-sm font-semibold text-slate-700">{studyFile ? "Reading selected study" : "No study selected yet"}</p><p className="mt-1 text-xs text-slate-500">{metadataMessage || "Choose a DICOM study to see its patient information immediately."}</p></div></div>
        )}
      </section>
    </div>
  );
}

function ClientProcessingView({
  token,
  processingJobs,
  reload,
  notice,
  readOnly = false,
}: {
  token: string;
  processingJobs: ProcessingJob[];
  reload: () => Promise<void>;
  notice: (message: string) => void;
  readOnly?: boolean;
}) {
  const [activeModality, setActiveModality] = useState<ModalityTab>("ALL");
  const [selectedJob, setSelectedJob] = useState<ProcessingJob | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortBy, setSortBy] = useState("updatedAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [filters, setFilters] = useState<Record<string, string>>({
    status: "ALL",
    priority: "ALL",
    dateFrom: "",
    dateTo: "",
  });
  const normalizedStatus = (job: ProcessingJob) =>
    job.status
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
  const canMarkUrgent = (job: ProcessingJob) => {
    const ageMs = Date.now() - new Date(job.createdAt).getTime();
    return (
      (job.priority ?? "REGULAR") !== "URGENT" &&
      ageMs <= 5 * 60 * 1000 &&
      ["queued", "processing"].includes(normalizedStatus(job))
    );
  };
  const statusSummary = {
    processing: processingJobs.filter(
      (job) => !["completed", "sent_to_pacs"].includes(normalizedStatus(job)),
    ).length,
    pacs: processingJobs.filter((job) =>
      ["completed", "sent_to_pacs"].includes(normalizedStatus(job)),
    ).length,
  };
  const modalityCounts = useMemo(() => {
    const counts = Object.fromEntries(
      modalityTabs.map((tab) => [tab, 0]),
    ) as Record<ModalityTab, number>;
    counts.ALL = processingJobs.length;
    processingJobs.forEach((job) => {
      modalityTabs.slice(1).forEach((tab) => {
        if (modalityMatches(tab, processingJobModalityValues(job)))
          counts[tab] += 1;
      });
    });
    return counts;
  }, [processingJobs]);
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredProcessingJobs = processingJobs
    .filter((job) =>
      modalityMatches(activeModality, processingJobModalityValues(job)),
    )
    .filter((job) => {
      const metadata = processingJobPatientMetadata(job);
      return (
        !normalizedSearch ||
        searchableText([
          job.id,
          job.uploadName,
          job.serviceType,
          serviceTypeLabels[job.serviceType],
          job.status,
          job.priority,
          metadata.patientId,
          metadata.patientName,
          metadata.studyDescription,
          metadata.studyInstanceUid,
        ]).includes(normalizedSearch)
      );
    })
    .filter((job) => {
      const status = clientProcessingReportStatus(job);
      if (filters.status !== "ALL" && status !== filters.status) return false;
      const priority = (job.priority ?? "REGULAR").trim().toUpperCase();
      if (filters.priority !== "ALL" && priority !== filters.priority)
        return false;
      const dateValue = sortBy === "createdAt" ? job.createdAt : job.updatedAt;
      if (!dateWithinRange(dateValue, filters.dateFrom, filters.dateTo))
        return false;
      return true;
    })
    .sort((a, b) => {
      const aMeta = processingJobPatientMetadata(a);
      const bMeta = processingJobPatientMetadata(b);
      const sortValues: Record<string, [string | number, string | number]> = {
        updatedAt: [parseDateValue(a.updatedAt), parseDateValue(b.updatedAt)],
        createdAt: [parseDateValue(a.createdAt), parseDateValue(b.createdAt)],
        patientName: [aMeta.patientName ?? "", bMeta.patientName ?? ""],
        patientId: [aMeta.patientId ?? "", bMeta.patientId ?? ""],
        service: [
          serviceTypeLabels[a.serviceType] ?? a.serviceType,
          serviceTypeLabels[b.serviceType] ?? b.serviceType,
        ],
        status: [
          clientProcessingReportStatus(a),
          clientProcessingReportStatus(b),
        ],
        priority: [a.priority ?? "REGULAR", b.priority ?? "REGULAR"],
        images: [a.imageCount, b.imageCount],
      };
      const [left, right] = sortValues[sortBy] ?? sortValues.updatedAt;
      return compareValues(left, right, sortDirection);
    });

  async function markUrgent(job: ProcessingJob) {
    try {
      await api(`/api/client/processing-jobs/${job.id}/mark-urgent`, token, {
        method: "POST",
      });
      notice(
        "Study marked urgent. Renewist submission will carry urgent=true if it has not already been sent.",
      );
      await reload();
    } catch (error) {
      notice(
        error instanceof Error ? error.message : "Unable to mark study urgent",
      );
    }
  }

  const overallStatus = statusSummary.processing
    ? "PROCESSING"
    : statusSummary.pacs
      ? "READY"
      : "ACTIVE";

  return (
    <section className="soft-card worklist-card rounded-lg p-5">
      <div className="worklist-panel-heading mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">
            Active study processing
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Track each received study from processing to radiologist review and
            PACS delivery.
          </p>
        </div>
        <StatusBadge status={overallStatus} />
      </div>
      <div className="worklist-table-frame">
        <WorklistSearchFilterBar
          query={searchQuery}
          onQueryChange={setSearchQuery}
          onFilterClick={() => setFilterOpen(true)}
          activeFilterCount={activeFilterCount(filters)}
          placeholder="Search upload, patient, service, status"
        />
        <ModalityBookmarkFilter
          active={activeModality}
          counts={modalityCounts}
          onChange={setActiveModality}
        />
        <div className="table-scroll">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                {[
                  "Study / patient",
                  "Exam",
                  "Priority",
                  "Status",
                  "Updated",
                  "Mark as Urgent",
                ].map((column) => (
                  <th className="py-3 pr-4" key={column}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredProcessingJobs.map((job) => (
                <tr
                  className="border-b border-slate-100 align-top"
                  key={job.id}
                >
                  <td className="py-4 pr-4 text-slate-700">
                    <strong className="block text-slate-900">
                      {processingJobPatientMetadata(job).patientName ?? "-"}
                    </strong>
                    <span className="text-xs text-slate-500">
                      {processingJobPatientMetadata(job).patientId ?? "-"} /{" "}
                      {job.uploadName}
                    </span>
                  </td>
                  <td className="py-4 pr-4 text-slate-700">
                    {processingJobExamLabel(job)}
                  </td>
                  <td className="py-4 pr-4">
                    <StatusBadge status={job.priority ?? "REGULAR"} />
                  </td>
                  <td className="py-4 pr-4">
                    <StatusBadge status={clientProcessingReportStatus(job)} />
                  </td>
                  <td className="py-4 pr-4 text-slate-700">
                    {toDate(job.updatedAt)}
                  </td>
                  <td className="py-4 pr-4">
                    <button
                      aria-label="Mark study as urgent"
                      className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs font-bold text-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={readOnly || !canMarkUrgent(job)}
                      onClick={() => void markUrgent(job)}
                      title={canMarkUrgent(job) ? "Mark as urgent" : (job.priority ?? "REGULAR") === "URGENT" ? "Already marked urgent" : "Urgent marking is no longer available"}
                      type="button"
                    >
                      <AlertTriangle size={15} /> <span>Urgent</span>
                    </button>
                  </td>
                </tr>
              ))}
              {!processingJobs.length && (
                <tr>
                  <td
                    className="py-6 text-sm font-semibold text-slate-500"
                    colSpan={6}
                  >
                    No studies have been received yet.
                  </td>
                </tr>
              )}
              {Boolean(processingJobs.length) &&
                !filteredProcessingJobs.length && (
                  <tr>
                    <td
                      className="py-6 text-sm font-semibold text-slate-500"
                      colSpan={6}
                    >
                      No {activeModality} studies are currently processing.
                    </td>
                  </tr>
                )}
            </tbody>
          </table>
        </div>
      </div>
      {filterOpen ? (
        <WorklistFilterModal
          title="Filter processing studies"
          sortBy={sortBy}
          sortDirection={sortDirection}
          sortOptions={[
            { value: "updatedAt", label: "Updated date / time" },
            { value: "createdAt", label: "Received date / time" },
            { value: "patientName", label: "Patient name" },
            { value: "patientId", label: "Patient ID" },
            { value: "service", label: "Service" },
            { value: "status", label: "Status" },
            { value: "priority", label: "Priority" },
            { value: "images", label: "Images" },
          ]}
          filterValues={filters}
          filterGroups={[
            {
              key: "status",
              label: "Status",
              options: [
                { value: "ALL", label: "All statuses" },
                { value: "PROCESSING", label: "Processing" },
                { value: "READY", label: "Ready" },
              ],
            },
            {
              key: "priority",
              label: "Priority",
              options: [
                { value: "ALL", label: "All priorities" },
                { value: "REGULAR", label: "Regular" },
                { value: "URGENT", label: "Urgent" },
                { value: "NIGHT", label: "Night" },
              ],
            },
          ]}
          onChangeSortBy={setSortBy}
          onChangeSortDirection={setSortDirection}
          onChangeFilter={(key, value) =>
            setFilters((current) => ({ ...current, [key]: value }))
          }
          onReset={() => {
            setSortBy("updatedAt");
            setSortDirection("desc");
            setFilters({
              status: "ALL",
              priority: "ALL",
              dateFrom: "",
              dateTo: "",
            });
          }}
          onClose={() => setFilterOpen(false)}
        />
      ) : null}
      {selectedJob ? (
        <Modal
          title="Study processing details"
          onClose={() => setSelectedJob(null)}
        >
          <div className="record-detail-grid">
            <DetailField label="Job ID" value={selectedJob.id} />
            <DetailField label="Upload" value={selectedJob.uploadName} />
            <DetailField
              label="Patient"
              value={`${processingJobPatientMetadata(selectedJob).patientName ?? "-"} / ${processingJobPatientMetadata(selectedJob).patientId ?? "-"}`}
            />
            <DetailField
              label="Study"
              value={
                processingJobPatientMetadata(selectedJob).studyDescription ??
                processingJobPatientMetadata(selectedJob).studyInstanceUid ??
                "-"
              }
            />
            <DetailField
              label="Service"
              value={
                serviceTypeLabels[selectedJob.serviceType] ??
                selectedJob.serviceType
              }
            />
            <DetailField
              label="Priority"
              value={selectedJob.priority ?? "REGULAR"}
            />
            <DetailField
              label="Images"
              value={String(selectedJob.imageCount)}
            />
            <DetailField
              label="Status"
              value={
                <StatusBadge
                  status={clientProcessingReportStatus(selectedJob)}
                />
              }
            />
            <DetailField
              label="TAT"
              value={formatTatStatus(processingJobTatStart(selectedJob), null)}
            />
            <DetailField
              label="Updated"
              value={toDate(selectedJob.updatedAt)}
            />
            <DetailField label="Error" value={selectedJob.error ?? "-"} />
          </div>
          <div className="mt-5">
            <h3 className="text-sm font-bold text-slate-900">
              Processing metadata
            </h3>
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-xs text-slate-700">
              {formatJson(selectedJob.upstreamStatus)}
            </pre>
          </div>
          {!readOnly ? (
            <div className="mt-5 flex justify-end">
              <button
                className="rounded-md border border-rose-200 px-3 py-2 text-sm font-bold text-rose-700 disabled:opacity-50"
                disabled={!canMarkUrgent(selectedJob)}
                onClick={() => void markUrgent(selectedJob)}
                type="button"
              >
                Mark urgent
              </button>
            </div>
          ) : null}
        </Modal>
      ) : null}
    </section>
  );
}

function processingJobPatientMetadata(job: ProcessingJob) {
  const status =
    job.upstreamStatus &&
    typeof job.upstreamStatus === "object" &&
    !Array.isArray(job.upstreamStatus)
      ? (job.upstreamStatus as Record<string, unknown>)
      : {};
  const metadata =
    status.dicomMetadata &&
    typeof status.dicomMetadata === "object" &&
    !Array.isArray(status.dicomMetadata)
      ? (status.dicomMetadata as Record<string, unknown>)
      : {};
  return {
    patientId:
      job.bridgeStudy?.patientId ??
      (typeof metadata.patientId === "string" ? metadata.patientId : null),
    patientName:
      job.bridgeStudy?.patientName ??
      (typeof metadata.patientName === "string" ? metadata.patientName : null),
    patientSex:
      job.bridgeStudy?.patientSex ??
      (typeof metadata.patientSex === "string" ? metadata.patientSex : null),
    patientAge:
      job.bridgeStudy?.patientAge ??
      (typeof metadata.patientAge === "string" ? metadata.patientAge : null),
    studyDescription:
      job.bridgeStudy?.studyDescription ??
      (typeof metadata.studyDescription === "string"
        ? metadata.studyDescription
        : null),
    studyInstanceUid:
      job.bridgeStudy?.studyInstanceUid ??
      (typeof metadata.studyInstanceUid === "string"
        ? metadata.studyInstanceUid
        : null),
  };
}

// List payloads omit the report JSON, so `value` may be missing.
function getReportProcessingJobId(value: Record<string, unknown> | null | undefined) {
  if (!value) return null;
  const directId = value.processingJobId;
  if (typeof directId === "string" && directId.trim()) return directId;
  const processingJob = value.processingJob;
  if (
    !processingJob ||
    typeof processingJob !== "object" ||
    Array.isArray(processingJob)
  )
    return null;
  const id = (processingJob as { id?: unknown }).id;
  return typeof id === "string" && id.trim() ? id : null;
}

function clientReportStatus(report: Pick<ReportReview, "status">) {
  if (report.status === "APPROVED" || report.status === "PUSHED")
    return "READY";
  return "PROCESSING";
}

function reportTatCompletedAt(report: Pick<ReportReview, "status" | "approvedAt" | "reviewedAt" | "pushedAt" | "updatedAt">) {
  if (clientReportStatus(report) !== "READY") return null;
  return report.approvedAt ?? report.reviewedAt ?? report.pushedAt ?? report.updatedAt;
}

function clientProcessingReportStatus(job: ProcessingJob) {
  const status = job.status
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (["completed", "sent_to_pacs"].includes(status)) return "READY";
  return "PROCESSING";
}

function processingJobTatStart(job: ProcessingJob) {
  return job.bridgeStudy?.submittedAt ?? job.createdAt;
}

function formatTatDuration(start?: string | null, end?: string | null) {
  const startTime = parseDateValue(start);
  const endTime = end ? parseDateValue(end) : Date.now();
  if (!startTime || !endTime || endTime < startTime) return "-";
  const totalMinutes = Math.max(0, Math.floor((endTime - startTime) / 60000));
  if (totalMinutes < 1) return "<1m";
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatTatStatus(start?: string | null, deliveredAt?: string | null) {
  const duration = formatTatDuration(start, deliveredAt);
  if (duration === "-") return "-";
  return deliveredAt ? duration : `${duration} live`;
}

function shouldShowProcessingReportRow(job: ProcessingJob) {
  const status = job.status
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return !["completed", "sent_to_pacs"].includes(status);
}

function ClientReportsView({
  token,
  reports,
  processingJobs,
  notice,
}: {
  token: string;
  reports: ReportReview[];
  processingJobs: ProcessingJob[];
  notice: (message: string) => void;
}) {
  const [scheduleReport, setScheduleReport] = useState<ReportReview | null>(
    null,
  );
  const [downloadReport, setDownloadReport] = useState<ReportReview | null>(
    null,
  );
  const [viewerReport, setViewerReport] = useState<ReportReview | null>(null);
  const [selectedReportDetails, setSelectedReportDetails] =
    useState<ReportReview | null>(null);
  const [selectedProcessingDetails, setSelectedProcessingDetails] =
    useState<ProcessingJob | null>(null);
  const [activeModality, setActiveModality] = useState<ModalityTab>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortBy, setSortBy] = useState("generatedAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [filters, setFilters] = useState<Record<string, string>>({
    status: "ALL",
    readiness: "ALL",
    dateFrom: "",
    dateTo: "",
  });
  const reportProcessingJobIds = new Set(
    reports
      .map(
        (report) =>
          getReportProcessingJobId(report.aiReportJson) ??
          getReportProcessingJobId(report.editedReportJson),
      )
      .filter((id): id is string => Boolean(id)),
  );
  const processingJobById = new Map(processingJobs.map((job) => [job.id, job]));
  const processingReportRows = processingJobs.filter(
    (job) =>
      shouldShowProcessingReportRow(job) && !reportProcessingJobIds.has(job.id),
  );
  const modalityCounts = useMemo(() => {
    const counts = Object.fromEntries(
      modalityTabs.map((tab) => [tab, 0]),
    ) as Record<ModalityTab, number>;
    counts.ALL = reports.length + processingReportRows.length;
    reports.forEach((report) => {
      modalityTabs.slice(1).forEach((tab) => {
        if (modalityMatches(tab, reportModalityValues(report)))
          counts[tab] += 1;
      });
    });
    processingReportRows.forEach((job) => {
      modalityTabs.slice(1).forEach((tab) => {
        if (modalityMatches(tab, processingJobModalityValues(job)))
          counts[tab] += 1;
      });
    });
    return counts;
  }, [processingReportRows, reports]);
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredProcessingReportRows = processingReportRows
    .filter((job) =>
      modalityMatches(activeModality, processingJobModalityValues(job)),
    )
    .filter((job) => {
      const metadata = processingJobPatientMetadata(job);
      return (
        !normalizedSearch ||
        searchableText([
          job.id,
          job.uploadName,
          job.serviceType,
          serviceTypeLabels[job.serviceType],
          job.status,
          metadata.patientId,
          metadata.patientName,
          metadata.studyDescription,
          metadata.studyInstanceUid,
        ]).includes(normalizedSearch)
      );
    })
    .filter((job) => {
      const readiness = clientProcessingReportStatus(job);
      if (filters.readiness !== "ALL" && readiness !== filters.readiness)
        return false;
      if (
        filters.status !== "ALL" &&
        job.status
          .trim()
          .toUpperCase()
          .replace(/[\s-]+/g, "_") !== filters.status
      )
        return false;
      const dateValue = sortBy === "updatedAt" ? job.updatedAt : job.createdAt;
      if (!dateWithinRange(dateValue, filters.dateFrom, filters.dateTo))
        return false;
      return true;
    });
  const filteredReports = reports
    .filter((report) =>
      modalityMatches(activeModality, reportModalityValues(report)),
    )
    .filter(
      (report) =>
        !normalizedSearch ||
        searchableText([
          report.id,
          report.studyUid,
          report.accession,
          report.patientId,
          report.patientName,
          report.serviceName,
          report.modality,
          report.status,
        ]).includes(normalizedSearch),
    )
    .filter((report) => {
      const readiness = clientReportStatus(report);
      if (filters.readiness !== "ALL" && readiness !== filters.readiness)
        return false;
      if (filters.status !== "ALL" && report.status !== filters.status)
        return false;
      const dateValue =
        sortBy === "updatedAt"
          ? report.updatedAt
          : (report.generatedAt ?? report.createdAt);
      if (!dateWithinRange(dateValue, filters.dateFrom, filters.dateTo))
        return false;
      return true;
    });
  const reportRowsForDisplay = [...filteredReports].sort((a, b) => {
    const sortValues: Record<string, [string | number, string | number]> = {
      generatedAt: [
        parseDateValue(a.generatedAt ?? a.createdAt),
        parseDateValue(b.generatedAt ?? b.createdAt),
      ],
      updatedAt: [parseDateValue(a.updatedAt), parseDateValue(b.updatedAt)],
      patientName: [a.patientName ?? "", b.patientName ?? ""],
      patientId: [a.patientId ?? "", b.patientId ?? ""],
      service: [a.serviceName, b.serviceName],
      status: [clientReportStatus(a), clientReportStatus(b)],
      reportId: [a.id, b.id],
    };
    const [left, right] = sortValues[sortBy] ?? sortValues.generatedAt;
    return compareValues(left, right, sortDirection);
  });
  const processingRowsForDisplay = [...filteredProcessingReportRows].sort(
    (a, b) => {
      const aMeta = processingJobPatientMetadata(a);
      const bMeta = processingJobPatientMetadata(b);
      const sortValues: Record<string, [string | number, string | number]> = {
        generatedAt: [parseDateValue(a.createdAt), parseDateValue(b.createdAt)],
        updatedAt: [parseDateValue(a.updatedAt), parseDateValue(b.updatedAt)],
        patientName: [aMeta.patientName ?? "", bMeta.patientName ?? ""],
        patientId: [aMeta.patientId ?? "", bMeta.patientId ?? ""],
        service: [
          serviceTypeLabels[a.serviceType] ?? a.serviceType,
          serviceTypeLabels[b.serviceType] ?? b.serviceType,
        ],
        status: [
          clientProcessingReportStatus(a),
          clientProcessingReportStatus(b),
        ],
        reportId: [a.id, b.id],
      };
      const [left, right] = sortValues[sortBy] ?? sortValues.generatedAt;
      return compareValues(left, right, sortDirection);
    },
  );
  const rowCount =
    reportRowsForDisplay.length + processingRowsForDisplay.length;
  const totalRowCount = reports.length + processingReportRows.length;

  function reportIsReady(report: ReportReview) {
    return report.status === "PUSHED" || report.status === "APPROVED";
  }

  async function fetchReportFile(
    report: ReportReview,
    format: "pdf" | "docx",
    download: boolean,
    variant: "with-letterhead" | "without-letterhead" = "with-letterhead",
  ) {
    if (!reportIsReady(report)) {
      notice("Final signed report is not available yet.");
      return;
    }
    try {
      const query = new URLSearchParams({ format });
      if (download) query.set("download", "1");
      if (format === "pdf" && variant === "without-letterhead")
        query.set("variant", "without-letterhead");
      const endpoint =
        format === "pdf"
          ? `/api/client/reports/${encodeURIComponent(report.id)}/pdf?${query.toString()}`
          : `/api/client/reports/${encodeURIComponent(report.id)}/download?${query.toString()}`;
      const response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
            body?.message ??
            `Report ${format.toUpperCase()} is not available yet`,
        );
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      if (download) {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${report.id}${variant === "without-letterhead" ? "-without-letterhead" : ""}.${format}`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
      } else {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch (error) {
      notice(
        error instanceof Error
          ? error.message
          : `Unable to open report ${format.toUpperCase()}`,
      );
    }
  }
  function activeBooking(report: ReportReview) {
    const now = Date.now();
    return (report.callBookings ?? [])
      .filter(
        (booking) =>
          [
            "REQUESTED",
            "MANAGER_ACCEPTED",
            "RADIOLOGIST_ACCEPTED",
            "BOOKED",
          ].includes(booking.status) &&
          new Date(booking.slotEnd).getTime() > now,
      )
      .sort(
        (a, b) =>
          new Date(a.slotStart).getTime() - new Date(b.slotStart).getTime(),
      )[0];
  }
  function canJoinCall(booking: ReportCallBooking) {
    const now = Date.now();
    const start = new Date(booking.slotStart).getTime();
    const end = new Date(booking.slotEnd).getTime();
    return now >= start - 5 * 60 * 1000 && now <= end;
  }
  function canRescheduleCall(booking: ReportCallBooking) {
    return (
      new Date(booking.slotStart).getTime() - Date.now() >= 2 * 60 * 60 * 1000
    );
  }
  const selectedReportReady = selectedReportDetails
    ? reportIsReady(selectedReportDetails)
    : false;
  const selectedReportBooking = selectedReportDetails
    ? activeBooking(selectedReportDetails)
    : undefined;
  const selectedReportJobId = selectedReportDetails
    ? (getReportProcessingJobId(selectedReportDetails.aiReportJson) ??
      getReportProcessingJobId(selectedReportDetails.editedReportJson))
    : null;
  const selectedReportLinkedJob = selectedReportJobId
    ? processingJobById.get(selectedReportJobId)
    : undefined;

  return (
    <section className="soft-card worklist-card rounded-lg p-5">
      <div className="worklist-panel-heading mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Reports</h2>
          <p className="mt-1 text-sm text-slate-500">
            View final reports, download with or without letterhead, or book a 15 minute
            call with the radiologist.
          </p>
        </div>
        <StatusBadge status={totalRowCount ? "ACTIVE" : "PENDING"} />
      </div>
      <div className="worklist-table-frame">
        <WorklistSearchFilterBar
          query={searchQuery}
          onQueryChange={setSearchQuery}
          onFilterClick={() => setFilterOpen(true)}
          activeFilterCount={activeFilterCount(filters)}
          placeholder="Search report, patient, study, service"
        />
        <ModalityBookmarkFilter
          active={activeModality}
          counts={modalityCounts}
          onChange={setActiveModality}
        />
        <div className="table-scroll">
          <table className="client-reports-table w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                {[
                  "Patient / report",
                  "Generated",
                  "Exam",
                  "Status",
                  "TAT",
                  "View Report",
                ].map((column) => (
                  <th className="py-3 pr-4" key={column}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {processingRowsForDisplay.map((job) => (
                <tr
                  className="border-b border-slate-100 align-top"
                  key={job.id}
                >
                  <td className="py-4 pr-4 text-slate-700">
                    <strong className="block text-slate-900">
                      {processingJobPatientMetadata(job).patientName ?? "-"}
                    </strong>
                    <span className="text-xs text-slate-500">
                      {processingJobPatientMetadata(job).patientId ?? "-"} /{" "}
                      {job.id}
                    </span>
                  </td>
                  <td className="py-4 pr-4 text-slate-700">
                    {toDate(job.createdAt)}
                  </td>
                  <td className="py-4 pr-4 text-slate-700">
                    {processingJobExamLabel(job)}
                  </td>
                  <td className="py-4 pr-4">
                    <StatusBadge status={clientProcessingReportStatus(job)} />
                  </td>
                  <td className="py-4 pr-4 text-slate-700">
                    {formatTatStatus(processingJobTatStart(job), null)}
                  </td>
                  <td className="py-4 pr-4">
                    <span className="text-xs font-semibold text-slate-400" title="Report actions become available when the signed report is ready">Pending</span>
                  </td>
                </tr>
              ))}
              {reportRowsForDisplay.map((report) => {
                const jobId =
                  getReportProcessingJobId(report.aiReportJson) ??
                  getReportProcessingJobId(report.editedReportJson);
                const linkedJob = jobId
                  ? processingJobById.get(jobId)
                  : undefined;
                const tatStart = linkedJob
                  ? processingJobTatStart(linkedJob)
                  : report.createdAt;
                return (
                  <tr
                    className="border-b border-slate-100 align-top"
                    key={report.id}
                  >
                    <td className="py-4 pr-4 text-slate-700">
                      <strong className="block text-slate-900">
                        {report.patientName ?? "-"}
                      </strong>
                      <span className="text-xs text-slate-500">
                        {report.patientId ?? "-"} / {report.id}
                      </span>
                    </td>
                    <td className="py-4 pr-4 text-slate-700">
                      {toDate(report.generatedAt ?? report.createdAt)}
                    </td>
                    <td className="py-4 pr-4 text-slate-700">
                      {reportExamLabel(report)}
                    </td>
                    <td className="py-4 pr-4">
                      <StatusBadge status={clientReportStatus(report)} />
                    </td>
                    <td className="py-4 pr-4 text-slate-700">
                      {formatTatStatus(tatStart, reportTatCompletedAt(report))}
                    </td>
                    <td className="py-4 pr-4">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          aria-label="Open report"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-sky-200 bg-sky-50 text-sky-700 disabled:opacity-40"
                          disabled={!reportIsReady(report)}
                          onClick={() => void fetchReportFile(report, "pdf", false)}
                          title="Open report"
                          type="button"
                        ><FileText size={16} /></button>
                        <button
                          aria-label="Open DICOM viewer"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700"
                          onClick={() => setViewerReport(report)}
                          title="DICOM viewer"
                          type="button"
                        ><Eye size={16} /></button>
                        <ShareReportButton
                          compact
                          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-violet-200 bg-violet-50 text-violet-700 disabled:cursor-not-allowed disabled:opacity-40"
                          disabled={!reportIsReady(report)}
                          report={report}
                          token={token}
                        />
                        <button
                          aria-label="Download report"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 disabled:opacity-40"
                          disabled={!reportIsReady(report)}
                          onClick={() => setDownloadReport(report)}
                          title="Download report"
                          type="button"
                        ><Download size={16} /></button>
                        <button
                          aria-label={activeBooking(report) ? "Reschedule call" : "Schedule call"}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 disabled:opacity-40"
                          disabled={Boolean(activeBooking(report) && !canRescheduleCall(activeBooking(report)!))}
                          onClick={() => setScheduleReport(report)}
                          title={activeBooking(report) ? "Reschedule call" : "Schedule call"}
                          type="button"
                        ><Phone size={16} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!totalRowCount && (
                <tr>
                  <td
                    className="py-6 text-sm font-semibold text-slate-500"
                    colSpan={6}
                  >
                    No reports are available yet.
                  </td>
                </tr>
              )}
              {Boolean(totalRowCount) && !rowCount && (
                <tr>
                  <td
                    className="py-6 text-sm font-semibold text-slate-500"
                    colSpan={6}
                  >
                    No {activeModality} reports are available yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {selectedProcessingDetails ? (
        <Modal
          title="Pending report details"
          onClose={() => setSelectedProcessingDetails(null)}
        >
          <div className="record-detail-grid">
            <DetailField label="Job ID" value={selectedProcessingDetails.id} />
            <DetailField
              label="Patient"
              value={`${processingJobPatientMetadata(selectedProcessingDetails).patientName ?? "-"} / ${processingJobPatientMetadata(selectedProcessingDetails).patientId ?? "-"}`}
            />
            <DetailField
              label="Study"
              value={
                processingJobPatientMetadata(selectedProcessingDetails)
                  .studyDescription ?? selectedProcessingDetails.uploadName
              }
            />
            <DetailField
              label="Service"
              value={
                serviceTypeLabels[selectedProcessingDetails.serviceType] ??
                selectedProcessingDetails.serviceType
              }
            />
            <DetailField
              label="Priority"
              value={selectedProcessingDetails.priority ?? "REGULAR"}
            />
            <DetailField
              label="Images"
              value={String(selectedProcessingDetails.imageCount)}
            />
            <DetailField
              label="Status"
              value={
                <StatusBadge
                  status={clientProcessingReportStatus(
                    selectedProcessingDetails,
                  )}
                />
              }
            />
            <DetailField
              label="TAT"
              value={formatTatStatus(
                processingJobTatStart(selectedProcessingDetails),
                null,
              )}
            />
            <DetailField
              label="Received"
              value={toDate(selectedProcessingDetails.createdAt)}
            />
            <DetailField
              label="Updated"
              value={toDate(selectedProcessingDetails.updatedAt)}
            />
          </div>
          <p className="mt-5 rounded-md bg-slate-50 p-3 text-sm font-semibold text-slate-600">
            The final report actions become available after the signed report is
            returned.
          </p>
        </Modal>
      ) : null}
      {selectedReportDetails ? (
        <Modal
          title="Report details"
          onClose={() => setSelectedReportDetails(null)}
        >
          <div className="record-detail-grid">
            <DetailField label="Report ID" value={selectedReportDetails.id} />
            <DetailField
              label="Patient"
              value={`${selectedReportDetails.patientName ?? "-"} / ${selectedReportDetails.patientId ?? "-"}`}
            />
            <DetailField
              label="Study UID"
              value={selectedReportDetails.studyUid ?? "-"}
            />
            <DetailField
              label="Service"
              value={selectedReportDetails.serviceName}
            />
            <DetailField
              label="Radiologist"
              value={
                selectedReportDetails.radiologist?.fullName ?? "Unassigned"
              }
            />
            <DetailField
              label="Status"
              value={
                <StatusBadge
                  status={clientReportStatus(selectedReportDetails)}
                />
              }
            />
            <DetailField
              label="Generated"
              value={toDate(
                selectedReportDetails.generatedAt ??
                  selectedReportDetails.createdAt,
              )}
            />
            <DetailField
              label="TAT"
              value={formatTatStatus(
                selectedReportLinkedJob
                  ? processingJobTatStart(selectedReportLinkedJob)
                  : selectedReportDetails.createdAt,
                reportTatCompletedAt(selectedReportDetails),
              )}
            />
          </div>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button
              className="table-view-button disabled:opacity-50"
              disabled={!selectedReportReady}
              onClick={() =>
                void fetchReportFile(selectedReportDetails, "pdf", false)
              }
              type="button"
            >
              <FileText className="mr-1 inline" size={14} />
              Open PDF
            </button>
            <button
              className="table-view-button"
              onClick={() => {
                setViewerReport(selectedReportDetails);
                setSelectedReportDetails(null);
              }}
              type="button"
            >
              <Eye className="mr-1 inline" size={14} />
              DICOM viewer
            </button>
            <button
              className="table-view-button disabled:opacity-50"
              disabled={!selectedReportReady}
              onClick={() => {
                setDownloadReport(selectedReportDetails);
                setSelectedReportDetails(null);
              }}
              type="button"
            >
              <Download className="mr-1 inline" size={14} />
              Download
            </button>
            {selectedReportBooking &&
            selectedReportBooking.status === "BOOKED" &&
            canJoinCall(selectedReportBooking) ? (
              <button
                className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-bold text-white"
                onClick={() =>
                  window.open(selectedReportBooking.meetingUrl, "_blank")
                }
                type="button"
              >
                <Phone className="mr-1 inline" size={14} />
                Join call
              </button>
            ) : (
              <button
                className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
                disabled={Boolean(
                  selectedReportBooking &&
                  !canRescheduleCall(selectedReportBooking),
                )}
                onClick={() => {
                  setScheduleReport(selectedReportDetails);
                  setSelectedReportDetails(null);
                }}
                type="button"
              >
                <Phone className="mr-1 inline" size={14} />
                {selectedReportBooking ? "Reschedule call" : "Schedule call"}
              </button>
            )}
          </div>
        </Modal>
      ) : null}
      {downloadReport ? (
        <Modal title="Download report" onClose={() => setDownloadReport(null)}>
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-bold text-slate-900">
                {downloadReport.id}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                {downloadReport.patientName ?? "Patient"} -{" "}
                {downloadReport.serviceName}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 hover:border-sky-300 hover:bg-sky-50"
                onClick={() => {
                  const report = downloadReport;
                  setDownloadReport(null);
                  void fetchReportFile(report, "pdf", true);
                }}
                type="button"
              >
                <FileText size={16} /> With letterhead
              </button>
              <button
                className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 hover:border-sky-300 hover:bg-sky-50"
                onClick={() => {
                  const report = downloadReport;
                  setDownloadReport(null);
                  void fetchReportFile(report, "pdf", true, "without-letterhead");
                }}
                type="button"
              >
                <FileText size={16} /> Without letterhead
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
      {scheduleReport ? (
        <ScheduleCallModal
          report={scheduleReport}
          token={token}
          notice={notice}
          onClose={() => setScheduleReport(null)}
        />
      ) : null}
      {viewerReport ? (
        <MarengoDicomViewerModal
          report={viewerReport}
          token={token}
          onClose={() => setViewerReport(null)}
        />
      ) : null}
      {filterOpen ? (
        <WorklistFilterModal
          title="Filter reports"
          sortBy={sortBy}
          sortDirection={sortDirection}
          sortOptions={[
            { value: "generatedAt", label: "Generated date / time" },
            { value: "updatedAt", label: "Updated date / time" },
            { value: "patientName", label: "Patient name" },
            { value: "patientId", label: "Patient ID" },
            { value: "service", label: "Service" },
            { value: "status", label: "Status" },
            { value: "reportId", label: "Report ID" },
          ]}
          filterValues={filters}
          filterGroups={[
            {
              key: "readiness",
              label: "Readiness",
              options: [
                { value: "ALL", label: "All reports" },
                { value: "PROCESSING", label: "Processing" },
                { value: "READY", label: "Ready" },
              ],
            },
            {
              key: "status",
              label: "Report status",
              options: [
                { value: "ALL", label: "All statuses" },
                { value: "PENDING", label: "Pending" },
                { value: "IN_REVIEW", label: "In review" },
                { value: "SAVED", label: "Saved" },
                { value: "APPROVED", label: "Approved" },
                { value: "PUSHED", label: "Pushed" },
                { value: "FAILED", label: "Failed" },
              ],
            },
          ]}
          onChangeSortBy={setSortBy}
          onChangeSortDirection={setSortDirection}
          onChangeFilter={(key, value) =>
            setFilters((current) => ({ ...current, [key]: value }))
          }
          onReset={() => {
            setSortBy("generatedAt");
            setSortDirection("desc");
            setFilters({
              status: "ALL",
              readiness: "ALL",
              dateFrom: "",
              dateTo: "",
            });
          }}
          onClose={() => setFilterOpen(false)}
        />
      ) : null}
    </section>
  );
}

function ScheduleCallModal({
  report,
  token,
  notice,
  onClose,
}: {
  report: ReportReview;
  token: string;
  notice: (message: string) => void;
  onClose: () => void;
}) {
  const existingBooking =
    (report.callBookings ?? [])
      .filter(
        (item) =>
          item.status === "BOOKED" &&
          new Date(item.slotEnd).getTime() > Date.now(),
      )
      .sort(
        (a, b) =>
          new Date(a.slotStart).getTime() - new Date(b.slotStart).getTime(),
      )[0] ?? null;
  const [bookings, setBookings] = useState<ReportCallBooking[]>(
    report.callBookings ?? [],
  );
  const [booking, setBooking] = useState<ReportCallBooking | null>(
    existingBooking,
  );
  const [callOptions, setCallOptions] = useState<CallOptions | null>(null);
  const [selectedAvailabilityId, setSelectedAvailabilityId] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(
    existingBooking?.requestedDurationMinutes
      ? String(existingBooking.requestedDurationMinutes)
      : "15",
  );
  const [communicationMode, setCommunicationMode] = useState<
    "BUILT_IN_MEETING" | "PHONE_CALL"
  >("BUILT_IN_MEETING");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [loading, setLoading] = useState(true);
  const [bookingBusy, setBookingBusy] = useState(false);
  const selectedDuration = Math.max(5, Number(durationMinutes || 15));
  const selectedAvailability =
    callOptions?.slots.find((item) => item.id === selectedAvailabilityId) ??
    null;
  const selectedSlot = selectedAvailability?.slotStart ?? "";

  const confirmedBooking =
    booking ??
    bookings
      .filter(
        (item) =>
          item.status === "BOOKED" &&
          new Date(item.slotEnd).getTime() > Date.now(),
      )
      .sort(
        (a, b) =>
          new Date(a.slotStart).getTime() - new Date(b.slotStart).getTime(),
      )[0] ??
    null;
  const canRescheduleExisting =
    !confirmedBooking ||
    new Date(confirmedBooking.slotStart).getTime() - Date.now() >=
      2 * 60 * 60 * 1000;
  const selectedIsFuture = selectedSlot
    ? new Date(selectedSlot).getTime() > Date.now()
    : false;


  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api<ReportCallBooking[]>(
        `/api/client/reports/${encodeURIComponent(report.id)}/call-bookings`,
        token,
      ),
      api<CallOptions>(
        `/api/client/reports/${encodeURIComponent(report.id)}/call-options?durationMinutes=${encodeURIComponent(String(selectedDuration))}`,
        token,
      ),
    ])
      .then(([nextBookings, options]) => {
        if (cancelled) return;
        setBookings(nextBookings);
        const nextBooking = nextBookings.find(
          (item) =>
            item.status === "BOOKED" &&
            new Date(item.slotEnd).getTime() > Date.now(),
        );
        if (nextBooking) setBooking(nextBooking);
        setCallOptions(options);
        if (
          selectedAvailabilityId &&
          !options.slots.some((item) => item.id === selectedAvailabilityId)
        )
          setSelectedAvailabilityId("");
      })
      .catch((error) =>
        notice(
          error instanceof Error
            ? error.message
            : "Unable to load radiologist call scheduling",
        ),
      )
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [report.id, token, selectedDuration]);

  function selectAvailability(id: string) {
    setSelectedAvailabilityId(id);
  }

  async function bookSlot() {
    if (!selectedSlot || !selectedIsFuture) {
      notice("Choose a future date and time.");
      return;
    }
    if (confirmedBooking && !canRescheduleExisting) {
      notice(
        "Rescheduling is allowed only up to 2 hours before the booked call.",
      );
      return;
    }
    setBookingBusy(true);
    try {
      const result = await api<ReportCallBooking>(
        `/api/client/reports/${encodeURIComponent(report.id)}/call-bookings`,
        token,
        {
          method: "POST",
          body: JSON.stringify({
            availabilityId: selectedAvailabilityId || undefined,
            slotStart: selectedSlot,
            durationMinutes: selectedDuration,
            communicationMode,
            phoneNumber,
          }),
        },
      );
      setBooking(result);
      setBookings((current) =>
        current.filter((item) => item.id !== result.id).concat(result),
      );
      notice("Call request raised for Renewist confirmation.");
    } catch (error) {
      notice(error instanceof Error ? error.message : "Unable to book slot");
    } finally {
      setBookingBusy(false);
    }
  }

  return (
    <Modal title="Schedule radiologist call" onClose={onClose} wide>
      <div className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h3 className="text-lg font-semibold text-slate-950">
            Select date and time
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            {report.id} - {report.patientName ?? "Patient"} -{" "}
            {report.radiologist?.fullName ?? "Radiologist"}
          </p>
          {loading ? (
            <p className="mt-5 text-sm font-semibold text-slate-500">
              Loading current booking...
            </p>
          ) : null}
          <div className="mt-5 grid gap-4">
            <TextInput
              label="Duration minutes"
              value={durationMinutes}
              onChange={(value) => {
                setDurationMinutes(value.replace(/\D/g, ""));
                setSelectedAvailabilityId("");
              }}
            />
            <SelectInput
              label="Preferred time window (IST)"
              value={selectedAvailabilityId}
              onChange={selectAvailability}
              options={[
                ["", "Select preferred start"],
                ...(callOptions?.slots ?? []).map((slot) => {
                  return [
                    slot.id,
                    `${slot.radiologist?.fullName ?? "Radiologist"} - ${toDate(slot.slotStart)} ${new Date(slot.slotStart).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} - ${new Date(slot.slotEnd).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
                  ] as [string, string];
                }),
              ]}
            />
            <SelectInput
              label="Mode of communication"
              value={communicationMode}
              onChange={(value) =>
                setCommunicationMode(value as "BUILT_IN_MEETING" | "PHONE_CALL")
              }
              options={[
                ["BUILT_IN_MEETING", "Screen call"],
                ["PHONE_CALL", "Phone call"],
              ]}
            />
            {communicationMode === "PHONE_CALL" ? (
              <TextInput
                label="Phone number to receive call"
                value={phoneNumber}
                onChange={setPhoneNumber}
              />
            ) : null}
            <p className="pw-help">Preferred time window; confirmation is pending.</p>

            {confirmedBooking && !canRescheduleExisting ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
                This call is within 2 hours. Rescheduling is locked.
              </div>
            ) : null}
          </div>
          <button
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
            disabled={
              !selectedSlot ||
              !selectedIsFuture ||
              bookingBusy ||
              Boolean(confirmedBooking && !canRescheduleExisting)
            }
            onClick={() => void bookSlot()}
            type="button"
          >
            <Phone size={16} />{" "}
            {bookingBusy
              ? "Requesting..."
              : confirmedBooking
                ? "Confirm reschedule request"
                : "Raise call request"}
          </button>
        </section>
        <section className="rounded-lg border border-slate-200 bg-slate-950 p-5 text-white">
          <h3 className="text-lg font-semibold">Confirmed slot</h3>
          <p className="mt-1 text-sm text-slate-300">
            The slot is confirmed after Renewist manager and radiologist
            acceptance.
          </p>
          {confirmedBooking ? (
            <div className="mt-5 space-y-4">
              <div className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-4 text-sm font-semibold text-emerald-100">
                <p>
                  {confirmedBooking.status === "BOOKED"
                    ? "Confirmed"
                    : "Requested"}{" "}
                  for {toDate(confirmedBooking.slotStart)} at{" "}
                  {new Date(confirmedBooking.slotStart).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
                <p className="mt-1 text-xs text-emerald-200">
                  Mode:{" "}
                  {confirmedBooking.communicationMode === "PHONE_CALL"
                    ? `Phone call ${confirmedBooking.phoneNumber ?? ""}`
                    : "Built-in meeting"}
                </p>
                <p className="mt-2 break-words text-xs text-emerald-200">
                  Room: {confirmedBooking.meetingRoom}
                </p>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-900 p-5">
                <Phone className="text-slate-400" size={32} />
                <p className="mt-3 text-sm font-semibold text-slate-200">
                  The call room will open in a separate browser tab.
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Camera, microphone, and screen sharing permissions will be
                  requested there.
                </p>
              </div>
              <button
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-500"
                onClick={() =>
                  window.open(
                    confirmedBooking.meetingUrl,
                    "_blank",
                    "noopener,noreferrer",
                  )
                }
                type="button"
              >
                <Phone size={16} /> Join call
              </button>
            </div>
          ) : (
            <div className="mt-5 grid min-h-[520px] place-items-center rounded-lg border border-dashed border-slate-700 bg-slate-900 text-center">
              <div>
                <Phone className="mx-auto text-slate-500" size={36} />
                <p className="mt-3 text-sm font-semibold text-slate-300">
                  Select a slot and book to create the video room.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}

function RadiologistContent({
  active,
  profile,
  token,
  reload,
  notice,
}: {
  active: string;
  profile: RadiologistProfile;
  token: string;
  reload: () => Promise<void>;
  notice: (message: string) => void;
}) {
  const reports = profile.reportReviews ?? [];
  if (active === "Notifications") return <NotificationCenterView token={token} />;
  if (active === "AI Report Feedback") return <RadiologistFeedbackByPatientView token={token} notice={notice} />;
  if (active === "Call Requests") return <CallRequestsView token={token} notice={notice} reports={reports} />;
  if (active === "Profile")
    return <RadiologistProfilePanel profile={profile} />;
  if (active === "Generated Reports")
    return (
      <ReportReviewsTable
        reports={reports}
        token={token}
        canViewInternalReports={false}
      />
    );
  return (
    <RadiologistReports
      profile={profile}
      reports={reports}
      token={token}
      reload={reload}
      notice={notice}
      readOnly
    />
  );
}

function RadiologistReports({
  profile,
  reports,
  token,
  reload,
  notice,
  readOnly = false,
}: {
  profile: RadiologistProfile;
  reports: ReportReview[];
  token: string;
  reload: () => Promise<void>;
  notice: (message: string) => void;
  readOnly?: boolean;
}) {
  const [selectedReportId, setSelectedReportId] = useState("");
  const [viewerReport, setViewerReport] = useState<ReportReview | null>(null);
  const centerOptions = Array.from(
    new Map(
      reports.map((report) => [
        report.clientId,
        report.client ?? { name: "Unknown center", code: report.clientId },
      ]),
    ).entries(),
  );
  const [centerId, setCenterId] = useState("ALL");
  const displayReports =
    centerId === "ALL"
      ? reports
      : reports.filter((report) => report.clientId === centerId);
  const selectedReport = reports.find(
    (report) => report.id === selectedReportId,
  );
  async function claimReport(report: ReportReview) {
    try {
      await api<ReportReview>(
        `/api/radiologist/reports/${report.id}/claim`,
        token,
        { method: "PATCH" },
      );
      notice("Report claimed. You can now review and sign it.");
      await reload();
      setSelectedReportId(report.id);
    } catch (error) {
      notice(
        error instanceof Error ? error.message : "Unable to claim report.",
      );
    }
  }

  if (selectedReport) {
    return (
      <RadiologistReportCard
        report={selectedReport}
        token={token}
        reload={reload}
        notice={notice}
        onBack={() => setSelectedReportId("")}
        readOnly={readOnly}
      />
    );
  }

  return (
    <section className="soft-card rounded-lg p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">
            {readOnly ? "Marengo studies and reports" : "Pending report queue"}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {readOnly
              ? "View studies and generated reports across Marengo centers."
              : "Open a report to review, edit, save, and approve it for PACS delivery."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {readOnly ? (
            <SelectInput
              label="Center"
              value={centerId}
              onChange={setCenterId}
              options={[
                ["ALL", "All centers"],
                ...centerOptions.map(
                  ([id, center]) =>
                    [id, `${brandText(center.name)} (${center.code})`] as [
                      string,
                      string,
                    ],
                ),
              ]}
            />
          ) : null}
          <StatusBadge
            status={
              reports.length ? (readOnly ? "VIEW ONLY" : "PENDING") : "ACTIVE"
            }
          />
        </div>
      </div>
      <div className="table-scroll">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
              {(readOnly
                ? [
                    "Center",
                    "Patient / report",
                    "Study",
                    "Status",
                    "Updated",
                    "Action",
                  ]
                : [
                    "Patient / report",
                    "Study",
                    "Exam",
                    "Status",
                    "Updated",
                    "Action",
                  ]
              ).map((column) => (
                <th className="py-3 pr-4" key={column}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayReports.map((report) => (
              <tr className="border-b border-slate-100" key={report.id}>
                {readOnly ? (
                  <td className="py-4 pr-4 text-slate-700">
                    {brandText(report.client?.name ?? "-")}
                  </td>
                ) : null}
                <td className="py-4 pr-4 text-slate-700">
                  <strong className="block text-slate-900">
                    {report.patientName ?? "-"}
                  </strong>
                  <span className="text-xs text-slate-500">
                    {report.patientId ?? "-"} / {report.id}
                  </span>
                </td>
                <td className="py-4 pr-4 text-slate-700">
                  {report.studyUid ?? report.id}
                </td>
                {!readOnly ? (
                  <td className="py-4 pr-4 text-slate-700">
                    {reportExamLabel(report)}
                  </td>
                ) : null}
                <td className="py-4 pr-4">
                  <StatusBadge status={report.status} />
                </td>
                <td className="py-4 pr-4 text-slate-700">
                  {toDate(report.updatedAt)}
                </td>
                <td className="py-4 pr-4">
                  <div className="flex flex-wrap gap-2">
                    {readOnly ? (
                      <button
                        className="inline-flex items-center gap-2 rounded-md bg-sky-700 px-3 py-2 text-sm font-bold text-white"
                        onClick={() => setSelectedReportId(report.id)}
                        title="View study and report"
                        type="button"
                      >
                        <Eye size={16} /> View
                      </button>
                    ) : (
                      <button
                        className="viewer-open-button inline-flex items-center gap-2 rounded-md bg-sky-700 px-3 py-2 text-sm font-bold text-white"
                        onClick={() => setViewerReport(report)}
                        title="Open DICOM viewer"
                        type="button"
                      >
                        <Eye size={16} /> Open viewer
                      </button>
                    )}
                    {!readOnly && report.radiologistId === profile.id ? (
                      <button
                        className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700"
                        onClick={() => setSelectedReportId(report.id)}
                        title="View report"
                        type="button"
                      >
                        <FileText size={16} /> View
                      </button>
                    ) : !readOnly ? (
                      <button
                        className="inline-flex items-center gap-2 rounded-md bg-sky-600 px-3 py-2 text-sm font-bold text-white"
                        onClick={() => void claimReport(report)}
                        title="Claim report"
                        type="button"
                      >
                        <Plus size={16} /> Claim
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {!displayReports.length && (
              <tr>
                <td
                  className="py-6 text-sm font-semibold text-slate-500"
                  colSpan={6}
                >
                  {readOnly
                    ? "No reports found for this center."
                    : "No pending reports assigned."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {viewerReport ? (
        <MarengoDicomViewerModal
          report={viewerReport}
          token={token}
          canViewInternalReports
          onClose={() => setViewerReport(null)}
        />
      ) : null}
    </section>
  );
}








function getSpeechRecognitionConstructor() {
  const speechWindow = window as WindowWithSpeechRecognition;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
}

function RadiologistReportCard({
  report,
  token,
  reload,
  notice,
  onBack,
  readOnly = false,
}: {
  report: ReportReview;
  token: string;
  reload: () => Promise<void>;
  notice: (message: string) => void;
  onBack?: () => void;
  readOnly?: boolean;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const dictationActiveRef = useRef(false);
  const savedRangeRef = useRef<Range | null>(null);
  const lastReportIdRef = useRef("");
  const originalReportHtml = String(
    report.editedReportJson?.htmlReport ??
      report.aiReportJson?.htmlReport ??
      "",
  );
  const [reportParts, setReportParts] = useState(() =>
    extractEditableReportParts(originalReportHtml),
  );
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [dictating, setDictating] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [providerPdfData, setProviderPdfData] = useState<ArrayBuffer | null>(
    null,
  );
  const [providerPdfError, setProviderPdfError] = useState("");
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackType, setFeedbackType] = useState("GENERAL");
  const [feedbackComment, setFeedbackComment] = useState("");
  const [mobilePane, setMobilePane] = useState<"VIEWER" | "REPORT">("VIEWER");
  const isLocked =
    readOnly ||
    report.locked ||
    report.status === "APPROVED" ||
    report.status === "PUSHED";

  useEffect(() => {
    setSpeechSupported(Boolean(getSpeechRecognitionConstructor()));
    window.dispatchEvent(
      new CustomEvent("decxpert-editor-active", { detail: true }),
    );
    return () => {
      dictationActiveRef.current = false;
      recognitionRef.current?.stop?.();
      window.dispatchEvent(
        new CustomEvent("decxpert-editor-active", { detail: false }),
      );
    };
  }, []);

  useLayoutEffect(() => {
    if (lastReportIdRef.current === report.id) return;
    lastReportIdRef.current = report.id;
    const reportParts = extractEditableReportParts(originalReportHtml);
    setReportParts(reportParts);
    if (editorRef.current)
      editorRef.current.innerHTML = reportParts.editableBody;
  }, [report.id, originalReportHtml]);

  useEffect(() => {
    let cancelled = false;
    setProviderPdfData(null);
    setProviderPdfError("");
    fetch(`/api/radiologist/reports/${encodeURIComponent(report.id)}/pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((response) => {
        if (!response.ok) throw new Error("PDF report is not available yet");
        return response.arrayBuffer();
      })
      .then((data) => {
        if (cancelled) return;
        setProviderPdfData(data);
      })
      .catch((error) => {
        if (!cancelled)
          setProviderPdfError(
            error instanceof Error
              ? error.message
              : "PDF report is not available yet",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [report.id, token]);

  function runFormat(command: "bold" | "italic" | "underline") {
    if (isLocked) return;
    editorRef.current?.focus();
    document.execCommand(command);
  }

  function rememberEditorSelection() {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    savedRangeRef.current = range.cloneRange();
  }

  function insertDictatedText(text: string) {
    if (isLocked || !text.trim()) return;
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const selection = window.getSelection();
    if (selection && savedRangeRef.current) {
      selection.removeAllRanges();
      selection.addRange(savedRangeRef.current);
    }
    const insertion = `${text.trim()} `;
    if (!document.execCommand("insertText", false, insertion)) {
      const range = selection?.rangeCount
        ? selection.getRangeAt(0)
        : document.createRange();
      range.deleteContents();
      range.insertNode(document.createTextNode(insertion));
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    rememberEditorSelection();
  }

  function toggleDictation() {
    if (isLocked) return;
    if (!speechSupported) {
      notice(
        "Speech to text is not supported in this browser. Use Chrome or Edge.",
      );
      return;
    }
    if (dictating) {
      dictationActiveRef.current = false;
      recognitionRef.current?.stop?.();
      setDictating(false);
      return;
    }
    rememberEditorSelection();
    const SpeechRecognition = getSpeechRecognitionConstructor();
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.lang = "en-IN";
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      for (
        let index = event.resultIndex;
        index < event.results.length;
        index += 1
      ) {
        if (event.results[index]?.isFinal)
          insertDictatedText(String(event.results[index][0]?.transcript ?? ""));
      }
    };
    recognition.onerror = (event) => {
      notice(
        event?.error === "not-allowed"
          ? "Microphone permission was blocked."
          : "Speech recognition stopped.",
      );
      dictationActiveRef.current = false;
      setDictating(false);
    };
    recognition.onend = () => {
      if (dictationActiveRef.current && !isLocked) {
        try {
          recognition.start();
        } catch {
          setDictating(false);
        }
      } else {
        setDictating(false);
      }
    };
    dictationActiveRef.current = true;
    setDictating(true);
    try {
      recognition.start();
    } catch {
      dictationActiveRef.current = false;
      setDictating(false);
    }
  }

  function insertAnnotatedSlice(imageData: string, caption: string) {
    if (isLocked) return;
    const figureHtml = `<figure class="viewer-snapshot"><img alt="${escapeHtmlAttributeText(caption)}" src="${escapeHtmlAttributeText(imageData)}" /><figcaption>${escapeHtmlText(caption)}</figcaption></figure>`;
    editorRef.current?.insertAdjacentHTML("beforeend", figureHtml);
    editorRef.current?.focus();
    notice("Selected slice added to report.");
  }

  async function saveReport() {
    const confirmed = window.confirm(
      "Saving will replace the previous edited version of this report. The original AI report will remain archived, and these final changes will be saved. Continue?",
    );
    if (!confirmed) return;
    setSaving(true);
    try {
      const nextHtml = wrapEditableReportHtml(
        editorRef.current?.innerHTML ?? reportParts.editableBody,
        reportParts.lockedHeader,
        reportParts.lockedFooter,
      );
      await api<ReportReview>(
        `/api/radiologist/reports/${report.id}/save`,
        token,
        {
          method: "PATCH",
          body: JSON.stringify({ editedReportJson: { htmlReport: nextHtml } }),
        },
      );
      notice("Report edits saved.");
      await reload();
    } catch (error) {
      notice(
        error instanceof Error ? error.message : "Unable to save report edits.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function approveReport() {
    setApproving(true);
    try {
      const nextHtml = wrapEditableReportHtml(
        editorRef.current?.innerHTML ?? reportParts.editableBody,
        reportParts.lockedHeader,
        reportParts.lockedFooter,
      );
      await api<ReportReview>(
        `/api/radiologist/reports/${report.id}/approve`,
        token,
        {
          method: "PATCH",
          body: JSON.stringify({ editedReportJson: { htmlReport: nextHtml } }),
        },
      );
      notice("Report approved and sent back to PACS.");
      await reload();
    } catch (error) {
      notice(
        error instanceof Error
          ? error.message
          : "Unable to approve and send report to PACS.",
      );
    } finally {
      setApproving(false);
    }
  }

  async function submitFeedback(event: FormEvent) {
    event.preventDefault();
    try {
      await api(`/api/radiologist/reports/${report.id}/feedback`, token, {
        method: "POST",
        body: JSON.stringify({ feedbackType, comment: feedbackComment }),
      });
      setFeedbackOpen(false);
      setFeedbackComment("");
      setFeedbackType("GENERAL");
      notice("Report feedback submitted to Dectrocel and Renewist.");
    } catch (error) {
      notice(
        error instanceof Error ? error.message : "Unable to submit feedback.",
      );
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[80] flex flex-col bg-slate-950 text-white">
      <header className="flex min-h-14 shrink-0 items-center justify-between gap-2 border-b border-slate-800 bg-slate-950 px-2 py-2 sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-md border border-slate-700 px-2 py-2 text-sm font-bold text-slate-100 hover:bg-slate-900 sm:gap-2 sm:px-3"
            onClick={onBack}
            type="button"
          >
            <span aria-hidden>&lsaquo;</span> Back
          </button>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">{report.id}</p>
            <p className="truncate text-xs text-slate-400">
              {report.patientName ?? "Patient"}
              {report.patientId ? ` (${report.patientId})` : ""} -{" "}
              {report.serviceName}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <button
            className="radiologist-feedback-button inline-flex min-h-10 items-center gap-1 rounded-md border border-violet-400/50 bg-violet-500/10 px-2 py-2 text-sm font-bold text-violet-100 sm:gap-2 sm:px-3"
            onClick={() => setFeedbackOpen(true)}
            type="button"
          >
            <MessageSquare size={16} />
            <span>Feedback</span>
          </button>
          {readOnly ? (
            <StatusBadge status="VIEW ONLY" />
          ) : (
            <>
              <button
                className="rounded-md border border-slate-700 px-3 py-2 text-sm font-bold text-slate-100 disabled:opacity-50"
                disabled={isLocked}
                onClick={() => runFormat("bold")}
                title="Bold"
                type="button"
              >
                <Bold size={16} />
              </button>
              <button
                className="rounded-md border border-slate-700 px-3 py-2 text-sm font-bold text-slate-100 disabled:opacity-50"
                disabled={isLocked}
                onClick={() => runFormat("italic")}
                title="Italic"
                type="button"
              >
                <Italic size={16} />
              </button>
              <button
                className="rounded-md border border-slate-700 px-3 py-2 text-sm font-bold text-slate-100 disabled:opacity-50"
                disabled={isLocked}
                onClick={() => runFormat("underline")}
                title="Underline"
                type="button"
              >
                <Underline size={16} />
              </button>
              <button
                className="inline-flex items-center gap-2 rounded-md border border-sky-500/50 bg-sky-500/10 px-3 py-2 text-sm font-bold text-sky-100 disabled:opacity-50"
                disabled={isLocked || saving || approving}
                onClick={saveReport}
                type="button"
              >
                <Save size={16} /> Save
              </button>
              <button
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                disabled={isLocked || saving || approving}
                onClick={approveReport}
                type="button"
              >
                {approving ? "Signing..." : "Sign"}
              </button>
            </>
          )}
        </div>
      </header>
      <nav className="grid h-11 shrink-0 grid-cols-2 border-b border-slate-700 bg-slate-900 lg:hidden" aria-label="Study workspace">
        {([['VIEWER', 'Images'], ['REPORT', 'Report']] as const).map(([key, label]) => (
          <button
            className={cx('border-b-2 text-sm font-bold', mobilePane === key ? 'border-sky-400 bg-slate-800 text-sky-200' : 'border-transparent text-slate-400')}
            key={key}
            onClick={() => setMobilePane(key)}
            type="button"
          >
            {label}
          </button>
        ))}
      </nav>
      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1.08fr)_minmax(460px,0.92fr)]">
        <div className={cx("h-full min-h-0", mobilePane === "VIEWER" ? "block" : "hidden", "lg:block")}>
          <DicomReviewPane
            report={report}
            token={token}
            isLocked={isLocked}
            onInsertSlice={insertAnnotatedSlice}
          />
        </div>
        <section
          className={cx(
            "min-h-0 border-l border-slate-800 text-slate-950",
            mobilePane === "REPORT" ? "block" : "hidden",
            "lg:block",
            providerPdfData
              ? "overflow-hidden bg-slate-900 p-0"
              : "overflow-auto bg-slate-100 p-4",
          )}
        >
          {providerPdfData ? (
            <ResponsivePdfDocument
              data={providerPdfData}
              title="Renewist PDF report"
            />
          ) : (
            <>
              {providerPdfError ? (
                <p className="mx-auto mb-3 max-w-[920px] rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                  {providerPdfError}. Showing editable report instead.
                </p>
              ) : null}
              {reportParts.lockedHeader ? (
                <div
                  className="report-editor mx-auto max-w-[920px] rounded-t-lg border border-b-0 border-slate-200 bg-white p-8 text-slate-950 shadow-xl"
                  dangerouslySetInnerHTML={{ __html: reportParts.lockedHeader }}
                />
              ) : null}
              {!readOnly ? (
                <div className="mx-auto flex max-w-[920px] items-center justify-between gap-3 border-x border-t border-slate-200 bg-white px-4 py-3 shadow-xl">
                  <button
                    className={cx(
                      "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-bold disabled:opacity-50",
                      dictating
                        ? "bg-rose-600 text-white"
                        : "border border-sky-200 bg-sky-50 text-sky-700",
                    )}
                    disabled={isLocked || !speechSupported}
                    onClick={toggleDictation}
                    type="button"
                  >
                    <Mic size={16} />{" "}
                    {dictating ? "Stop dictation" : "Mic dictation"}
                  </button>
                  <span className="text-right text-xs font-semibold text-slate-500">
                    {speechSupported
                      ? dictating
                        ? "Listening..."
                        : "Place cursor in report, then dictate."
                      : "Speech API unavailable in this browser."}
                  </span>
                </div>
              ) : null}
              <div
                className="report-editor mx-auto min-h-[calc(100vh-10rem)] max-w-[920px] border-x border-slate-200 bg-white p-8 text-slate-950 shadow-xl outline-none focus:ring-2 focus:ring-sky-200"
                contentEditable={!isLocked}
                onInput={rememberEditorSelection}
                onKeyUp={rememberEditorSelection}
                onMouseUp={rememberEditorSelection}
                ref={editorRef}
                role="textbox"
                spellCheck
                suppressContentEditableWarning
              />
              {reportParts.lockedFooter ? (
                <div
                  className="report-editor mx-auto max-w-[920px] rounded-b-lg border border-t-0 border-slate-200 bg-white p-8 text-slate-950 shadow-xl"
                  dangerouslySetInnerHTML={{ __html: reportParts.lockedFooter }}
                />
              ) : null}
            </>
          )}
        </section>
      </main>
      {feedbackOpen ? (
        <Modal title="Report Feedback" onClose={() => setFeedbackOpen(false)}>
          <form className="space-y-4 text-slate-900" onSubmit={submitFeedback}>
            <label className="block text-sm font-semibold">
              Feedback type
              <select
                className="mt-1 w-full rounded-md border border-slate-200 p-3"
                value={feedbackType}
                onChange={(e) => setFeedbackType(e.target.value)}
              >
                {[
                  ["GENERAL", "General report feedback"],
                  ["INCORRECT_FINDING", "Incorrect finding"],
                  ["MISSING_FINDING", "Missing finding"],
                  [
                    "INCORRECT_SEVERITY_URGENCY",
                    "Incorrect severity / urgency",
                  ],
                  ["INCORRECT_TERMINOLOGY", "Incorrect terminology"],
                  [
                    "FORMATTING_REPORTING_ISSUE",
                    "Formatting / reporting issue",
                  ],
                  ["OTHER", "Other"],
                ].map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-semibold">
              Comment
              <textarea
                className="mt-1 min-h-32 w-full rounded-md border border-slate-200 p-3"
                required
                value={feedbackComment}
                onChange={(e) => setFeedbackComment(e.target.value)}
              />
            </label>
            <button
              className="rounded-md bg-violet-700 px-4 py-2 font-bold text-white"
              type="submit"
            >
              Submit Feedback
            </button>
          </form>
        </Modal>
      ) : null}
    </div>,
    document.body,
  );
}





function DicomReviewPane({ report, token }: { report: ReportReview; token: string; isLocked: boolean; onInsertSlice: (imageData: string, caption: string) => void }) { return <ExternalViewerPane endpoint={`/api/reports/${encodeURIComponent(report.id)}/viewer-session`} token={token} />; }

function extractEditableReportParts(html: string) {
  const fallback = {
    lockedHeader: "",
    editableBody: "<h1>Radiology Report</h1><p></p>",
    lockedFooter: "",
  };
  if (!html.trim()) return fallback;
  const parser = new DOMParser();
  const documentHtml = parser.parseFromString(html, "text/html");
  const source = documentHtml.body;
  source
    .querySelectorAll("style,script,link,meta,title")
    .forEach((node) => node.remove());
  source
    .querySelectorAll(".viewer-snapshot pre")
    .forEach((node) => node.remove());
  const inner = source.querySelector(".inner") ?? source;
  const header = inner.querySelector(".brand-bar");
  const patientGrid = inner.querySelector(".patient-grid");
  const footer = inner.querySelector(".footer-note");
  const reportCards = Array.from(inner.querySelectorAll(".report-card"));

  const lockedHeader = sanitizeEditableReportContent(
    [header?.outerHTML, patientGrid?.outerHTML].filter(Boolean).join(""),
  );
  const editableBody = sanitizeEditableReportContent(
    reportCards.length
      ? reportCards.map((node) => node.outerHTML).join("")
      : (source.innerHTML ?? html),
  );
  const lockedFooter = sanitizeEditableReportContent(footer?.outerHTML ?? "");
  return {
    lockedHeader,
    editableBody: editableBody || fallback.editableBody,
    lockedFooter,
  };
}

function sanitizeEditableReportContent(html: string) {
  return (
    html
      .replace(/<\/?(html|head|body)[^>]*>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<pre[\s\S]*?<\/pre>/gi, "")
      .trim() || "<h1>Radiology Report</h1><p></p>"
  );
}

function wrapEditableReportHtml(
  bodyHtml: string,
  lockedHeader = "",
  lockedFooter = "",
) {
  const safeBody = sanitizeEditableReportContent(bodyHtml);
  const safeHeader = sanitizeEditableReportContent(lockedHeader);
  const safeFooter = sanitizeEditableReportContent(lockedFooter);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>DecXpert AI-Assisted Radiology Report</title>
<style>
  :root { --ink:#172033; --muted:#5d667a; --line:#d9e2f1; --panel:#f7faff; --accent:#1f5f99; }
  * { box-sizing:border-box; }
  body { margin:0; background:#eef3f9; color:var(--ink); font-family:Arial, Helvetica, sans-serif; line-height:1.55; }
  .page { max-width:960px; margin:32px auto; background:white; border:1px solid var(--line); box-shadow:0 16px 50px rgba(23,32,51,.12); }
  .inner { padding:34px 42px 28px; }
  .brand-bar { display:flex; justify-content:space-between; gap:24px; align-items:center; padding:24px 28px; border-bottom:4px solid var(--accent); background:linear-gradient(135deg,#f8fbff,#eef6ff); }
  .brand-title { font-size:32px; font-weight:800; color:var(--accent); letter-spacing:.2px; }
  .brand-subtitle { color:var(--muted); font-weight:600; margin-top:2px; }
  .report-meta { text-align:right; color:var(--muted); font-size:14px; }
  .report-label { color:var(--ink); font-weight:800; font-size:16px; letter-spacing:.08em; }
  table { width:100%; border-collapse:collapse; margin:18px 0 24px; }
  th, td { border:1px solid var(--line); padding:11px 14px; vertical-align:top; }
  th { width:24%; background:var(--panel); color:#34405a; text-align:left; font-size:13px; text-transform:uppercase; letter-spacing:.05em; }
  td { background:#fff; font-weight:600; }
  .report-card { border:1px solid var(--line); border-radius:14px; padding:24px; margin:24px 0; background:#fff; }
  h1 { margin:0 0 18px; padding-bottom:12px; border-bottom:1px solid var(--line); color:var(--accent); font-size:24px; }
  h2 { margin:22px 0 8px; color:#24324d; font-size:15px; letter-spacing:.08em; text-transform:uppercase; }
  p { margin:8px 0 12px; }
  .numbered-list { margin:8px 0 14px 22px; padding:0; }
  .numbered-list li { margin:6px 0; padding-left:4px; }
  .exam-grid th:first-child { width:26%; }
  .viewer-snapshot { margin:24px 0; padding:12px; border:1px solid var(--line); background:#f8fbff; page-break-inside:avoid; }
  .viewer-snapshot img { display:block; width:100%; max-height:520px; object-fit:contain; background:#020617; }
  .viewer-snapshot figcaption { margin-top:8px; font-size:12px; font-weight:700; color:var(--muted); }
  .viewer-snapshot pre { white-space:pre-wrap; margin:8px 0 0; font-size:11px; color:var(--muted); }
  .footer-note { margin-top:28px; padding:18px 20px; border-top:1px solid var(--line); background:#fbfdff; color:var(--muted); font-size:12px; }
  @media print { body { background:white; } .page { margin:0; box-shadow:none; border:none; } }
</style>
</head>
<body>
<main class="page"><div class="inner">
${safeHeader}
${safeBody}
${safeFooter}
</div></main>
</body>
</html>`;
}

function RadiologistProfilePanel({ profile }: { profile: RadiologistProfile }) {
  return (
    <div className="space-y-5">
      <section className="soft-card rounded-lg p-5">
        <h2 className="text-lg font-semibold text-slate-950">
          Radiologist profile
        </h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <TextInput label="Full name" value={profile.fullName} readOnly />
          <TextInput label="Email" value={profile.email} readOnly />
          <TextInput
            label="Qualification"
            value={profile.qualification}
            readOnly
          />
          <TextInput
            label="Registration number"
            value={profile.medicalRegistrationNumber}
            readOnly
          />
          <TextInput
            label="Organisation"
            value={brandText(profile.organisationName)}
            readOnly
          />
          <TextInput
            label="Signature"
            value={profile.signatureImageUrl ? "Uploaded" : "Missing"}
            readOnly
          />
        </div>
      </section>
      <section className="soft-card rounded-lg p-5">
        <h2 className="text-lg font-semibold text-slate-950">
          Notification preferences
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Portal notifications remain available inside authenticated worklists.
          WhatsApp synchronization is reserved for the configured demo/future
          Cloud API workflow.
        </p>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <TextInput label="Portal worklist alerts" value="Enabled" readOnly />
          <TextInput label="WhatsApp sync" value="Demo mode only" readOnly />
        </div>
      </section>
    </div>
  );
}

function AppShell({
  token,
  user,
}: {
  token: string;
  user: User;
  onLogout: () => void;
}) {
  const [active, setActive] = useState(
    user.role === "CLIENT_USER" ? "Dashboard" : "Dashboard",
  );
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [radiologist, setRadiologist] = useState<RadiologistProfile | null>(
    null,
  );
  const [providerDashboard, setProviderDashboard] =
    useState<ProviderDashboard | null>(null);
  const [adminFullOverviewLoaded, setAdminFullOverviewLoaded] = useState(false);
  const [, setAdminFullOverviewLoading] = useState(false);
  const [adminFullOverviewError, setAdminFullOverviewError] = useState("");
  const [adminFullOverviewRetry, setAdminFullOverviewRetry] = useState(0);
  const [notice, setNotice] = useState("");
  const [, setError] = useState("");
  const [, setLoading] = useState(true);
  const [, setRefreshing] = useState(false);
  const [editorActive, setEditorActive] = useState(false);
  const [, setGlobalSearch] = useState("");
  const [, setUnreadNotifications] = useState(0);
  const globalSearchRef = useRef<HTMLInputElement | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const dataLoadingRef = useRef(false);
  const [workspaceSyncError, setWorkspaceSyncError] = useState("");

  const role = user.role;
  const workspace = resolvePortalWorkspace(role, client?.code, client?.kind);

  const hasLoadedData = Boolean(
    (role === "SUPER_ADMIN" && overview) ||
    (role === "RADIOLOGIST" && radiologist) ||
    ((role === "PROVIDER_ADMIN" || role === "PROVIDER_MANAGER") &&
      providerDashboard) ||
    (role === "CLIENT_USER" && client),
  );
  const adminSectionNeedsFullOverview =
    role === "SUPER_ADMIN" &&
    needsFullAdminOverview(active) &&
    !adminFullOverviewLoaded;
  const availableTabs = useMemo(
    () => {
      if (role === "CLIENT_USER") return clientWorkspaceTabs(user.portalRole, workspace === "MARENGO_GROUP");
      const tabs = filterClientPortalTabs(
        getPortalTabs(workspace, Boolean(client?.studySyncEnabled)),
        user.portalRole,
        workspace,
      );
      if (role === "SUPER_ADMIN") tabs.push("Healthcheck");
      if (!user.deploymentFeatures?.marengoMinimal) return tabs;
      const disabled = new Set([
        "AI Report Feedback", "Call Requests",
        "Center Analytics", "Demo Requests", "Management Bot", "Notification History",
        "Notifications", "Processing Notifications", "Queries", "Report",
        "Reporting Statistics", "Support", "WhatsApp Whitelist",
      ]);
      if (user.deploymentFeatures?.notifications) {
        disabled.delete("Notifications");
        disabled.delete("Notification History");
      }
      if (role !== "SUPER_ADMIN") { disabled.add("Analytics"); disabled.add("Billing"); }
      if (workspace === "CENTER") disabled.add("Dashboard");
      return tabs.filter((tab) => !disabled.has(tab));
    },
    [workspace, role, client?.studySyncEnabled, user.portalRole, user.deploymentFeatures?.marengoMinimal, user.deploymentFeatures?.notifications],
  );



  async function loadData(showSpinner = true, forceFullAdmin = false, signal?: AbortSignal) {
    if (dataLoadingRef.current) return;
    dataLoadingRef.current = true;
    const shouldBlockWorkspace = showSpinner && !hasLoadedData;
    if (shouldBlockWorkspace) setLoading(true);
    if (showSpinner && hasLoadedData) setRefreshing(true);
    if (showSpinner) setError("");
    try {
      if (role === "SUPER_ADMIN") {
        const fullOverview = forceFullAdmin || needsFullAdminOverview(active);
        const data = await api<AdminOverview>(fullOverview ? "/api/admin/overview" : "/api/admin/overview?scope=dashboard", token, { cache: "no-store", signal });
        if (signal?.aborted) return;
        setOverview(current => !fullOverview && adminFullOverviewLoaded && current ? { ...current, dashboard: data.dashboard } : data);
        if (fullOverview) setAdminFullOverviewLoaded(true);
      } else if (role === "RADIOLOGIST") {
        const data = await api<RadiologistProfile>("/api/radiologist/dashboard", token, { cache: "no-store", signal });
        if (signal?.aborted) return;
        setRadiologist(data);
      } else if (role === "PROVIDER_ADMIN" || role === "PROVIDER_MANAGER") {
        const data = await api<ProviderDashboard>("/api/provider/dashboard", token, { cache: "no-store", signal });
        if (signal?.aborted) return;
        setProviderDashboard(data);
      } else {
        const data = await api<Client>("/api/client/dashboard", token, { cache: "no-store", signal });
        if (signal?.aborted) return;
        setClient(data);
      }
      setError("");
      setWorkspaceSyncError("");
    } catch (err) {
      if (signal?.aborted && signal.reason?.name !== "TimeoutError") throw err;
      setWorkspaceSyncError("Live workspace refresh failed.");
      if (showSpinner && !hasLoadedData) {
        setError("Unable to load portal data. Please try again.");
      } else {
        console.warn(
          "Portal refresh failed; keeping current workspace data",
          err,
        );
      }
      if (signal) throw err;
    } finally {
      dataLoadingRef.current = false;
      if (shouldBlockWorkspace) setLoading(false);
      if (showSpinner) setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [token, role]);

  useEffect(() => {
    if (!adminSectionNeedsFullOverview) return;
    let cancelled = false;
    setAdminFullOverviewLoading(true);
    setAdminFullOverviewError("");
    void api<AdminOverview>("/api/admin/overview", token)
      .then((fullOverview) => {
        if (cancelled) return;
        setOverview(fullOverview);
        setAdminFullOverviewLoaded(true);
      })
      .catch((requestError) => {
        if (cancelled) return;
        console.error("Unable to load full admin overview", requestError);
        setAdminFullOverviewError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load center data.",
        );
      })
      .finally(() => {
        if (!cancelled) setAdminFullOverviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [adminSectionNeedsFullOverview, adminFullOverviewRetry, token]);

  useEffect(() => {
    if (!availableTabs.includes(active))
      setActive(availableTabs[0] ?? "Dashboard");
  }, [availableTabs, active]);

  useLiveRefresh((signal) => loadData(false, false, signal), { enabled: hasLoadedData && !editorActive, immediate: false });

  useEffect(() => {
    if (editorActive) return;
    if (user.deploymentFeatures?.notifications === false) return;
    let activeRequest = false;
    const loadUnread = () => {
      if (activeRequest || document.visibilityState !== "visible" || !navigator.onLine) return;
      activeRequest = true;
      void api<{ count: number }>("/api/notifications/unread-count", token)
        .then((result) => setUnreadNotifications(result.count))
        .catch(() => undefined)
        .finally(() => { activeRequest = false; });
    };
    void loadUnread();
    const timer = window.setInterval(() => void loadUnread(), 15000);
    return () => window.clearInterval(timer);
  }, [editorActive, token, user.deploymentFeatures?.notifications]);

  useEffect(() => {
    function handleEditorActive(event: Event) {
      setEditorActive(Boolean((event as CustomEvent<boolean>).detail));
    }
    window.addEventListener("decxpert-editor-active", handleEditorActive);
    return () =>
      window.removeEventListener("decxpert-editor-active", handleEditorActive);
  }, []);

  useEffect(() => {
    function handleGlobalSearchShortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if (
        event.key === "Escape" &&
        document.activeElement === globalSearchRef.current
      ) {
        setGlobalSearch("");
        globalSearchRef.current?.blur();
        return;
      }
      if (typing) return;
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        globalSearchRef.current?.focus();
        globalSearchRef.current?.select();
      }
    }
    window.addEventListener("keydown", handleGlobalSearchShortcut);
    return () =>
      window.removeEventListener("keydown", handleGlobalSearchShortcut);
  }, []);

  useEffect(
    () => () => {
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    },
    [],
  );

  function showNotice(message: string) {
    setNotice(message);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice("");
      noticeTimerRef.current = null;
    }, 12000);
  }

  function selectSection(item: string) {
    setActive(item);
    setGlobalSearch("");
    window.scrollTo({ top: 0 });
  }


  {
    const workspaceClient: Client = client ?? {
      id: "", code: "MARENGO", name: role === "SUPER_ADMIN" ? "All authorized centers" : "Radiology workspace",
      kind: "GROUP", facilityType: "Hospital", primaryContact: user.name, email: user.email,
      billingDiscountPercent: 0, status: "ACTIVE", services: [],
      reportReviews: overview?.reportReviews ?? radiologist?.reportReviews ?? providerDashboard?.reportReviews ?? [],
      processingJobs: overview?.processingJobs ?? [], availableBridgeStudies: overview?.availableBridgeStudies ?? [],
    };
    const sectionContent = role === "SUPER_ADMIN" && overview
      ? adminSectionNeedsFullOverview
        ? <div className="pw-empty">{adminFullOverviewError || "Loading administration..."}{adminFullOverviewError && <button onClick={() => setAdminFullOverviewRetry((value) => value + 1)}>Retry</button>}</div>
        : <AdminContent active={active} overview={overview} token={token} reload={loadData} notice={showNotice} onNavigate={selectSection}/>
      : role === "CLIENT_USER" && client
        ? <ClientContent active={active} token={token} client={client} user={user} reload={loadData} notice={showNotice} onNavigate={selectSection} availableTabs={availableTabs}/>
        : role === "RADIOLOGIST" && radiologist
          ? <RadiologistContent active={active} profile={radiologist} token={token} reload={loadData} notice={showNotice}/>
          : providerDashboard ? <ProviderContent active={active} dashboard={providerDashboard} token={token} reload={loadData} notice={showNotice} user={user}/> : null;
    return <MarengoUnifiedWorklist token={token} client={workspaceClient} user={user} reload={loadData} notice={showNotice} onNavigate={selectSection} availableTabs={availableTabs} activeSection={active} sectionContent={sectionContent} workspaceNotice={notice} workspaceSyncError={workspaceSyncError}/>;
  }

}

function App() {
  const studyStatusId = /^\/study-status\/([^/?#]+)\/?$/.exec(window.location.pathname)?.[1];
  const sharedReportToken = /^\/shared\/([^/?#]+)\/?$/.exec(window.location.pathname)?.[1];
  const [token, setToken] = useState(localStorage.getItem(tokenKey) ?? "");
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(Boolean(token));

  useEffect(() => {
    async function restoreSession() {
      if (!token) return;
      try {
        const currentUser = await api<User>("/api/me", token);
        setUser(currentUser);
      } catch {
        localStorage.removeItem(tokenKey);
        setToken("");
      } finally {
        setChecking(false);
      }
    }
    void restoreSession();
  }, [token]);

  function logout() {
    localStorage.removeItem(tokenKey);
    setToken("");
    setUser(null);
  }

  if (sharedReportToken) return <PublicSharedReportView token={sharedReportToken} />;
  if (checking)
    return (
      <main className="app-shell grid min-h-screen place-items-center p-4">
        <EmptyState message="Restoring secure session..." />
      </main>
    );
  if (!token || !user)
    return (
      <LoginView
        onLogin={(nextToken, nextUser) => {
          setToken(nextToken);
          setUser(nextUser);
        }}
      />
    );
  if (studyStatusId) return <StudyStatusPage token={token} jobId={studyStatusId} onLogout={logout} />;
  return <AppShell token={token} user={user} onLogout={logout} />;
}

export default App;
