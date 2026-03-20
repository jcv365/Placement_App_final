import { computeOpportunityId } from "./opportunity";
import { prisma } from "./prisma";
import { DEFAULT_RULES } from "./rules";

type SeedSummary = {
  companies: number;
  companySettings: number;
  jobs: number;
  candidates: number;
  applications: number;
  clientAccounts: number;
  contacts: number;
  vacancies: number;
  placementAlerts: number;
  timesheets: number;
  invoices: number;
  monthlyReports: number;
  auditLogs: number;
};

export async function seedFunctionalTestData(): Promise<SeedSummary> {
  await prisma.$transaction([
    prisma.monthlyFinanceReport.deleteMany(),
    prisma.companySettings.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.invoice.deleteMany(),
    prisma.timesheet.deleteMany(),
    prisma.placementAlert.deleteMany(),
    prisma.emailDraft.deleteMany(),
    prisma.note.deleteMany(),
    prisma.applicationStageHistory.deleteMany(),
    prisma.application.deleteMany(),
    prisma.candidateAgreement.deleteMany(),
    prisma.vacancy.deleteMany(),
    prisma.clientContact.deleteMany(),
    prisma.clientAccount.deleteMany(),
    prisma.candidate.deleteMany(),
    prisma.job.deleteMany(),
    prisma.company.deleteMany(),
    prisma.ruleSet.updateMany({ data: { isDefault: false } }),
  ]);

  await prisma.ruleSet.upsert({
    where: { tenantId_name: { tenantId: "default", name: "Default" } },
    update: { rulesJson: DEFAULT_RULES, isDefault: true },
    create: {
      tenantId: "default",
      name: "Default",
      rulesJson: DEFAULT_RULES,
      isDefault: true,
    },
  });

  await prisma.ruleSet.upsert({
    where: {
      tenantId_name: {
        tenantId: "default",
        name: "Conservative enterprise",
      },
    },
    update: {
      rulesJson: {
        ...DEFAULT_RULES,
        tone: "formal",
        includeVossSummary: true,
      },
      isDefault: false,
    },
    create: {
      tenantId: "default",
      name: "Conservative enterprise",
      rulesJson: {
        ...DEFAULT_RULES,
        tone: "formal",
        includeVossSummary: true,
      },
      isDefault: false,
    },
  });

  const [acme, northwind, globex] = await Promise.all([
    prisma.clientAccount.create({
      data: {
        name: "Acme Consulting",
        domain: "acme-consulting.co.uk",
        contractTerms: "Outside IR35 preferred. Weekly interview batches.",
        billingNotes: "Weekly invoicing, 14-day payment terms.",
      },
    }),
    prisma.clientAccount.create({
      data: {
        name: "Northwind Engineering",
        domain: "northwind-eng.io",
        contractTerms: "Mix of inside and outside IR35 by project.",
        billingNotes: "Monthly invoicing, PO required on all submissions.",
      },
    }),
    prisma.clientAccount.create({
      data: {
        name: "Globex Financial",
        domain: "globex-finance.com",
        contractTerms: "Security clearance and compliance checks mandatory.",
        billingNotes: "Bi-weekly invoicing, net 30.",
      },
    }),
  ]);

  const [acmeHm, northwindHm, globexHm] = await Promise.all([
    prisma.clientContact.create({
      data: {
        clientAccountId: acme.id,
        fullName: "Jane Cooper",
        email: "jane.cooper@acme-consulting.co.uk",
        role: "HIRING_MANAGER",
        notes: "Prefers shortlists with contract availability.",
      },
    }),
    prisma.clientContact.create({
      data: {
        clientAccountId: northwind.id,
        fullName: "Robert Fox",
        email: "robert.fox@northwind-eng.io",
        role: "HIRING_MANAGER",
      },
    }),
    prisma.clientContact.create({
      data: {
        clientAccountId: globex.id,
        fullName: "Priya Singh",
        email: "priya.singh@globex-finance.com",
        role: "HIRING_MANAGER",
      },
    }),
  ]);

  const today = new Date();
  const day = 24 * 60 * 60 * 1000;

  await prisma.vacancy.createMany({
    data: [
      {
        clientAccountId: acme.id,
        hiringManagerId: acmeHm.id,
        title: "Azure Data Engineer (Contract)",
        description:
          "Build resilient data pipelines and maintain Azure SQL and Fabric workloads.",
        stage: "SCREENING",
        slaDate: new Date(today.getTime() + 5 * day),
      },
      {
        clientAccountId: northwind.id,
        hiringManagerId: northwindHm.id,
        title: "Platform Engineer (Kubernetes)",
        description:
          "Improve CI/CD, SRE practices, and observability across AKS estates.",
        stage: "OPEN",
        slaDate: new Date(today.getTime() + 9 * day),
      },
      {
        clientAccountId: globex.id,
        hiringManagerId: globexHm.id,
        title: "Security Architect",
        description:
          "Lead cloud security baselines and remediation plans for regulated data platforms.",
        stage: "INTERVIEW",
        slaDate: new Date(today.getTime() + 2 * day),
      },
    ],
  });

  const [acmeCompany, northwindCompany, globexCompany] = await Promise.all([
    prisma.company.create({
      data: { name: "Acme Consulting", domain: "acme-consulting.co.uk" },
    }),
    prisma.company.create({
      data: { name: "Northwind Engineering", domain: "northwind-eng.io" },
    }),
    prisma.company.create({
      data: { name: "Globex Financial", domain: "globex-finance.com" },
    }),
  ]);

  await prisma.companySettings.createMany({
    data: [
      {
        companyId: acmeCompany.id,
        revenueSplitPercent: 50,
        brandName: "DotCloud Delivery",
        logoUrl: "https://assets.dotcloud.africa/logo-dotcloud.png",
        reportRecipientsCsv:
          "charl.venter@dotcloud.africa, finance@dotcloud.africa",
        currency: "ZAR",
      },
      {
        companyId: northwindCompany.id,
        revenueSplitPercent: 50,
        brandName: "DotCloud Northwind",
        logoUrl: "https://assets.dotcloud.africa/logo-northwind.png",
        reportRecipientsCsv:
          "charl.venter@dotcloud.africa, northwind.finance@dotcloud.africa",
        currency: "ZAR",
      },
      {
        companyId: globexCompany.id,
        revenueSplitPercent: 50,
        brandName: "DotCloud Globex",
        logoUrl: "https://assets.dotcloud.africa/logo-globex.png",
        reportRecipientsCsv:
          "charl.venter@dotcloud.africa, globex.finance@dotcloud.africa",
        currency: "ZAR",
      },
    ],
  });

  const jobs = await Promise.all([
    prisma.job.create({
      data: {
        title: "Senior Data Engineer",
        rawText:
          "LinkedIn opportunity: Senior Data Engineer contract in London. Must have Azure, SQL, Python, and stakeholder communication.",
        opportunityUrl: "https://www.linkedin.com/jobs/view/100001",
        opportunityEmail: "talent@acme-consulting.co.uk",
        companyId: acmeCompany.id,
      },
    }),
    prisma.job.create({
      data: {
        title: "Cloud Platform Engineer",
        rawText:
          "Contract role focused on AKS, Terraform, GitHub Actions, and production support.",
        opportunityUrl: "https://www.linkedin.com/jobs/view/100002",
        companyId: northwindCompany.id,
      },
    }),
    prisma.job.create({
      data: {
        title: "Security Architect",
        rawText:
          "Security architecture contract for cloud-native systems, policy compliance, and SOC integration.",
        opportunityEmail: "security.hiring@globex-finance.com",
        companyId: globexCompany.id,
      },
    }),
    prisma.job.create({
      data: {
        title: "Data Migration Lead",
        rawText:
          "Outside IR35 programme to migrate legacy ETL pipelines to modern Azure architecture.",
        companyId: acmeCompany.id,
      },
    }),
    prisma.job.create({
      data: {
        title: "DevOps Consultant",
        rawText:
          "Six-month contract to standardise deployment governance and SRE tooling.",
        companyId: northwindCompany.id,
      },
    }),
    prisma.job.create({
      data: {
        title: "FinOps Analyst",
        rawText:
          "LinkedIn referral role to optimise cloud spend, cost controls, and budget forecasting.",
        opportunityUrl: "https://www.linkedin.com/jobs/view/100003",
        companyId: globexCompany.id,
      },
    }),
  ]);

  const candidates = await Promise.all([
    prisma.candidate.create({
      data: {
        fullName: "Alex Johnson",
        rawCV:
          "Data engineer with 7 years of Azure, SQL, Python, and data warehousing delivery.",
        email: "alex.johnson@example.com",
        phone: "+44 7700 900101",
        skillsCsv: "Azure, SQL, Python, Databricks, Power BI",
        certificationsCsv: "AZ-900, DP-203",
        suggestedRolesCsv: "Data Engineer, Data Migration Lead",
        vettingStatus: "VETTED",
        vettedAt: new Date(today.getTime() - 12 * day),
        vettingNotes: "All pre-placement checks completed.",
      },
    }),
    prisma.candidate.create({
      data: {
        fullName: "Morgan Lee",
        rawCV:
          "Platform engineer with Kubernetes, Terraform, observability, and incident response expertise.",
        email: "morgan.lee@example.com",
        phone: "+44 7700 900102",
        skillsCsv: "Kubernetes, Terraform, Azure, GitHub Actions, Prometheus",
        certificationsCsv: "CKA, AZ-104",
        suggestedRolesCsv: "Cloud Platform Engineer, DevOps Consultant",
        vettingStatus: "PENDING_VETTING",
        vettingNotes: "Awaiting final right-to-work evidence.",
      },
    }),
    prisma.candidate.create({
      data: {
        fullName: "Priyanka Das",
        rawCV:
          "Security architect specialising in cloud controls, IAM hardening, and audit remediation.",
        email: "priyanka.das@example.com",
        phone: "+44 7700 900103",
        skillsCsv: "Cloud Security, IAM, SOC2, SIEM, Threat Modelling",
        certificationsCsv: "CISSP, AZ-500",
        suggestedRolesCsv: "Security Architect, Compliance Lead",
        vettingStatus: "NOT_STARTED",
      },
    }),
    prisma.candidate.create({
      data: {
        fullName: "Chris Bennett",
        rawCV:
          "FinOps specialist with cloud cost governance and forecasting programmes.",
        email: "chris.bennett@example.com",
        phone: "+44 7700 900104",
        skillsCsv:
          "FinOps, Cost Optimisation, Azure Cost Management, Forecasting",
        certificationsCsv: "FinOps Practitioner",
        suggestedRolesCsv: "FinOps Analyst",
        isActive: false,
        vettingStatus: "REJECTED",
        vettingNotes: "Declined due to limited contract availability.",
      },
    }),
    prisma.candidate.create({
      data: {
        fullName: "Naomi Clarke",
        rawCV:
          "Delivery consultant with strong stakeholder management and programme rescue experience.",
        email: "naomi.clarke@example.com",
        phone: "+44 7700 900105",
        skillsCsv: "Stakeholder Management, Delivery, Azure, Data Governance",
        certificationsCsv: "PRINCE2",
        suggestedRolesCsv: "Data Migration Lead, Delivery Consultant",
      },
    }),
    prisma.candidate.create({
      data: {
        fullName: "Daniel Osei",
        rawCV:
          "Contract engineer focused on CI/CD and cloud platform reliability.",
        email: "daniel.osei@example.com",
        phone: "+44 7700 900106",
        skillsCsv: "CI/CD, Azure DevOps, AKS, SRE",
        certificationsCsv: "AZ-400",
        suggestedRolesCsv: "DevOps Consultant, Platform Engineer",
      },
    }),
  ]);

  const [alex, morgan, priyanka, chris, naomi, daniel] = candidates;

  await prisma.candidateAgreement.createMany({
    data: [
      {
        candidateId: alex.id,
        type: "NDA",
        status: "COMPLETED",
        sentAt: new Date(today.getTime() - 20 * day),
        signedAt: new Date(today.getTime() - 19 * day),
      },
      {
        candidateId: alex.id,
        type: "TEAMING_AGREEMENT",
        status: "COMPLETED",
        sentAt: new Date(today.getTime() - 18 * day),
        signedAt: new Date(today.getTime() - 17 * day),
      },
      {
        candidateId: morgan.id,
        type: "NDA",
        status: "SENT",
        sentAt: new Date(today.getTime() - 2 * day),
      },
      {
        candidateId: priyanka.id,
        type: "NDA",
        status: "NOT_SENT",
      },
      {
        candidateId: naomi.id,
        type: "TEAMING_AGREEMENT",
        status: "DECLINED",
      },
    ],
  });

  const [
    jobDataEngineer,
    jobPlatform,
    jobSecurity,
    jobMigration,
    jobDevOps,
    jobFinOps,
  ] = jobs;

  async function createApplicationFixture(params: {
    jobId: string;
    candidateId: string;
    roleTitle: string;
    companyName?: string;
    currentStage:
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
    note?: string;
    emailSubject?: string;
    preferredForLearning?: boolean;
  }) {
    const opportunityId = `default:${computeOpportunityId({
      candidateName:
        candidates.find((candidate) => candidate.id === params.candidateId)
          ?.fullName ?? "",
      roleTitle: params.roleTitle,
      companyName: params.companyName,
    })}`;

    const app = await prisma.application.create({
      data: {
        jobId: params.jobId,
        candidateId: params.candidateId,
        opportunityId,
        currentStage: params.currentStage,
        c2cPartner: process.env.DEFAULT_C2C_PARTNER_NAME ?? "C2C Partner Ltd",
        history: {
          create:
            params.currentStage === "NEW"
              ? [{ toStage: "NEW" }]
              : [
                  { toStage: "NEW" },
                  { fromStage: "NEW", toStage: params.currentStage },
                ],
        },
      },
    });

    if (params.note) {
      await prisma.note.create({
        data: {
          applicationId: app.id,
          author: "Seeder",
          content: params.note,
        },
      });
    }

    if (params.emailSubject) {
      await prisma.emailDraft.create({
        data: {
          applicationId: app.id,
          subject: params.emailSubject,
          htmlBody:
            "<p>Hello hiring team,</p><p>Please find this contractor profile for review.</p><p>Kind regards</p>",
          generatedFrom: "seed-functional-test-data",
          preferredForLearning: params.preferredForLearning ?? false,
        },
      });
    }

    return app;
  }

  const applications = await Promise.all([
    createApplicationFixture({
      jobId: jobDataEngineer.id,
      candidateId: alex.id,
      roleTitle: jobDataEngineer.title,
      companyName: acmeCompany.name,
      currentStage: "PLACED",
      note: "Client accepted after second interview.",
      emailSubject: "Senior Data Engineer profile for review",
      preferredForLearning: true,
    }),
    createApplicationFixture({
      jobId: jobPlatform.id,
      candidateId: morgan.id,
      roleTitle: jobPlatform.title,
      companyName: northwindCompany.name,
      currentStage: "INTERVIEW_1",
      note: "Interview panel booked for Thursday.",
      emailSubject: "Cloud Platform Engineer shortlist",
    }),
    createApplicationFixture({
      jobId: jobSecurity.id,
      candidateId: priyanka.id,
      roleTitle: jobSecurity.title,
      companyName: globexCompany.name,
      currentStage: "SENT_TO_CLIENT",
      note: "Awaiting feedback from hiring manager.",
      emailSubject: "Security Architect candidate submission",
    }),
    createApplicationFixture({
      jobId: jobMigration.id,
      candidateId: naomi.id,
      roleTitle: jobMigration.title,
      companyName: acmeCompany.name,
      currentStage: "EMAIL_DRAFTED",
      note: "Draft prepared, pending final tone review.",
      emailSubject: "Data Migration Lead recommendation",
    }),
    createApplicationFixture({
      jobId: jobDevOps.id,
      candidateId: daniel.id,
      roleTitle: jobDevOps.title,
      companyName: northwindCompany.name,
      currentStage: "NEW",
      note: "Initial match created from review queue.",
    }),
    createApplicationFixture({
      jobId: jobFinOps.id,
      candidateId: chris.id,
      roleTitle: jobFinOps.title,
      companyName: globexCompany.name,
      currentStage: "REJECTED",
      note: "Rate expectation exceeded budget.",
    }),
    createApplicationFixture({
      jobId: jobPlatform.id,
      candidateId: daniel.id,
      roleTitle: `${jobPlatform.title} Alternate`,
      companyName: northwindCompany.name,
      currentStage: "ON_HOLD",
      note: "Paused pending revised statement of work.",
    }),
    createApplicationFixture({
      jobId: jobSecurity.id,
      candidateId: alex.id,
      roleTitle: `${jobSecurity.title} Reserve`,
      companyName: globexCompany.name,
      currentStage: "OFFER",
      note: "Offer draft shared with candidate.",
    }),
  ]);

  const [placedApp, interviewApp, sentApp, draftedApp, , rejectedApp] =
    applications;

  await prisma.placementAlert.createMany({
    data: [
      {
        applicationId: placedApp.id,
        title: "Confirm onboarding start date",
        dueDate: new Date(today.getTime() + 2 * day),
        status: "OPEN",
        notes: "Client requested confirmation by close of business.",
      },
      {
        applicationId: interviewApp.id,
        title: "Collect interview feedback",
        dueDate: new Date(today.getTime() + 1 * day),
        status: "ACKNOWLEDGED",
      },
      {
        applicationId: sentApp.id,
        title: "Chase submission response",
        dueDate: new Date(today.getTime() - 2 * day),
        status: "OPEN",
      },
      {
        applicationId: rejectedApp.id,
        title: "Archive rejected placement notes",
        dueDate: new Date(today.getTime() - 10 * day),
        status: "RESOLVED",
      },
    ],
  });

  const submittedTimesheet = await prisma.timesheet.create({
    data: {
      applicationId: placedApp.id,
      weekStartDate: new Date(today.getTime() - 14 * day),
      weekEndDate: new Date(today.getTime() - 8 * day),
      hoursWorked: 37.5,
      ratePerHour: 82,
      engineerRatePerHour: 57,
      currency: "ZAR",
      status: "SUBMITTED",
      submittedAt: new Date(today.getTime() - 7 * day),
    },
  });

  const invoicedTimesheet = await prisma.timesheet.create({
    data: {
      applicationId: placedApp.id,
      weekStartDate: new Date(today.getTime() - 7 * day),
      weekEndDate: new Date(today.getTime() - 1 * day),
      hoursWorked: 40,
      ratePerHour: 82,
      engineerRatePerHour: 57,
      currency: "ZAR",
      status: "INVOICED",
      submittedAt: new Date(today.getTime() - 1 * day),
      approvedAt: new Date(today.getTime() - 1 * day),
    },
  });

  await prisma.timesheet.create({
    data: {
      applicationId: draftedApp.id,
      weekStartDate: new Date(today.getTime() - 7 * day),
      weekEndDate: new Date(today.getTime() - 1 * day),
      hoursWorked: 16,
      ratePerHour: 75,
      engineerRatePerHour: 50,
      currency: "ZAR",
      status: "DRAFT",
    },
  });

  await prisma.invoice.createMany({
    data: [
      {
        timesheetId: submittedTimesheet.id,
        invoiceNumber: "INV-FT-1001",
        amount: submittedTimesheet.hoursWorked * submittedTimesheet.ratePerHour,
        currency: "ZAR",
        dueDate: new Date(today.getTime() + 7 * day),
        status: "SENT",
        issuedAt: new Date(today.getTime() - 6 * day),
      },
      {
        timesheetId: invoicedTimesheet.id,
        invoiceNumber: "INV-FT-1002",
        amount: invoicedTimesheet.hoursWorked * invoicedTimesheet.ratePerHour,
        currency: "ZAR",
        dueDate: new Date(today.getTime() + 21 * day),
        status: "PAID",
        issuedAt: new Date(today.getTime() - 1 * day),
        paidAt: today,
      },
    ],
  });

  const acmeMonthlyCharge =
    (submittedTimesheet.ratePerHour - submittedTimesheet.engineerRatePerHour) *
      submittedTimesheet.hoursWorked +
    (invoicedTimesheet.ratePerHour - invoicedTimesheet.engineerRatePerHour) *
      invoicedTimesheet.hoursWorked;

  await prisma.monthlyFinanceReport.createMany({
    data: [
      {
        companyId: acmeCompany.id,
        periodStart: new Date(today.getFullYear(), today.getMonth() - 1, 1),
        periodEnd: new Date(today.getFullYear(), today.getMonth(), 1),
        fileName: "finance-report-acme-consulting-prev-month.csv",
        csvContent:
          "brand_name,logo_url,timesheet_id,approved_hours,monthly_charge,currency\n" +
          "DotCloud Delivery,https://assets.dotcloud.africa/logo-dotcloud.png,TS-ACME-001,77.50," +
          `${acmeMonthlyCharge.toFixed(2)},ZAR`,
        recipientsCsv: "charl.venter@dotcloud.africa, finance@dotcloud.africa",
        totalApprovedHours: 77.5,
        totalCharge: Number(acmeMonthlyCharge.toFixed(2)),
        currency: "ZAR",
        generatedAt: new Date(today.getTime() - 2 * day),
        emailedAt: new Date(today.getTime() - 2 * day),
        emailStatus: "SENT",
      },
      {
        companyId: northwindCompany.id,
        periodStart: new Date(today.getFullYear(), today.getMonth() - 1, 1),
        periodEnd: new Date(today.getFullYear(), today.getMonth(), 1),
        fileName: "finance-report-northwind-prev-month.csv",
        csvContent:
          "brand_name,logo_url,timesheet_id,approved_hours,monthly_charge,currency\n" +
          "DotCloud Northwind,https://assets.dotcloud.africa/logo-northwind.png,TS-NORTH-001,0.00,0.00,ZAR",
        recipientsCsv:
          "charl.venter@dotcloud.africa, northwind.finance@dotcloud.africa",
        totalApprovedHours: 0,
        totalCharge: 0,
        currency: "ZAR",
        generatedAt: new Date(today.getTime() - 2 * day),
        emailedAt: null,
        emailStatus: "FAILED",
        emailError: "SMTP is not configured",
      },
      {
        companyId: globexCompany.id,
        periodStart: new Date(today.getFullYear(), today.getMonth() - 1, 1),
        periodEnd: new Date(today.getFullYear(), today.getMonth(), 1),
        fileName: "finance-report-globex-prev-month.csv",
        csvContent:
          "brand_name,logo_url,timesheet_id,approved_hours,monthly_charge,currency\n" +
          "DotCloud Globex,https://assets.dotcloud.africa/logo-globex.png,TS-GLOBEX-001,0.00,0.00,ZAR",
        recipientsCsv:
          "charl.venter@dotcloud.africa, globex.finance@dotcloud.africa",
        totalApprovedHours: 0,
        totalCharge: 0,
        currency: "ZAR",
        generatedAt: new Date(today.getTime() - 1 * day),
        emailedAt: new Date(today.getTime() - 1 * day),
        emailStatus: "SENT",
      },
    ],
  });

  await prisma.auditLog.createMany({
    data: [
      {
        actor: "Seeder",
        entityType: "company_settings",
        entityId: acmeCompany.id,
        action: "created",
        afterJson: {
          revenueSplitPercent: 50,
          brandName: "DotCloud Delivery",
          currency: "ZAR",
        },
      },
      {
        actor: "Seeder",
        entityType: "timesheet",
        entityId: submittedTimesheet.id,
        action: "created",
        afterJson: {
          ratePerHour: submittedTimesheet.ratePerHour,
          engineerRatePerHour: submittedTimesheet.engineerRatePerHour,
          status: submittedTimesheet.status,
        },
      },
      {
        actor: "Seeder",
        entityType: "monthly_finance_report",
        entityId: acmeCompany.id,
        action: "generated",
        afterJson: {
          fileName: "finance-report-acme-consulting-prev-month.csv",
          totalCharge: Number(acmeMonthlyCharge.toFixed(2)),
          currency: "ZAR",
        },
      },
    ],
  });

  const [
    companies,
    companySettings,
    jobCount,
    candidateCount,
    appCount,
    clientAccounts,
    contacts,
    vacancies,
    placementAlerts,
    timesheets,
    invoices,
    monthlyReports,
    auditLogs,
  ] = await Promise.all([
    prisma.company.count(),
    prisma.companySettings.count(),
    prisma.job.count(),
    prisma.candidate.count(),
    prisma.application.count(),
    prisma.clientAccount.count(),
    prisma.clientContact.count(),
    prisma.vacancy.count(),
    prisma.placementAlert.count(),
    prisma.timesheet.count(),
    prisma.invoice.count(),
    prisma.monthlyFinanceReport.count(),
    prisma.auditLog.count(),
  ]);

  const summary: SeedSummary = {
    companies,
    companySettings,
    jobs: jobCount,
    candidates: candidateCount,
    applications: appCount,
    clientAccounts,
    contacts,
    vacancies,
    placementAlerts,
    timesheets,
    invoices,
    monthlyReports,
    auditLogs,
  };

  return summary;
}
