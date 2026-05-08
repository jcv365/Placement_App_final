import { z } from "zod";

const clientContactRoleSchema = z.enum([
  "HIRING_MANAGER",
  "BILLING",
  "LEGAL",
  "OTHER",
]);

const vacancyStageSchema = z.enum([
  "OPEN",
  "SCREENING",
  "INTERVIEW",
  "OFFER",
  "FILLED",
  "ON_HOLD",
  "CLOSED",
]);

const agreementTypeSchema = z.enum(["NDA", "TEAMING_AGREEMENT"]);
const agreementStatusSchema = z.enum([
  "NOT_SENT",
  "SENT",
  "COMPLETED",
  "DECLINED",
  "VOIDED",
]);
const vettingStatusSchema = z.enum([
  "NOT_STARTED",
  "PENDING_VETTING",
  "VETTED",
  "REJECTED",
]);

const candidateStatusSchema = z.enum(["ACTIVE", "NON_ACTIVE", "PLACED"]);

const placementAlertStatusSchema = z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED"]);

const timesheetStatusSchema = z.enum([
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
  "INVOICED",
]);

const invoiceStatusSchema = z.enum(["DRAFT", "SENT", "PAID", "VOIDED"]);
const billingModelSchema = z.enum(["PER_HOUR_PER_CANDIDATE", "PERCENTAGE"]);

export const placementBillingModelSchema = z.enum([
  "EOR_MARGIN",
  "INDEPENDENT_CONTRACTOR_MARGIN",
  "ONCE_OFF_PLACEMENT_FEE",
  "PERMANENT_PLACEMENT_FEE",
]);

const applicationStageSchema = z.enum([
  "NEW",
  "SHORTLISTED",
  "EMAIL_DRAFTED",
  "SENT_TO_CLIENT",
  "INTERVIEW_1",
  "INTERVIEW_2",
  "OFFER",
  "PLACED",
  "REJECTED",
  "ON_HOLD",
]);

export const uploadTextSchema = z.object({
  text: z.string().min(20),
  title: z.string().min(2).optional(),
  fullName: z.string().min(2).optional(),
});

export const rulesetSchema = z.object({
  name: z.string().min(2),
  rulesJson: z.record(z.unknown()),
  isDefault: z.boolean().optional(),
});

export const applicationCreateSchema = z.object({
  jobId: z.string().min(1),
  candidateId: z.string().min(1),
  c2cPartner: z.string().min(2).optional(),
});

export const candidateUpdateSchema = z.object({
  fullName: z.string().trim().min(2),
  email: z.string().trim().email().or(z.literal("")),
  phone: z.string().trim(),
  skillsCsv: z.string().trim(),
  certificationsCsv: z.string().trim(),
  suggestedRolesCsv: z.string().trim(),
  status: candidateStatusSchema,
});

export const stageUpdateSchema = z.object({
  toStage: applicationStageSchema,
  note: z.string().min(5).optional(),
});

export const applicationDetailsUpdateSchema = z.object({
  candidateName: z.string().min(2).optional(),
  candidateEmail: z.string().email().nullable().optional(),
  candidatePhone: z.string().min(5).nullable().optional(),
  hourlyRate: z.string().min(1).optional(),
});

export const placementContractUpdateSchema = z.object({
  agreedHourlyRate: z.number().positive().optional(),
  placementBillingModel: placementBillingModelSchema.optional(),
  placementFeePercent: z.number().min(0).max(100).optional(),
  annualCtc: z.number().positive().optional(),
  contractValue: z.number().positive().optional(),
});

export const noteSchema = z.object({
  content: z.string().min(3),
  author: z.string().min(2).optional(),
});

export const emailGenerateSchema = z.object({
  jobId: z.string().min(1),
  candidateId: z.string().min(1),
  applicationId: z.string().optional(),
  rulesetId: z.string().optional(),
  aiProvider: z
    .enum(["auto", "azure-openai", "copilot-studio", "github-models"])
    .optional(),
  githubAccessToken: z.string().min(20).optional(),
});

export const emailDraftSchema = z.object({
  applicationId: z.string().min(1),
  emailDraftId: z.string().min(1),
  to: z.array(z.string().email()).min(1),
  accessToken: z.string().min(10).optional(),
});

export const emailDraftCleanupSchema = z.object({
  applicationId: z.string().min(1),
  keepEmailDraftId: z.string().min(1).optional(),
});

export const emailLearningSchema = z.object({
  emailDraftId: z.string().min(1),
  preferredForLearning: z.boolean().optional(),
});

export const rulesetUpdateSchema = z.object({
  name: z.string().min(2).optional(),
  rulesJson: z.record(z.unknown()).optional(),
  isDefault: z.boolean().optional(),
});

export const clientAccountCreateSchema = z.object({
  name: z.string().trim().min(2),
  domain: z.string().trim().optional(),
  contractTerms: z.string().trim().optional(),
  billingNotes: z.string().trim().optional(),
  isActive: z.boolean().optional(),
});

export const clientAccountUpdateSchema = clientAccountCreateSchema.partial();

export const clientContactCreateSchema = z.object({
  clientAccountId: z.string().min(1),
  fullName: z.string().trim().min(2),
  email: z.string().trim().email(),
  phone: z.string().trim().optional(),
  role: clientContactRoleSchema.optional(),
  notes: z.string().trim().optional(),
});

export const vacancyCreateSchema = z.object({
  clientAccountId: z.string().min(1),
  hiringManagerId: z.string().min(1).optional(),
  title: z.string().trim().min(2),
  description: z.string().trim().min(10),
  stage: vacancyStageSchema.optional(),
  slaDate: z.string().datetime({ offset: true }).optional(),
  interviewFeedback: z.string().trim().optional(),
  offerStatus: z.string().trim().optional(),
  reasonCode: z.string().trim().optional(),
});

export const vacancyUpdateSchema = vacancyCreateSchema.partial();

export const candidateAgreementSendSchema = z.object({
  type: agreementTypeSchema,
  recipientEmail: z.string().email().optional(),
  recipientName: z.string().min(2).optional(),
});

export const docusignWebhookSchema = z.object({
  tenantId: z.string().trim().min(2).max(63).optional(),
  envelopeId: z.string().min(1),
  status: agreementStatusSchema,
  externalStatus: z.string().optional(),
  eventTime: z.string().datetime({ offset: true }).optional(),
});

export const candidateVettingUpdateSchema = z.object({
  status: vettingStatusSchema,
  notes: z.string().optional(),
});

export const candidateAtsMatchSchema = z
  .object({
    jobId: z.string().min(1).optional(),
    jobText: z.string().trim().min(40).optional(),
  })
  .refine((value) => Boolean(value.jobId || value.jobText), {
    message: "Either jobId or jobText is required",
  });

export const candidateAtsFixSchema = z
  .object({
    jobId: z.string().min(1).optional(),
    jobText: z.string().trim().min(40).optional(),
    previewOnly: z.boolean().optional(),
    aiProvider: z
      .enum(["auto", "github-models", "azure-openai", "copilot-studio"])
      .optional(),
    githubAccessToken: z.string().min(20).optional(),
  })
  .refine((value) => Boolean(value.jobId || value.jobText), {
    message: "Either jobId or jobText is required",
  });

export const placementAlertCreateSchema = z.object({
  applicationId: z.string().min(1),
  title: z.string().trim().min(2),
  dueDate: z.string().datetime({ offset: true }),
  notes: z.string().trim().optional(),
});

export const placementAlertUpdateSchema = z.object({
  title: z.string().trim().min(2).optional(),
  dueDate: z.string().datetime({ offset: true }).optional(),
  status: placementAlertStatusSchema.optional(),
  notes: z.string().trim().optional(),
});

const MAX_MONTHLY_HOURS = 350;

export const timesheetCreateSchema = z.object({
  applicationId: z.string().min(1),
  periodStartDate: z.string().datetime({ offset: true }),
  periodEndDate: z.string().datetime({ offset: true }),
  hoursWorked: z.number().positive().max(MAX_MONTHLY_HOURS),
  engineerRatePerHour: z.number().min(0),
  currency: z.string().trim().min(3).max(3).optional(),
});

export const timesheetUpdateSchema = z.object({
  status: timesheetStatusSchema.optional(),
  hoursWorked: z.number().positive().max(MAX_MONTHLY_HOURS).optional(),
  ratePerHour: z.number().positive().optional(),
  engineerRatePerHour: z.number().min(0).optional(),
  currency: z.string().trim().min(3).max(3).optional(),
});

export const invoiceCreateSchema = z.object({
  dueDate: z.string().datetime({ offset: true }).optional(),
});

export const invoiceUpdateSchema = z.object({
  status: invoiceStatusSchema,
});

export const adminLoginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
  tenantId: z.string().trim().min(2).max(63).optional(),
});

export const companyRegistrationSchema = z
  .object({
    displayName: z.string().trim().min(2).max(120),
    domain: z.string().trim().max(255).optional(),
    adminName: z.string().trim().min(2).max(120),
    adminEmail: z.string().trim().email(),
    password: z.string().min(8).max(120),
    brandName: z.string().trim().min(2).max(120),
    billingContactEmail: z.string().trim().email(),
    billingModel: billingModelSchema,
    billingRatePerHour: z.number().min(0).optional(),
    outlookMailbox: z.string().trim().email().optional(),
  })
  .superRefine((value, context) => {
    if (
      value.billingModel === "PER_HOUR_PER_CANDIDATE" &&
      (value.billingRatePerHour === undefined || value.billingRatePerHour <= 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["billingRatePerHour"],
        message: "Billing rate per hour is required for per-hour billing.",
      });
    }
  });

export const tenantLoginSchema = z.object({
  tenantId: z.string().trim().min(2).max(63).optional(),
  email: z.string().trim().email(),
  password: z.string().min(1),
});

export const tenantUserRegistrationSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  password: z.string().min(8).max(120),
  role: z.enum(["ADMIN", "USER"]).default("USER"),
});

export const companySettingsUpdateSchema = z.object({
  companyId: z.string().min(1),
  revenueSplitPercent: z.number().min(0).max(100).optional(),
  brandName: z.string().trim().min(2),
  outlookMailbox: z.string().trim().email().optional(),
  reportRecipients: z
    .array(z.string().trim().email())
    .min(1)
    .refine(
      (items) =>
        items
          .map((item) => item.toLowerCase())
          .includes("accounts@dotcloud.africa"),
      "Report recipients must include accounts@dotcloud.africa",
    ),
  currency: z.literal("ZAR").default("ZAR"),
});

export const companyLogoUploadSchema = z.object({
  companyId: z.string().min(1),
});
