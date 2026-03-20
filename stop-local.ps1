$ErrorActionPreference = "Stop"

$targets = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq "node.exe" -and $_.CommandLine -match "standalone[/\\]server\.js"
}

if (-not $targets) {
  Write-Host "No standalone node servers found."
  exit 0
}

foreach ($target in $targets) {
  Stop-Process -Id $target.ProcessId -Force -ErrorAction SilentlyContinue
  Write-Host "Stopped PID $($target.ProcessId)"
}
