param(
  [switch]$Rebuild,
  [int]$Port = 3001
)

& "$PSScriptRoot\scripts\start-local-standalone.ps1" -Port $Port -DatabaseUrl "file:./prod.db" -DistDir ".next-run-prod" -Rebuild:$Rebuild
