param(
    [ValidateSet("dev", "prod")]
    [string]$Mode = "dev"
)

$composeFile = if ($Mode -eq "prod") { "docker-compose.yml" } else { "docker-compose.dev.yml" }
$projectName = if ($Mode -eq "prod") { "contract_placements_prod" } else { "contract_placements_demo" }
$dockerCmd = if (Get-Command docker -ErrorAction SilentlyContinue) {
    "docker"
}
elseif (Test-Path "C:\Program Files\Docker\Docker\resources\bin\docker.exe") {
    "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
}
else {
    $null
}

$composeVersion = ""
$composeCmd = if (Get-Command docker-compose -ErrorAction SilentlyContinue) {
    $composeVersion = "v1"
    "docker-compose"
}
elseif ($dockerCmd) {
    # Prefer Docker Compose v2 via `docker compose` when docker-compose is unavailable.
    $composeVersion = "v2"
    $dockerCmd
}
else {
    $null
}

Write-Host "Starting containers using $composeFile..."

# Ensure Docker is running
try {
    if (-not $dockerCmd) {
        throw "Docker CLI not found"
    }

    & $dockerCmd info | Out-Null
}
catch {
    Write-Error "Docker does not appear to be running. Please start Docker Desktop and try again."
    exit 1
}

if (-not $composeCmd) {
    Write-Error "Docker Compose is not available. Install Docker Compose and try again."
    exit 1
}

# Start containers
if ($composeVersion -eq "v2") {
    & $composeCmd compose -p $projectName -f $composeFile up -d
}
else {
    & $composeCmd -p $projectName -f $composeFile up -d
}
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to start containers."
    exit 1
}

# Initialise database if needed
Write-Host "Ensuring database schema is up to date..."
if ($composeVersion -eq "v2") {
    & $composeCmd compose -p $projectName -f $composeFile exec app npx prisma db push
}
else {
    & $composeCmd -p $projectName -f $composeFile exec app npx prisma db push
}
if ($LASTEXITCODE -ne 0) {
    Write-Warning "Database schema sync failed. You can rerun: docker compose -p $projectName -f $composeFile exec app npx prisma db push"
}

Write-Host "Seeding demo data (safe to re-run)..."
if ($composeVersion -eq "v2") {
    & $composeCmd compose -p $projectName -f $composeFile exec app npm run seed
}
else {
    & $composeCmd -p $projectName -f $composeFile exec app npm run seed
}

$appUrl = if ($Mode -eq "prod") { "http://localhost:3001" } else { "http://localhost:3000" }
Write-Host "Done. App should be available at $appUrl"
