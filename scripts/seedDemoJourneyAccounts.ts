import { PrismaClient, TenantUserRole } from "@prisma/client";

import { hashPassword } from "../src/lib/appAuth";

type JourneyUserSeed = {
  tenantId: string;
  tenantName: string;
  companyName: string;
  fullName: string;
  email: string;
  password: string;
  role: TenantUserRole;
};

const DEMO_DB_URL = process.env.DEMO_DATABASE_URL ?? "file:./demo.db";

const journeyUsers: JourneyUserSeed[] = [
  {
    tenantId: "default",
    tenantName: "Demo Instance",
    companyName: "Demo Instance",
    fullName: "Demo Administrator",
    email: "demo.admin@example.com",
    password: "DemoAdmin123!",
    role: TenantUserRole.ADMIN,
  },
  {
    tenantId: "default",
    tenantName: "Demo Instance",
    companyName: "Demo Instance",
    fullName: "Demo User",
    email: "demo.user@example.com",
    password: "DemoUser123!",
    role: TenantUserRole.USER,
  },
  {
    tenantId: "acmeops",
    tenantName: "Acme Operations",
    companyName: "Acme Operations",
    fullName: "Acme Admin",
    email: "acme.admin@example.com",
    password: "AcmeAdmin123!",
    role: TenantUserRole.ADMIN,
  },
  {
    tenantId: "acmeops",
    tenantName: "Acme Operations",
    companyName: "Acme Operations",
    fullName: "Acme Recruiter",
    email: "acme.user@example.com",
    password: "AcmeUser123!",
    role: TenantUserRole.USER,
  },
];

async function ensureTenantAndCompany(
  prisma: PrismaClient,
  tenantId: string,
  tenantName: string,
  companyName: string,
): Promise<void> {
  await prisma.tenant.upsert({
    where: { tenantId },
    create: {
      tenantId,
      displayName: tenantName,
    },
    update: {
      displayName: tenantName,
    },
  });

  const existingCompany = await prisma.company.findFirst({
    where: {
      tenantId,
      name: companyName,
    },
    select: { id: true },
  });

  if (!existingCompany) {
    await prisma.company.create({
      data: {
        tenantId,
        name: companyName,
      },
    });
  }
}

async function ensureJourneyUser(
  prisma: PrismaClient,
  user: JourneyUserSeed,
): Promise<void> {
  const passwordHash = await hashPassword(user.password);
  const now = new Date();

  await prisma.tenantUser.upsert({
    where: {
      tenantId_email: {
        tenantId: user.tenantId,
        email: user.email,
      },
    },
    create: {
      tenantId: user.tenantId,
      fullName: user.fullName,
      email: user.email,
      passwordHash,
      role: user.role,
      isActive: true,
      emailVerifiedAt: now,
    },
    update: {
      fullName: user.fullName,
      passwordHash,
      role: user.role,
      isActive: true,
      emailVerifiedAt: now,
      verifyTokenHash: null,
      verifyTokenExpiry: null,
    },
  });
}

async function main(): Promise<void> {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: DEMO_DB_URL,
      },
    },
  });

  try {
    for (const user of journeyUsers) {
      await ensureTenantAndCompany(
        prisma,
        user.tenantId,
        user.tenantName,
        user.companyName,
      );
      await ensureJourneyUser(prisma, user);
    }

    console.log("Demo journey accounts are ready.");
    console.log(
      JSON.stringify(
        journeyUsers.map((user) => ({
          tenantId: user.tenantId,
          role: user.role,
          email: user.email,
          password: user.password,
        })),
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Failed to seed demo journey accounts", error);
  process.exitCode = 1;
});
