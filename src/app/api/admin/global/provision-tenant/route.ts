import { requireSuperAdminFromRequest } from "@/lib/adminAuth";
import { jsonError, jsonOk } from "@/lib/apiResponses";
import { execSync } from "node:child_process";
import crypto, { scryptSync } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

const SLUG_RE = /^[a-z][a-z0-9-]{1,30}$/;

const TENANTS_DIR = path.resolve(process.cwd(), "..", "tenants");
const REGISTRY_PATH = path.join(TENANTS_DIR, "registry.json");
const TEMPLATE_PATH = path.join(TENANTS_DIR, "docker-compose.tenant.yml");
const DYNAMIC_DIR = path.join(TENANTS_DIR, "dynamic");

type TenantRegistry = {
  tenants: Record<
    string,
    {
      slug: string;
      companyName: string;
      adminEmail: string;
      adminName: string;
      createdAt: string;
      status: "provisioning" | "running" | "stopped" | "error";
    }
  >;
};

function readRegistry(): TenantRegistry {
  if (!fs.existsSync(REGISTRY_PATH)) {
    return { tenants: {} };
  }
  return JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf-8")) as TenantRegistry;
}

function writeRegistry(registry: TenantRegistry): void {
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2), "utf-8");
}

function generatePassword(length = 20): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join("");
}

function generateAdminPasswordHash(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString("base64")}:${hash.toString("base64")}`;
}

export async function GET(request: Request) {
  try {
    requireSuperAdminFromRequest(request);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Forbidden";
    if (msg === "UNAUTHORISED_ADMIN") return jsonError("Unauthorised", 401);
    return jsonError("Forbidden — super-admin required", 403);
  }

  const registry = readRegistry();
  return jsonOk({ tenants: registry.tenants });
}

export async function POST(request: Request) {
  try {
    requireSuperAdminFromRequest(request);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Forbidden";
    if (msg === "UNAUTHORISED_ADMIN") return jsonError("Unauthorised", 401);
    return jsonError("Forbidden — super-admin required", 403);
  }

  let body: {
    slug?: string;
    companyName?: string;
    adminEmail?: string;
    adminName?: string;
  };
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const slug = body.slug?.trim().toLowerCase();
  const companyName = body.companyName?.trim();
  const adminEmail = body.adminEmail?.trim().toLowerCase();
  const adminName = body.adminName?.trim();

  if (!slug || !SLUG_RE.test(slug)) {
    return jsonError(
      "Slug must be 2–31 lowercase alphanumeric characters or hyphens, starting with a letter.",
    );
  }
  if (!companyName || companyName.length < 2 || companyName.length > 120) {
    return jsonError("Company name must be 2–120 characters.");
  }
  if (
    !adminEmail ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail) ||
    adminEmail.length > 254
  ) {
    return jsonError("Invalid admin email address.");
  }
  if (!adminName || adminName.length < 2 || adminName.length > 120) {
    return jsonError("Admin name must be 2–120 characters.");
  }

  // Check registry for duplicates
  const registry = readRegistry();
  if (registry.tenants[slug]) {
    return jsonError(`Tenant "${slug}" already exists.`, 409);
  }

  // Generate credentials
  const tempPassword = generatePassword();
  const sessionSecret = crypto.randomBytes(32).toString("base64");
  const adminPasswordHash = generateAdminPasswordHash(tempPassword);

  // Create tenant directory
  const tenantDir = path.join(TENANTS_DIR, slug);
  const tenantDataDir = path.join(tenantDir, "data", "prisma");

  try {
    fs.mkdirSync(tenantDataDir, { recursive: true });

    // Copy compose template
    const template = fs.readFileSync(TEMPLATE_PATH, "utf-8");
    fs.writeFileSync(path.join(tenantDir, "docker-compose.yml"), template);

    // Write .env
    const envContent = [
      `TENANT_SLUG=${slug}`,
      `COMPANY_NAME=${companyName}`,
      `ADMIN_EMAIL=${adminEmail}`,
      `APP_SESSION_SECRET=${sessionSecret}`,
      `ADMIN_PASSWORD_HASH=${adminPasswordHash}`,
      `TENANT_APP_IMAGE=contract_placements:latest`,
      `GITHUB_MODELS_TOKEN=${process.env.GITHUB_MODELS_TOKEN ?? ""}`,
      `SMTP_HOST=${process.env.SMTP_HOST ?? ""}`,
      `SMTP_PORT=${process.env.SMTP_PORT ?? "587"}`,
      `SMTP_FROM=${process.env.SMTP_FROM ?? ""}`,
      `SMTP_PASS=${process.env.SMTP_PASS ?? ""}`,
    ].join("\n");

    fs.writeFileSync(path.join(tenantDir, ".env"), envContent);

    // Copy prisma schema so db push works
    const prismaSchemaSource = path.resolve(
      process.cwd(),
      "prisma",
      "schema.prisma",
    );
    const tenantPrismaDir = path.join(tenantDir, "data", "prisma");
    if (fs.existsSync(prismaSchemaSource)) {
      fs.copyFileSync(
        prismaSchemaSource,
        path.join(tenantPrismaDir, "schema.prisma"),
      );
    }

    // Register in registry (status: provisioning)
    registry.tenants[slug] = {
      slug,
      companyName,
      adminEmail,
      adminName,
      createdAt: new Date().toISOString(),
      status: "provisioning",
    };
    writeRegistry(registry);

    // Write Traefik file-based route so the gateway discovers this tenant
    const projectName = `tenant_${slug.replace(/-/g, "_")}`;
    const containerName = `${projectName}-app-1`;
    const wildcardDomain =
      process.env.TENANT_WILDCARD_DOMAIN ?? "dotcloud.africa";
    const routeYaml = [
      "http:",
      "  routers:",
      `    ${slug}:`,
      `      rule: "Host(\`${slug}-placements.${wildcardDomain}\`)"`,
      "      entryPoints:",
      "        - websecure",
      "      tls: {}",
      `      service: ${slug}`,
      "",
      "  services:",
      `    ${slug}:`,
      "      loadBalancer:",
      "        servers:",
      `          - url: "http://${containerName}:3000"`,
    ].join("\n");
    fs.writeFileSync(path.join(DYNAMIC_DIR, `${slug}.yml`), routeYaml, "utf-8");

    // Push Prisma schema to tenant DB from host using local Prisma CLI (v6)
    // Must run before the container starts so the DB tables exist on boot
    const dbPath = path.join(tenantDir, "data", "prisma", "prod.db");
    execSync(`npx prisma db push --skip-generate`, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: `file:${dbPath}`,
      },
      timeout: 60_000,
      stdio: "pipe",
    });

    // Start the tenant stack
    execSync(`docker compose -p ${projectName} -f docker-compose.yml up -d`, {
      cwd: tenantDir,
      timeout: 120_000,
      stdio: "pipe",
    });

    // Wait for Next.js to finish starting up
    await new Promise((resolve) => setTimeout(resolve, 5_000));

    const seedCmd = [
      `node -e "`,
      `const { PrismaClient } = require('@prisma/client');`,
      `const crypto = require('crypto');`,
      `const p = new PrismaClient();`,
      `async function main() {`,
      `  const salt = crypto.randomBytes(16).toString('hex');`,
      `  const hash = await new Promise((res, rej) => crypto.scrypt('${tempPassword.replace(/'/g, "\\'")}', salt, 64, (e, k) => e ? rej(e) : res(k.toString('hex'))));`,
      `  const passwordHash = salt + ':' + hash;`,
      `  await p.tenant.upsert({ where: { tenantId: '${slug}' }, create: { tenantId: '${slug}', displayName: '${companyName.replace(/'/g, "\\'")}' }, update: {} });`,
      `  const existing = await p.company.findFirst({ where: { tenantId: '${slug}' } });`,
      `  if (!existing) await p.company.create({ data: { tenantId: '${slug}', name: '${companyName.replace(/'/g, "\\'")}' } });`,
      `  await p.tenantUser.upsert({`,
      `    where: { tenantId_email: { tenantId: '${slug}', email: '${adminEmail}' } },`,
      `    create: { tenantId: '${slug}', fullName: '${adminName.replace(/'/g, "\\'")}', email: '${adminEmail}', passwordHash, role: 'ADMIN', isActive: true, emailVerifiedAt: new Date() },`,
      `    update: { passwordHash, isActive: true, emailVerifiedAt: new Date() }`,
      `  });`,
      `  console.log('SEED_OK');`,
      `  await p.$disconnect();`,
      `}`,
      `main().catch(e => { console.error(e); process.exit(1); });`,
      `"`,
    ].join(" ");

    try {
      execSync(`docker exec ${containerName} sh -c '${seedCmd}'`, {
        timeout: 30_000,
        stdio: "pipe",
      });
    } catch (seedErr) {
      // Seeding may fail if container isn't ready yet — mark it but don't fail
      console.error(
        "[provision-tenant] Seed failed, manual seed required:",
        seedErr instanceof Error ? seedErr.message : seedErr,
      );
      registry.tenants[slug].status = "error";
      writeRegistry(registry);
      return jsonOk({
        slug,
        url: `https://${slug}-placements.dotcloud.africa`,
        tempPassword,
        status: "error",
        note: "Instance started but admin seeding failed. Re-run seeding manually.",
      });
    }

    registry.tenants[slug].status = "running";
    writeRegistry(registry);

    return jsonOk({
      slug,
      url: `https://${slug}-placements.dotcloud.africa`,
      tempPassword,
      adminEmail,
      status: "running",
    });
  } catch (err) {
    // Mark error in registry
    if (registry.tenants[slug]) {
      registry.tenants[slug].status = "error";
      writeRegistry(registry);
    }
    const message = err instanceof Error ? err.message : "Provisioning failed";
    return jsonError(message, 500);
  }
}
