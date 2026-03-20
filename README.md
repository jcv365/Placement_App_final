# Contract Placements

A full-stack workflow for contract placements: upload a job description and candidate CV, extract key fields, generate a British English positioning email using Chris Voss techniques, and track every application through a Kanban board with history and notes.

## Features

- Upload and extract JD/CV data (text or file)
- Rule-driven British English email generation
- Outlook draft creation via Microsoft Graph
- Kanban board with stage history and notes
- Editable ruleset with Voss technique toggles
- Admin portal with username/password auth for company finance settings
- Company branding settings (brand name, logo, report recipients, revenue split)
- Monthly finance CSV reports with download history and email delivery
- Month-to-date projected charge preview based on approved and in-flight timesheets
- Audit trail for settings and rate changes

## Tech Stack

- Next.js 14 App Router, TypeScript, Tailwind CSS
- Prisma (SQLite for dev, Postgres for prod)
- MSAL for Graph sign-in
- Azure OpenAI or Copilot Studio (feature-flagged)
- Azure Document Intelligence for extraction

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

### Option 3: Local Standalone (Reliable 3000/3001)

Use these PowerShell scripts to run both local instances reliably on IPv4 without listener conflicts.
Each script uses its own standalone build directory to prevent chunk mismatch errors.

1. Start demo instance (port 3000, demo.db)

```powershell
.\start-demo-local.ps1
```

2. Start prod-like instance (port 3001, prod.db)

```powershell
.\start-prod-local.ps1
```

3. Stop all local standalone node servers

```powershell
.\stop-local.ps1
```

Optional: rebuild standalone bundle before start

```powershell
.\start-demo-local.ps1 -Rebuild
.\start-prod-local.ps1 -Rebuild
```

Open using IPv4 URLs:

- `http://127.0.0.1:3000/auth/signin`
- `http://127.0.0.1:3001/auth/signin`

## Scripts

- `npm run dev` - start demo dev server on port `3000`
- `npm run demo` - alias for demo server on port `3000`
- `npm run build` - build for production
- `npm run prod:build` - alias for production build
- `npm run start` - run production server on port `3001`
- `npm run prod:start` - alias for production server on port `3001`
- `npm run lint` - lint
- `npm run test` - unit tests
- `npm run e2e` - Playwright smoke tests
- `npm run prisma:generate` - generate Prisma client
- `npm run prisma:migrate` - run migrations
- `npm run seed` - seed functional journey test data (jobs, candidates, applications, clients, vacancies, alerts, timesheets, invoices)
- `npm run seed:demo-policy` - enforce demo-only `@example.com` data policy and provision dummy demo logins

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
- Configure Azure or Copilot Studio credentials in `.env` before generating emails.
- To use GitHub Models with device login, set `GITHUB_OAUTH_CLIENT_ID` and use Settings → GitHub Models (device login).
- Optional provider controls: set `AI_PROVIDER` to `auto`, `azure-openai`, `copilot-studio`, or `github-models`.
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
  - `report_recipients` (must include `accounts@dotcloud.africa`)
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
- `GRAPH_SENDER_USER` (mailbox UPN, for example `placements@dotcloud.africa`)

App registration requirements:

- Microsoft Graph application permission `Mail.Send`
- Admin consent granted
- Sender mailbox exists and is licensed
