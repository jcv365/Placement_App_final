export type ApplicationStage =
  | "NEW"
  | "SHORTLISTED"
  | "EMAIL_DRAFTED"
  | "SENT_TO_CLIENT"
  | "INTERVIEW_1"
  | "INTERVIEW_2"
  | "OFFER"
  | "PLACED"
  | "REJECTED"
  | "ON_HOLD";

export type LifecycleActionType =
  | "STOP_CONTRACT"
  | "TERMINATE_CONTRACT"
  | "ACCESS_REVOKED"
  | "ACCESS_RESTORED"
  | "CLIENT_PAUSED"
  | "CANDIDATE_UNAVAILABLE";

export const STAGES: ApplicationStage[] = [
  "NEW",
  "EMAIL_DRAFTED",
  "SENT_TO_CLIENT",
  "INTERVIEW_1",
  "INTERVIEW_2",
  "OFFER",
  "ON_HOLD",
  "REJECTED",
  "PLACED",
];

export const STAGE_LABELS: Record<ApplicationStage, string> = {
  NEW: "New",
  SHORTLISTED: "Shortlisted",
  EMAIL_DRAFTED: "Email drafted",
  SENT_TO_CLIENT: "Sent to client",
  INTERVIEW_1: "Interview 1",
  INTERVIEW_2: "Interview 2",
  OFFER: "Offer",
  PLACED: "Placed",
  REJECTED: "Rejected",
  ON_HOLD: "On hold",
};

export const LIFECYCLE_ACTIONS: Array<{
  value: LifecycleActionType;
  label: string;
  targetStage: ApplicationStage | "KEEP";
}> = [
  {
    value: "STOP_CONTRACT",
    label: "Stop contract",
    targetStage: "ON_HOLD",
  },
  {
    value: "TERMINATE_CONTRACT",
    label: "Terminate contract",
    targetStage: "REJECTED",
  },
  {
    value: "ACCESS_REVOKED",
    label: "Access revoked",
    targetStage: "ON_HOLD",
  },
  {
    value: "ACCESS_RESTORED",
    label: "Access restored",
    targetStage: "PLACED",
  },
  {
    value: "CLIENT_PAUSED",
    label: "Client paused assignment",
    targetStage: "ON_HOLD",
  },
  {
    value: "CANDIDATE_UNAVAILABLE",
    label: "Candidate unavailable",
    targetStage: "ON_HOLD",
  },
];

export type Application = {
  id: string;
  opportunityId: string;
  currentStage: ApplicationStage;
  placedAt: string | null;
  agreedHourlyRate: number | null;
  agreedRateLockedAt: string | null;
  placementBillingModel: string | null;
  placementFeePercent: number | null;
  annualCtc: number | null;
  contractValue: number | null;
  signedContractFileName: string | null;
  signedContractMimeType: string | null;
  signedContractUploadedAt: string | null;
  job: {
    id: string;
    title: string;
    rawText?: string;
    opportunityEmail: string | null;
    opportunityUrl: string | null;
    company?: {
      id: string;
      name: string;
    } | null;
  };
  candidate: {
    id: string;
    fullName: string;
    email: string | null;
    phone: string | null;
    rawCV?: string;
  };
  notes: { id: string }[];
  emails: { id: string }[];
  updatedAt: string;
};

export type DetailData = Omit<Application, "emails" | "job" | "candidate"> & {
  job: {
    id: string;
    title: string;
    rawText: string;
    opportunityEmail: string | null;
    opportunityUrl: string | null;
    company?: {
      id: string;
      name: string;
    } | null;
  };
  candidate: {
    id: string;
    fullName: string;
    email: string | null;
    phone: string | null;
    rawCV: string;
  };
  history?: {
    id: string;
    fromStage: ApplicationStage | null;
    toStage: ApplicationStage;
    changedAt: string;
  }[];
  notes?: {
    id: string;
    content: string;
    author: string | null;
    createdAt: string;
  }[];
  emails?: {
    id: string;
    subject: string;
    htmlBody: string;
    preferredForLearning?: boolean;
    createdAt: string;
  }[];
};

export type GroupedApplication = {
  id: string;
  stage: ApplicationStage;
  representative: Application;
  applicationIds: string[];
  groupedCount: number;
  totalNotes: number;
  totalEmails: number;
  hasPlacementIssue: boolean;
  latestUpdatedAt: string;
};

export type PipelineViewFilter =
  | "ALL"
  | "ACTIVE"
  | "PLACED_ONLY"
  | "INACTIVE"
  | "PLACEMENT_ISSUES";

export type BoardSort = "UPDATED_DESC" | "UPDATED_ASC" | "GROUP_SIZE_DESC";
export type BoardDensity = "COMPACT" | "COMFORTABLE";

export type PlacementTarget = {
  id: string;
  candidateName: string;
  roleTitle: string;
  agreedHourlyRate: number | null;
  agreedRateLockedAt: string | null;
  placementBillingModel: string | null;
  placementFeePercent: number | null;
  annualCtc: number | null;
  contractValue: number | null;
  signedContractFileName: string | null;
  signedContractUploadedAt: string | null;
};

export type GeneratedEmailResponse = {
  id: string;
  applicationId: string;
  subject: string;
  htmlBody: string;
  outlookDraft?: {
    status: "created" | "skipped" | "failed";
    reason?: string;
  };
};

export function isPlacementRequirementsMissing(application: {
  currentStage: ApplicationStage;
  agreedHourlyRate: number | null;
  placementBillingModel: string | null;
  signedContractUploadedAt: string | null;
}): boolean {
  return (
    application.currentStage === "PLACED" &&
    (application.agreedHourlyRate == null ||
      application.placementBillingModel == null ||
      application.signedContractUploadedAt == null)
  );
}
