const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const tenantId = "dotcloudconsulting";
const targetMailbox = "janine.venter@dotcloud.africa";
const targetCount = 61;

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((value || "").trim());
}

function b64url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function makeToken(uid, tid, role) {
  const payload = { uid, tid, role, exp: Date.now() + 24 * 60 * 60 * 1000 };
  const encoded = b64url(JSON.stringify(payload));
  const secret =
    (process.env.APP_SESSION_SECRET || "").trim() || "local-app-session-secret";
  return `${encoded}.${sign(encoded, secret)}`;
}

function startOfTodayUtc() {
  const now = new Date();
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      0,
      0,
      0,
    ),
  );
}

async function pickAfternoonApplications(limit) {
  const drafts = await prisma.emailDraft.findMany({
    where: {
      tenantId,
      createdAt: { gte: startOfTodayUtc() },
    },
    orderBy: { createdAt: "desc" },
    select: {
      applicationId: true,
      createdAt: true,
      application: {
        select: {
          id: true,
          jobId: true,
          candidateId: true,
          currentStage: true,
          job: { select: { opportunityEmail: true } },
        },
      },
    },
    take: 500,
  });

  const seen = new Set();
  const apps = [];

  for (const row of drafts) {
    const app = row.application;
    if (!app || seen.has(app.id)) continue;
    if (!isValidEmail(app.job?.opportunityEmail || "")) continue;

    seen.add(app.id);
    apps.push({
      id: app.id,
      jobId: app.jobId,
      candidateId: app.candidateId,
      currentStage: app.currentStage,
      opportunityEmail: app.job?.opportunityEmail || null,
      sourceDraftCreatedAt: row.createdAt,
    });

    if (apps.length >= limit) break;
  }

  return apps;
}

async function run() {
  const admin = await prisma.tenantUser.findFirst({
    where: { tenantId, role: "ADMIN", isActive: true },
    select: { id: true },
  });

  if (!admin) {
    throw new Error("No active admin user found for tenant");
  }

  const company = await prisma.company.findFirst({
    where: { tenantId },
    select: {
      id: true,
      settings: { select: { outlookMailbox: true } },
    },
  });

  if (!company?.id) {
    throw new Error("No company found for tenant");
  }

  const applications = await pickAfternoonApplications(targetCount);
  if (applications.length === 0) {
    throw new Error("No eligible afternoon applications found to regenerate");
  }

  const originalMailbox = (company.settings?.outlookMailbox || "")
    .trim()
    .toLowerCase();

  const appIds = applications.map((app) => app.id);
  const deletedBeforeRun = await prisma.emailDraft.deleteMany({
    where: { tenantId, applicationId: { in: appIds } },
  });

  let resetToNew = 0;
  for (const app of applications) {
    if (app.currentStage === "EMAIL_DRAFTED") {
      await prisma.application.update({
        where: { id: app.id },
        data: {
          currentStage: "NEW",
          history: {
            create: {
              tenantId,
              fromStage: "EMAIL_DRAFTED",
              toStage: "NEW",
              changedBy: "Redo email generation",
            },
          },
        },
      });
      resetToNew += 1;
    }
  }

  await prisma.companySettings.upsert({
    where: { companyId: company.id },
    update: { outlookMailbox: targetMailbox },
    create: { companyId: company.id, outlookMailbox: targetMailbox },
  });

  const token = makeToken(admin.id, tenantId, "ADMIN");

  let success = 0;
  let failed = 0;
  let skippedOutlook = 0;
  const failSamples = [];

  try {
    for (let i = 0; i < applications.length; i += 1) {
      const app = applications[i];
      const response = await fetch("http://127.0.0.1:3000/api/email/generate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `appSession=${token}; tenantId=${tenantId}`,
        },
        body: JSON.stringify({
          applicationId: app.id,
          jobId: app.jobId,
          candidateId: app.candidateId,
          aiProvider: "auto",
        }),
      });

      const text = await response.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text };
      }

      if (response.ok) {
        success += 1;
        const status = payload?.data?.outlookDraft?.status;
        if (status === "skipped") skippedOutlook += 1;
      } else {
        failed += 1;
        if (failSamples.length < 20) {
          failSamples.push({
            applicationId: app.id,
            status: response.status,
            error:
              payload?.error?.message ||
              payload?.error?.details?.message ||
              payload?.raw ||
              `HTTP ${response.status}`,
          });
        }
      }

      if ((i + 1) % 10 === 0) {
        console.log(
          `progress ${i + 1}/${applications.length} success=${success} failed=${failed}`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  } finally {
    await prisma.companySettings.upsert({
      where: { companyId: company.id },
      update: {
        outlookMailbox: originalMailbox || "placements@dotcloud.africa",
      },
      create: {
        companyId: company.id,
        outlookMailbox: originalMailbox || "placements@dotcloud.africa",
      },
    });
  }

  const latestRegenerated = await prisma.emailDraft.findMany({
    where: {
      tenantId,
      applicationId: { in: applications.map((a) => a.id) },
    },
    orderBy: { createdAt: "desc" },
    take: applications.length,
    select: {
      applicationId: true,
      htmlBody: true,
      createdAt: true,
      application: { select: { candidate: { select: { fullName: true } } } },
    },
  });

  const withExplicitName = latestRegenerated.filter((d) => {
    const name = (d.application?.candidate?.fullName || "").trim();
    if (!name) return false;
    return d.htmlBody.toLowerCase().includes(name.toLowerCase());
  }).length;

  console.log(
    JSON.stringify(
      {
        tenantId,
        targetedApplications: applications.length,
        deletedDraftRowsBeforeRun: deletedBeforeRun.count,
        applicationsResetToNewBeforeRun: resetToNew,
        mailboxUsedDuringRun: targetMailbox,
        mailboxRestoredTo: originalMailbox || "placements@dotcloud.africa",
        success,
        failed,
        skippedOutlook,
        engineerNameMentionedInLatestDrafts: `${withExplicitName}/${latestRegenerated.length}`,
        failSamples,
      },
      null,
      2,
    ),
  );

  if (failed > 0) {
    process.exitCode = 1;
  }
}

run()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
