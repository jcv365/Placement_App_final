param(
  [Parameter(Mandatory = $true)]
  [int]$Port,

  [Parameter(Mandatory = $true)]
  [string]$DatabaseUrl,

  [string]$DistDir = ".next-run",

  [switch]$Rebuild
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Get-DotEnvValues {
  param([string]$DotEnvPath)

  $values = @{}
  if (-not (Test-Path $DotEnvPath)) {
    return $values
  }

  $lines = Get-Content $DotEnvPath
  foreach ($rawLine in $lines) {
    $line = $rawLine.Trim()
    if (-not $line -or $line.StartsWith("#")) {
      continue
    }

    $parts = $line -split "=", 2
    if ($parts.Length -ne 2) {
      continue
    }

    $key = $parts[0].Trim()
    $value = $parts[1].Trim()

    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    if ($key) {
      $values[$key] = $value
    }
  }

  return $values
}

function Stop-StandaloneOnPort {
  param([int]$TargetPort)

  $lines = netstat -ano | Select-String ":$TargetPort" | Select-String "LISTENING"
  if (-not $lines) {
    return
  }

  $pids = @()
  foreach ($line in $lines) {
    $processId = ($line.ToString().Trim() -split "\s+")[-1]
    if ($processId -match "^\d+$") {
      $pids += [int]$processId
    }
  }

  $pids = $pids | Select-Object -Unique
  foreach ($processId in $pids) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
    if ($null -eq $proc) {
      continue
    }

    $cmd = $proc.CommandLine
    if ($proc.Name -eq "node.exe" -and $cmd -match "standalone[/\\]server\.js") {
      Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
      Write-Host "Stopped existing standalone node process on port ${TargetPort}: PID $processId"
    }
  }
}

function Build-Standalone {
  param([string]$TargetDistDir)

  $env:NEXT_DIST_DIR = $TargetDistDir
  npm run build
  if ($LASTEXITCODE -ne 0) {
    throw "Build failed"
  }
}

function Sync-DatabaseSchema {
  param([string]$TargetDatabaseUrl)

  Write-Host "Syncing Prisma schema to $TargetDatabaseUrl ..."
  $originalDatabaseUrl = $env:DATABASE_URL

  try {
    $env:DATABASE_URL = $TargetDatabaseUrl
    npx prisma db push --skip-generate | Out-Host
    if ($LASTEXITCODE -ne 0) {
      throw "Prisma schema sync failed"
    }
  }
  finally {
    $env:DATABASE_URL = $originalDatabaseUrl
  }
}

function Test-StandaloneStale {
  param(
    [Parameter(Mandatory = $true)]
    [string]$TargetDistDir
  )

  $serverPath = Join-Path $TargetDistDir "standalone/server.js"
  if (-not (Test-Path $serverPath)) {
    return $true
  }

  $serverWriteUtc = (Get-Item $serverPath).LastWriteTimeUtc

  $watchFiles = @(
    "package.json",
    "next.config.ts",
    "tsconfig.json",
    "prisma/schema.prisma"
  )

  foreach ($file in $watchFiles) {
    if (-not (Test-Path $file)) {
      continue
    }

    $fileWriteUtc = (Get-Item $file).LastWriteTimeUtc
    if ($fileWriteUtc -gt $serverWriteUtc) {
      Write-Host "Detected newer file: $file"
      return $true
    }
  }

  $watchDirs = @("src", "public", "prisma/migrations")
  foreach ($dir in $watchDirs) {
    if (-not (Test-Path $dir)) {
      continue
    }

    $newer = Get-ChildItem -Path $dir -File -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTimeUtc -gt $serverWriteUtc } |
    Select-Object -First 1

    if ($newer) {
      Write-Host "Detected newer file: $($newer.FullName)"
      return $true
    }
  }

  return $false
}

function Sync-StandaloneAssets {
  param([string]$TargetDistDir)

  # Standalone server.js sets distDir to "./$TargetDistDir", relative to the standalone folder.
  # Static assets must therefore live under standalone/$TargetDistDir/static.
  $standaloneStatic = Join-Path $TargetDistDir ("standalone/{0}/static" -f $TargetDistDir)
  $buildStatic = Join-Path $TargetDistDir "static"
  $standalonePublic = Join-Path $TargetDistDir "standalone/public"

  # Remove legacy path used before distDir became configurable.
  $legacyStandaloneStatic = Join-Path $TargetDistDir "standalone/.next/static"
  if (Test-Path $legacyStandaloneStatic) {
    Remove-Item -Recurse -Force $legacyStandaloneStatic
  }

  if (Test-Path $standaloneStatic) {
    Remove-Item -Recurse -Force $standaloneStatic
  }
  New-Item -ItemType Directory -Force -Path $standaloneStatic | Out-Null

  if (Test-Path $buildStatic) {
    Copy-Item -Recurse -Force (Join-Path $buildStatic "*") $standaloneStatic
  }

  if (Test-Path "public") {
    if (Test-Path $standalonePublic) {
      Remove-Item -Recurse -Force $standalonePublic
    }
    Copy-Item -Recurse -Force "public" $standalonePublic
  }
}

$standaloneServer = Join-Path $DistDir "standalone/server.js"

# Stop the running standalone process first so Windows file locks do not block rebuild.
Stop-StandaloneOnPort -TargetPort $Port

if ($Rebuild -or (Test-StandaloneStale -TargetDistDir $DistDir)) {
  Write-Host "Building standalone bundle into $DistDir ..."
  Build-Standalone -TargetDistDir $DistDir
}

Sync-DatabaseSchema -TargetDatabaseUrl $DatabaseUrl

Write-Host "Syncing standalone assets ..."
Sync-StandaloneAssets -TargetDistDir $DistDir

$envMap = Get-DotEnvValues -DotEnvPath (Join-Path $root ".env.local")
$envMap["HOSTNAME"] = "localhost"
$envMap["PORT"] = "$Port"
$envMap["APP_BASE_URL"] = "http://localhost:$Port"
$envMap["DATABASE_URL"] = $DatabaseUrl

$proc = Start-Process -FilePath "node" -ArgumentList $standaloneServer -WorkingDirectory $root -PassThru -Environment $envMap
Write-Host "Started standalone server (PID $($proc.Id)) on http://localhost:$Port"
