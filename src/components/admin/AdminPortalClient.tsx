"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson } from "@/lib/client";
import { getInitialisedMsalInstance } from "@/lib/msal";
import Image from "next/image";
import * as React from "react";

type CompanySettings = {
  companyId: string;
  companyName: string;
  revenueSplitPercent: number;
  splitLabel: string;
  splitParties: string;
  brandName: string | null;
  logoUrl: string | null;
  reportRecipients: string[];
  outlookMailbox: string;
  graphConnected: boolean;
  graphConnectedEmail: string | null;
  graphTokenExpiresAt: string | null;
  graphConnectedAt: string | null;
  currency: "ZAR";
};

type SettingsResponse = {
  companies: CompanySettings[];
  requiredRecipient: string;
};

type Projection = {
  monthLabel: string;
  projectedCharge: number;
  approvedCharge: number;
  partnerShareProjected: number;
  companyShareProjected: number;
  splitPercent: number;
  currency: string;
};

type Report = {
  id: string;
  companyId: string;
  fileName: string;
  totalApprovedHours: number;
  totalCharge: number;
  currency: string;
  generatedAt: string;
  emailStatus: string;
  company: {
    id: string;
    name: string;
  };
};

type AuditLog = {
  id: string;
  actor: string | null;
  entityType: string;
  action: string;
  createdAt: string;
};

type ImportCleanupSummary = {
  mode: "dry-run" | "execute";
  jobsMatched: number;
  opportunitiesMatched: number;
  candidatesEligibleForDelete: number;
  companiesEligibleForDelete: number;
  clientAccountsEligibleForDelete: number;
  invoicesMatched: number;
};

type RepairDraftResult = {
  dbPairs: number;
  alreadyInMailbox: number;
  repaired: number;
  failed: number;
  skippedNoEmail: number;
};

type EmailAuditFlaggedItem = {
  applicationId: string;
  candidateName: string;
  roleTitle: string;
  score: number;
  hallucinatedClaims: string[];
};

type EmailAuditResult = {
  total: number;
  pass: number;
  fail: number;
  errors: number;
  deletedDrafts: number;
  flaggedItems: EmailAuditFlaggedItem[];
};

type DeletionRequest = {
  id: string;
  resourceType: string;
  resourceId: string;
  status: string;
  reason: string | null;
  requestedBy: string | null;
  requestedAt: string;
  title: string;
  companyName: string | null;
  resourceCreatedAt: string | null;
};

type SupportTicketComment = {
  id: string;
  author: string;
  body: string;
  createdAt: string;
};

type SupportTicket = {
  id: string;
  tenantId: string;
  tenantDisplayName: string;
  companyId: string | null;
  companyName: string | null;
  category: "USER_ACCESS" | "ADMIN_ACCESS" | "BILLING" | "SUPPORT";
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  subject: string;
  description: string;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
  createdBy: string;
  assignedTo: string | null;
  slaResponseDueAt: string | null;
  slaResolutionDueAt: string | null;
  firstResponseAt: string | null;
  responseSlaBreached: boolean;
  resolutionSlaBreached: boolean;
  resolutionNotes: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  comments: SupportTicketComment[];
};

type SupportTicketDraft = {
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
  assignedTo: string;
  slaResponseDueAt: string;
  slaResolutionDueAt: string;
  resolutionNotes: string;
};

type TenantUserLogin = {
  id: string;
  fullName: string;
  email: string;
  role: "ADMIN" | "USER";
  isActive: boolean;
  createdAt: string;
};

type TicketQueueView =
  | "ALL"
  | "OVERDUE"
  | "UNASSIGNED"
  | "MINE"
  | "RESOLVED_TODAY";

type Props = {
  username: string;
  portalMode?: "admin" | "super-admin";
};

type AdminAuthStatus = {
  authenticated: boolean;
  username: string | null;
  tenantId: string;
  superAdmin: boolean;
};

type GlobalAdminOverview = {
  tenants: Array<{
    tenantId: string;
    tenantDisplayName: string;
    createdAt: string;
    pendingInvoiceAmount: number;
    pendingInvoiceCount: number;
    placedWithoutSubmittedTimesheetCount: number;
    admins: Array<{
      id: string;
      fullName: string;
      email: string;
      createdAt: string;
    }>;
    companies: Array<{
      id: string;
      name: string;
      createdAt: string;
      billingModel: "PER_HOUR_PER_CANDIDATE" | "PERCENTAGE";
      billingRatePerHour: number;
      revenueSplitPercent: number;
      pendingInvoiceCount: number;
      pendingInvoiceAmount: number;
      expectedAmount: number;
      invoicedAmount: number;
      paidAmount: number;
      outstandingAmount: number;
      paidAsPerAgreement: boolean;
      paymentCoveragePercent: number;
      isAgreementCompany: boolean;
      signedAgreementCount: number;
      currency: string;
      placedWithoutSubmittedTimesheets: Array<{
        applicationId: string;
        candidateName: string;
        roleTitle: string;
        outstandingMonths: string[];
        outstandingMonthCount: number;
      }>;
    }>;
  }>;
};

type BillingDraft = {
  billingModel: "PER_HOUR_PER_CANDIDATE" | "PERCENTAGE";
  billingRatePerHour: string;
  revenueSplitPercent: string;
};

type AdminRuleset = {
  id: string;
  name: string;
  isDefault: boolean;
  rulesJson: Record<string, unknown>;
};

const DEFAULT_RULESET_NAME = "Default";
const AAD_REDIRECT_URI =
  process.env.NEXT_PUBLIC_AAD_REDIRECT_URI ?? "http://localhost:3001";

export default function AdminPortalClient({
  username,
  portalMode = "admin",
}: Props) {
  const [companies, setCompanies] = React.useState<CompanySettings[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = React.useState("");
  const [requiredRecipient, setRequiredRecipient] = React.useState("");
  const [brandName, setBrandName] = React.useState("");
  const [splitLabel, setSplitLabel] = React.useState("50/50");
  const [splitParties, setSplitParties] = React.useState("");
  const [reportRecipientsText, setReportRecipientsText] = React.useState("");
  const [outlookMailbox, setOutlookMailbox] = React.useState("");
  const [logoUrl, setLogoUrl] = React.useState<string | null>(null);
  const [projection, setProjection] = React.useState<Projection | null>(null);
  const [reports, setReports] = React.useState<Report[]>([]);
  const [auditLogs, setAuditLogs] = React.useState<AuditLog[]>([]);
  const [deletionRequests, setDeletionRequests] = React.useState<
    DeletionRequest[]
  >([]);
  const [saving, setSaving] = React.useState(false);
  const [graphConnecting, setGraphConnecting] = React.useState(false);
  const [uploadingLogo, setUploadingLogo] = React.useState(false);
  const [generatingReport, setGeneratingReport] = React.useState(false);
  const [cleaningImports, setCleaningImports] = React.useState(false);
  const [repairingDrafts, setRepairingDrafts] = React.useState(false);
  const [repairDraftResult, setRepairDraftResult] =
    React.useState<RepairDraftResult | null>(null);
  const [runningEmailAudit, setRunningEmailAudit] = React.useState(false);
  const [emailAuditResult, setEmailAuditResult] =
    React.useState<EmailAuditResult | null>(null);
  const [emailAuditDeleteFlagged, setEmailAuditDeleteFlagged] =
    React.useState(false);
  const [cleanupDate, setCleanupDate] = React.useState(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 10);
  });
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(
    null,
  );
  const [reviewingRequestId, setReviewingRequestId] = React.useState<
    string | null
  >(null);
  const [newUserName, setNewUserName] = React.useState("");
  const [newUserEmail, setNewUserEmail] = React.useState("");
  const [newUserPassword, setNewUserPassword] = React.useState("");
  const [newUserRole, setNewUserRole] = React.useState<"ADMIN" | "USER">(
    "USER",
  );
  const [tenantUsers, setTenantUsers] = React.useState<TenantUserLogin[]>([]);
  const [loadingTenantUsers, setLoadingTenantUsers] = React.useState(true);
  const [updatingTenantUserId, setUpdatingTenantUserId] = React.useState<
    string | null
  >(null);
  const [resetPasswordDrafts, setResetPasswordDrafts] = React.useState<
    Record<string, string>
  >({});
  const [creatingUser, setCreatingUser] = React.useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = React.useState(false);
  const [authTenantId, setAuthTenantId] = React.useState("default");
  const [globalOverview, setGlobalOverview] = React.useState<
    GlobalAdminOverview["tenants"]
  >([]);
  const [newCompanyAdminTenantId, setNewCompanyAdminTenantId] =
    React.useState("");
  const [newCompanyAdminName, setNewCompanyAdminName] = React.useState("");
  const [newCompanyAdminEmail, setNewCompanyAdminEmail] = React.useState("");
  const [newCompanyAdminPassword, setNewCompanyAdminPassword] =
    React.useState("");
  const [creatingCompanyAdmin, setCreatingCompanyAdmin] = React.useState(false);
  const [removingCompanyAdminId, setRemovingCompanyAdminId] = React.useState<
    string | null
  >(null);
  const [billingDrafts, setBillingDrafts] = React.useState<
    Record<string, BillingDraft>
  >({});
  const [savingCompanyBillingId, setSavingCompanyBillingId] = React.useState<
    string | null
  >(null);
  const [defaultRulesetId, setDefaultRulesetId] = React.useState<string | null>(
    null,
  );
  const [defaultRulesetName, setDefaultRulesetName] =
    React.useState(DEFAULT_RULESET_NAME);
  const [defaultRulesetJson, setDefaultRulesetJson] = React.useState<
    Record<string, unknown>
  >({});
  const [customEmailPrompt, setCustomEmailPrompt] = React.useState("");
  const [c2cPartnerName, setC2cPartnerName] = React.useState("");
  const [c2cPartnerPositioning, setC2cPartnerPositioning] = React.useState("");
  const [companyType, setCompanyType] = React.useState<"placement" | "support">(
    "placement",
  );
  const [preferredEmailLength, setPreferredEmailLength] = React.useState("");
  const [vossToggles, setVossToggles] = React.useState<Record<string, boolean>>(
    {
      accusations_audit: true,
      tactical_empathy: true,
      labelling: true,
      mirroring: true,
      calibrated_questions: true,
      no_oriented_closing: true,
    },
  );
  const [enforceRemoteGate, setEnforceRemoteGate] = React.useState(true);
  const [enforceUsWorkAuthGate, setEnforceUsWorkAuthGate] =
    React.useState(true);
  const [enforceUkWorkAuthGate, setEnforceUkWorkAuthGate] =
    React.useState(true);
  const [automationEnabled, setAutomationEnabled] = React.useState(false);
  const [automationSourcePath, setAutomationSourcePath] = React.useState("");
  const [automationPathValidating, setAutomationPathValidating] =
    React.useState(false);
  const [automationPathStatus, setAutomationPathStatus] = React.useState<{
    valid: boolean;
    error?: string;
  } | null>(null);
  const [automationRunId, setAutomationRunId] = React.useState<string | null>(
    null,
  );
  const [automationRunning, setAutomationRunning] = React.useState(false);
  const [automationRunStatus, setAutomationRunStatus] = React.useState<{
    status: string;
    phase: string;
    message: string;
    draftsSent?: number;
    draftsFound?: number;
    draftsFailedToSend?: number;
    error?: string;
  } | null>(null);
  const [activeTab, setActiveTab] = React.useState<
    | "company"
    | "ai-email"
    | "automation"
    | "finance"
    | "users"
    | "support"
    | "maintenance"
    | "config"
    | "instance"
  >("company");
  const [instanceEnvGroups, setInstanceEnvGroups] = React.useState<
    Array<{
      label: string;
      vars: Array<{
        key: string;
        set: boolean;
        hint: string;
        optional?: boolean;
      }>;
    }>
  >([]);
  const [configEnvGroups, setConfigEnvGroups] = React.useState<
    Array<{
      label: string;
      description?: string;
      vars: Array<{
        key: string;
        set: boolean;
        hint: string;
        optional?: boolean;
      }>;
    }>
  >([]);
  const [clientFilter, setClientFilter] = React.useState("");
  const [supportTickets, setSupportTickets] = React.useState<SupportTicket[]>(
    [],
  );
  const [supportTicketCategory, setSupportTicketCategory] =
    React.useState<SupportTicket["category"]>("SUPPORT");
  const [supportTicketPriority, setSupportTicketPriority] =
    React.useState<SupportTicket["priority"]>("MEDIUM");
  const [supportTicketCompanyId, setSupportTicketCompanyId] =
    React.useState("");
  const [supportTicketSubject, setSupportTicketSubject] = React.useState("");
  const [supportTicketDescription, setSupportTicketDescription] =
    React.useState("");
  const [creatingSupportTicket, setCreatingSupportTicket] =
    React.useState(false);
  const [updatingSupportTicketId, setUpdatingSupportTicketId] = React.useState<
    string | null
  >(null);
  const [supportTicketDrafts, setSupportTicketDrafts] = React.useState<
    Record<string, SupportTicketDraft>
  >({});
  const [supportCommentDrafts, setSupportCommentDrafts] = React.useState<
    Record<string, string>
  >({});
  const [savingSupportCommentId, setSavingSupportCommentId] = React.useState<
    string | null
  >(null);
  const [ticketFilterStatus, setTicketFilterStatus] = React.useState<
    "ALL" | SupportTicket["status"]
  >("ALL");
  const [ticketFilterPriority, setTicketFilterPriority] = React.useState<
    "ALL" | SupportTicket["priority"]
  >("ALL");
  const [ticketFilterCategory, setTicketFilterCategory] = React.useState<
    "ALL" | SupportTicket["category"]
  >("ALL");
  const [ticketFilterAssigned, setTicketFilterAssigned] = React.useState<
    "ALL" | "UNASSIGNED" | "MINE"
  >("ALL");
  const [ticketFilterSla, setTicketFilterSla] = React.useState<
    "ALL" | "BREACHED" | "RESPONSE_BREACHED" | "RESOLUTION_BREACHED"
  >("ALL");
  const [ticketTenantFilter, setTicketTenantFilter] = React.useState("");
  const [ticketQueueView, setTicketQueueView] =
    React.useState<TicketQueueView>("ALL");

  const toLocalDateTimeInputValue = React.useCallback(
    (value: string | null): string => {
      if (!value) {
        return "";
      }

      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return "";
      }

      const offsetMs = date.getTimezoneOffset() * 60_000;
      return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
    },
    [],
  );

  const selectedCompany = companies.find(
    (company) => company.companyId === selectedCompanyId,
  );

  const graphScopes = React.useMemo(() => {
    const configured = (process.env.NEXT_PUBLIC_GRAPH_SCOPES ?? "")
      .split(" ")
      .map((item) => item.trim())
      .filter(Boolean);

    return configured.length > 0
      ? configured
      : ["openid", "profile", "email", "offline_access", "Mail.ReadWrite"];
  }, []);
  const canUseSuperAdminPortalFeatures =
    isSuperAdmin && portalMode === "super-admin";
  const filteredSupportTickets = React.useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0,
      0,
    );

    return supportTickets.filter((ticket) => {
      if (
        ticketFilterStatus !== "ALL" &&
        ticket.status !== ticketFilterStatus
      ) {
        return false;
      }

      if (
        ticketFilterPriority !== "ALL" &&
        ticket.priority !== ticketFilterPriority
      ) {
        return false;
      }

      if (
        ticketFilterCategory !== "ALL" &&
        ticket.category !== ticketFilterCategory
      ) {
        return false;
      }

      if (ticketFilterAssigned === "UNASSIGNED" && ticket.assignedTo) {
        return false;
      }

      if (
        ticketFilterAssigned === "MINE" &&
        (ticket.assignedTo ?? "").trim().toLowerCase() !==
          username.trim().toLowerCase()
      ) {
        return false;
      }

      if (
        ticketFilterSla === "BREACHED" &&
        !ticket.responseSlaBreached &&
        !ticket.resolutionSlaBreached
      ) {
        return false;
      }

      if (
        ticketFilterSla === "RESPONSE_BREACHED" &&
        !ticket.responseSlaBreached
      ) {
        return false;
      }

      if (
        ticketFilterSla === "RESOLUTION_BREACHED" &&
        !ticket.resolutionSlaBreached
      ) {
        return false;
      }

      if (
        canUseSuperAdminPortalFeatures &&
        ticketTenantFilter.trim() &&
        !`${ticket.tenantDisplayName} ${ticket.tenantId}`
          .toLowerCase()
          .includes(ticketTenantFilter.trim().toLowerCase())
      ) {
        return false;
      }

      if (ticketQueueView === "RESOLVED_TODAY") {
        if (!ticket.resolvedAt) {
          return false;
        }

        if (new Date(ticket.resolvedAt).getTime() < startOfToday.getTime()) {
          return false;
        }
      }

      return true;
    });
  }, [
    canUseSuperAdminPortalFeatures,
    supportTickets,
    ticketQueueView,
    ticketFilterAssigned,
    ticketFilterCategory,
    ticketFilterPriority,
    ticketFilterSla,
    ticketFilterStatus,
    ticketTenantFilter,
    username,
  ]);

  const applyTicketQueueView = React.useCallback((view: TicketQueueView) => {
    setTicketQueueView(view);

    if (view === "ALL") {
      setTicketFilterStatus("ALL");
      setTicketFilterPriority("ALL");
      setTicketFilterCategory("ALL");
      setTicketFilterAssigned("ALL");
      setTicketFilterSla("ALL");
      return;
    }

    if (view === "OVERDUE") {
      setTicketFilterStatus("ALL");
      setTicketFilterAssigned("ALL");
      setTicketFilterSla("BREACHED");
      return;
    }

    if (view === "UNASSIGNED") {
      setTicketFilterStatus("ALL");
      setTicketFilterAssigned("UNASSIGNED");
      setTicketFilterSla("ALL");
      return;
    }

    if (view === "MINE") {
      setTicketFilterStatus("ALL");
      setTicketFilterAssigned("MINE");
      setTicketFilterSla("ALL");
      return;
    }

    if (view === "RESOLVED_TODAY") {
      setTicketFilterStatus("RESOLVED");
      setTicketFilterAssigned("ALL");
      setTicketFilterSla("ALL");
    }
  }, []);

  const queueViewCounts = React.useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0,
      0,
    );

    const all = supportTickets.length;
    const overdue = supportTickets.filter(
      (ticket) => ticket.responseSlaBreached || ticket.resolutionSlaBreached,
    ).length;
    const unassigned = supportTickets.filter(
      (ticket) => !ticket.assignedTo,
    ).length;
    const mine = supportTickets.filter(
      (ticket) =>
        (ticket.assignedTo ?? "").trim().toLowerCase() ===
        username.trim().toLowerCase(),
    ).length;
    const resolvedToday = supportTickets.filter((ticket) => {
      if (!ticket.resolvedAt) {
        return false;
      }

      return new Date(ticket.resolvedAt).getTime() >= startOfToday.getTime();
    }).length;

    return { all, overdue, unassigned, mine, resolvedToday };
  }, [supportTickets, username]);

  const refreshGlobalOverview = React.useCallback(async () => {
    const payload = await fetchJson<GlobalAdminOverview>(
      "/api/admin/global/overview",
    );
    setGlobalOverview(payload.tenants);

    const nextDrafts: Record<string, BillingDraft> = {};
    for (const tenant of payload.tenants) {
      for (const company of tenant.companies) {
        nextDrafts[company.id] = {
          billingModel: company.billingModel,
          billingRatePerHour: company.billingRatePerHour.toString(),
          revenueSplitPercent: company.revenueSplitPercent.toString(),
        };
      }
    }
    setBillingDrafts(nextDrafts);

    if (!newCompanyAdminTenantId && payload.tenants.length > 0) {
      setNewCompanyAdminTenantId(payload.tenants[0].tenantId);
    }
  }, [newCompanyAdminTenantId]);

  const loadSettings = React.useCallback(async () => {
    const payload = await fetchJson<SettingsResponse>(
      "/api/admin/company-settings",
    );
    setCompanies(payload.companies);
    setRequiredRecipient(payload.requiredRecipient);

    const active = payload.companies[0];
    if (!active) {
      return;
    }

    setSelectedCompanyId(active.companyId);
    setBrandName(active.brandName ?? active.companyName);
    setSplitLabel(active.splitLabel);
    setSplitParties(active.splitParties);
    setReportRecipientsText(active.reportRecipients.join(", "));
    setOutlookMailbox(active.outlookMailbox);
    setLogoUrl(active.logoUrl);
  }, []);

  const loadPromptSettings = React.useCallback(async () => {
    const rulesets = await fetchJson<AdminRuleset[]>("/api/rulesets");
    const active =
      rulesets.find((item) => item.isDefault) ??
      rulesets.find((item) => item.name === DEFAULT_RULESET_NAME) ??
      rulesets[0];

    if (!active) {
      setDefaultRulesetId(null);
      setDefaultRulesetName(DEFAULT_RULESET_NAME);
      setDefaultRulesetJson({});
      setCustomEmailPrompt("");
      setC2cPartnerName("");
      setC2cPartnerPositioning("");
      setCompanyType("placement");
      setPreferredEmailLength("");
      setVossToggles({
        accusations_audit: true,
        tactical_empathy: true,
        labelling: true,
        mirroring: true,
        calibrated_questions: true,
        no_oriented_closing: true,
      });
      setEnforceRemoteGate(true);
      setEnforceUsWorkAuthGate(true);
      setEnforceUkWorkAuthGate(true);
      setAutomationEnabled(false);
      setAutomationSourcePath("");
      return;
    }

    const rj = active.rulesJson ?? {};
    setDefaultRulesetId(active.id);
    setDefaultRulesetName(active.name || DEFAULT_RULESET_NAME);
    setDefaultRulesetJson(rj);
    setCustomEmailPrompt(
      typeof rj.custom_email_prompt === "string" ? rj.custom_email_prompt : "",
    );
    setC2cPartnerName(
      typeof rj.c2c_partner_name === "string" ? rj.c2c_partner_name : "",
    );
    setC2cPartnerPositioning(
      typeof rj.c2c_partner_positioning === "string"
        ? rj.c2c_partner_positioning
        : "",
    );
    setCompanyType(rj.company_type === "support" ? "support" : "placement");
    setPreferredEmailLength(typeof rj.length === "string" ? rj.length : "");
    const sections =
      rj.include_sections && typeof rj.include_sections === "object"
        ? (rj.include_sections as Record<string, boolean>)
        : {};
    setVossToggles({
      accusations_audit: sections.accusations_audit !== false,
      tactical_empathy: sections.tactical_empathy !== false,
      labelling: sections.labelling !== false,
      mirroring: sections.mirroring !== false,
      calibrated_questions: sections.calibrated_questions !== false,
      no_oriented_closing: sections.no_oriented_closing !== false,
    });
    setEnforceRemoteGate(rj.enforce_remote_gate !== false);
    setEnforceUsWorkAuthGate(rj.enforce_us_work_auth_gate !== false);
    setEnforceUkWorkAuthGate(rj.enforce_uk_work_auth_gate !== false);
    setAutomationEnabled(rj.automation_enabled === true);
    setAutomationSourcePath(
      typeof rj.automation_source_path === "string"
        ? rj.automation_source_path
        : "",
    );
    setAutomationPathStatus(null);
  }, []);

  const loadSupportTickets = React.useCallback(async () => {
    const payload = await fetchJson<{ tickets: SupportTicket[] }>(
      "/api/admin/support-tickets",
    );
    setSupportTickets(payload.tickets);

    const nextDrafts: Record<string, SupportTicketDraft> = {};
    for (const ticket of payload.tickets) {
      nextDrafts[ticket.id] = {
        status: ticket.status,
        assignedTo: ticket.assignedTo ?? "",
        slaResponseDueAt: toLocalDateTimeInputValue(ticket.slaResponseDueAt),
        slaResolutionDueAt: toLocalDateTimeInputValue(
          ticket.slaResolutionDueAt,
        ),
        resolutionNotes: ticket.resolutionNotes ?? "",
      };
    }
    setSupportTicketDrafts(nextDrafts);
  }, [toLocalDateTimeInputValue]);

  const loadTenantUsers = React.useCallback(async () => {
    setLoadingTenantUsers(true);
    try {
      const payload = await fetchJson<{ users: TenantUserLogin[] }>(
        "/api/admin/users",
      );
      setTenantUsers(payload.users);
    } finally {
      setLoadingTenantUsers(false);
    }
  }, []);

  const loadProjectionAndReports = React.useCallback(async () => {
    if (!selectedCompanyId) {
      return;
    }

    const [projectionPayload, reportPayload, auditPayload, requestPayload] =
      await Promise.all([
        fetchJson<{ projection: Projection }>(
          `/api/admin/finance/preview?companyId=${selectedCompanyId}`,
        ),
        fetchJson<Report[]>(
          `/api/admin/reports?companyId=${selectedCompanyId}`,
        ),
        fetchJson<AuditLog[]>("/api/admin/audit-logs"),
        fetchJson<DeletionRequest[]>("/api/admin/deletion-requests"),
      ]);

    setProjection(projectionPayload.projection);
    setReports(reportPayload);
    setAuditLogs(auditPayload);
    setDeletionRequests(requestPayload);
  }, [selectedCompanyId]);

  React.useEffect(() => {
    const initialise = async () => {
      try {
        setErrorMessage(null);
        const status = await fetchJson<AdminAuthStatus>(
          "/api/admin/auth/status",
        );
        setIsSuperAdmin(Boolean(status.superAdmin));
        setAuthTenantId(status.tenantId || "default");
        await Promise.all([
          loadSettings(),
          loadPromptSettings(),
          loadTenantUsers(),
          loadSupportTickets(),
          status.superAdmin ? refreshGlobalOverview() : Promise.resolve(),
        ]);
      } catch (error) {
        setErrorMessage(
          (error as Error).message || "Unable to load admin data",
        );
      }
    };

    void initialise();
  }, [
    loadPromptSettings,
    loadSettings,
    loadTenantUsers,
    loadSupportTickets,
    refreshGlobalOverview,
  ]);

  React.useEffect(() => {
    const active = companies.find(
      (company) => company.companyId === selectedCompanyId,
    );
    if (!active) {
      return;
    }

    setBrandName(active.brandName ?? active.companyName);
    setSplitLabel(active.splitLabel);
    setSplitParties(active.splitParties);
    setReportRecipientsText(active.reportRecipients.join(", "));
    setOutlookMailbox(active.outlookMailbox);
    setLogoUrl(active.logoUrl);

    if (!supportTicketCompanyId) {
      setSupportTicketCompanyId(active.companyId);
    }
  }, [companies, selectedCompanyId, supportTicketCompanyId]);

  React.useEffect(() => {
    const load = async () => {
      try {
        setErrorMessage(null);
        await loadProjectionAndReports();
      } catch (error) {
        setErrorMessage(
          (error as Error).message || "Unable to load finance data",
        );
      }
    };

    void load();
  }, [loadProjectionAndReports]);

  // ── Automation polling ──────────────────────────────────────────────────────
  React.useEffect(() => {
    if (!automationRunId || !automationRunning) return;

    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const data = await fetchJson<{
          status: string;
          phase: string;
          message: string;
          draftsSent?: number;
          draftsFound?: number;
          draftsFailedToSend?: number;
          error?: string;
        }>(`/api/automation/run?runId=${encodeURIComponent(automationRunId)}`);

        if (cancelled) return;
        setAutomationRunStatus(data);

        if (data.status === "completed" || data.status === "failed") {
          setAutomationRunning(false);
          clearInterval(interval);
        }
      } catch {
        if (!cancelled) {
          setAutomationRunning(false);
          clearInterval(interval);
        }
      }
    }, 5_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [automationRunId, automationRunning]);

  const handleValidateAutomationPath = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setAutomationPathStatus(null);
      return;
    }
    setAutomationPathValidating(true);
    setAutomationPathStatus(null);
    try {
      const result = await fetchJson<{ valid: boolean; error?: string }>(
        `/api/automation/validate-path?path=${encodeURIComponent(trimmed)}`,
      );
      setAutomationPathStatus(result);
    } catch {
      setAutomationPathStatus({
        valid: false,
        error: "Could not validate path — server error.",
      });
    } finally {
      setAutomationPathValidating(false);
    }
  };

  const handleRunAutomation = async () => {
    setAutomationRunning(true);
    setAutomationRunStatus(null);
    setAutomationRunId(null);
    try {
      const result = await fetchJson<{ runId: string }>("/api/automation/run", {
        method: "POST",
      });
      setAutomationRunId(result.runId);
    } catch (error) {
      setAutomationRunning(false);
      setAutomationRunStatus({
        status: "failed",
        phase: "done",
        message: (error as Error).message || "Failed to start automation run.",
      });
    }
  };

  const handleSaveSettings = async () => {
    if (!selectedCompanyId) {
      return;
    }

    setSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const recipients = reportRecipientsText
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

      await fetchJson("/api/admin/company-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: selectedCompanyId,
          brandName,
          outlookMailbox: outlookMailbox.trim().toLowerCase(),
          reportRecipients: recipients,
          currency: "ZAR",
        }),
      });

      const trimmedCustomPrompt = customEmailPrompt.trim();
      const nextRulesJson: Record<string, unknown> = {
        ...defaultRulesetJson,
      };

      // AI email settings
      if (trimmedCustomPrompt) {
        nextRulesJson.custom_email_prompt = trimmedCustomPrompt;
      } else {
        delete nextRulesJson.custom_email_prompt;
      }

      const trimmedPartnerName = c2cPartnerName.trim();
      if (trimmedPartnerName) {
        nextRulesJson.c2c_partner_name = trimmedPartnerName;
      } else {
        delete nextRulesJson.c2c_partner_name;
      }

      const trimmedPositioning = c2cPartnerPositioning.trim();
      if (trimmedPositioning) {
        nextRulesJson.c2c_partner_positioning = trimmedPositioning;
      } else {
        delete nextRulesJson.c2c_partner_positioning;
      }

      nextRulesJson.company_type = companyType;

      const trimmedLength = preferredEmailLength.trim();
      if (trimmedLength) {
        nextRulesJson.length = trimmedLength;
      } else {
        delete nextRulesJson.length;
      }

      nextRulesJson.include_sections = { ...vossToggles };

      // Opportunity gating rules
      nextRulesJson.enforce_remote_gate = enforceRemoteGate;
      nextRulesJson.enforce_us_work_auth_gate = enforceUsWorkAuthGate;
      nextRulesJson.enforce_uk_work_auth_gate = enforceUkWorkAuthGate;

      // Automation
      nextRulesJson.automation_enabled = automationEnabled;
      const trimmedSourcePath = automationSourcePath.trim();
      if (trimmedSourcePath) {
        nextRulesJson.automation_source_path = trimmedSourcePath;
      } else {
        delete nextRulesJson.automation_source_path;
      }

      if (defaultRulesetId) {
        await fetchJson(`/api/rulesets/${defaultRulesetId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rulesJson: nextRulesJson,
            isDefault: true,
          }),
        });
      } else {
        await fetchJson("/api/rulesets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: defaultRulesetName || DEFAULT_RULESET_NAME,
            rulesJson: nextRulesJson,
            isDefault: true,
          }),
        });
      }

      await loadSettings();
      await loadPromptSettings();
      await loadProjectionAndReports();
      setSuccessMessage("Company settings saved.");
    } catch (error) {
      setErrorMessage((error as Error).message || "Unable to save settings");
    } finally {
      setSaving(false);
    }
  };

  const handleConnectCompanyGraph = async () => {
    if (!selectedCompanyId) {
      return;
    }

    setGraphConnecting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const msalInstance = await getInitialisedMsalInstance();
      const loginResult = await msalInstance.loginPopup({
        scopes: graphScopes,
        redirectUri: AAD_REDIRECT_URI,
      });

      await fetchJson("/api/admin/company-graph-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: selectedCompanyId,
          accessToken: loginResult.accessToken,
          connectedEmail: loginResult.account?.username,
          expiresAt: loginResult.expiresOn?.toISOString(),
        }),
      });

      await loadSettings();
      setSuccessMessage("Company Graph connection saved.");
    } catch (error) {
      setErrorMessage(
        (error as Error).message || "Unable to connect company Graph account",
      );
    } finally {
      setGraphConnecting(false);
    }
  };

  const handleDisconnectCompanyGraph = async () => {
    if (!selectedCompanyId) {
      return;
    }

    setGraphConnecting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await fetchJson("/api/admin/company-graph-connection", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: selectedCompanyId }),
      });

      await loadSettings();
      setSuccessMessage("Company Graph connection removed.");
    } catch (error) {
      setErrorMessage(
        (error as Error).message ||
          "Unable to disconnect company Graph account",
      );
    } finally {
      setGraphConnecting(false);
    }
  };

  const handleLogoUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    if (!selectedCompanyId) {
      return;
    }

    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setUploadingLogo(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const formData = new FormData();
      formData.append("companyId", selectedCompanyId);
      formData.append("file", file);

      const payload = await fetchJson<{ logoUrl: string }>(
        "/api/admin/company-settings/logo",
        {
          method: "POST",
          body: formData,
        },
      );

      setLogoUrl(payload.logoUrl);
      await loadSettings();
      setSuccessMessage("Logo uploaded.");
    } catch (error) {
      setErrorMessage((error as Error).message || "Unable to upload logo");
    } finally {
      setUploadingLogo(false);
      event.target.value = "";
    }
  };

  const handleGenerateReport = async () => {
    if (!selectedCompanyId) {
      return;
    }

    setGeneratingReport(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await fetchJson("/api/admin/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: selectedCompanyId }),
      });

      await loadProjectionAndReports();
      setSuccessMessage("Monthly report generated.");
    } catch (error) {
      setErrorMessage((error as Error).message || "Unable to generate report");
    } finally {
      setGeneratingReport(false);
    }
  };

  const handleCleanupImports = async (dryRun: boolean) => {
    setCleaningImports(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const summary = await fetchJson<ImportCleanupSummary>(
        "/api/admin/import-cleanup",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: cleanupDate,
            deleteJobs: true,
            deleteOpportunities: true,
            deleteCandidates: true,
            deleteClients: true,
            dryRun,
          }),
        },
      );

      const resultMessage = `${summary.jobsMatched} jobs, ${summary.opportunitiesMatched} opportunities, ${summary.candidatesEligibleForDelete} candidates, ${summary.companiesEligibleForDelete + summary.clientAccountsEligibleForDelete} client entities`;

      setSuccessMessage(
        dryRun
          ? `Cleanup preview for ${cleanupDate}: ${resultMessage}.`
          : `Cleanup completed for ${cleanupDate}: ${resultMessage}.`,
      );

      await loadProjectionAndReports();
    } catch (error) {
      setErrorMessage((error as Error).message || "Unable to clean imports");
    } finally {
      setCleaningImports(false);
    }
  };

  const handleRepairDrafts = async () => {
    setRepairingDrafts(true);
    setRepairDraftResult(null);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const result = await fetchJson<RepairDraftResult>(
        "/api/email/repair-drafts",
        { method: "POST" },
      );
      setRepairDraftResult(result);
      setSuccessMessage(
        `Repair complete — ${result.repaired} draft(s) created, ${result.failed} failed, ${result.skippedNoEmail} skipped (no recruiter email).`,
      );
    } catch (error) {
      setErrorMessage(
        (error as Error).message || "Unable to repair missing drafts",
      );
    } finally {
      setRepairingDrafts(false);
    }
  };

  const handleRunEmailAudit = async () => {
    setRunningEmailAudit(true);
    setEmailAuditResult(null);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const params = new URLSearchParams();
      if (emailAuditDeleteFlagged) params.set("deleteFlagged", "true");
      const result = await fetchJson<EmailAuditResult>(
        `/api/admin/email-audit?${params.toString()}`,
        { method: "POST" },
      );
      setEmailAuditResult(result);
      const summary =
        result.fail === 0
          ? `All ${result.total} draft(s) passed the factuality check.`
          : `Audit complete — ${result.fail} of ${result.total} draft(s) flagged.${result.deletedDrafts > 0 ? ` ${result.deletedDrafts} deleted.` : ""}`;
      if (result.fail === 0) {
        setSuccessMessage(summary);
      } else {
        setErrorMessage(summary);
      }
    } catch (error) {
      setErrorMessage((error as Error).message || "Unable to run email audit");
    } finally {
      setRunningEmailAudit(false);
    }
  };

  const handleReviewDeletionRequest = async (
    requestId: string,
    decision: "APPROVE" | "REJECT",
  ) => {
    setReviewingRequestId(requestId);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await fetchJson("/api/admin/deletion-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          decision,
        }),
      });

      await loadProjectionAndReports();
      setSuccessMessage(
        decision === "APPROVE"
          ? "Deletion request approved and processed."
          : "Deletion request rejected.",
      );
    } catch (error) {
      setErrorMessage((error as Error).message || "Unable to review request");
    } finally {
      setReviewingRequestId(null);
    }
  };

  const handleSignOut = async () => {
    await fetchJson("/api/admin/auth/logout", { method: "POST" });
    window.location.href = "/";
  };

  const handleCreateUserLogin = async () => {
    setCreatingUser(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await fetchJson("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: newUserName,
          email: newUserEmail,
          password: newUserPassword,
          role: newUserRole,
        }),
      });

      setNewUserName("");
      setNewUserEmail("");
      setNewUserPassword("");
      setNewUserRole("USER");
      await loadTenantUsers();
      setSuccessMessage("User login created.");
    } catch (error) {
      setErrorMessage(
        (error as Error).message || "Unable to create user login",
      );
    } finally {
      setCreatingUser(false);
    }
  };

  const handleResetUserPassword = async (userId: string) => {
    const password = (resetPasswordDrafts[userId] ?? "").trim();
    if (password.length < 8) {
      setErrorMessage("Temporary password must be at least 8 characters.");
      return;
    }

    setUpdatingTenantUserId(userId);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await fetchJson("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          password,
        }),
      });

      setResetPasswordDrafts((current) => ({
        ...current,
        [userId]: "",
      }));
      await loadTenantUsers();
      setSuccessMessage("User password reset.");
    } catch (error) {
      setErrorMessage((error as Error).message || "Unable to reset password");
    } finally {
      setUpdatingTenantUserId(null);
    }
  };

  const handleToggleUserAccess = async (user: TenantUserLogin) => {
    setUpdatingTenantUserId(user.id);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await fetchJson("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          isActive: !user.isActive,
        }),
      });

      await loadTenantUsers();
      setSuccessMessage(
        user.isActive ? "User access disabled." : "User access enabled.",
      );
    } catch (error) {
      setErrorMessage(
        (error as Error).message || "Unable to update user access",
      );
    } finally {
      setUpdatingTenantUserId(null);
    }
  };

  const handleToggleUserRole = async (user: TenantUserLogin) => {
    setUpdatingTenantUserId(user.id);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await fetchJson("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          role: user.role === "ADMIN" ? "USER" : "ADMIN",
        }),
      });

      await loadTenantUsers();
      setSuccessMessage(
        user.role === "ADMIN"
          ? "User changed to standard access."
          : "User promoted to admin.",
      );
    } catch (error) {
      setErrorMessage((error as Error).message || "Unable to update user role");
    } finally {
      setUpdatingTenantUserId(null);
    }
  };

  const handleCreateCompanyAdmin = async () => {
    setCreatingCompanyAdmin(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await fetchJson("/api/admin/global/company-admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: newCompanyAdminTenantId,
          fullName: newCompanyAdminName,
          email: newCompanyAdminEmail,
          password: newCompanyAdminPassword,
        }),
      });

      setNewCompanyAdminName("");
      setNewCompanyAdminEmail("");
      setNewCompanyAdminPassword("");
      await refreshGlobalOverview();
      setSuccessMessage("Company admin saved.");
    } catch (error) {
      setErrorMessage(
        (error as Error).message || "Unable to add company admin",
      );
    } finally {
      setCreatingCompanyAdmin(false);
    }
  };

  const handleRemoveCompanyAdmin = async (userId: string) => {
    setRemovingCompanyAdminId(userId);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await fetchJson("/api/admin/global/company-admins", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });

      await refreshGlobalOverview();
      setSuccessMessage("Company admin removed.");
    } catch (error) {
      setErrorMessage(
        (error as Error).message || "Unable to remove company admin",
      );
    } finally {
      setRemovingCompanyAdminId(null);
    }
  };

  const updateBillingDraft = React.useCallback(
    (companyId: string, patch: Partial<BillingDraft>) => {
      setBillingDrafts((current) => ({
        ...current,
        [companyId]: {
          billingModel:
            patch.billingModel ??
            current[companyId]?.billingModel ??
            "PERCENTAGE",
          billingRatePerHour:
            patch.billingRatePerHour ??
            current[companyId]?.billingRatePerHour ??
            "0",
          revenueSplitPercent:
            patch.revenueSplitPercent ??
            current[companyId]?.revenueSplitPercent ??
            "50",
        },
      }));
    },
    [],
  );

  const handleSaveCompanyBilling = async (companyId: string) => {
    const draft = billingDrafts[companyId];
    if (!draft) {
      return;
    }

    setSavingCompanyBillingId(companyId);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await fetchJson("/api/admin/global/company-billing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          billingModel: draft.billingModel,
          billingRatePerHour:
            draft.billingModel === "PER_HOUR_PER_CANDIDATE"
              ? Number(draft.billingRatePerHour)
              : undefined,
          revenueSplitPercent:
            draft.billingModel === "PERCENTAGE"
              ? Number(draft.revenueSplitPercent)
              : undefined,
        }),
      });

      await refreshGlobalOverview();
      setSuccessMessage("Company billing updated.");
    } catch (error) {
      setErrorMessage((error as Error).message || "Unable to save billing");
    } finally {
      setSavingCompanyBillingId(null);
    }
  };

  const handleCreateSupportTicket = async () => {
    setCreatingSupportTicket(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await fetchJson("/api/admin/support-tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: supportTicketCompanyId || selectedCompanyId || undefined,
          category: supportTicketCategory,
          priority: supportTicketPriority,
          subject: supportTicketSubject,
          description: supportTicketDescription,
        }),
      });

      setSupportTicketSubject("");
      setSupportTicketDescription("");
      await loadSupportTickets();
      setSuccessMessage("Support ticket logged.");
    } catch (error) {
      setErrorMessage(
        (error as Error).message || "Unable to create support ticket",
      );
    } finally {
      setCreatingSupportTicket(false);
    }
  };

  const updateSupportTicketDraft = React.useCallback(
    (ticketId: string, patch: Partial<SupportTicketDraft>) => {
      setSupportTicketDrafts((current) => ({
        ...current,
        [ticketId]: {
          status: patch.status ?? current[ticketId]?.status ?? "OPEN",
          assignedTo: patch.assignedTo ?? current[ticketId]?.assignedTo ?? "",
          slaResponseDueAt:
            patch.slaResponseDueAt ?? current[ticketId]?.slaResponseDueAt ?? "",
          slaResolutionDueAt:
            patch.slaResolutionDueAt ??
            current[ticketId]?.slaResolutionDueAt ??
            "",
          resolutionNotes:
            patch.resolutionNotes ?? current[ticketId]?.resolutionNotes ?? "",
        },
      }));
    },
    [],
  );

  const handleUpdateSupportTicket = async (ticketId: string) => {
    const draft = supportTicketDrafts[ticketId];
    if (!draft) {
      return;
    }

    setUpdatingSupportTicketId(ticketId);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await fetchJson(`/api/admin/support-tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: draft.status,
          assignedTo: draft.assignedTo,
          slaResponseDueAt: draft.slaResponseDueAt
            ? new Date(draft.slaResponseDueAt).toISOString()
            : null,
          slaResolutionDueAt: draft.slaResolutionDueAt
            ? new Date(draft.slaResolutionDueAt).toISOString()
            : null,
          resolutionNotes: draft.resolutionNotes,
        }),
      });

      await loadSupportTickets();
      setSuccessMessage("Support ticket updated.");
    } catch (error) {
      setErrorMessage(
        (error as Error).message || "Unable to update support ticket",
      );
    } finally {
      setUpdatingSupportTicketId(null);
    }
  };

  const handleAddSupportComment = async (ticketId: string) => {
    const body = supportCommentDrafts[ticketId]?.trim();
    if (!body) {
      return;
    }

    setSavingSupportCommentId(ticketId);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await fetchJson(`/api/admin/support-tickets/${ticketId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });

      setSupportCommentDrafts((current) => ({
        ...current,
        [ticketId]: "",
      }));
      await loadSupportTickets();
      setSuccessMessage("Comment added to ticket.");
    } catch (error) {
      setErrorMessage(
        (error as Error).message || "Unable to add support ticket comment",
      );
    } finally {
      setSavingSupportCommentId(null);
    }
  };

  const handleQuickAssignSupportTicket = async (
    ticketId: string,
    assignedTo: string | null,
  ) => {
    setUpdatingSupportTicketId(ticketId);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await fetchJson(`/api/admin/support-tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignedTo,
          status: assignedTo ? "IN_PROGRESS" : undefined,
        }),
      });

      await loadSupportTickets();
      setSuccessMessage(
        assignedTo ? "Ticket assigned." : "Ticket assignment cleared.",
      );
    } catch (error) {
      setErrorMessage(
        (error as Error).message || "Unable to update ticket assignment",
      );
    } finally {
      setUpdatingSupportTicketId(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-6 py-6">
      <Card>
        <CardHeader>
          <CardTitle>Admin portal</CardTitle>
          <p className="text-sm text-slate-600">
            Signed in as {username}. Manage company branding, revenue split,
            finance reporting, and audit logs.
          </p>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {logoUrl ? (
              <Image
                src={logoUrl}
                alt="Company logo"
                width={40}
                height={40}
                unoptimized
                className="h-10 w-10 rounded border border-slate-200 object-cover"
              />
            ) : null}
            <div>
              <p className="text-sm font-medium text-slate-900">
                {brandName || selectedCompany?.companyName || "Company"}
              </p>
              <p className="text-xs text-slate-600">Currency: ZAR</p>
            </div>
          </div>

          <Button
            className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
            onClick={handleSignOut}
          >
            Sign out
          </Button>
        </CardContent>
      </Card>

      {/* Section navigation */}
      <nav className="flex gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-1">
        {(
          [
            { key: "company", label: "Company" },
            { key: "ai-email", label: "AI Email" },
            { key: "automation", label: "Automation" },
            { key: "finance", label: "Finance" },
            { key: "users", label: "Users" },
            { key: "support", label: "Support" },
            { key: "maintenance", label: "Maintenance" },
            { key: "config" as const, label: "Configuration" },
            ...(canUseSuperAdminPortalFeatures
              ? [{ key: "instance" as const, label: "Instance" }]
              : []),
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:bg-white/60 hover:text-slate-900"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {isSuperAdmin && portalMode === "admin" ? (
        <Card>
          <CardHeader>
            <CardTitle>Super admin access</CardTitle>
            <p className="text-sm text-slate-600">
              Open the dedicated super admin portal for cross-company
              administration and support operations.
            </p>
          </CardHeader>
          <CardContent>
            <a
              href="/super-admin"
              className="inline-flex h-9 items-center rounded bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700"
            >
              Open super admin portal
            </a>
          </CardContent>
        </Card>
      ) : null}

      {canUseSuperAdminPortalFeatures ? (
        <Card>
          <CardHeader>
            <CardTitle>Super admin mode</CardTitle>
            <p className="text-sm text-slate-600">
              Signed in as tenant{" "}
              <span className="font-medium">{authTenantId}</span>. This portal
              can support all company instances.
            </p>
          </CardHeader>
        </Card>
      ) : null}

      {canUseSuperAdminPortalFeatures ? (
        <Card>
          <CardHeader>
            <CardTitle>Admin of Admins</CardTitle>
            <p className="text-sm text-slate-600">
              View all company instances, active admins, and approved timesheets
              pending invoicing.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <Input
                value={newCompanyAdminTenantId}
                onChange={(event) =>
                  setNewCompanyAdminTenantId(event.target.value)
                }
                placeholder="Tenant id"
              />
              <Input
                value={newCompanyAdminName}
                onChange={(event) => setNewCompanyAdminName(event.target.value)}
                placeholder="Admin full name"
              />
              <Input
                value={newCompanyAdminEmail}
                onChange={(event) =>
                  setNewCompanyAdminEmail(event.target.value)
                }
                placeholder="Admin email"
              />
              <Input
                type="password"
                value={newCompanyAdminPassword}
                onChange={(event) =>
                  setNewCompanyAdminPassword(event.target.value)
                }
                placeholder="Temporary password"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={handleCreateCompanyAdmin}
                disabled={
                  creatingCompanyAdmin ||
                  !newCompanyAdminTenantId ||
                  !newCompanyAdminName ||
                  !newCompanyAdminEmail ||
                  !newCompanyAdminPassword
                }
              >
                {creatingCompanyAdmin ? "Saving..." : "Add company admin"}
              </Button>
              <Button
                className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                onClick={() => refreshGlobalOverview()}
              >
                Refresh overview
              </Button>
              <Input
                value={clientFilter}
                onChange={(event) => setClientFilter(event.target.value)}
                placeholder="Filter by client name"
                className="h-9 w-56"
              />
            </div>

            {globalOverview.length === 0 ? (
              <p className="text-sm text-slate-600">
                No tenant instances found.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm text-slate-700">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-2 py-2">Company instance</th>
                      <th className="px-2 py-2">Tenant admins</th>
                      <th className="px-2 py-2">Billing mechanism</th>
                      <th className="px-2 py-2">Payment vs agreement</th>
                      <th className="px-2 py-2">
                        Outstanding timesheet months
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {globalOverview.map((tenant) => {
                      const visibleCompanies = tenant.companies.filter(
                        (company) => company.isAgreementCompany,
                      );
                      const filteredCompanies = visibleCompanies.filter(
                        (company) =>
                          company.name
                            .toLowerCase()
                            .includes(clientFilter.trim().toLowerCase()),
                      );

                      return (
                        <tr
                          key={tenant.tenantId}
                          className="border-b border-slate-100"
                        >
                          <td className="px-2 py-2 align-top">
                            <p className="font-medium text-slate-900">
                              {tenant.tenantDisplayName}
                            </p>
                            <p className="text-xs text-slate-500">
                              {tenant.tenantId}
                            </p>
                            <p className="mt-1 text-xs text-slate-600">
                              {filteredCompanies.length} agreement
                              {filteredCompanies.length === 1
                                ? " company"
                                : " companies"}
                            </p>
                          </td>
                          <td className="px-2 py-2 align-top">
                            {tenant.admins.length === 0 ? (
                              <p className="text-xs text-slate-500">
                                No active admins
                              </p>
                            ) : (
                              <div className="space-y-2">
                                {tenant.admins.map((admin) => (
                                  <div
                                    key={admin.id}
                                    className="flex items-center justify-between gap-2 rounded border border-slate-200 px-2 py-1"
                                  >
                                    <div>
                                      <p className="text-xs font-medium text-slate-900">
                                        {admin.fullName}
                                      </p>
                                      <p className="text-xs text-slate-600">
                                        {admin.email}
                                      </p>
                                    </div>
                                    <Button
                                      type="button"
                                      className="h-7 border border-slate-300 bg-white px-2 text-xs text-slate-900 hover:bg-slate-50"
                                      onClick={() =>
                                        handleRemoveCompanyAdmin(admin.id)
                                      }
                                      disabled={
                                        removingCompanyAdminId === admin.id
                                      }
                                    >
                                      {removingCompanyAdminId === admin.id
                                        ? "Removing..."
                                        : "Remove"}
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-2 align-top">
                            {filteredCompanies.length === 0 ? (
                              <p className="text-xs text-slate-500">
                                No agreement-signing companies match the current
                                filter
                              </p>
                            ) : (
                              <div className="space-y-2">
                                {filteredCompanies.map((company) => {
                                  const draft = billingDrafts[company.id] ?? {
                                    billingModel: company.billingModel,
                                    billingRatePerHour:
                                      company.billingRatePerHour.toString(),
                                    revenueSplitPercent:
                                      company.revenueSplitPercent.toString(),
                                  };

                                  return (
                                    <div
                                      key={company.id}
                                      className="rounded border border-slate-200 p-2"
                                    >
                                      <p className="mb-1 text-xs font-medium text-slate-900">
                                        {company.name}
                                      </p>
                                      <select
                                        className="h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs"
                                        value={draft.billingModel}
                                        onChange={(event) =>
                                          updateBillingDraft(company.id, {
                                            billingModel: event.target
                                              .value as BillingDraft["billingModel"],
                                          })
                                        }
                                      >
                                        <option value="PER_HOUR_PER_CANDIDATE">
                                          Per hour per candidate
                                        </option>
                                        <option value="PERCENTAGE">
                                          Percentage wise
                                        </option>
                                      </select>

                                      {draft.billingModel ===
                                      "PER_HOUR_PER_CANDIDATE" ? (
                                        <Input
                                          className="mt-2 h-8 text-xs"
                                          type="number"
                                          min={0}
                                          step={0.01}
                                          value={draft.billingRatePerHour}
                                          onChange={(event) =>
                                            updateBillingDraft(company.id, {
                                              billingRatePerHour:
                                                event.target.value,
                                            })
                                          }
                                          placeholder="Hourly billing rate"
                                        />
                                      ) : (
                                        <Input
                                          className="mt-2 h-8 text-xs"
                                          type="number"
                                          min={0}
                                          max={100}
                                          step={0.01}
                                          value={draft.revenueSplitPercent}
                                          onChange={(event) =>
                                            updateBillingDraft(company.id, {
                                              revenueSplitPercent:
                                                event.target.value,
                                            })
                                          }
                                          placeholder="Billing percentage"
                                        />
                                      )}

                                      <Button
                                        type="button"
                                        className="mt-2 h-7 px-2 text-xs"
                                        onClick={() =>
                                          handleSaveCompanyBilling(company.id)
                                        }
                                        disabled={
                                          savingCompanyBillingId === company.id
                                        }
                                      >
                                        {savingCompanyBillingId === company.id
                                          ? "Saving..."
                                          : "Save billing"}
                                      </Button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-2 align-top">
                            {filteredCompanies.length === 0 ? (
                              <p className="text-xs text-slate-500">
                                No agreement-signing companies match the current
                                filter
                              </p>
                            ) : (
                              <div className="space-y-2">
                                {filteredCompanies.map((company) => (
                                  <div
                                    key={`${company.id}-payment`}
                                    className="rounded border border-slate-200 p-2"
                                  >
                                    <p className="text-xs font-medium text-slate-900">
                                      {company.name}
                                    </p>
                                    <p className="text-xs text-slate-700">
                                      Expected:{" "}
                                      {company.expectedAmount.toFixed(2)}{" "}
                                      {company.currency}
                                    </p>
                                    <p className="text-xs text-slate-700">
                                      Paid: {company.paidAmount.toFixed(2)}{" "}
                                      {company.currency}
                                    </p>
                                    <p className="text-xs text-slate-700">
                                      Outstanding:{" "}
                                      {company.outstandingAmount.toFixed(2)}{" "}
                                      {company.currency}
                                    </p>
                                    <p
                                      className={`text-xs font-medium ${
                                        company.paidAsPerAgreement
                                          ? "text-emerald-700"
                                          : "text-amber-700"
                                      }`}
                                    >
                                      {company.paidAsPerAgreement
                                        ? "Paid as per agreement"
                                        : `Payment coverage ${company.paymentCoveragePercent.toFixed(2)}%`}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-2 align-top">
                            {filteredCompanies.length === 0 ? (
                              <p className="text-xs text-slate-500">
                                No agreement-signing companies match the current
                                filter
                              </p>
                            ) : (
                              <div className="space-y-2">
                                {filteredCompanies.map((company) => (
                                  <div
                                    key={`${company.id}-placed`}
                                    className="rounded border border-slate-200 p-2"
                                  >
                                    <p className="text-xs font-medium text-slate-900">
                                      {company.name}:{" "}
                                      {
                                        company.placedWithoutSubmittedTimesheets
                                          .length
                                      }
                                    </p>
                                    {company.placedWithoutSubmittedTimesheets
                                      .length === 0 ? (
                                      <p className="text-xs text-slate-500">
                                        None
                                      </p>
                                    ) : (
                                      <div className="mt-1 space-y-1">
                                        {company.placedWithoutSubmittedTimesheets.map(
                                          (item) => (
                                            <div
                                              key={item.applicationId}
                                              className="rounded border border-slate-100 bg-slate-50 px-2 py-1 text-xs text-slate-700"
                                            >
                                              <p className="font-medium">
                                                {item.candidateName} (
                                                {item.roleTitle})
                                              </p>
                                              <p className="text-slate-600">
                                                Outstanding months (
                                                {item.outstandingMonthCount}):
                                              </p>
                                              <div className="mt-1 flex flex-wrap gap-1">
                                                {item.outstandingMonths.map(
                                                  (month) => {
                                                    const href = `/timesheets?companyName=${encodeURIComponent(
                                                      company.name,
                                                    )}&candidateName=${encodeURIComponent(
                                                      item.candidateName,
                                                    )}&month=${encodeURIComponent(month)}`;

                                                    return (
                                                      <a
                                                        key={`${item.applicationId}-${month}`}
                                                        href={href}
                                                        className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
                                                      >
                                                        {month}
                                                      </a>
                                                    );
                                                  },
                                                )}
                                              </div>
                                            </div>
                                          ),
                                        )}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Error/success messages — always visible */}
      {errorMessage ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage}
        </p>
      ) : null}

      {successMessage ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {successMessage}
        </p>
      ) : null}

      {activeTab === "support" && (
        <Card>
          <CardHeader>
            <CardTitle>Support tickets</CardTitle>
            <p className="text-sm text-slate-600">
              Log assistance requests for user, admin, billing, or support
              issues.
              {canUseSuperAdminPortalFeatures
                ? " Super admins can manage tickets across all company instances."
                : " Your team can track request progress here."}
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {canUseSuperAdminPortalFeatures ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={ticketQueueView === "ALL" ? "default" : "outline"}
                  onClick={() => applyTicketQueueView("ALL")}
                >
                  All ({queueViewCounts.all})
                </Button>
                <Button
                  type="button"
                  variant={
                    ticketQueueView === "OVERDUE" ? "default" : "outline"
                  }
                  onClick={() => applyTicketQueueView("OVERDUE")}
                >
                  Overdue ({queueViewCounts.overdue})
                </Button>
                <Button
                  type="button"
                  variant={
                    ticketQueueView === "UNASSIGNED" ? "default" : "outline"
                  }
                  onClick={() => applyTicketQueueView("UNASSIGNED")}
                >
                  Unassigned ({queueViewCounts.unassigned})
                </Button>
                <Button
                  type="button"
                  variant={ticketQueueView === "MINE" ? "default" : "outline"}
                  onClick={() => applyTicketQueueView("MINE")}
                >
                  Mine ({queueViewCounts.mine})
                </Button>
                <Button
                  type="button"
                  variant={
                    ticketQueueView === "RESOLVED_TODAY" ? "default" : "outline"
                  }
                  onClick={() => applyTicketQueueView("RESOLVED_TODAY")}
                >
                  Resolved today ({queueViewCounts.resolvedToday})
                </Button>
              </div>
            ) : null}

            <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-6">
              <select
                className="h-9 rounded border border-slate-300 bg-white px-2 text-sm"
                value={ticketFilterStatus}
                onChange={(event) =>
                  setTicketFilterStatus(
                    event.target.value as typeof ticketFilterStatus,
                  )
                }
              >
                <option value="ALL">All statuses</option>
                <option value="OPEN">Open</option>
                <option value="IN_PROGRESS">In progress</option>
                <option value="RESOLVED">Resolved</option>
                <option value="CLOSED">Closed</option>
              </select>
              <select
                className="h-9 rounded border border-slate-300 bg-white px-2 text-sm"
                value={ticketFilterPriority}
                onChange={(event) =>
                  setTicketFilterPriority(
                    event.target.value as typeof ticketFilterPriority,
                  )
                }
              >
                <option value="ALL">All priorities</option>
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </select>
              <select
                className="h-9 rounded border border-slate-300 bg-white px-2 text-sm"
                value={ticketFilterCategory}
                onChange={(event) =>
                  setTicketFilterCategory(
                    event.target.value as typeof ticketFilterCategory,
                  )
                }
              >
                <option value="ALL">All categories</option>
                <option value="USER_ACCESS">User access</option>
                <option value="ADMIN_ACCESS">Admin access</option>
                <option value="BILLING">Billing</option>
                <option value="SUPPORT">Support</option>
              </select>
              <select
                className="h-9 rounded border border-slate-300 bg-white px-2 text-sm"
                value={ticketFilterAssigned}
                onChange={(event) =>
                  setTicketFilterAssigned(
                    event.target.value as typeof ticketFilterAssigned,
                  )
                }
              >
                <option value="ALL">All assignments</option>
                <option value="UNASSIGNED">Unassigned</option>
                <option value="MINE">Assigned to me</option>
              </select>
              <select
                className="h-9 rounded border border-slate-300 bg-white px-2 text-sm"
                value={ticketFilterSla}
                onChange={(event) =>
                  setTicketFilterSla(
                    event.target.value as typeof ticketFilterSla,
                  )
                }
              >
                <option value="ALL">All SLA states</option>
                <option value="BREACHED">Any SLA breached</option>
                <option value="RESPONSE_BREACHED">Response SLA breached</option>
                <option value="RESOLUTION_BREACHED">
                  Resolution SLA breached
                </option>
              </select>
              {canUseSuperAdminPortalFeatures ? (
                <Input
                  value={ticketTenantFilter}
                  onChange={(event) =>
                    setTicketTenantFilter(event.target.value)
                  }
                  placeholder="Filter by company instance"
                />
              ) : (
                <div />
              )}
            </div>

            <div className="grid gap-2 md:grid-cols-4">
              <select
                className="h-9 rounded border border-slate-300 bg-white px-2 text-sm"
                value={supportTicketCategory}
                onChange={(event) =>
                  setSupportTicketCategory(
                    event.target.value as SupportTicket["category"],
                  )
                }
              >
                <option value="USER_ACCESS">User access</option>
                <option value="ADMIN_ACCESS">Admin access</option>
                <option value="BILLING">Billing</option>
                <option value="SUPPORT">Support</option>
              </select>
              <select
                className="h-9 rounded border border-slate-300 bg-white px-2 text-sm"
                value={supportTicketPriority}
                onChange={(event) =>
                  setSupportTicketPriority(
                    event.target.value as SupportTicket["priority"],
                  )
                }
              >
                <option value="LOW">Low priority</option>
                <option value="MEDIUM">Medium priority</option>
                <option value="HIGH">High priority</option>
                <option value="URGENT">Urgent</option>
              </select>
              <select
                className="h-9 rounded border border-slate-300 bg-white px-2 text-sm"
                value={supportTicketCompanyId}
                onChange={(event) =>
                  setSupportTicketCompanyId(event.target.value)
                }
              >
                <option value="">No company selected</option>
                {companies.map((company) => (
                  <option key={company.companyId} value={company.companyId}>
                    {company.companyName}
                  </option>
                ))}
              </select>
              <Button
                onClick={handleCreateSupportTicket}
                disabled={
                  creatingSupportTicket ||
                  supportTicketSubject.trim().length < 3 ||
                  supportTicketDescription.trim().length < 10
                }
              >
                {creatingSupportTicket ? "Logging..." : "Log ticket"}
              </Button>
            </div>

            <Input
              value={supportTicketSubject}
              onChange={(event) => setSupportTicketSubject(event.target.value)}
              placeholder="Ticket subject"
            />
            <Textarea
              value={supportTicketDescription}
              onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                setSupportTicketDescription(event.target.value)
              }
              placeholder="Describe the issue and what help is needed."
              rows={4}
            />

            {filteredSupportTickets.length === 0 ? (
              <p className="text-sm text-slate-600">
                No support tickets match the current filters.
              </p>
            ) : (
              <div className="space-y-2">
                {filteredSupportTickets.map((ticket) => {
                  const draft = supportTicketDrafts[ticket.id] ?? {
                    status: ticket.status,
                    assignedTo: ticket.assignedTo ?? "",
                    slaResponseDueAt: toLocalDateTimeInputValue(
                      ticket.slaResponseDueAt,
                    ),
                    slaResolutionDueAt: toLocalDateTimeInputValue(
                      ticket.slaResolutionDueAt,
                    ),
                    resolutionNotes: ticket.resolutionNotes ?? "",
                  };

                  return (
                    <div
                      key={ticket.id}
                      className="rounded border border-slate-200 p-3"
                    >
                      <div className="grid gap-2 text-xs text-slate-700 md:grid-cols-2">
                        <p>
                          <span className="font-semibold text-slate-900">
                            Created:
                          </span>{" "}
                          {new Date(ticket.createdAt).toLocaleString("en-GB")}
                        </p>
                        <p>
                          <span className="font-semibold text-slate-900">
                            Requested by:
                          </span>{" "}
                          {ticket.createdBy}
                        </p>
                        {canUseSuperAdminPortalFeatures ? (
                          <p>
                            <span className="font-semibold text-slate-900">
                              Company instance:
                            </span>{" "}
                            {ticket.tenantDisplayName}
                          </p>
                        ) : null}
                        <p>
                          <span className="font-semibold text-slate-900">
                            Company:
                          </span>{" "}
                          {ticket.companyName ?? "Not linked"}
                        </p>
                        <p>
                          <span className="font-semibold text-slate-900">
                            Category:
                          </span>{" "}
                          {ticket.category}
                        </p>
                        <p>
                          <span className="font-semibold text-slate-900">
                            Priority:
                          </span>{" "}
                          {ticket.priority}
                        </p>
                        <p>
                          <span className="font-semibold text-slate-900">
                            SLA response due:
                          </span>{" "}
                          {ticket.slaResponseDueAt
                            ? new Date(ticket.slaResponseDueAt).toLocaleString(
                                "en-GB",
                              )
                            : "Not set"}
                          {ticket.responseSlaBreached ? " | Breached" : ""}
                        </p>
                        <p>
                          <span className="font-semibold text-slate-900">
                            SLA resolution due:
                          </span>{" "}
                          {ticket.slaResolutionDueAt
                            ? new Date(
                                ticket.slaResolutionDueAt,
                              ).toLocaleString("en-GB")
                            : "Not set"}
                          {ticket.resolutionSlaBreached ? " | Breached" : ""}
                        </p>
                      </div>

                      <p className="mt-2 text-sm font-medium text-slate-900">
                        {ticket.subject}
                      </p>
                      <p className="mt-1 text-sm text-slate-700">
                        {ticket.description}
                      </p>

                      <div className="mt-2 rounded border border-slate-100 bg-slate-50 p-2 text-xs text-slate-700">
                        <p>
                          First response:{" "}
                          {ticket.firstResponseAt
                            ? new Date(ticket.firstResponseAt).toLocaleString(
                                "en-GB",
                              )
                            : "Pending"}
                        </p>
                        {ticket.resolvedAt ? (
                          <p>
                            Resolved:{" "}
                            {new Date(ticket.resolvedAt).toLocaleString(
                              "en-GB",
                            )}
                          </p>
                        ) : null}
                      </div>

                      {canUseSuperAdminPortalFeatures ? (
                        <div className="mt-3 grid gap-2 md:grid-cols-2">
                          <select
                            className="h-9 rounded border border-slate-300 bg-white px-2 text-sm"
                            value={draft.status}
                            onChange={(event) =>
                              updateSupportTicketDraft(ticket.id, {
                                status: event.target
                                  .value as SupportTicketDraft["status"],
                              })
                            }
                          >
                            <option value="OPEN">Open</option>
                            <option value="IN_PROGRESS">In progress</option>
                            <option value="RESOLVED">Resolved</option>
                            <option value="CLOSED">Closed</option>
                          </select>
                          <Input
                            value={draft.assignedTo}
                            onChange={(event) =>
                              updateSupportTicketDraft(ticket.id, {
                                assignedTo: event.target.value,
                              })
                            }
                            placeholder="Assigned to"
                          />
                          <Input
                            type="datetime-local"
                            value={draft.slaResponseDueAt}
                            onChange={(event) =>
                              updateSupportTicketDraft(ticket.id, {
                                slaResponseDueAt: event.target.value,
                              })
                            }
                            placeholder="SLA response due"
                          />
                          <Input
                            type="datetime-local"
                            value={draft.slaResolutionDueAt}
                            onChange={(event) =>
                              updateSupportTicketDraft(ticket.id, {
                                slaResolutionDueAt: event.target.value,
                              })
                            }
                            placeholder="SLA resolution due"
                          />
                          <Textarea
                            value={draft.resolutionNotes}
                            onChange={(
                              event: React.ChangeEvent<HTMLTextAreaElement>,
                            ) =>
                              updateSupportTicketDraft(ticket.id, {
                                resolutionNotes: event.target.value,
                              })
                            }
                            placeholder="Resolution notes"
                            rows={2}
                          />
                          <div className="flex items-center">
                            <div className="flex flex-wrap gap-2">
                              <Button
                                onClick={() =>
                                  handleUpdateSupportTicket(ticket.id)
                                }
                                disabled={updatingSupportTicketId === ticket.id}
                              >
                                {updatingSupportTicketId === ticket.id
                                  ? "Saving..."
                                  : "Save ticket"}
                              </Button>
                              <Button
                                className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                                onClick={() =>
                                  handleQuickAssignSupportTicket(
                                    ticket.id,
                                    username,
                                  )
                                }
                                disabled={updatingSupportTicketId === ticket.id}
                              >
                                Assign to me
                              </Button>
                              <Button
                                className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                                onClick={() =>
                                  handleQuickAssignSupportTicket(
                                    ticket.id,
                                    null,
                                  )
                                }
                                disabled={updatingSupportTicketId === ticket.id}
                              >
                                Clear assignment
                              </Button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-slate-600">
                          Status: {ticket.status}
                          {ticket.assignedTo
                            ? ` | Assigned to ${ticket.assignedTo}`
                            : ""}
                        </p>
                      )}

                      <div className="mt-3 space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                          Ticket comments
                        </p>
                        {ticket.comments.length === 0 ? (
                          <p className="text-xs text-slate-500">
                            No comments yet.
                          </p>
                        ) : (
                          <div className="space-y-1">
                            {ticket.comments.map((comment) => (
                              <div
                                key={comment.id}
                                className="rounded border border-slate-100 bg-white px-2 py-1"
                              >
                                <p className="text-xs text-slate-600">
                                  {new Date(comment.createdAt).toLocaleString(
                                    "en-GB",
                                  )}{" "}
                                  | {comment.author}
                                </p>
                                <p className="text-sm text-slate-800">
                                  {comment.body}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="flex gap-2">
                          <Input
                            value={supportCommentDrafts[ticket.id] ?? ""}
                            onChange={(event) =>
                              setSupportCommentDrafts((current) => ({
                                ...current,
                                [ticket.id]: event.target.value,
                              }))
                            }
                            placeholder="Add a comment"
                          />
                          <Button
                            onClick={() => handleAddSupportComment(ticket.id)}
                            disabled={
                              savingSupportCommentId === ticket.id ||
                              !(supportCommentDrafts[ticket.id] ?? "").trim()
                            }
                          >
                            {savingSupportCommentId === ticket.id
                              ? "Saving..."
                              : "Comment"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === "users" && (
        <Card>
          <CardHeader>
            <CardTitle>Create user logins</CardTitle>
            <p className="text-sm text-slate-600">
              Create company users. Administrators can access all company data;
              users can access only resources they create.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              value={newUserName}
              onChange={(event) => setNewUserName(event.target.value)}
              placeholder="Full name"
            />
            <Input
              value={newUserEmail}
              onChange={(event) => setNewUserEmail(event.target.value)}
              placeholder="Email"
            />
            <Input
              type="password"
              value={newUserPassword}
              onChange={(event) => setNewUserPassword(event.target.value)}
              placeholder="Password"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant={newUserRole === "USER" ? "default" : "outline"}
                onClick={() => setNewUserRole("USER")}
              >
                User
              </Button>
              <Button
                type="button"
                variant={newUserRole === "ADMIN" ? "default" : "outline"}
                onClick={() => setNewUserRole("ADMIN")}
              >
                Admin
              </Button>
            </div>
            <Button
              type="button"
              disabled={
                creatingUser ||
                !newUserName ||
                !newUserEmail ||
                !newUserPassword
              }
              onClick={handleCreateUserLogin}
            >
              {creatingUser ? "Creating user..." : "Create user login"}
            </Button>

            <div className="rounded border border-slate-200">
              <div className="border-b border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-sm font-medium text-slate-900">
                  Manage existing logins
                </p>
                <p className="text-xs text-slate-600">
                  Reset passwords, change role access, or disable accounts.
                </p>
              </div>

              {loadingTenantUsers ? (
                <p className="px-3 py-3 text-sm text-slate-600">
                  Loading users...
                </p>
              ) : tenantUsers.length === 0 ? (
                <p className="px-3 py-3 text-sm text-slate-600">
                  No user logins found.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm text-slate-700">
                    <thead>
                      <tr className="border-b border-slate-200 bg-white text-left text-xs uppercase tracking-wide text-slate-500">
                        <th className="px-3 py-2">Name</th>
                        <th className="px-3 py-2">Email</th>
                        <th className="px-3 py-2">Role</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Password reset</th>
                        <th className="px-3 py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tenantUsers.map((user) => (
                        <tr key={user.id} className="border-b border-slate-100">
                          <td className="px-3 py-2">
                            <p className="font-medium text-slate-900">
                              {user.fullName}
                            </p>
                            <p className="text-xs text-slate-500">
                              Created{" "}
                              {new Date(user.createdAt).toLocaleDateString(
                                "en-GB",
                              )}
                            </p>
                          </td>
                          <td className="px-3 py-2">{user.email}</td>
                          <td className="px-3 py-2">{user.role}</td>
                          <td className="px-3 py-2">
                            {user.isActive ? "Active" : "Disabled"}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex min-w-[230px] gap-2">
                              <Input
                                type="password"
                                value={resetPasswordDrafts[user.id] ?? ""}
                                onChange={(event) =>
                                  setResetPasswordDrafts((current) => ({
                                    ...current,
                                    [user.id]: event.target.value,
                                  }))
                                }
                                placeholder="New temporary password"
                              />
                              <Button
                                type="button"
                                className="whitespace-nowrap"
                                disabled={
                                  updatingTenantUserId === user.id ||
                                  (resetPasswordDrafts[user.id] ?? "").trim()
                                    .length < 8
                                }
                                onClick={() => handleResetUserPassword(user.id)}
                              >
                                Reset
                              </Button>
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                className="whitespace-nowrap"
                                disabled={updatingTenantUserId === user.id}
                                onClick={() => handleToggleUserRole(user)}
                              >
                                {user.role === "ADMIN"
                                  ? "Make user"
                                  : "Make admin"}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                className="whitespace-nowrap"
                                disabled={updatingTenantUserId === user.id}
                                onClick={() => handleToggleUserAccess(user)}
                              >
                                {user.isActive ? "Disable" : "Enable"}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === "company" && (
        <Card>
          <CardHeader>
            <CardTitle>Company settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              value={brandName}
              onChange={(event) => setBrandName(event.target.value)}
              placeholder="Brand name"
            />

            <Input
              value={splitParties}
              readOnly
              placeholder="Revenue split parties"
            />

            <Input value={splitLabel} readOnly placeholder="Revenue split" />

            <Input
              value={reportRecipientsText}
              onChange={(event) => setReportRecipientsText(event.target.value)}
              placeholder="Report recipients (comma-separated)"
            />
            <Input
              value={outlookMailbox}
              onChange={(event) => setOutlookMailbox(event.target.value)}
              placeholder="Outlook draft mailbox"
            />
            <p className="text-xs text-slate-500">
              AI-generated drafts are automatically saved to this Outlook
              mailbox.
            </p>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <p className="font-medium text-slate-900">
                Microsoft Graph connection
              </p>
              <p>
                Status:{" "}
                {selectedCompany?.graphConnected
                  ? "Connected"
                  : "Not connected"}
              </p>
              {selectedCompany?.graphConnectedEmail ? (
                <p>Connected account: {selectedCompany.graphConnectedEmail}</p>
              ) : null}
              {selectedCompany?.graphTokenExpiresAt ? (
                <p>
                  Token expires:{" "}
                  {new Date(
                    selectedCompany.graphTokenExpiresAt,
                  ).toLocaleString()}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={handleConnectCompanyGraph}
                  disabled={graphConnecting || !selectedCompanyId}
                >
                  {graphConnecting ? "Connecting..." : "Connect company Graph"}
                </Button>
                {selectedCompany?.graphConnected ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleDisconnectCompanyGraph}
                    disabled={graphConnecting || !selectedCompanyId}
                  >
                    Disconnect Graph
                  </Button>
                ) : null}
              </div>
            </div>
            <p className="text-xs text-slate-500">
              Required recipient: {requiredRecipient}
            </p>

            <div className="space-y-2">
              <label className="text-sm text-slate-700" htmlFor="company-logo">
                Company logo upload
              </label>
              <Input
                id="company-logo"
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
              />
              {uploadingLogo ? (
                <p className="text-xs text-slate-600">Uploading logo...</p>
              ) : null}
            </div>

            <Button
              onClick={handleSaveSettings}
              disabled={saving || !selectedCompanyId}
            >
              {saving ? "Saving..." : "Save settings"}
            </Button>
          </CardContent>
        </Card>
      )}

      {activeTab === "ai-email" && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>AI email generation</CardTitle>
              <p className="text-sm text-slate-600">
                Configure how the AI generates client submission emails. These
                settings control partner branding, email tone, length, and
                negotiation techniques.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label
                  className="text-sm font-medium text-slate-700"
                  htmlFor="partner-name"
                >
                  Partner name
                </label>
                <Input
                  id="partner-name"
                  value={c2cPartnerName}
                  onChange={(event) => setC2cPartnerName(event.target.value)}
                  placeholder="Your company name as it appears in emails"
                />
                <p className="text-xs text-slate-500">
                  The company name injected into AI-generated emails (e.g.
                  &quot;Acme Consulting Ltd&quot;).
                </p>
              </div>

              <div className="space-y-2">
                <label
                  className="text-sm font-medium text-slate-700"
                  htmlFor="company-type"
                >
                  Company type
                </label>
                <select
                  id="company-type"
                  value={companyType}
                  onChange={(event) =>
                    setCompanyType(
                      event.target.value as "placement" | "support",
                    )
                  }
                  className="flex h-9 w-full rounded-md border border-slate-200 bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-950"
                >
                  <option value="placement">
                    Professional services / placement firm
                  </option>
                  <option value="support">
                    Specialist support and services partner
                  </option>
                </select>
                <p className="text-xs text-slate-500">
                  Controls how the AI frames your company in generated emails.
                </p>
              </div>

              <div className="space-y-2">
                <label
                  className="text-sm font-medium text-slate-700"
                  htmlFor="partner-positioning"
                >
                  Company positioning (optional)
                </label>
                <Textarea
                  id="partner-positioning"
                  value={c2cPartnerPositioning}
                  onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                    setC2cPartnerPositioning(event.target.value)
                  }
                  placeholder="Describe your company's unique positioning, e.g. 'We are a niche IT consulting firm specialising in financial services modernisation.'"
                  rows={4}
                />
                <p className="text-xs text-slate-500">
                  Custom positioning narrative woven into the email body to
                  differentiate your company.
                </p>
              </div>

              <div className="space-y-2">
                <label
                  className="text-sm font-medium text-slate-700"
                  htmlFor="email-length"
                >
                  Preferred email length
                </label>
                <Input
                  id="email-length"
                  value={preferredEmailLength}
                  onChange={(event) =>
                    setPreferredEmailLength(event.target.value)
                  }
                  placeholder="e.g. 350-500 words"
                />
                <p className="text-xs text-slate-500">
                  Target word count range for generated emails. Leave blank for
                  the default (350–500 words).
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700">
                  Negotiation techniques (Chris Voss)
                </p>
                <p className="text-xs text-slate-500">
                  Toggle which persuasion techniques the AI weaves into emails.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(
                    [
                      { key: "accusations_audit", label: "Accusations audit" },
                      { key: "tactical_empathy", label: "Tactical empathy" },
                      { key: "labelling", label: "Labelling" },
                      { key: "mirroring", label: "Mirroring" },
                      {
                        key: "calibrated_questions",
                        label: "Calibrated questions",
                      },
                      {
                        key: "no_oriented_closing",
                        label: "No-oriented closing",
                      },
                    ] as const
                  ).map((toggle) => (
                    <label
                      key={toggle.key}
                      className="flex items-center gap-2 text-sm text-slate-700"
                    >
                      <input
                        type="checkbox"
                        checked={vossToggles[toggle.key] ?? true}
                        onChange={(event) =>
                          setVossToggles((prev) => ({
                            ...prev,
                            [toggle.key]: event.target.checked,
                          }))
                        }
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      {toggle.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700">
                  Opportunity gating rules
                </p>
                <p className="text-xs text-slate-500">
                  Toggle which hard gates are enforced during email generation.
                  When enabled, opportunities that fail the gate are blocked
                  from email generation.
                </p>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={enforceRemoteGate}
                      onChange={(event) =>
                        setEnforceRemoteGate(event.target.checked)
                      }
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    Block non-remote opportunities
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={enforceUsWorkAuthGate}
                      onChange={(event) =>
                        setEnforceUsWorkAuthGate(event.target.checked)
                      }
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    Block US work authorisation opportunities
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={enforceUkWorkAuthGate}
                      onChange={(event) =>
                        setEnforceUkWorkAuthGate(event.target.checked)
                      }
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    Block UK work authorisation opportunities
                  </label>
                </div>
              </div>

              <div className="space-y-2">
                <label
                  className="text-sm font-medium text-slate-700"
                  htmlFor="custom-prompt"
                >
                  Custom email prompt (optional)
                </label>
                <Textarea
                  id="custom-prompt"
                  value={customEmailPrompt}
                  onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                    setCustomEmailPrompt(event.target.value)
                  }
                  placeholder="Add extra instructions for AI-generated client submission emails."
                  rows={8}
                />
                <p className="text-xs text-slate-500">
                  Appended as a mandatory instruction during email generation.
                  Use this to enforce house style, specific phrasing, or
                  additional rules.
                </p>
              </div>

              <Button
                onClick={handleSaveSettings}
                disabled={saving || !selectedCompanyId}
              >
                {saving ? "Saving..." : "Save AI email settings"}
              </Button>
            </CardContent>
          </Card>
        </>
      )}

      {activeTab === "finance" && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Month-to-date projected charge</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm text-slate-700 md:grid-cols-2">
              <p>Month: {projection?.monthLabel ?? "-"}</p>
              <p>
                Projected charge:{" "}
                {projection?.projectedCharge.toFixed(2) ?? "0.00"}{" "}
                {projection?.currency ?? "ZAR"}
              </p>
              <p>
                Approved charge:{" "}
                {projection?.approvedCharge.toFixed(2) ?? "0.00"}{" "}
                {projection?.currency ?? "ZAR"}
              </p>
              <p>
                Company share preview:{" "}
                {projection?.companyShareProjected.toFixed(2) ?? "0.00"}{" "}
                {projection?.currency ?? "ZAR"}
              </p>
              <p>
                Partner share preview:{" "}
                {projection?.partnerShareProjected.toFixed(2) ?? "0.00"}{" "}
                {projection?.currency ?? "ZAR"}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Monthly reports</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                onClick={handleGenerateReport}
                disabled={generatingReport || !selectedCompanyId}
              >
                {generatingReport ? "Generating..." : "Generate report now"}
              </Button>

              {reports.length === 0 ? (
                <p className="text-sm text-slate-600">
                  No reports generated yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm text-slate-700">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                        <th className="px-2 py-2">Generated</th>
                        <th className="px-2 py-2">Hours</th>
                        <th className="px-2 py-2">Charge</th>
                        <th className="px-2 py-2">Email</th>
                        <th className="px-2 py-2">Download</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reports.map((report) => (
                        <tr
                          key={report.id}
                          className="border-b border-slate-100"
                        >
                          <td className="px-2 py-2">
                            {new Date(report.generatedAt).toLocaleString(
                              "en-GB",
                            )}
                          </td>
                          <td className="px-2 py-2">
                            {report.totalApprovedHours.toFixed(2)}
                          </td>
                          <td className="px-2 py-2">
                            {report.totalCharge.toFixed(2)} {report.currency}
                          </td>
                          <td className="px-2 py-2">{report.emailStatus}</td>
                          <td className="px-2 py-2">
                            <a
                              className="text-blue-700 underline"
                              href={`/api/admin/reports/${report.id}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              CSV
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {activeTab === "maintenance" && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Imported data cleanup</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-slate-600">
                Remove noisy imported records by local date (YYYY-MM-DD).
              </p>
              <Input
                type="date"
                value={cleanupDate}
                onChange={(event) => setCleanupDate(event.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => handleCleanupImports(true)}
                  disabled={cleaningImports || !cleanupDate}
                  className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                >
                  {cleaningImports ? "Working..." : "Preview cleanup"}
                </Button>
                <Button
                  onClick={() => handleCleanupImports(false)}
                  disabled={cleaningImports || !cleanupDate}
                >
                  {cleaningImports ? "Cleaning..." : "Delete imported data"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Email hallucination audit</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-slate-600">
                Checks every <strong>EMAIL_DRAFTED</strong> application for
                invented certifications, skills, or technologies not present in
                the candidate&apos;s CV. Optionally deletes flagged drafts and
                reverts the application stage to SHORTLISTED.
              </p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={emailAuditDeleteFlagged}
                  onChange={(e) => setEmailAuditDeleteFlagged(e.target.checked)}
                />
                Delete flagged drafts and revert to SHORTLISTED
              </label>
              <Button
                onClick={handleRunEmailAudit}
                disabled={runningEmailAudit}
              >
                {runningEmailAudit ? "Auditing..." : "Run audit"}
              </Button>
              {emailAuditResult && (
                <div className="space-y-2">
                  <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                    <p>
                      <span className="font-medium">Total checked:</span>{" "}
                      {emailAuditResult.total}
                    </p>
                    <p>
                      <span className="font-medium text-green-700">
                        Passed:
                      </span>{" "}
                      {emailAuditResult.pass}
                    </p>
                    <p>
                      <span className="font-medium text-red-700">Flagged:</span>{" "}
                      {emailAuditResult.fail}
                    </p>
                    {emailAuditResult.errors > 0 && (
                      <p>
                        <span className="font-medium text-amber-700">
                          Errors (skipped):
                        </span>{" "}
                        {emailAuditResult.errors}
                      </p>
                    )}
                    {emailAuditResult.deletedDrafts > 0 && (
                      <p>
                        <span className="font-medium">Deleted drafts:</span>{" "}
                        {emailAuditResult.deletedDrafts}
                      </p>
                    )}
                  </div>
                  {emailAuditResult.flaggedItems.length > 0 && (
                    <div className="overflow-x-auto rounded border border-red-200">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 bg-red-50 text-left text-xs uppercase tracking-wide text-slate-500">
                            <th className="px-3 py-2">Candidate</th>
                            <th className="px-3 py-2">Role</th>
                            <th className="px-3 py-2">Score</th>
                            <th className="px-3 py-2">Invented claims</th>
                          </tr>
                        </thead>
                        <tbody>
                          {emailAuditResult.flaggedItems.map((item) => (
                            <tr
                              key={item.applicationId}
                              className="border-b border-slate-100 align-top"
                            >
                              <td className="px-3 py-2 font-medium text-slate-800">
                                {item.candidateName}
                              </td>
                              <td className="px-3 py-2 text-slate-600">
                                {item.roleTitle}
                              </td>
                              <td className="px-3 py-2 text-red-700">
                                {item.score}
                              </td>
                              <td className="px-3 py-2">
                                <ul className="list-disc pl-4 text-red-700">
                                  {item.hallucinatedClaims.map((claim, ci) => (
                                    <li key={ci}>{claim}</li>
                                  ))}
                                </ul>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Repair missing Outlook drafts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-slate-600">
                Checks every generated email in the database against both the
                Drafts and Sent Items folders of the shared mailbox, then
                recreates any that are missing as Outlook drafts.
              </p>
              <Button onClick={handleRepairDrafts} disabled={repairingDrafts}>
                {repairingDrafts ? "Repairing..." : "Repair missing drafts"}
              </Button>
              {repairDraftResult && (
                <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  <p>
                    <span className="font-medium">DB unique pairs:</span>{" "}
                    {repairDraftResult.dbPairs}
                  </p>
                  <p>
                    <span className="font-medium">Already in mailbox:</span>{" "}
                    {repairDraftResult.alreadyInMailbox}
                  </p>
                  <p>
                    <span className="font-medium">Repaired:</span>{" "}
                    {repairDraftResult.repaired}
                  </p>
                  {repairDraftResult.failed > 0 && (
                    <p className="text-red-600">
                      <span className="font-medium">Failed:</span>{" "}
                      {repairDraftResult.failed}
                    </p>
                  )}
                  <p>
                    <span className="font-medium">Skipped (no email):</span>{" "}
                    {repairDraftResult.skippedNoEmail}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Deletion requests</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {deletionRequests.length === 0 ? (
                <p className="text-sm text-slate-600">
                  No pending deletion requests.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm text-slate-700">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                        <th className="px-2 py-2">Requested</th>
                        <th className="px-2 py-2">Type</th>
                        <th className="px-2 py-2">Resource</th>
                        <th className="px-2 py-2">Company</th>
                        <th className="px-2 py-2">Reason</th>
                        <th className="px-2 py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deletionRequests.map((item) => (
                        <tr key={item.id} className="border-b border-slate-100">
                          <td className="px-2 py-2">
                            {new Date(item.requestedAt).toLocaleString("en-GB")}
                          </td>
                          <td className="px-2 py-2">{item.resourceType}</td>
                          <td className="px-2 py-2">{item.title}</td>
                          <td className="px-2 py-2">
                            {item.companyName ?? "Unknown"}
                          </td>
                          <td className="px-2 py-2">
                            {item.reason ?? "No reason provided"}
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex flex-wrap gap-2">
                              <Button
                                onClick={() =>
                                  handleReviewDeletionRequest(
                                    item.id,
                                    "APPROVE",
                                  )
                                }
                                disabled={reviewingRequestId === item.id}
                              >
                                {reviewingRequestId === item.id
                                  ? "Processing..."
                                  : "Approve"}
                              </Button>
                              <Button
                                onClick={() =>
                                  handleReviewDeletionRequest(item.id, "REJECT")
                                }
                                disabled={reviewingRequestId === item.id}
                                className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                              >
                                Reject
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Audit trail</CardTitle>
            </CardHeader>
            <CardContent>
              {auditLogs.length === 0 ? (
                <p className="text-sm text-slate-600">No audit events yet.</p>
              ) : (
                <div className="space-y-1 text-xs text-slate-700">
                  {auditLogs.map((log) => (
                    <p key={log.id}>
                      {new Date(log.createdAt).toLocaleString("en-GB")} -{" "}
                      {log.entityType} - {log.action} - {log.actor ?? "system"}
                    </p>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
      {activeTab === "automation" && (
        <Card>
          <CardHeader>
            <CardTitle>Automation</CardTitle>
            <p className="text-sm text-slate-600">
              Automatically ingest the latest LinkedIn opportunities file, run
              AI matching, and send email drafts to candidates on a daily
              schedule.
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Enable / disable */}
            <div className="flex items-center justify-between rounded-lg border border-slate-200 p-4">
              <div>
                <p className="font-medium text-slate-900">Enable automation</p>
                <p className="text-sm text-slate-500">
                  Runs daily at 06:00 SAST. Also available on demand below.
                </p>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={automationEnabled}
                  onChange={(e) => setAutomationEnabled(e.target.checked)}
                />
                <div className="peer h-6 w-11 rounded-full bg-slate-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full"></div>
              </label>
            </div>

            {/* Source folder path */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">
                Source folder path
              </label>
              <Input
                value={automationSourcePath}
                onChange={(e) => {
                  setAutomationSourcePath(e.target.value);
                  setAutomationPathStatus(null);
                }}
                onBlur={(e) =>
                  void handleValidateAutomationPath(e.target.value)
                }
                placeholder="/mnt/shared/linkedin-exports"
                className={`font-mono text-sm ${
                  automationPathStatus?.valid === false
                    ? "border-red-400 focus-visible:ring-red-400"
                    : automationPathStatus?.valid === true
                      ? "border-green-500 focus-visible:ring-green-500"
                      : ""
                }`}
              />
              {automationPathValidating && (
                <p className="text-xs text-slate-400">Checking path…</p>
              )}
              {!automationPathValidating &&
                automationPathStatus?.valid === false && (
                  <p className="text-xs text-red-600">
                    {automationPathStatus.error}
                  </p>
                )}
              {!automationPathValidating &&
                automationPathStatus?.valid === true && (
                  <p className="text-xs text-green-600">Path is accessible.</p>
                )}
              <p className="text-xs text-slate-500">
                Absolute path to the folder containing year-month sub-folders
                (e.g.&nbsp;
                <span className="font-mono">
                  /your/path/2025-07/linkedin_opportunities_2025-07-14.xlsx
                </span>
                ).
              </p>
            </div>

            {/* Save button */}
            <div>
              <Button
                onClick={() => void handleSaveSettings()}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save settings"}
              </Button>
            </div>

            {/* Run now */}
            <div className="rounded-lg border border-slate-200 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-slate-900">Run now</p>
                  <p className="text-sm text-slate-500">
                    Immediately process today&apos;s opportunities file and send
                    email drafts.
                  </p>
                </div>
                <Button
                  onClick={() => void handleRunAutomation()}
                  disabled={automationRunning}
                  variant="outline"
                >
                  {automationRunning ? "Running…" : "Run now"}
                </Button>
              </div>

              {/* Status card */}
              {automationRunStatus && (
                <div
                  className={`rounded-md border p-3 text-sm ${
                    automationRunStatus.status === "completed"
                      ? "border-green-200 bg-green-50 text-green-800"
                      : automationRunStatus.status === "failed"
                        ? "border-red-200 bg-red-50 text-red-800"
                        : "border-blue-200 bg-blue-50 text-blue-800"
                  }`}
                >
                  <p className="font-medium capitalize">
                    {automationRunStatus.status === "running"
                      ? `In progress — ${automationRunStatus.phase.replace(/_/g, " ")}`
                      : automationRunStatus.status}
                  </p>
                  <p className="mt-1">{automationRunStatus.message}</p>
                  {automationRunStatus.status === "completed" && (
                    <p className="mt-1 text-xs">
                      Drafts found: {automationRunStatus.draftsFound ?? 0}
                      {" · "}Sent: {automationRunStatus.draftsSent ?? 0}
                      {(automationRunStatus.draftsFailedToSend ?? 0) > 0 && (
                        <> · Failed: {automationRunStatus.draftsFailedToSend}</>
                      )}
                    </p>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
      {activeTab === "config" && (
        <ConfigEnvPanel groups={configEnvGroups} onLoad={setConfigEnvGroups} />
      )}
      {activeTab === "instance" && canUseSuperAdminPortalFeatures && (
        <>
          <ManageInstancesPanel />
          <InstanceEnvPanel
            groups={instanceEnvGroups}
            onLoad={setInstanceEnvGroups}
          />
        </>
      )}
    </div>
  );
}

/* ─── Manage Instances (Tenant Provisioning) ─── */

type ProvisionedTenant = {
  slug: string;
  companyName: string;
  adminEmail: string;
  adminName: string;
  createdAt: string;
  status: "provisioning" | "running" | "stopped" | "error";
};

function ManageInstancesPanel() {
  const [tenants, setTenants] = React.useState<
    Record<string, ProvisionedTenant>
  >({});
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Provision form state
  const [slug, setSlug] = React.useState("");
  const [companyName, setCompanyName] = React.useState("");
  const [adminEmail, setAdminEmail] = React.useState("");
  const [adminName, setAdminName] = React.useState("");
  const [provisioning, setProvisioning] = React.useState(false);
  const [provisionResult, setProvisionResult] = React.useState<{
    url: string;
    tempPassword: string;
    status: string;
    note?: string;
  } | null>(null);
  const [provisionError, setProvisionError] = React.useState<string | null>(
    null,
  );

  const loadTenants = React.useCallback(() => {
    setLoading(true);
    fetch("/api/admin/global/provision-tenant", { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          setError(body?.error?.message ?? `HTTP ${res.status}`);
          return;
        }
        const payload = (await res.json()) as {
          data?: { tenants?: Record<string, ProvisionedTenant> };
        };
        setTenants(payload.data?.tenants ?? {});
      })
      .catch(() => setError("Failed to load tenant instances."))
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => {
    loadTenants();
  }, [loadTenants]);

  async function handleProvision(e: React.FormEvent) {
    e.preventDefault();
    setProvisioning(true);
    setProvisionResult(null);
    setProvisionError(null);
    try {
      const res = await fetch("/api/admin/global/provision-tenant", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, companyName, adminEmail, adminName }),
      });
      const payload = (await res.json()) as {
        data?: {
          url?: string;
          tempPassword?: string;
          status?: string;
          note?: string;
        };
        error?: { message?: string };
      };
      if (!res.ok) {
        setProvisionError(payload.error?.message ?? `HTTP ${res.status}`);
        return;
      }
      setProvisionResult({
        url: payload.data?.url ?? "",
        tempPassword: payload.data?.tempPassword ?? "",
        status: payload.data?.status ?? "unknown",
        note: payload.data?.note,
      });
      // Reset form
      setSlug("");
      setCompanyName("");
      setAdminEmail("");
      setAdminName("");
      // Refresh list
      loadTenants();
    } catch {
      setProvisionError("Network error — could not provision instance.");
    } finally {
      setProvisioning(false);
    }
  }

  const tenantList = Object.values(tenants).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const statusBadge = (status: ProvisionedTenant["status"]) => {
    const styles: Record<string, string> = {
      running: "border-emerald-200 bg-emerald-50 text-emerald-700",
      provisioning: "border-amber-200 bg-amber-50 text-amber-700",
      stopped: "border-slate-200 bg-slate-50 text-slate-500",
      error: "border-red-200 bg-red-50 text-red-700",
    };
    return (
      <span
        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${styles[status] ?? styles.stopped}`}
      >
        {status}
      </span>
    );
  };

  return (
    <>
      {/* Provision new instance */}
      <Card>
        <CardHeader>
          <CardTitle>Provision new tenant instance</CardTitle>
          <p className="text-sm text-slate-600">
            Create an isolated placement portal for a new company. Each instance
            gets its own database, admin credentials, and subdomain.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleProvision} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Subdomain slug
                </label>
                <div className="flex items-center gap-0">
                  <Input
                    value={slug}
                    onChange={(e) =>
                      setSlug(
                        e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
                      )
                    }
                    placeholder="acme"
                    required
                    maxLength={31}
                    pattern="^[a-z][a-z0-9-]{1,30}$"
                    className="rounded-r-none"
                    disabled={provisioning}
                  />
                  <span className="inline-flex h-9 items-center rounded-r-md border border-l-0 border-slate-200 bg-slate-50 px-3 text-sm text-slate-500">
                    -placements.dotcloud.africa
                  </span>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Company name
                </label>
                <Input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Acme Staffing"
                  required
                  maxLength={120}
                  disabled={provisioning}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Admin email
                </label>
                <Input
                  type="email"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  placeholder="admin@acme.co.za"
                  required
                  maxLength={254}
                  disabled={provisioning}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Admin full name
                </label>
                <Input
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                  placeholder="Jane Smith"
                  required
                  maxLength={120}
                  disabled={provisioning}
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={provisioning}>
                {provisioning ? "Provisioning…" : "Provision instance"}
              </Button>
              {slug && (
                <span className="text-sm text-slate-500">
                  URL: https://{slug}-placements.dotcloud.africa
                </span>
              )}
            </div>
          </form>

          {provisionError && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {provisionError}
            </div>
          )}

          {provisionResult && (
            <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-4">
              <p className="mb-2 font-medium text-emerald-800">
                Instance provisioned — status: {provisionResult.status}
              </p>
              <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="font-medium text-slate-700">URL</dt>
                <dd>
                  <a
                    href={provisionResult.url}
                    className="text-blue-600 underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {provisionResult.url}
                  </a>
                </dd>
                <dt className="font-medium text-slate-700">
                  Temporary password
                </dt>
                <dd className="font-mono text-slate-800">
                  {provisionResult.tempPassword}
                </dd>
              </dl>
              {provisionResult.note && (
                <p className="mt-2 text-sm text-amber-700">
                  {provisionResult.note}
                </p>
              )}
              <p className="mt-2 text-xs text-slate-500">
                Copy the temporary password now — it will not be shown again.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tenant list */}
      <Card>
        <CardHeader>
          <CardTitle>Tenant instances</CardTitle>
          <p className="text-sm text-slate-600">
            All provisioned company instances across the platform.
          </p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-slate-500">Loading instances…</p>
          ) : error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : tenantList.length === 0 ? (
            <p className="text-sm text-slate-500">
              No tenant instances provisioned yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                    <th className="px-2 py-2">Slug</th>
                    <th className="px-2 py-2">Company</th>
                    <th className="px-2 py-2">Admin</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {tenantList.map((t) => (
                    <tr key={t.slug}>
                      <td className="whitespace-nowrap px-2 py-2 font-mono text-xs">
                        <a
                          href={`https://${t.slug}-placements.dotcloud.africa`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 underline"
                        >
                          {t.slug}
                        </a>
                      </td>
                      <td className="px-2 py-2">{t.companyName}</td>
                      <td className="px-2 py-2">
                        <span className="block">{t.adminName}</span>
                        <span className="text-xs text-slate-400">
                          {t.adminEmail}
                        </span>
                      </td>
                      <td className="px-2 py-2">{statusBadge(t.status)}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-xs text-slate-500">
                        {new Date(t.createdAt).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function ConfigEnvPanel({
  groups,
  onLoad,
}: {
  groups: Array<{
    label: string;
    description?: string;
    vars: Array<{
      key: string;
      set: boolean;
      hint: string;
      optional?: boolean;
    }>;
  }>;
  onLoad: (
    g: Array<{
      label: string;
      description?: string;
      vars: Array<{
        key: string;
        set: boolean;
        hint: string;
        optional?: boolean;
      }>;
    }>,
  ) => void;
}) {
  const [loading, setLoading] = React.useState(groups.length === 0);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (groups.length > 0) return;
    setLoading(true);
    fetch("/api/admin/config-status", { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          setError(body?.error?.message ?? `HTTP ${res.status}`);
          return;
        }
        const payload = (await res.json()) as {
          data?: {
            groups?: typeof groups;
          };
        };
        onLoad(payload.data?.groups ?? []);
      })
      .catch(() => setError("Failed to load configuration status."))
      .finally(() => setLoading(false));
  }, [groups.length, onLoad]);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-slate-500">
          Loading configuration status…
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-600">{error}</p>
        </CardContent>
      </Card>
    );
  }

  const allRequired = groups.flatMap((g) => g.vars.filter((v) => !v.optional));
  const missingRequired = allRequired.filter((v) => !v.set);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Automation configuration</CardTitle>
          <p className="text-sm text-slate-600">
            Environment variables required for the instance automations to
            function. Values are never shown — only whether each variable is
            set. Hover over a variable name for a description.
          </p>
        </CardHeader>
        <CardContent>
          {missingRequired.length === 0 ? (
            <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
              All required variables configured
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
              {missingRequired.length} required variable
              {missingRequired.length > 1 ? "s" : ""} missing
            </span>
          )}
        </CardContent>
      </Card>

      {groups.map((group) => (
        <Card key={group.label}>
          <CardHeader>
            <CardTitle className="text-base">{group.label}</CardTitle>
            {group.description && (
              <p className="text-xs text-slate-500">{group.description}</p>
            )}
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-slate-100">
              {group.vars.map((v) => (
                <li
                  key={v.key}
                  className="flex flex-wrap items-start gap-2 py-2.5 first:pt-0 last:pb-0"
                >
                  <span
                    className="group relative inline-flex cursor-help items-center gap-1.5 font-mono text-sm text-slate-800"
                    title={v.hint}
                  >
                    {v.key}
                    <span className="pointer-events-none absolute bottom-full left-0 z-10 mb-2 hidden w-72 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-sans text-slate-600 shadow-lg group-hover:block">
                      {v.hint}
                    </span>
                  </span>

                  {v.optional && (
                    <span className="text-xs text-slate-400">optional</span>
                  )}

                  <span className="ml-auto">
                    {v.set ? (
                      <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        Set
                      </span>
                    ) : v.optional ? (
                      <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-500">
                        Not set
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                        Missing
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </>
  );
}

function InstanceEnvPanel({
  groups,
  onLoad,
}: {
  groups: Array<{
    label: string;
    vars: Array<{
      key: string;
      set: boolean;
      hint: string;
      optional?: boolean;
    }>;
  }>;
  onLoad: (
    g: Array<{
      label: string;
      vars: Array<{
        key: string;
        set: boolean;
        hint: string;
        optional?: boolean;
      }>;
    }>,
  ) => void;
}) {
  const [loading, setLoading] = React.useState(groups.length === 0);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (groups.length > 0) return;
    setLoading(true);
    fetch("/api/admin/global/instance-env", { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          setError(body?.error?.message ?? `HTTP ${res.status}`);
          return;
        }
        const payload = (await res.json()) as {
          data?: {
            groups?: typeof groups;
          };
        };
        onLoad(payload.data?.groups ?? []);
      })
      .catch(() => setError("Failed to load instance configuration."))
      .finally(() => setLoading(false));
  }, [groups.length, onLoad]);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-slate-500">
          Loading instance configuration…
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Instance configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-600">{error}</p>
        </CardContent>
      </Card>
    );
  }

  const allRequired = groups.flatMap((g) => g.vars.filter((v) => !v.optional));
  const missingRequired = allRequired.filter((v) => !v.set);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Instance configuration</CardTitle>
          <p className="text-sm text-slate-600">
            Deployment-specific environment variables for this server instance.
            Values are never shown — only whether each variable is set.
          </p>
        </CardHeader>
        <CardContent>
          {missingRequired.length === 0 ? (
            <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
              All required variables configured
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
              {missingRequired.length} required variable
              {missingRequired.length > 1 ? "s" : ""} missing
            </span>
          )}
        </CardContent>
      </Card>

      {groups.map((group) => (
        <Card key={group.label}>
          <CardHeader>
            <CardTitle className="text-base">{group.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-slate-100">
              {group.vars.map((v) => (
                <li
                  key={v.key}
                  className="flex flex-wrap items-start gap-2 py-2.5 first:pt-0 last:pb-0"
                >
                  <span
                    className="group relative inline-flex cursor-help items-center gap-1.5 font-mono text-sm text-slate-800"
                    title={v.hint}
                  >
                    {v.key}
                    <span className="pointer-events-none absolute bottom-full left-0 z-10 mb-2 hidden w-72 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-sans text-slate-600 shadow-lg group-hover:block">
                      {v.hint}
                    </span>
                  </span>

                  {v.optional && (
                    <span className="text-xs text-slate-400">optional</span>
                  )}

                  <span className="ml-auto">
                    {v.set ? (
                      <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        Set
                      </span>
                    ) : v.optional ? (
                      <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-500">
                        Not set
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                        Missing
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </>
  );
}
