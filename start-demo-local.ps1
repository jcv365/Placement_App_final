param(
  [switch]$Rebuild
)

& "$PSScriptRoot\scripts\start-local-standalone.ps1" -Port 3000 -DatabaseUrl "file:./demo.db" -DistDir ".next-run-demo" -Rebuild:$Rebuild
