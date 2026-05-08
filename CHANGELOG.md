# Changelog

## 2026-04-16 — SQLite WAL mode — Docker named volume migration

Moved `prod.db` from the Windows bind-mount (`./:/app/data`) to a Docker named volume (`contract_placements_prod_db` → `/app/db`). A Windows bind-mount causes `mmap(MAP_SHARED)` to fail inside the Linux container, making SQLite WAL mode unusable and causing `SQLITE_CANTOPEN`/`SQLITE_READONLY_CANTINIT` errors on container restart.

- `docker-compose.yml`: `DATABASE_URL` updated to `file:/app/db/prod.db`, new `db` volume (external, name `contract_placements_prod_db`) added.
- `prod.db` copied to named volume with correct ownership (`nextjs` uid 1001) and WAL mode pre-set so container startup PRAGMA is a no-op.
- Smoke tests: 4/4 passing.

## 2026-04-16 — Performance Optimisations

### Candidate list query — no longer loads CV blob

The `GET /api/candidates` list query previously fetched the full `rawCV` text (20–50 KB per row) for every candidate. It only needed that field to derive 3–4 character `cvStorageMode` string. The fix:

- Added `cvStorageMode STRING NOT NULL DEFAULT 'FULL'` column to `Candidate` to persist the mode.
- All CV write paths (`upload/cv`, `cv-contact-privacy`) now persist `cvStorageMode` on create/update.
- The list query now selects `cvStorageMode: true` instead of `rawCV: true`.
- **Before:** each page load fetched ~50 KB × N candidates. **After:** ~8 bytes × N candidates.

### Missing FK indexes added

Four foreign-key columns that were hit on every join lacked indexes:

| Index                         | Column                    |
| ----------------------------- | ------------------------- |
| `Candidate_email_idx`         | `Candidate.email`         |
| `Application_candidateId_idx` | `Application.candidateId` |
| `Application_jobId_idx`       | `Application.jobId`       |
| `Job_companyId_idx`           | `Job.companyId`           |

### Company-name AI validation cache

`isLikelyInvalidCompanyNameWithAi()` in `companyResolution.ts` previously called the LLM for every company string encountered, even duplicates within a single request. A 500-entry in-process LRU-style cache (`AI_VALIDATION_CACHE`) now short-circuits repeated lookups.

### Global overview — bounded timesheet query

The `allTimesheets` query in `GET /api/admin/global/overview` previously had no `WHERE` clause and would scan the entire timesheet table. It is now bounded to the last 730 days (24 months), which covers all practical reporting needs.

---

## 2026-04-15 — Multi-tenant Platform, Public Portal & SQLite Tuning

### Multi-tenant infrastructure

The platform now supports isolated per-tenant deployments routed through a Traefik reverse-proxy gateway.

| File / directory                     | Purpose                                                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `tenants/docker-compose.gateway.yml` | Traefik v3.4 gateway compose file. Listens on `:10443` (HTTPS) and `:1080` (HTTP → HTTPS redirect). Wildcard cert from `SSL/certs/`. |
| `tenants/docker-compose.tenant.yml`  | Template compose for isolated tenant app instances. Joins `placements_gateway` network; auto-runs `prisma db push` on start.         |
| `tenants/dynamic/master.yml`         | Traefik dynamic config: routes `placements.dotcloud.africa` → master instance.                                                       |
| `tenants/dynamic/nildata.yml`        | Routes `nildata-placements.dotcloud.africa` → `tenant_nildata-app-1`.                                                                |
| `tenants/dynamic/tls.yml`            | Defines the shared default TLS certificate for the gateway.                                                                          |
| `tenants/registry.json`              | Machine-readable registry of provisioned tenants and their status.                                                                   |
| `tenants/nildata/`                   | First provisioned tenant: Nildata. Contains its own `.env`, `data/`, `docker-compose.yml`, and `seed.js`.                            |

### New API routes

| Route                                        | Purpose                                                                                                                                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/admin/global/provision-tenant`    | Super-admin: provisions a fresh tenant stack (generates `.env`, Traefik dynamic config, `docker-compose.yml`, seeds DB, registers in `registry.json`).                                                             |
| `GET /api/admin/global/overview`             | Super-admin dashboard: instance-wide counts for tenants, users, candidates, jobs, applications.                                                                                                                    |
| `GET/POST /api/admin/global/company-admins`  | Super-admin: list and manage company-level admins across all tenants.                                                                                                                                              |
| `GET/POST /api/admin/global/company-billing` | Super-admin: view and update per-tenant billing configuration.                                                                                                                                                     |
| `GET /api/admin/global/instance-env`         | Super-admin: read-only view of key environment variable status (set / not set) for the running instance.                                                                                                           |
| `POST /api/public/candidate-signup`          | Public, unauthenticated CV upload endpoint. Rate-limited (5 attempts / 10 min per IP). Validates PDF signature, infers candidate profile via AI, generates formatted CV PDF, and optionally sends a welcome email. |
| `POST /api/public/contact`                   | Public contact-form submission. Rate-limited; sends enquiry via SMTP mailer.                                                                                                                                       |
| `GET /api/auth/tenant/verify-email`          | Verifies email address for newly registered company accounts using a one-time signed token; activates the account.                                                                                                 |

### New pages

| Route               | Description                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/candidate-signup` | Public-facing self-service CV upload form. Supports multi-step flow: upload → review → confirmation. Middleware guards rewrite it to the API endpoint. |
| `/contact`          | Public contact form page.                                                                                                                              |

### New scripts (2026-04-15)

| Script                                       | Purpose                                                                                                                                                                                                                       |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/sendDraftEmailsAgent.cjs`           | Cross-references the DB (`EMAIL_DRAFTED` applications + `EmailDraft` records) against the shared Outlook Drafts folder. Only sends drafts that have a verified match; advances application stage to `SENT_TO_CLIENT` on send. |
| `scripts/sendTodaysDrafts.cjs`               | Simpler agent: finds all draft messages in the shared Outlook mailbox created today and sends them. Supports `--apply` and `--filter` flags.                                                                                  |
| `scripts/resendCandidateEmails.cjs`          | Resends the Role Confirmation and NDA/Teaming emails for a specific candidate by calling the Graph API directly. Usage: `--candidate-id <id> [--apply]`.                                                                      |
| `scripts/splitMultiRoleJobs.ts`              | AI-assisted script that detects job records representing multiple roles (e.g. consortium tenders listing comma-separated positions) and splits them into individual job records.                                              |
| `scripts/cleanupOpportunityTitles.ts`        | Normalises job opportunity `title` field — strips noise, standardises casing, deduplicates role suffixes. Supports `--apply` flag.                                                                                            |
| `scripts/dedupeApplicationsByOpportunity.ts` | Finds duplicate applications for the same candidate+opportunity pair and merges or removes them.                                                                                                                              |
| `scripts/backfillOpportunityId.ts`           | Backfills missing `opportunityId` on `Application` records by matching against the job vacancy.                                                                                                                               |
| `scripts/normaliseDemoData.ts`               | Ensures demo-instance data is clean and policy-compliant (`@example.com` records only in `demo.db`).                                                                                                                          |
| `scripts/seedDemoJourneyAccounts.ts`         | Seeds demo journey user accounts (admin + user) into the demo instance after a standalone build.                                                                                                                              |

### SQLite performance tuning (production Docker)

- `src/lib/prisma.ts`: PRAGMAs applied on first connection: `PRAGMA journal_mode = WAL`, `synchronous = NORMAL`, `cache_size = -20000`, `busy_timeout = 15000`, `mmap_size = 268435456`.
- `src/lib/prisma.ts`: `transactionOptions` extended to `{ maxWait: 10_000, timeout: 15_000 }`.
- `docker-compose.yml`: `DATABASE_URL` includes `?connection_limit=1&busy_timeout=15000`.
- `src/app/api/applications/[id]/stage/route.ts`: `writeAuditLog` call moved **outside** the `$transaction` block to eliminate write-lock contention.
- Result: Stage PATCH latency dropped from timeout (> 5 000 ms) to ~1 000–1 800 ms.

### App-wide changes

- `MASTER_TENANT_ID` is now a **required** environment variable (startup throws if unset) and no longer falls back to `"dotcloudconsulting"`. Tenant compose template sets it to `${TENANT_SLUG}`.
- `src/lib/apiResponses.ts` extracted as a shared module (`jsonOk`, `jsonError`, `rejectCrossOrigin`, typed `ApiError`) to standardise response shapes across all routes.
- `src/lib/britishEnglish.ts` added: utility functions for consistent British English spelling and copy checks.
- `src/lib/cookies.ts`: helper utilities for cookie serialisation.
- `src/lib/upload.ts`: shared file-type validation helpers (`hasPdfSignature`, `ALLOWED_MIME_TYPES`).
- `src/lib/uploadProgress.ts`: upload progress store with periodic cleanup and max-size cap.
- `src/lib/validation.ts`: expanded validation helpers for email, phone, URL, slug, and rate-limiting inputs.

---

## 2026-04-13 — Agent Build-out & Positioning Uplift

### New files

| File                                                  | Purpose                                                                                                                                                                                                                                                     |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/generateAllCvPdfs.js`                        | Batch-generates redacted CV PDFs for all candidates. Now checks both DB staleness (`formattedCvGeneratedAt >= updatedAt`) and file existence before skipping — prevents stale-skip on re-generated CVs.                                                     |
| `scripts/cvMatchDraftAgent.cjs`                       | Agent: fetches active candidates + open jobs, calls the ATS matcher, and triggers `POST /api/email/generate` for pairs above the configured score threshold. **Known bug**: individual candidate fetch needed for `rawCV`; list API strips it. Fix pending. |
| `scripts/jdCandidateMatchAgent.cjs`                   | Agent: given a job (or all jobs), scores all candidates and outputs a ranked match table. Same rawCV limitation applies.                                                                                                                                    |
| `scripts/sendDraftsAgent.cjs`                         | Agent: sends Outlook drafts from the shared mailbox with `--filter`, `--since`/`--all-dates` date controls, `--apply` flag (default is dry-run), retry on 5xx, and structured stderr error output.                                                          |
| `scripts/docusignLifecycleAgent.cjs`                  | Agent: polls DocuSign for SENT/COMPLETED envelopes and syncs status back to the database via the Docker container.                                                                                                                                          |
| `scripts/sendNdaAndTeamingAgreement.cjs`              | Sends NDA + Teaming Agreement PDFs to all active candidates as Outlook drafts with attachments.                                                                                                                                                             |
| `scripts/generateCandidateRoleConfirmationDrafts.cjs` | Drafts role-confirmation emails (roles + rate request) for candidates who have suggested roles.                                                                                                                                                             |
| `scripts/processInboxReplies.cjs`                     | Inbox agent: reads incoming email replies, matches to candidate/application by subject, and updates application notes/stage.                                                                                                                                |
| `scripts/processNdaReplies.cjs`                       | Inbox agent: reads replies to NDA emails, saves signed PDF attachments to `data/Documents/<candidateId>/`.                                                                                                                                                  |

### Modified — email positioning

All four layers of the email system now position DotCloud Consulting as a **specialist professional services firm deploying engineers from its active, vetted bench** — not a generic recruitment/C2C broker.

#### `src/lib/prompts.ts` (AI-generated client-facing emails)

- `EMAIL_SYSTEM_PROMPT`: role changed from "placement consultant / company-to-company recruitment partner" → "professional services consultant / specialist professional services firm presenting engineers from its active, vetted bench".
- Hard constraint 5 updated: engineers are presented as a deployment from a vetted bench; the firm is directly accountable — not brokering.
- `partnerLabel` changed from `"company-to-company recruitment partner"` → `"specialist professional services firm"`.
- `partnerIntro`: reader-outcome changed to _"this firm has the right engineer available, has done the vetting work, and stands behind the deployment"_.
- Company intro labelling example updated from "finding the right specialist for this brief" → "finding a specialist who can deploy quickly without onboarding uncertainty".
- Emphasis changed from talent pipeline / market insight → bench readiness, direct accountability, professional services deployment.

#### `scripts/sendNdaAndTeamingAgreement.cjs` (candidate-facing NDA email)

- Opening paragraph: was _"Thank you for registering… we are excited to assist you in finding opportunities"_ → _"Thank you for joining DotCloud Consulting's specialist engineering bench. We are a professional services company that deploys vetted engineers to clients…"_
- Teaming Agreement description updated: _"sets out terms under which we will deploy you to our clients as part of our engineering bench"_.

#### `src/lib/roleConfirmationEmail.ts` (candidate-facing role confirmation, used by the app API)

- Same opening paragraph update: candidates understand they are joining an active bench, not being helped to job-seek.
- Teaming Agreement bullet updated to match bench deployment framing.

#### `scripts/generateCandidateRoleConfirmationDrafts.cjs` (candidate-facing role confirmation, batch script)

- Opening paragraph updated identically to `roleConfirmationEmail.ts`.

---

### Operations — 2026-04-13

- **37 NDA & Teaming Agreement emails sent** to all active candidates via `scripts/sendDraftsAgent.cjs --all-dates --filter "teaming" --apply`.
  - Filter `"teaming"` chosen over `"nda"` to avoid substring false-positives (e.g. `brendan`, `randall`, `foundations` all contain `"nda"`).
  - All 37 sent, 0 failed.

---

### Known issues / pending

- `cvMatchDraftAgent.cjs` and `jdCandidateMatchAgent.cjs` report "0 active with CV" because `GET /api/candidates` list endpoint strips `rawCV` at response-mapping time (`route.ts` line ~121). Fix: switch inner scoring loop to call `POST /api/candidates/:id/ats-match` per pair (reads `rawCV` directly from DB) instead of inline scoring.

---

## 2026-04-08 — Production Stability & Email Reliability Fixes

### Email generation (`POST /api/email/generate`)

- **Regression fix**: endpoint no longer returns `400`/`502` when Outlook draft creation is `skipped` or `failed`. It now persists the `EmailDraft` record, updates the application stage, returns `201`, and includes `outlookDraft.status` / `outlookDraft.reason` in the response so the UI can surface the skip reason.
- **Recipient name safety guard**: generation now passes `recipientName` into `EMAIL_USER_PROMPT` and rejects drafts with `422` when the generated subject or body does not contain the expected candidate full name. Prevents invented names from being saved.
- **Mailbox routing fix**: `createAutomaticOutlookDraft` in the generate route now unconditionally uses the shared mailbox (`OUTLOOK_SHARED_MAILBOX`, falling back to `DEFAULT_OUTLOOK_MAILBOX`) and no longer falls through to connected-user/company Graph tokens.

### Opportunity email backfill

- Script run against production DB: backfilled missing `Job.opportunityEmail` from the first valid email address found in `opportunityUrl`, `rawText`, or `description` (missing-only update).
- Result: `valid` count 34 → 97, `missing` 285 → 222, `invalid` unchanged at 0.
- 34 previously-invalid addresses resolved by normalising `mailto:` prefix stripping.

### Match scoring consistency (`MatchReviewClient`)

- **Problem**: overall score was driven by title/body token overlap while skill/role/certification chips used different denominators, causing a high overall score alongside very low component percentages.
- **Fix**: focused top-requirement tokens are derived first; component scores are computed from these consistent token sets; overall is a weighted blend of title/body and component scores.
- **Certification weighting**: conditional on required certification presence to avoid irrelevant drag on overall score when no cert is required.

### AI provider fixes

- All AI callers now use a shared model resolver (`LLMLITE_MODEL` → `OPENAI_MODEL` → `AZURE_OPENAI_DEPLOYMENT` → default). The `model` field is always included in `/chat/completions` requests; omitting it produced `invalid model name ... model=None` errors during CV upload extraction.
- DeepSeek-R1 removed from fallback lists for structured JSON tasks — reasoning chains (`<think>` tags) break JSON parsing.
- GitHub Models endpoint (`models.inference.ai.azure.com`) model names no longer include the `openai/` prefix.

---

## 2026-04-15 — Hardcode-to-AI Audit & Replacement

### Salary parsing now uses live exchange rates

**Before:** Inbox replies containing GBP/EUR/USD rates were converted to ZAR using rates baked into the source code (`GBP 23.5, EUR 20.0, USD 18.5`). As real rates drifted, candidate rate records were silently wrong — sometimes by 10–15%.

**After:** `scripts/processInboxReplies.cjs` fetches today's rates from Frankfurter on every run and logs them at startup (`FX rates: GBP=X.XX EUR=X.XX USD=X.XX`). Stale hardcoded values are kept only as a fallback if the API is unreachable.

---

### Role-match guard no longer misses modern job titles

**Before:** Roles like "CTO", "VP Engineering", "SRE", "DevOps Practitioner", or "Data Steward" were not recognised by the role-family guard (`ROLE_FAMILY_WORDS` had 16 entries; `SENIORITY_WORDS` had 15). Candidates with these titles could slip through or be incorrectly rejected.

**After:** Both sets have been roughly doubled (35 and 23 entries respectively), covering the full range of modern technical seniority and role types. The coverage threshold (`0.75`) is now tunable via `ROLE_COVERAGE_THRESHOLD` env var without a code change.

---

### Client emails contain fewer American spellings

**Before:** The British English normaliser covered 42 words. Common American forms like "digitize", "modeled", "artifact", "skeptical", "tire" (tyre), and "cozy" passed through uncorrected into client-facing emails.

**After:** The static map covers ~100 forms across `-ize`, `-or`, `-er`, double-consonant, and miscellaneous categories. A new `normaliseBritishEnglishAsync()` function additionally sends residual text to the AI for any spellings still not in the map — making it effectively comprehensive.

---

### Company names from cluttered job postings are no longer silently corrupted

**Before:** A 39-term keyword list (`ROLE_LIKE_TERMS` + `JOB_POSTING_TERMS`) rejected strings that contained words like "engineer", "contract", or "remote". This caused LinkedIn job posting text (e.g. "Senior Data Engineer — Remote, Outside IR35") to be rejected as a company name, which is correct — but it also wrongly rejected legitimate company names that happened to contain those words (e.g. "Engineer Staffing Solutions Ltd", "Remote Talent Group").

**After:** Zero-false-positive heuristics handle the obvious cases (URLs, currency amounts, overlong strings). Everything else goes to the AI, which understands context and correctly distinguishes "Acme Engineering Ltd" from "Senior Data Engineer — Remote".

---

### Consortium security role splits now work for any acronym

**Before:** Only four specific acronyms were expanded correctly in `splitMultiRoleJobs.ts` (`SOC`, `IAM`, `DFIR`, `cloud security`). Any other acronym in a consortium tender (e.g. `GRC`, `PKI`, `VAPT`, `DLP`) fell through as `"PKI Engineer"` unchanged — a generic and often wrong title.

**After:** The hardcoded if-chain is gone. All items default to `"${item} Engineer"` and the existing AI resolver (`resolveGenericRoles`) automatically expands any all-caps acronym to its proper job title. The `looksLikeRole` guard was also broadened (14 → 22 role types) so more split roles pass validation.

---

### Job title cleanup no longer silently deletes valid niche roles

**Before:** `cleanupOpportunityTitles.ts` gated every title against a 50-keyword set before considering deletion. Any role title that lacked an exact keyword match — "Steward", "Evangelist", "Scrum Master" (without the word "engineer"), "Practitioner" — was deleted without review, even when it was a perfectly valid vacancy.

**After:** The keyword gate is gone entirely. Every title that fails sanitisation goes straight to the AI, which decides whether it is a legitimate job title. False-negative deletions of valid niche roles are eliminated.

---

### Match and factuality thresholds are tunable without a redeploy

**Before:** Lowering or raising the match confidence threshold (90) or the email factuality pass threshold (80) required editing source code and rebuilding the Docker image.

**After:** Both are read from env vars (`MATCH_CONFIDENCE_THRESHOLD`, `FACTUALITY_PASS_THRESHOLD`). CV and JD excerpt lengths are also configurable (`CV_EXCERPT_LENGTH`, `JD_EXCERPT_LENGTH`). Update `.env` and restart — no code change needed.

| Env var                      | Controls                                                   | Default |
| ---------------------------- | ---------------------------------------------------------- | ------- |
| `MATCH_CONFIDENCE_THRESHOLD` | Minimum AI confidence to allow email generation            | `90`    |
| `CV_EXCERPT_LENGTH`          | Characters of CV text sent to the match validator          | `1800`  |
| `JD_EXCERPT_LENGTH`          | Characters of JD text sent to the match validator          | `2000`  |
| `FACTUALITY_PASS_THRESHOLD`  | Minimum factuality score for an email draft to be accepted | `80`    |
| `ROLE_COVERAGE_THRESHOLD`    | Specialisation coverage required by the role-match guard   | `0.75`  |
