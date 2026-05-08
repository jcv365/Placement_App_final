<#
.SYNOPSIS
  Hourly wrapper for the inbox reply agent. Designed to be run via Windows Task Scheduler.

.DESCRIPTION
  Runs processInboxReplies.cjs --apply and processNdaReplies.cjs --apply against the
  shared Outlook mailbox, writes timestamped log output to logs/inbox-agent-*.log,
  and prunes logs older than 7 days.

.EXAMPLE
  # Run manually:
  powershell -ExecutionPolicy Bypass -File scripts\run-inbox-agent.ps1

  # Register scheduled task (requires admin):
  schtasks /Create /XML scripts\inbox-agent-task.xml /TN "\ContractPlacements\InboxReplyAgent" /F
#>

$ErrorActionPreference = "Stop"

# Resolve repo root (parent of the scripts/ folder)
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# Ensure logs directory exists
$logDir = Join-Path $root "logs"
if (-not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir | Out-Null
}

$stamp = Get-Date -Format "yyyy-MM-dd_HH-mm"
$logFile = Join-Path $logDir "inbox-agent-$stamp.log"

"[$stamp] ======================================" | Tee-Object -FilePath $logFile
"[$stamp] Inbox Reply Agent - starting"            | Tee-Object -Append -FilePath $logFile
"[$stamp] ======================================"  | Tee-Object -Append -FilePath $logFile

# Run general inbox replies (rates, availability, opportunity intent)
node scripts/processInboxReplies.cjs --apply 2>&1 | Tee-Object -Append -FilePath $logFile

$exitCode = $LASTEXITCODE
"" | Tee-Object -Append -FilePath $logFile

# Run NDA & teaming agreement reply processor
"[$stamp] --- NDA / Teaming Agreement replies ---" | Tee-Object -Append -FilePath $logFile
node scripts/processNdaReplies.cjs --apply 2>&1 | Tee-Object -Append -FilePath $logFile

$ndaExitCode = $LASTEXITCODE
if ($ndaExitCode -ne 0) { $exitCode = $ndaExitCode }
"" | Tee-Object -Append -FilePath $logFile
"[$stamp] Finished with exit code $exitCode." | Tee-Object -Append -FilePath $logFile

# Prune log files older than 7 days
Get-ChildItem $logDir -Filter "inbox-agent-*.log" |
Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } |
Remove-Item -Force

exit $exitCode
