#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Backup or restore the Contract Placements SQLite database volume.

.DESCRIPTION
    backup  — Dumps the Docker volume to a .tar.gz file on the local machine.
    restore — Restores a .tar.gz backup into the Docker volume on the new server.

    The app container is stopped before backup/restore and restarted afterwards.

.PARAMETER Action
    'backup' or 'restore'

.PARAMETER BackupFile
    Path to the backup file.
    backup  — where to write the archive (default: ./backups/db-<timestamp>.tar.gz)
    restore — path to the archive to restore from (required)

.EXAMPLE
    # On old server — create a backup:
    .\migrate-db.ps1 -Action backup

    # On new server — restore it:
    .\migrate-db.ps1 -Action restore -BackupFile .\backups\db-2026-05-08T06-00-00.tar.gz
#>

param(
    [Parameter(Mandatory)]
    [ValidateSet("backup", "restore")]
    [string]$Action,

    [string]$BackupFile = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectName = "contract_placements_prod"
$ComposeFile = "docker-compose.yml"
$VolumeName = "contract_placements_prod_db"
$AppContainer = "contract_placements_prod-app-1"

function Write-Step([string]$msg) { Write-Host "`n>>> $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg) { Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Fail([string]$msg) { Write-Host "    [FAIL] $msg" -ForegroundColor Red; exit 1 }

# ─── Validate Docker ──────────────────────────────────────────────────────────
Write-Step "Checking Docker"
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Fail "Docker CLI not found."
}
try { docker info | Out-Null } catch { Write-Fail "Docker daemon is not running." }
Write-Ok "Docker ready"

# ─── BACKUP ───────────────────────────────────────────────────────────────────
if ($Action -eq "backup") {

    if (-not $BackupFile) {
        $timestamp = (Get-Date -Format "yyyy-MM-ddTHH-mm-ss")
        $BackupFile = "backups/db-$timestamp.tar.gz"
    }

    $backupDir = Split-Path $BackupFile -Parent
    if ($backupDir -and -not (Test-Path $backupDir)) {
        New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    }

    Write-Step "Stopping app container"
    docker compose -p $ProjectName -f $ComposeFile stop app
    Write-Ok "App stopped"

    Write-Step "Dumping volume '$VolumeName' → $BackupFile"
    # Spin up a throw-away alpine container that mounts the volume and tars it to stdout
    docker run --rm `
        -v "${VolumeName}:/data:ro" `
        alpine `
        tar -czf - -C /data . | Set-Content -Path $BackupFile -AsByteStream
    Write-Ok "Backup written: $BackupFile"

    Write-Step "Restarting app container"
    docker compose -p $ProjectName -f $ComposeFile start app
    Write-Ok "App restarted"

    Write-Host ""
    Write-Host "  Backup complete: $((Get-Item $BackupFile).FullName)" -ForegroundColor Green
    Write-Host "  Copy this file to the new server, then run:" -ForegroundColor White
    Write-Host "  .\migrate-db.ps1 -Action restore -BackupFile <path>" -ForegroundColor White
}

# ─── RESTORE ──────────────────────────────────────────────────────────────────
if ($Action -eq "restore") {

    if (-not $BackupFile) { Write-Fail "-BackupFile is required for restore." }
    if (-not (Test-Path $BackupFile)) { Write-Fail "Backup file not found: $BackupFile" }

    # Ensure the volume exists
    $volExists = docker volume ls --format "{{.Name}}" | Where-Object { $_ -eq $VolumeName }
    if (-not $volExists) {
        Write-Step "Creating volume '$VolumeName'"
        docker volume create $VolumeName | Out-Null
        Write-Ok "Volume created"
    }

    # Stop app if running
    Write-Step "Stopping app container (if running)"
    $running = docker ps --format "{{.Names}}" | Where-Object { $_ -eq $AppContainer }
    if ($running) {
        docker compose -p $ProjectName -f $ComposeFile stop app
        Write-Ok "App stopped"
    }
    else {
        Write-Ok "App not running — nothing to stop"
    }

    Write-Step "Restoring '$BackupFile' → volume '$VolumeName'"
    Get-Content $BackupFile -AsByteStream -Raw | docker run --rm -i `
        -v "${VolumeName}:/data" `
        alpine `
        sh -c "cd /data && tar -xzf -"
    Write-Ok "Restore complete"

    Write-Host ""
    Write-Host "  Database restored. Start the stack with:" -ForegroundColor Green
    Write-Host "  docker compose -p $ProjectName -f $ComposeFile up -d" -ForegroundColor White
    Write-Host ""
    Write-Host "  Then apply any pending migrations:" -ForegroundColor White
    Write-Host "  docker compose -p $ProjectName -f $ComposeFile exec app npx prisma db push" -ForegroundColor White
}
