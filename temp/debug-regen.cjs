"use strict";
const path = require("path");
process.env.DATABASE_URL =
  "file:" + path.resolve(__dirname, "../prisma/prod.db");
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
const today = new Date();
today.setUTCHours(0, 0, 0, 0);
p.application
  .findMany({
    where: { emails: { some: { createdAt: { gte: today } } } },
    select: {
      id: true,
      jobId: true,
      candidateId: true,
      tenantId: true,
      job: { select: { title: true, tenantId: true } },
      candidate: { select: { fullName: true, tenantId: true } },
    },
  })
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
    return p.$disconnect();
  })
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
