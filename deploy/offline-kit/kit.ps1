#Requires -Version 5.1
<#
.SYNOPSIS
    ProjectAchilles offline kit loader (Windows).

.DESCRIPTION
    Checks the kit files, loads the images for this machine into Docker
    Desktop and unpacks the source to <Dest>\ProjectAchilles. Nothing is
    downloaded. Run it from the kit folder:

      powershell -ExecutionPolicy Bypass -File .\kit.ps1

.PARAMETER Dest
    Folder to unpack ProjectAchilles into. Default: your home folder.
#>
[CmdletBinding()]
param(
    [string]$Dest = $HOME
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Say([string]$Text) { Write-Host ""; Write-Host "==> $Text" -ForegroundColor Cyan }
function Die([string]$Text) { Write-Host ""; Write-Host "ERROR: $Text" -ForegroundColor Red; exit 1 }

$Kit = $PSScriptRoot

# Runs a native command with its output discarded and returns its exit code.
# Windows PowerShell 5.1 turns a native command's redirected stderr into
# errors, which 'Stop' makes fatal, so the preference is relaxed around it.
function Test-Native([string]$Exe, [string[]]$Arguments) {
    $saved = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $Exe @Arguments *> $null; return $LASTEXITCODE }
    catch [System.Management.Automation.CommandNotFoundException] { return 127 }
    finally { $ErrorActionPreference = $saved }
}

if ((Test-Native docker @('info')) -ne 0) { Die "Docker is not running. Start Docker Desktop and run this again." }

$dockerArch = (& docker info --format '{{.Architecture}}').Trim()
switch -Regex ($dockerArch) {
    '^(x86_64|amd64)$' { $Arch = 'amd64' }
    '^(aarch64|arm64)$' { $Arch = 'arm64' }
    default { Die "unsupported architecture: $dockerArch" }
}
Say "Docker architecture: $Arch"

Say "Checking the kit files"
$wanted = @()
foreach ($line in Get-Content (Join-Path $Kit 'SHA256SUMS')) {
    if ($line -notmatch '^([0-9a-f]{64}) [ *](.+)$') { continue }
    $hash = $Matches[1]; $rel = $Matches[2]
    if ($rel -like "images/$Arch/*" -or $rel -eq 'images/lab-endpoint.tar' -or $rel -eq 'ProjectAchilles.tar.gz') {
        $wanted += $rel
        $path = Join-Path $Kit ($rel -replace '/', '\')
        if (-not (Test-Path -LiteralPath $path)) { Die "missing kit file: $rel. Copy the kit again." }
        $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()
        if ($actual -ne $hash) { Die "damaged kit file: $rel. Copy the kit again." }
    }
}
if ($wanted.Count -eq 0) { Die "SHA256SUMS lists no files for $Arch." }

Say "Loading the images (a few minutes)"
$tars = @(Get-ChildItem -LiteralPath (Join-Path $Kit "images\$Arch") -Filter '*.tar' | ForEach-Object { $_.FullName })
$tars += (Join-Path $Kit 'images\lab-endpoint.tar')
foreach ($tar in $tars) {
    Write-Host "  $(Split-Path -Leaf $tar)"
    & docker load -q -i $tar | Out-Null
    if ($LASTEXITCODE -ne 0) { Die "docker load failed for $tar" }
}
foreach ($img in Get-Content (Join-Path $Kit 'images\IMAGES')) {
    if (-not $img.Trim()) { continue }
    if ((Test-Native docker @('image', 'inspect', $img)) -ne 0) { Die "image $img is missing after loading" }
}

$target = Join-Path $Dest 'ProjectAchilles'
if (Test-Path -LiteralPath $target) {
    $commit = (Get-Content (Join-Path $Kit 'images\COMMIT') -Raw).Trim()
    Say "$target already exists, leaving it as it is"
    Write-Host "  The images were built from commit $commit. Compose uses them"
    Write-Host "  whatever version that folder holds; to match exactly, rename it and run this again."
}
else {
    Say "Unpacking the source to $target"
    if (-not (Get-Command tar.exe -ErrorAction SilentlyContinue)) { Die "tar.exe not found (it ships with Windows 10 1803 and later)." }
    New-Item -ItemType Directory -Force -Path $Dest | Out-Null
    # Windows' tar.exe keeps the files byte for byte: shell scripts stay LF.
    & tar.exe -xzf (Join-Path $Kit 'ProjectAchilles.tar.gz') -C $Dest
    if ($LASTEXITCODE -ne 0) { Die "unpacking failed" }
}

# Docker copies the preloaded test library and Go caches into these volumes
# only when they are new; volumes left by an earlier install keep their old
# content, and test builds would then need the network.
$oldVols = @('projectachilles_repo-cache', 'projectachilles_go-cache') | Where-Object { (Test-Native docker @('volume', 'inspect', $_)) -eq 0 }
if ($oldVols) {
    Say "WARNING: volumes from an earlier install exist: $($oldVols -join ' ')"
    Write-Host "  They keep their old content, so the kit's test library and Go modules are not used."
    Write-Host "  To use the kit's, stop that install and remove them: docker volume rm $($oldVols -join ' ')"
}

Write-Host ""
Write-Host "Done. Next:"
Write-Host "  cd `"$target`""
Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\Install-ProjectAchilles.ps1 -NoBuild"
Write-Host "  docker compose --profile elasticsearch -f docker-compose.yml -f docker-compose.lab.yml up -d"
