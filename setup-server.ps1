#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Prepares a new server to run Contract Placements.

.DESCRIPTION
    Run this ONCE on the target server before starting the stack for the first time.
    It will:
      1. Verify Docker is available
      2. Create required external Docker networks
      3. Create the named database volume
      4. Create required directories (SSL certs, secrets)
      5. Check that .env.local exists and has no REPLACE_ placeholders

.EXAMPLE
    .\setup-server.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ─── Helpers ──────────────────────────────────────────────────────────────────
function Write-Step([string]$msg) { Write-Host "`n>>> $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg) { Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Warn([string]$msg) { Write-Host "    [WARN] $msg" -ForegroundColor Yellow }
function Write-Fail([string]$msg) { Write-Host "    [FAIL] $msg" -ForegroundColor Red; exit 1 }

# ─── 1. Docker ────────────────────────────────────────────────────────────────
Write-Step "Checking Docker"
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Fail "Docker CLI not found. Install Docker Engine and try again."
}
try { docker info | Out-Null } catch { Write-Fail "Docker daemon is not running." }
Write-Ok "Docker is running"

# ─── 2. External networks ─────────────────────────────────────────────────────
Write-Step "Creating external Docker networks"

$networks = @("placements_gateway", "ollama_default")
foreach ($net in $networks) {
    $exists = docker network ls --format "{{.Name}}" | Where-Object { $_ -eq $net }
    if ($exists) {
        Write-Ok "Network '$net' already exists — skipping"
    }
    else {
        docker network create $net | Out-Null
        Write-Ok "Created network '$net'"
    }
}

# ─── 3. Named DB volume ───────────────────────────────────────────────────────
Write-Step "Creating named database volume"

$volName = "contract_placements_prod_db"
$volExists = docker volume ls --format "{{.Name}}" | Where-Object { $_ -eq $volName }
if ($volExists) {
    Write-Ok "Volume '$volName' already exists — skipping"
}
else {
    docker volume create $volName | Out-Null
    Write-Ok "Created volume '$volName'"
}

# ─── 4. Required directories ──────────────────────────────────────────────────
Write-Step "Creating required directories"

$dirs = @("SSL/certs", "waf")
foreach ($d in $dirs) {
    if (-not (Test-Path $d)) {
        New-Item -ItemType Directory -Path $d -Force | Out-Null
        Write-Ok "Created $d/"
    }
    else {
        Write-Ok "$d/ already exists"
    }
}

# ─── 5. SSL certificate check ─────────────────────────────────────────────────
Write-Step "Checking SSL certificates"
$certFiles = @("SSL/certs/fullchain.pem", "SSL/certs/privkey.pem")
$missingCerts = $certFiles | Where-Object { -not (Test-Path $_) }
if ($missingCerts) {
    Write-Warn "Missing SSL certificate files:"
    $missingCerts | ForEach-Object { Write-Host "      $_" -ForegroundColor Yellow }
    Write-Host "    Copy your fullchain.pem and privkey.pem into SSL/certs/ before starting." -ForegroundColor Yellow
}
else {
    Write-Ok "SSL certificates present"
}

# ─── 6. WAF exclusion rules ───────────────────────────────────────────────────
Write-Step "Checking WAF config"
$wafRules = "waf/REQUEST-900-EXCLUSION-RULES-BEFORE-CRS.conf"
if (-not (Test-Path $wafRules)) {
    Write-Warn "Missing $wafRules — WAF will start with default rules only. Copy from old server."
}
else {
    Write-Ok "WAF exclusion rules present"
}

# ─── 7. .env.local check ──────────────────────────────────────────────────────
Write-Step "Checking .env.local"
if (-not (Test-Path ".env.local")) {
    Write-Fail ".env.local not found. Copy .env.example to .env.local and fill in all values."
}

$placeholders = Select-String -Path ".env.local" -Pattern "REPLACE_" -SimpleMatch
if ($placeholders) {
    Write-Warn ".env.local still contains placeholder values:"
    $placeholders | ForEach-Object { Write-Host "      Line $($_.LineNumber): $($_.Line.Trim())" -ForegroundColor Yellow }
    Write-Host "    Fill in all REPLACE_… values before starting." -ForegroundColor Yellow
}
else {
    Write-Ok ".env.local looks complete"
}

# ─── 8. Secrets directory ─────────────────────────────────────────────────────
Write-Step "Checking SMTP secrets"
$smtpSecret = ".secrets/smtp_pass.txt"
if (-not (Test-Path $smtpSecret)) {
    Write-Warn "$smtpSecret not found."
    Write-Host "    If using SMTP_PASS_FILE, create .secrets/smtp_pass.txt with the SMTP password." -ForegroundColor Yellow
    Write-Host "    Otherwise set SMTP_PASS directly in .env.local and leave SMTP_PASS_FILE empty." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path ".secrets" -Force | Out-Null
    Write-Ok "Created .secrets/ directory (add smtp_pass.txt if needed)"
}
else {
    Write-Ok "SMTP secret file present"
}

# ─── Summary ──────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Setup complete. Next steps:" -ForegroundColor Cyan
Write-Host ""
Write-Host "  1. Ensure Ollama is running on the 'ollama_default' network" -ForegroundColor White
Write-Host "     (or update LLMLITE_API_BASE / OPENAI_API_BASE in .env.local)" -ForegroundColor White
Write-Host ""
Write-Host "  2. If migrating data from an existing server, run:" -ForegroundColor White
Write-Host "     .\migrate-db.ps1 -Action restore -BackupFile <path\to\backup.tar.gz>" -ForegroundColor White
Write-Host ""
Write-Host "  3. Start the stack:" -ForegroundColor White
Write-Host "     docker compose -p contract_placements_prod -f docker-compose.yml up -d --build" -ForegroundColor White
Write-Host ""
Write-Host "  4. Apply database migrations:" -ForegroundColor White
Write-Host "     docker compose -p contract_placements_prod -f docker-compose.yml exec app npx prisma db push" -ForegroundColor White
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
