# Contract Placements

A full-stack workflow for contract placements: upload a job description and candidate CV, extract key fields, generate a British English positioning email using Chris Voss techniques, and track every application through a Kanban board with history and notes.

## Features

- Upload and extract JD/CV data (text or file)
- Rule-driven British English email generation with Chris Voss technique coverage checks
- Outlook draft creation via Microsoft Graph (shared mailbox)
- Kanban board with stage history, notes, and audit trail
- Editable ruleset with Voss technique toggles and custom tenant email prompt
- Public candidate self-service CV upload (`/candidate-signup`) with AI profile inference and PDF generation
- Public contact form (`/contact`)
- Email verification for newly registered company accounts
- Admin portal with username/password auth for company finance settings
- Company branding settings (brand name, logo, report recipients, revenue split)
- Monthly finance CSV reports with download history and email delivery
- Month-to-date projected charge preview based on approved and in-flight timesheets
- Audit trail for settings and rate changes
- Multi-vendor AI fallback (GitHub Models → Azure OpenAI → LLMLite) with model-name normalisation
- Multi-tenant deployment with isolated per-tenant Docker stacks and Traefik gateway routing
- Super-admin global dashboard: tenant provisioning, company admins, billing, and environment status

## Tech Stack

- Next.js 15 App Router, TypeScript, Tailwind CSS
- Prisma (SQLite with WAL mode for Docker volumes)
- MSAL for Graph sign-in; Microsoft Graph shared-mailbox draft creation
- Multi-vendor AI: GitHub Models, Azure OpenAI, LLMLite (OpenAI-compatible proxy)
- Azure Document Intelligence for document extraction
- Traefik v3.4 reverse proxy for multi-tenant routing
- DocuSign REST API for NDA and Teaming Agreement envelope sends

## Getting Started

### Option 1: Docker (Recommended)

1. **Create environment file**:

   ```bash
   copy .env.example .env.local
   ```

   Fill in your Azure credentials in `.env.local`.

2. **Run with Docker Compose** (development with hot reload):

   ```bash
   docker-compose -f docker-compose.dev.yml up
   ```

   This starts the demo instance on `http://localhost:3000`.

   Or for production build:

   ```bash
   docker-compose up --build
   ```

   This starts the production instance on `http://localhost:3001`.

3. **Initialize the database** (first time only):

   ```bash
   docker-compose exec app npx prisma db push
   docker-compose exec app npm run seed
   ```

4. Open [http://localhost:3000](http://localhost:3000) for demo, or [http://localhost:3001](http://localhost:3001) for production.

5. **Stop containers**:

   ```bash
   docker-compose down
   ```

### Option 2: Local Development

1. Install dependencies

```bash
npm install
```

2. Create environment file

```bash
copy .env.example .env.local
```

3. Generate Prisma client and migrate

```bash
npm run prisma:generate
npm run prisma:migrate
```

4. Seed demo data (optional)

```bash
npm run seed
```

5. Start the app

```bash
npm run dev
```

### Option 3: Local Standalone Behind WAF (8081/8082)

Use these PowerShell scripts to run both local instances behind a local WAF on IPv4.
Each script uses its own standalone build directory to prevent chunk mismatch errors.
Default WAF engine is `ModSecurity + OWASP CRS` (`owasp/modsecurity-crs:nginx`) for strict CRS-grade behaviour.

1. Start demo instance (`8081` external WAF -> `3000` internal app, `demo.db`)

```powershell
.\start-demo-local.ps1
```

2. Start prod-like instance (`8082` external WAF -> `3001` internal app, `prod.db`)

```powershell
.\start-prod-local.ps1
```

3. Stop all local standalone and WAF node servers

```powershell
.\stop-local.ps1
```

Optional: rebuild standalone bundle before start

```powershell
.\start-demo-local.ps1 -Rebuild
.\start-prod-local.ps1 -Rebuild
```

Open using WAF IPv4 URLs:

- `https://192.168.1.161:8081/auth/signin`
- `https://192.168.1.161:8082/auth/signin`

Internal app ports (`3000` and `3001`) stay bound to loopback by default so external traffic goes through WAF endpoints.

WAF protection profile (strict CRS mode):

- ModSecurity engine with OWASP Core Rule Set container
- Paranoia and anomaly thresholds tuned for stricter blocking defaults
- Full CRS request/response inspection pipeline

Switching engines:

- Default strict CRS mode:
  - `./start-demo-local.ps1`
  - `./start-prod-local.ps1`
- Optional legacy Node proxy mode:
  - `./start-demo-local.ps1 -WafEngine node-proxy`
  - `./start-prod-local.ps1 -WafEngine node-proxy`

Note: strict CRS mode requires Docker running locally.

TLS certificates for local HTTPS are loaded from:

- `SSL/certificate.crt`
- `SSL/private.key`
- Optional chain: `SSL/ca_bundle.crt`

If the certificate or key file is missing, startup falls back to HTTP on the WAF ports.

## Scripts

- `npm run dev` - start demo dev server on port `3000`
- `npm run demo` - alias for demo server on port `3000`
- `npm run build` - build for production
- `npm run prod:build` - alias for production build
- `npm run start` - run production server on port `3001`
- `npm run prod:start` - alias for production server on port `3001`
- `npm run lint` - lint
- `npm run test` - unit tests (run `npx vitest run` for one-shot CI mode)
- `npm run e2e` - Playwright smoke tests
- `npm run prisma:generate` - generate Prisma client
- `npm run prisma:migrate` - run migrations
- `npm run seed` - seed functional journey test data (jobs, candidates, applications, clients, vacancies, alerts, timesheets, invoices)
- `npm run seed:demo-policy` - enforce demo-only `@example.com` data policy and provision dummy demo logins

### Agent & operations scripts (run directly with `node` or `npx tsx`)

| Script                                                | Purpose                                                                                                                                         |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/generateAllCvPdfs.js`                        | Batch-generate redacted CV PDFs for all candidates. Skips up-to-date records.                                                                   |
| `scripts/cvMatchDraftAgent.cjs`                       | Fetch active candidates + open jobs, score matches, trigger `POST /api/email/generate` for pairs above threshold.                               |
| `scripts/jdCandidateMatchAgent.cjs`                   | Given a job (or all jobs), score all candidates and output a ranked match table.                                                                |
| `scripts/sendDraftsAgent.cjs`                         | Send Outlook drafts from the shared mailbox with `--filter`, `--since`/`--all-dates`, and `--apply` flag.                                       |
| `scripts/sendDraftEmailsAgent.cjs`                    | Cross-reference DB (`EMAIL_DRAFTED` records) against Outlook Drafts folder; only sends verified matches and advances stage to `SENT_TO_CLIENT`. |
| `scripts/sendTodaysDrafts.cjs`                        | Send all drafts created today from the shared Outlook mailbox. Supports `--apply` and `--filter`.                                               |
| `scripts/resendCandidateEmails.cjs`                   | Resend Role Confirmation and NDA/Teaming emails for a specific candidate. Usage: `--candidate-id <id> [--apply]`.                               |
| `scripts/docusignLifecycleAgent.cjs`                  | Poll DocuSign for SENT/COMPLETED envelopes and sync status back to the database.                                                                |
| `scripts/processInboxReplies.cjs`                     | Read incoming email replies, match to candidate/application by subject, update application notes/stage.                                         |
| `scripts/processNdaReplies.cjs`                       | Read replies to NDA emails and save signed PDF attachments to `data/Documents/<candidateId>/`.                                                  |
| `scripts/sendNdaAndTeamingAgreement.cjs`              | Send NDA + Teaming Agreement PDFs to all active candidates as Outlook drafts with attachments.                                                  |
| `scripts/generateCandidateRoleConfirmationDrafts.cjs` | Draft role-confirmation emails (roles + rate request) for candidates who have suggested roles.                                                  |
| `scripts/splitMultiRoleJobs.ts`                       | AI-assisted: detect multi-role job records (e.g. consortium tenders) and split into individual jobs.                                            |
| `scripts/cleanupOpportunityTitles.ts`                 | Normalise job title field — strip noise, standardise casing, deduplicate role suffixes.                                                         |
| `scripts/dedupeApplicationsByOpportunity.ts`          | Find and merge duplicate applications for the same candidate + opportunity pair.                                                                |
| `scripts/backfillOpportunityId.ts`                    | Backfill missing `opportunityId` on `Application` records.                                                                                      |
| `scripts/normaliseDemoData.ts`                        | Ensure demo-instance data is clean and policy-compliant.                                                                                        |

## Demo Data Policy

Run the demo policy normaliser when you want to keep all `@example.com` records in the demo instance only.

```bash
npm run seed:demo-policy
```

What it does:

- Ensures demo tenant records exist in `demo.db`
- Creates or updates dummy demo logins
- Moves `@example.com` tenant users and candidate records from `prod.db` to `demo.db`
- Removes those dummy records from `prod.db`

Default demo credentials created by the script:

- Admin: `demo.admin@example.com` / `DemoAdmin123!`
- User: `demo.user@example.com` / `DemoUser123!`

Optional environment variable overrides:

- `DEMO_DATABASE_URL` (default `file:./demo.db`)
- `PROD_DATABASE_URL` (default `file:./prod.db`)
- `DEMO_TENANT_ID` (default `default`)
- `DEMO_TENANT_NAME` (default `Demo Instance`)
- `DEMO_ADMIN_EMAIL` and `DEMO_ADMIN_PASSWORD`
- `DEMO_USER_EMAIL` and `DEMO_USER_PASSWORD`

## Notes

- Sign in at `/auth/signin` to store a Graph access token for Outlook drafts.
- Configure `LLMLITE_API_BASE` and `LLMLITE_API_KEY` in the app environment for all AI operations (email generation, extraction, and matching).
- To use GitHub Models with device login, set `GITHUB_OAUTH_CLIENT_ID` and use Settings → GitHub Models (device login).
- Model selection is delegated to LLMLITE. The app no longer chooses a model directly.
- The Form Recognizer integration uses a basic fallback if no file parser is installed.

## DocuSign Agreement Sending

The `Send NDA` and `Send teaming agreement` actions now submit real DocuSign envelopes to the selected candidate email.

Required environment variables:

- `DOCUSIGN_BASE_URI` (for example `https://demo.docusign.net`)
- `DOCUSIGN_ACCOUNT_ID`
- `DOCUSIGN_ACCESS_TOKEN`

Then configure either templates or documents for each agreement type.

Option A: Template-based sending (recommended)

- `DOCUSIGN_NDA_TEMPLATE_ID`
- `DOCUSIGN_TEAMING_TEMPLATE_ID`
- `DOCUSIGN_TEMPLATE_ROLE_NAME` (default `Signer`)
- Optional per-template override:
  - `DOCUSIGN_NDA_ROLE_NAME`
  - `DOCUSIGN_TEAMING_ROLE_NAME`

Option B: Document-based sending

- `DOCUSIGN_NDA_DOCUMENT_PATH`
- `DOCUSIGN_TEAMING_DOCUMENT_PATH`

If document paths are not set, the app falls back to:

- `data/agreements/nda.pdf`
- `data/agreements/teaming-agreement.pdf`

Alternative document input (if you cannot mount files):

- `DOCUSIGN_NDA_DOCUMENT_BASE64`
- `DOCUSIGN_TEAMING_DOCUMENT_BASE64`

## Admin Finance Portal

- Open `/admin/signin` and sign in with `ADMIN_USERNAME` and `ADMIN_PASSWORD`.
- Admin-only finance endpoints are under `/api/admin/*`.
- Company settings include:
  - `revenue_split_percent`
  - `brand_name`
  - `logo_url` (uploaded image)
  - `report_recipients`
  - `currency` fixed to `ZAR`

### Monthly charge formula

- Monthly charge per timesheet = `(Contract rate - Engineer rate) × approved hours`.
- Reporting uses approved (and invoiced-from-approved) timesheets only.

### Monthly scheduler

- Scheduler runs at `00:00` in `Africa/Johannesburg` timezone on each day and triggers report generation on the last day of month.
- Disable scheduler with `ENABLE_FINANCE_SCHEDULER=false`.

### Required/optional environment variables

- `ADMIN_USERNAME` (default: `admin`)
- `ADMIN_PASSWORD` (default: `admin123`)
- `ADMIN_SESSION_SECRET` (recommended in all environments)
- `ENABLE_FINANCE_SCHEDULER` (default: `true`)

For report emails (Microsoft Graph app credentials):

- `GRAPH_TENANT_ID`
- `GRAPH_CLIENT_ID`
- `GRAPH_CLIENT_SECRET`
- `GRAPH_SENDER_USER` (mailbox UPN, e.g. `placements@yourcompany.com`)

App registration requirements:

- Microsoft Graph application permission `Mail.Send`
- Admin consent granted
- Sender mailbox exists and is licensed

## Multi-tenant Deployment

Each tenant gets an isolated Docker stack (separate DB, separate app container) behind a shared Traefik gateway.

### Gateway

```bash
cd tenants
docker compose -f docker-compose.gateway.yml up -d
```

The gateway listens on:

- `192.168.1.161:10443` — HTTPS (wildcard cert from `SSL/certs/fullchain.pem` + `privkey.pem`)
- `192.168.1.161:1080` — HTTP (redirects to HTTPS)

Routes are defined in `tenants/dynamic/*.yml`. Add a new `<slug>.yml` file to add a route; Traefik hot-reloads it automatically.

### Provisioning a new tenant

Use the super-admin API from within the master instance:

```http
POST /api/admin/global/provision-tenant
Content-Type: application/json
Cookie: adminSession=<token>

{
  "slug": "acmecorp",
  "companyName": "Acme Corp",
  "adminEmail": "admin@acmecorp.com",
  "adminName": "Jane Smith"
}
```

This will:

1. Generate a secure password and `bcrypt`-hash it.
2. Write `tenants/acmecorp/.env` and `tenants/acmecorp/docker-compose.yml`.
3. Write `tenants/dynamic/acmecorp.yml` (Traefik route: `acmecorp-placements.dotcloud.africa`).
4. Register the tenant in `tenants/registry.json`.
5. Run `docker compose up -d` in the tenant directory.

### Starting a tenant stack manually

```bash
cd tenants/nildata
docker compose up -d
```

### Environment variables (per-tenant)

| Variable                | Description                                                          |
| ----------------------- | -------------------------------------------------------------------- |
| `MASTER_TENANT_ID`      | **Required.** The tenant slug — used to scope all DB queries.        |
| `APP_SESSION_SECRET`    | Session signing secret. Generate with `openssl rand -hex 32`.        |
| `ADMIN_USERNAME`        | Admin portal login email.                                            |
| `ADMIN_PASSWORD_HASH`   | Bcrypt hash of the admin password.                                   |
| `APP_BASE_URL`          | Public base URL, e.g. `https://acmecorp-placements.dotcloud.africa`. |
| `LLMLITE_API_BASE`      | OpenAI-compatible proxy for AI features.                             |
| `PLATFORM_PARTNER_NAME` | Tenant company name shown in emails.                                 |

## Public Candidate Signup

Candidates can self-register by uploading their CV at `/candidate-signup` without needing an invitation.

- Accepts PDF only (MIME type and `%PDF-` magic bytes validated server-side).
- Rate-limited: 5 submissions per IP per 10 minutes.
- AI infers candidate profile (name, email, phone, skills, roles, certifications).
- Formatted CV PDF generated and stored; welcome email sent via SMTP if configured.

Required for welcome emails:

- `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `SMTP_PASS`
