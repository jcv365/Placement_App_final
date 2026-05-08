"use strict";
const path = require("path");
const crypto = require("crypto");

process.env.DATABASE_URL =
  "file:" + path.resolve(__dirname, "../prisma/prod.db");
process.env.APP_SESSION_SECRET = "DwNteqv6/xUwLc1LwbWzbHOSD8CWUdFCMHZzQ1oJ59Q=";

const API_BASE = "http://127.0.0.1:3001";

function signValue(value) {
  return crypto
    .createHmac("sha256", process.env.APP_SESSION_SECRET)
    .update(value)
    .digest("base64url");
}

function mintSession(userId, tenantId) {
  const payload = {
    uid: userId,
    tid: tenantId,
    role: "ADMIN",
    exp: Date.now() + 24 * 60 * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  return `${encoded}.${signValue(encoded)}`;
}

async function main() {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  try {
    let userId;
    const adminUser = await prisma.tenantUser.findFirst({
      where: { tenantId: "dotcloudconsulting", role: "ADMIN", isActive: true },
      select: { id: true, email: true },
    });
    if (adminUser) {
      console.log("Using admin:", adminUser.email);
      userId = adminUser.id;
    } else {
      const anyUser = await prisma.tenantUser.findFirst({
        where: { tenantId: "dotcloudconsulting", isActive: true },
        select: { id: true, email: true },
      });
      if (!anyUser) throw new Error("No users in dotcloudconsulting");
      console.log("Using user:", anyUser.email);
      userId = anyUser.id;
    }

    const cookieHeader = `tenantId=dotcloudconsulting; appSession=${mintSession(userId, "dotcloudconsulting")}`;
    console.log("Session minted for dotcloudconsulting tenant");

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const drafts = await prisma.emailDraft.findMany({
      where: { createdAt: { gte: todayStart } },
      select: {
        id: true,
        application: {
          select: {
            jobId: true,
            candidateId: true,
            job: { select: { title: true } },
            candidate: { select: { fullName: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const pairMap = new Map();
    for (const d of drafts) {
      pairMap.set(`${d.application.jobId}::${d.application.candidateId}`, d);
    }
    const pairs = [...pairMap.values()];

    if (pairs.length === 0) {
      console.log("No drafts found for today.");
      return;
    }

    console.log(`\nFound ${pairs.length} unique pair(s):`);
    for (const d of pairs)
      console.log(
        `  [${d.application.job.title}] => ${d.application.candidate.fullName}`,
      );
    console.log(`\nRegenerating...\n`);

    let done = 0,
      failed = 0;
    for (const draft of pairs) {
      const { jobId, candidateId } = draft.application;
      const label = `${draft.application.job.title} / ${draft.application.candidate.fullName}`;
      process.stdout.write(
        `  [${done + failed + 1}/${pairs.length}] ${label} ... `,
      );
      try {
        const res = await fetch(`${API_BASE}/api/email/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookieHeader },
          body: JSON.stringify({ jobId, candidateId }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 201 || res.ok) {
          console.log(`OK "${data.subject ?? "?"}"`);
          done++;
        } else {
          console.log(
            `FAIL ${res.status}: ${JSON.stringify(data.error ?? data).slice(0, 160)}`,
          );
          failed++;
        }
      } catch (err) {
        console.log(`ERR: ${err.message}`);
        failed++;
      }
    }
    console.log(`\nDone: ${done} OK, ${failed} failed`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
