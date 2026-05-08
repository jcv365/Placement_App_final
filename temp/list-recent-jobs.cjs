#!/usr/bin/env node
"use strict";
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env.local") });
process.env.DATABASE_URL =
  "file:" + path.resolve(__dirname, "../prisma/prod.db");
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
const since = new Date(Date.now() - 20 * 60 * 1000); // last 20 min
p.job
  .findMany({
    where: { tenantId: "dotcloudconsulting", createdAt: { gte: since } },
    select: { id: true, title: true, opportunityEmail: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  })
  .then((rows) => {
    console.log(`Jobs uploaded since ${since.toISOString()}:`);
    rows.forEach((j) =>
      console.log(
        `  ${j.createdAt.toISOString()} | ${j.id} | ${j.title} | ${j.opportunityEmail}`,
      ),
    );
    console.log(`Total: ${rows.length}`);
    return p.$disconnect();
  });
