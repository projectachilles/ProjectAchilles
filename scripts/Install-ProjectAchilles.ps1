#Requires -Version 5.1
<#
.SYNOPSIS
    ProjectAchilles -- Windows Bootstrap Script

.DESCRIPTION
    Automates the Docker-based setup of ProjectAchilles on Windows.
    Checks prerequisites, configures backend/.env, fixes line endings,
    builds Docker images, waits for health, and opens the dashboard.

    Mirrors the behavior of setup.sh for Linux/macOS but is native
    PowerShell 5.1+ for Windows.

.PARAMETER Quick
    Minimal prompts -- only asks for Clerk keys (if not pre-provided),
    auto-generates secrets, skips Elasticsearch/GitHub config.

.PARAMETER ClerkPublishableKey
    Pre-provide the Clerk publishable key (skips prompt).

.PARAMETER ClerkSecretKey
    Pre-provide the Clerk secret key (skips prompt).

.PARAMETER WithElasticsearch
    Enable local Docker Elasticsearch without prompting.

.PARAMETER Force
    Overwrite existing backend/.env without asking.

.PARAMETER NoOpen
    Don't open the browser when setup completes.

.EXAMPLE
    .\scripts\Install-ProjectAchilles.ps1

.EXAMPLE
    .\scripts\Install-ProjectAchilles.ps1 -Quick -ClerkPublishableKey pk_test_xxx -ClerkSecretKey sk_test_xxx
#>

[CmdletBinding()]
param(
    [switch]$Quick,
    [string]$ClerkPublishableKey,
    [string]$ClerkSecretKey,
    [switch]$WithElasticsearch,
    [switch]$Force,
    [switch]$NoOpen
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# -----------------------------------------------------------------------------
# Constants
# -----------------------------------------------------------------------------

$TOTAL_STEPS = 10
$REPO_URL    = 'https://github.com/your-org/ProjectAchilles.git'

# -----------------------------------------------------------------------------
# Helper Functions
# -----------------------------------------------------------------------------

function Write-Banner {
    $banner = @"

    ____            _           __     ___       __    _ ____
   / __ \_________(_)__  _____/ /_   /   | ____/ /_  (_) / /__  _____
  / /_/ / ___/ __ \/ / _ \/ ___/ __/  / /| |/ ___/ __ \/ / / / _ \/ ___/
 / ____/ /  / /_/ / /  __/ /__/ /_   / ___ / /__/ / / / / / /  __(__  )
/_/   /_/   \____/ /\___/\___/\__/  /_/  |_\___/_/ /_/_/_/_/\___/____/
                /___/

"@
    Write-Host $banner -ForegroundColor Magenta
    Write-Host "  Windows Bootstrap Script" -ForegroundColor DarkGray
    Write-Host "  --------------------------------------------------------" -ForegroundColor DarkGray
    Write-Host ""
}

function Write-Step {
    param([int]$Number, [string]$Text)
    Write-Host "  [$Number/$TOTAL_STEPS] " -ForegroundColor Cyan -NoNewline
    Write-Host $Text
}

function Write-Success {
    param([string]$Text)
    Write-Host "         [OK] " -ForegroundColor Green -NoNewline
    Write-Host $Text
}

function Write-Warning {
    param([string]$Text)
    Write-Host "         [!!] " -ForegroundColor Yellow -NoNewline
    Write-Host $Text
}

function Write-Failure {
    param([string]$Text)
    Write-Host "       [FAIL] " -ForegroundColor Red -NoNewline
    Write-Host $Text
}

function Write-Info {
    param([string]$Text)
    Write-Host "         $Text" -ForegroundColor DarkGray
}

function Test-PortAvailable {
    param([int]$Port)
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $tcp.Connect('127.0.0.1', $Port)
        $tcp.Close()
        return $false  # port is in use
    }
    catch {
        return $true   # port is available
    }
}

function Get-PortProcess {
    param([int]$Port)
    try {
        $conn = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
                Where-Object { $_.State -eq 'Listen' } |
                Select-Object -First 1
        if ($conn) {
            $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
            if ($proc) {
                return "$($proc.ProcessName) (PID $($proc.Id))"
            }
        }
    }
    catch {}
    return $null
}

function Wait-ForDocker {
    param([int]$TimeoutSeconds = 120)
    $elapsed = 0
    $spinChars = @('|', '/', '-', '\')
    $i = 0
    while ($elapsed -lt $TimeoutSeconds) {
        try {
            $null = & docker info 2>&1
            if ($LASTEXITCODE -eq 0) { return $true }
        }
        catch {}
        $char = $spinChars[$i % 4]
        Write-Host "`r         [$char] Waiting for Docker daemon... (${elapsed}s)" -NoNewline -ForegroundColor Yellow
        Start-Sleep -Seconds 5
        $elapsed += 5
        $i++
    }
    Write-Host ""
    return $false
}

function New-CryptoSecret {
    param([int]$Bytes = 32)
    $buf = New-Object byte[] $Bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($buf)
    $rng.Dispose()
    return [Convert]::ToBase64String($buf)
}

function Read-SecurePrompt {
    param([string]$Prompt)
    $secure = Read-Host -Prompt $Prompt -AsSecureString
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    }
    finally {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

function Read-MenuChoice {
    param(
        [string]$Title,
        [string[]]$Options,
        [int]$Default = 1
    )
    Write-Host ""
    Write-Host "  $Title" -ForegroundColor Cyan
    for ($i = 0; $i -lt $Options.Count; $i++) {
        $marker = ''
        if (($i + 1) -eq $Default) { $marker = ' (default)' }
        Write-Host "    $($i + 1)) $($Options[$i])$marker"
    }
    do {
        $raw = Read-Host "  Choice [$Default]"
        if ([string]::IsNullOrWhiteSpace($raw)) { return $Default }
        $val = 0
        if ([int]::TryParse($raw, [ref]$val) -and $val -ge 1 -and $val -le $Options.Count) {
            return $val
        }
        Write-Host "  Please enter a number between 1 and $($Options.Count)." -ForegroundColor Yellow
    } while ($true)
}

# -----------------------------------------------------------------------------
# .env File Helpers
# -----------------------------------------------------------------------------

function Read-EnvFile {
    param([string]$Path)
    $result = @{}
    if (-not (Test-Path $Path)) { return $result }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $lines = [System.IO.File]::ReadAllLines($Path, $utf8NoBom)
    foreach ($line in $lines) {
        if ($line -match '^\s*#') { continue }
        if ($line -match '^\s*$') { continue }
        $eqIdx = $line.IndexOf('=')
        if ($eqIdx -gt 0) {
            $key = $line.Substring(0, $eqIdx).Trim()
            $val = $line.Substring($eqIdx + 1).Trim()
            $result[$key] = $val
        }
    }
    return $result
}

function Set-EnvValue {
    param([string]$Path, [string]$Key, [string]$Value)
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    if (-not (Test-Path $Path)) {
        [System.IO.File]::WriteAllText($Path, "$Key=$Value`n", $utf8NoBom)
        return
    }
    $content = [System.IO.File]::ReadAllText($Path, $utf8NoBom)
    $lines = $content -split "`n"
    $found = $false
    $newLines = @()
    foreach ($line in $lines) {
        if ($line -match "^#?\s*$([regex]::Escape($Key))=") {
            $newLines += "$Key=$Value"
            $found = $true
        }
        else {
            $newLines += $line
        }
    }
    if (-not $found) {
        $newLines += "$Key=$Value"
    }
    $output = ($newLines -join "`n")
    # Ensure trailing newline
    if (-not $output.EndsWith("`n")) { $output += "`n" }
    [System.IO.File]::WriteAllText($Path, $output, $utf8NoBom)
}

function Remove-EnvValue {
    param([string]$Path, [string]$Key)
    if (-not (Test-Path $Path)) { return }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $content = [System.IO.File]::ReadAllText($Path, $utf8NoBom)
    $lines = $content -split "`n"
    $newLines = @()
    foreach ($line in $lines) {
        if ($line -match "^$([regex]::Escape($Key))=") {
            $newLines += "# $line"
        }
        else {
            $newLines += $line
        }
    }
    $output = ($newLines -join "`n")
    if (-not $output.EndsWith("`n")) { $output += "`n" }
    [System.IO.File]::WriteAllText($Path, $output, $utf8NoBom)
}

function Repair-LineEndings {
    param([string]$FilePath)
    if (-not (Test-Path $FilePath)) { return $false }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $bytes = [System.IO.File]::ReadAllBytes($FilePath)
    $hasCRLF = $false
    for ($i = 0; $i -lt $bytes.Length - 1; $i++) {
        if ($bytes[$i] -eq 0x0D -and $bytes[$i + 1] -eq 0x0A) {
            $hasCRLF = $true
            break
        }
    }
    if ($hasCRLF) {
        $text = [System.IO.File]::ReadAllText($FilePath, $utf8NoBom)
        $fixed = $text.Replace("`r`n", "`n")
        [System.IO.File]::WriteAllText($FilePath, $fixed, $utf8NoBom)
        return $true
    }
    return $false
}

function Wait-ForHealthy {
    param(
        [string]$Url,
        [string]$Label,
        [int]$TimeoutSeconds = 180,
        [int]$IntervalSeconds = 3
    )
    $elapsed = 0
    $spinChars = @('|', '/', '-', '\')
    $i = 0
    while ($elapsed -lt $TimeoutSeconds) {
        try {
            $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5 -ErrorAction SilentlyContinue
            if ($resp.StatusCode -eq 200) {
                Write-Host "`r         [OK] $Label is healthy (${elapsed}s)              " -ForegroundColor Green
                return $true
            }
        }
        catch {}
        $char = $spinChars[$i % 4]
        Write-Host "`r         [$char] Waiting for $Label... (${elapsed}s)     " -NoNewline -ForegroundColor Yellow
        Start-Sleep -Seconds $IntervalSeconds
        $elapsed += $IntervalSeconds
        $i++
    }
    Write-Host ""
    return $false
}

function Get-MaskedKey {
    param([string]$Key, [int]$ShowChars = 8)
    if ([string]::IsNullOrEmpty($Key)) { return '(not set)' }
    if ($Key.Length -le $ShowChars) { return ($Key[0]) + ('*' * ($Key.Length - 1)) }
    return $Key.Substring(0, $ShowChars) + ('*' * ($Key.Length - $ShowChars))
}

# -----------------------------------------------------------------------------
# Phase 1 -- Banner
# -----------------------------------------------------------------------------

function Invoke-PhaseBanner {
    Clear-Host
    Write-Banner
    $psVer = $PSVersionTable.PSVersion
    Write-Step 1 "Checking PowerShell version..."
    if ($psVer.Major -lt 5 -or ($psVer.Major -eq 5 -and $psVer.Minor -lt 1)) {
        Write-Failure "PowerShell $($psVer) detected. Version 5.1 or higher is required."
        Write-Info "Update via: https://aka.ms/powershell"
        exit 1
    }
    Write-Success "PowerShell $psVer"
    Write-Host ""
}

# -----------------------------------------------------------------------------
# Phase 2 -- Prerequisite Checks
# -----------------------------------------------------------------------------

function Invoke-PhasePrereqs {
    Write-Step 2 "Checking prerequisites..."

    # Git
    try {
        $gitVer = & git --version 2>&1
        if ($LASTEXITCODE -ne 0) { throw 'git failed' }
        Write-Success "Git: $gitVer"
    }
    catch {
        Write-Failure "Git is not installed."
        Write-Info "Download from: https://git-scm.com/download/win"
        exit 1
    }

    # Docker
    try {
        $dockerVer = & docker --version 2>&1
        if ($LASTEXITCODE -ne 0) { throw 'docker failed' }
        Write-Success "Docker: $dockerVer"
    }
    catch {
        Write-Failure "Docker is not installed."
        Write-Info "Download from: https://www.docker.com/products/docker-desktop/"
        exit 1
    }

    # Docker Compose V2
    $script:ComposeCmd = 'docker compose'
    try {
        $composeVer = & docker compose version 2>&1
        if ($LASTEXITCODE -ne 0) { throw 'compose v2 failed' }
        Write-Success "Docker Compose: $composeVer"
    }
    catch {
        try {
            $composeVer = & docker-compose --version 2>&1
            if ($LASTEXITCODE -ne 0) { throw 'compose v1 failed' }
            $script:ComposeCmd = 'docker-compose'
            Write-Warning "Using legacy docker-compose. Consider upgrading to Docker Compose V2."
            Write-Success "docker-compose: $composeVer"
        }
        catch {
            Write-Failure "Docker Compose is not available."
            Write-Info "Install Docker Desktop (includes Compose V2)."
            exit 1
        }
    }

    # Docker daemon running
    try {
        $null = & docker info 2>&1
        if ($LASTEXITCODE -ne 0) { throw 'daemon not running' }
        Write-Success "Docker daemon is running"
    }
    catch {
        Write-Warning "Docker daemon is not running."
        Write-Info "Start Docker Desktop, then press Enter to continue (or Ctrl+C to abort)."
        Read-Host "  Press Enter when Docker Desktop is running"
        $ok = Wait-ForDocker -TimeoutSeconds 120
        if (-not $ok) {
            Write-Failure "Docker daemon did not start within 120 seconds."
            exit 1
        }
        Write-Host ""
        Write-Success "Docker daemon is running"
    }

    # Port checks
    foreach ($portInfo in @(@(80, 'Frontend'), @(3000, 'Backend API'))) {
        $port = $portInfo[0]
        $label = $portInfo[1]
        if (Test-PortAvailable -Port $port) {
            Write-Success "Port $port ($label) is available"
        }
        else {
            $proc = Get-PortProcess -Port $port
            if ($proc) {
                Write-Warning "Port $port ($label) is in use by $proc"
            }
            else {
                Write-Warning "Port $port ($label) is in use"
            }
            Write-Info "Docker may fail to bind. Stop the conflicting service or edit docker-compose.yml."
        }
    }

    Write-Host ""
}

# -----------------------------------------------------------------------------
# Phase 3 -- Repository Detection
# -----------------------------------------------------------------------------

function Invoke-PhaseRepoDetection {
    Write-Step 3 "Locating project repository..."

    if (Test-Path (Join-Path $PWD 'docker-compose.yml')) {
        Write-Success "Already inside ProjectAchilles repository"
        $script:ProjectRoot = $PWD.Path
    }
    else {
        $defaultPath = Join-Path $HOME 'ProjectAchilles'
        Write-Host ""
        $clonePath = Read-Host "  Clone location [$defaultPath]"
        if ([string]::IsNullOrWhiteSpace($clonePath)) { $clonePath = $defaultPath }

        if (Test-Path (Join-Path $clonePath 'docker-compose.yml')) {
            Write-Success "Found existing clone at $clonePath"
            $script:ProjectRoot = $clonePath
        }
        else {
            Write-Info "Cloning repository..."
            & git clone $REPO_URL $clonePath
            if ($LASTEXITCODE -ne 0) {
                Write-Failure "git clone failed."
                exit 1
            }
            Write-Success "Cloned to $clonePath"
            $script:ProjectRoot = $clonePath
        }
    }

    Write-Host ""
}

# -----------------------------------------------------------------------------
# Phase 4 -- Line Ending Safety
# -----------------------------------------------------------------------------

function Invoke-PhaseLineEndings {
    Write-Step 4 "Checking line endings in shell scripts..."

    $shellFiles = @()
    # Collect all .sh files in the project root (non-recursive for top-level)
    $shellFiles += Get-ChildItem -Path $script:ProjectRoot -Filter '*.sh' -ErrorAction SilentlyContinue
    # Also check the critical entrypoint
    $entrypoint = Join-Path $script:ProjectRoot 'frontend' 'docker-entrypoint.sh'
    if ((Test-Path $entrypoint) -and ($shellFiles.FullName -notcontains $entrypoint)) {
        $shellFiles += Get-Item $entrypoint
    }

    $fixedCount = 0
    foreach ($file in $shellFiles) {
        $wasFixed = Repair-LineEndings -FilePath $file.FullName
        if ($wasFixed) {
            Write-Warning "Fixed CRLF in: $($file.Name)"
            $fixedCount++
        }
    }

    if ($fixedCount -eq 0) {
        Write-Success "All shell scripts have correct LF line endings"
    }
    else {
        Write-Success "Fixed $fixedCount file(s) -- CRLF converted to LF"
    }

    Write-Host ""
}

# -----------------------------------------------------------------------------
# Phase 5 -- Existing Config Detection
# -----------------------------------------------------------------------------

function Invoke-PhaseConfigDetection {
    Write-Step 5 "Checking existing configuration..."

    $script:EnvFile = Join-Path $script:ProjectRoot 'backend' '.env'
    $script:EnvExample = Join-Path $script:ProjectRoot 'backend' '.env.example'
    $script:ConfigAction = 'fresh'  # fresh | keep | reconfigure

    if (Test-Path $script:EnvFile) {
        $existing = Read-EnvFile -Path $script:EnvFile
        $clerkPub = if ($existing.ContainsKey('CLERK_PUBLISHABLE_KEY')) { $existing['CLERK_PUBLISHABLE_KEY'] } else { '(not set)' }
        $nodeEnv  = if ($existing.ContainsKey('NODE_ENV')) { $existing['NODE_ENV'] } else { '(not set)' }
        $corsOrig = if ($existing.ContainsKey('CORS_ORIGIN')) { $existing['CORS_ORIGIN'] } else { '(not set)' }

        Write-Success "Found existing backend/.env"
        Write-Info "Clerk key: $(Get-MaskedKey $clerkPub)"
        Write-Info "NODE_ENV:  $nodeEnv"
        Write-Info "CORS:      $corsOrig"

        if ($Force) {
            $script:ConfigAction = 'fresh'
            Write-Info "-Force specified: starting fresh config"
        }
        else {
            $choice = Read-MenuChoice -Title "Existing configuration found:" -Options @(
                'Keep existing config (skip to build)',
                'Reconfigure (use current values as defaults)',
                'Fresh start (backup and reconfigure)'
            ) -Default 1
            switch ($choice) {
                1 { $script:ConfigAction = 'keep' }
                2 { $script:ConfigAction = 'reconfigure' }
                3 { $script:ConfigAction = 'fresh' }
            }
        }

        if ($script:ConfigAction -eq 'fresh') {
            $backup = "$($script:EnvFile).backup.$(Get-Date -Format 'yyyyMMdd_HHmmss')"
            Copy-Item $script:EnvFile $backup
            Write-Info "Backed up to: $backup"
        }
    }
    else {
        Write-Info "No existing backend/.env found -- will create from template"
    }

    Write-Host ""
}

# -----------------------------------------------------------------------------
# Phase 6 -- Interactive Configuration
# -----------------------------------------------------------------------------

function Invoke-PhaseConfiguration {
    Write-Step 6 "Configuring environment..."

    if ($script:ConfigAction -eq 'keep') {
        Write-Success "Keeping existing configuration"
        Write-Host ""
        return
    }

    # Load existing values as defaults if reconfiguring
    $defaults = @{}
    if ($script:ConfigAction -eq 'reconfigure' -and (Test-Path $script:EnvFile)) {
        $defaults = Read-EnvFile -Path $script:EnvFile
    }

    # -- Clerk Keys --
    if (-not [string]::IsNullOrEmpty($ClerkPublishableKey)) {
        $script:ClerkPub = $ClerkPublishableKey
    }
    elseif ($defaults.ContainsKey('CLERK_PUBLISHABLE_KEY') -and $defaults['CLERK_PUBLISHABLE_KEY'] -like 'pk_*') {
        $existing = $defaults['CLERK_PUBLISHABLE_KEY']
        $input = Read-Host "  Clerk Publishable Key [$existing]"
        $script:ClerkPub = if ([string]::IsNullOrWhiteSpace($input)) { $existing } else { $input }
    }
    else {
        do {
            $script:ClerkPub = Read-Host "  Clerk Publishable Key (starts with pk_)"
            if ($script:ClerkPub -notlike 'pk_*') {
                Write-Warning "Key should start with 'pk_'. Try again or press Enter to accept anyway."
                $accept = Read-Host "  Use '$($script:ClerkPub)' anyway? [y/N]"
                if ($accept -match '^[Yy]') { break }
            }
        } while ($script:ClerkPub -notlike 'pk_*')
    }

    if (-not [string]::IsNullOrEmpty($ClerkSecretKey)) {
        $script:ClerkSec = $ClerkSecretKey
    }
    else {
        do {
            $script:ClerkSec = Read-SecurePrompt -Prompt "  Clerk Secret Key (starts with sk_, input hidden)"
            if ($script:ClerkSec -notlike 'sk_*') {
                Write-Warning "Key should start with 'sk_'. Try again or press Enter to accept anyway."
                $accept = Read-Host "  Use this value anyway? [y/N]"
                if ($accept -match '^[Yy]') { break }
            }
        } while ($script:ClerkSec -notlike 'sk_*')
    }

    Write-Success "Clerk keys configured"

    # -- Elasticsearch --
    $script:EsMode = 'skip'
    if ($WithElasticsearch) {
        $script:EsMode = 'local'
    }
    elseif (-not $Quick) {
        $esChoice = Read-MenuChoice -Title "Elasticsearch (Analytics):" -Options @(
            'Local Docker instance (~2 GB RAM)',
            'Elastic Cloud (Cloud ID + API Key)',
            'Self-hosted instance (URL)',
            'Skip -- configure later'
        ) -Default 4
        switch ($esChoice) {
            1 { $script:EsMode = 'local' }
            2 { $script:EsMode = 'cloud' }
            3 { $script:EsMode = 'self-hosted' }
            4 { $script:EsMode = 'skip' }
        }
    }

    $script:EsNode     = ''
    $script:EsCloudId  = ''
    $script:EsApiKey   = ''
    $script:EsUsername  = ''
    $script:EsPassword = ''
    $script:EsIndex    = 'achilles-results-*'

    switch ($script:EsMode) {
        'local' {
            $script:EsNode  = 'http://elasticsearch:9200'
            $script:EsIndex = 'achilles-results-*'
            Write-Success "Elasticsearch: local Docker"
        }
        'cloud' {
            $defaultCloudId = if ($defaults.ContainsKey('ELASTICSEARCH_CLOUD_ID')) { $defaults['ELASTICSEARCH_CLOUD_ID'] } else { '' }
            $script:EsCloudId = Read-Host "  Elastic Cloud ID [$defaultCloudId]"
            if ([string]::IsNullOrWhiteSpace($script:EsCloudId)) { $script:EsCloudId = $defaultCloudId }
            $script:EsApiKey = Read-SecurePrompt -Prompt "  Elasticsearch API Key (input hidden)"
            $defaultIdx = if ($defaults.ContainsKey('ELASTICSEARCH_INDEX_PATTERN')) { $defaults['ELASTICSEARCH_INDEX_PATTERN'] } else { 'achilles-results-*' }
            $idxInput = Read-Host "  Index pattern [$defaultIdx]"
            if (-not [string]::IsNullOrWhiteSpace($idxInput)) { $script:EsIndex = $idxInput } else { $script:EsIndex = $defaultIdx }
            Write-Success "Elasticsearch: Elastic Cloud"
        }
        'self-hosted' {
            $defaultNode = if ($defaults.ContainsKey('ELASTICSEARCH_NODE')) { $defaults['ELASTICSEARCH_NODE'] } else { 'https://localhost:9200' }
            $nodeInput = Read-Host "  Elasticsearch URL [$defaultNode]"
            $script:EsNode = if ([string]::IsNullOrWhiteSpace($nodeInput)) { $defaultNode } else { $nodeInput }
            $script:EsApiKey = Read-SecurePrompt -Prompt "  API Key (leave empty for basic auth, input hidden)"
            if ([string]::IsNullOrEmpty($script:EsApiKey)) {
                $defaultUser = if ($defaults.ContainsKey('ELASTICSEARCH_USERNAME')) { $defaults['ELASTICSEARCH_USERNAME'] } else { 'elastic' }
                $userInput = Read-Host "  Username [$defaultUser]"
                $script:EsUsername = if ([string]::IsNullOrWhiteSpace($userInput)) { $defaultUser } else { $userInput }
                $script:EsPassword = Read-SecurePrompt -Prompt "  Password (input hidden)"
            }
            $defaultIdx = if ($defaults.ContainsKey('ELASTICSEARCH_INDEX_PATTERN')) { $defaults['ELASTICSEARCH_INDEX_PATTERN'] } else { 'achilles-results-*' }
            $idxInput = Read-Host "  Index pattern [$defaultIdx]"
            if (-not [string]::IsNullOrWhiteSpace($idxInput)) { $script:EsIndex = $idxInput } else { $script:EsIndex = $defaultIdx }
            Write-Success "Elasticsearch: self-hosted"
        }
        'skip' {
            Write-Info "Elasticsearch: skipped (configure later in Settings)"
        }
    }

    # -- Test Repository --
    $script:GitHubToken  = ''
    $script:TestsRepoUrl = ''
    if (-not $Quick) {
        $defaultToken = if ($defaults.ContainsKey('GITHUB_TOKEN') -and $defaults['GITHUB_TOKEN'] -ne 'ghp_xxxxx') { $defaults['GITHUB_TOKEN'] } else { '' }
        $defaultRepo  = if ($defaults.ContainsKey('TESTS_REPO_URL')) { $defaults['TESTS_REPO_URL'] } else { 'https://github.com/your-org/f0_library.git' }

        Write-Host ""
        $hasRepo = Read-Host "  Do you have a private test library? [y/N]"
        if ($hasRepo -match '^[Yy]') {
            $script:GitHubToken = Read-SecurePrompt -Prompt "  GitHub Personal Access Token (input hidden)"
            $repoInput = Read-Host "  Repository URL [$defaultRepo]"
            $script:TestsRepoUrl = if ([string]::IsNullOrWhiteSpace($repoInput)) { $defaultRepo } else { $repoInput }
            Write-Success "Test repository configured"
        }
        else {
            Write-Info "Test repository: skipped"
        }
    }

    Write-Host ""
}

# -----------------------------------------------------------------------------
# Phase 7 -- Write Configuration
# -----------------------------------------------------------------------------

function Invoke-PhaseWriteConfig {
    Write-Step 7 "Writing configuration..."

    if ($script:ConfigAction -eq 'keep') {
        Write-Success "Using existing backend/.env"
        Write-Host ""
        return
    }

    # Start from .env.example if no file exists or fresh start
    if ($script:ConfigAction -eq 'fresh' -or -not (Test-Path $script:EnvFile)) {
        if (Test-Path $script:EnvExample) {
            Copy-Item $script:EnvExample $script:EnvFile -Force
        }
        else {
            # Create minimal .env
            $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
            [System.IO.File]::WriteAllText($script:EnvFile, "# ProjectAchilles Configuration`n", $utf8NoBom)
        }
    }

    # Generate secrets
    $script:SessionSecret    = New-CryptoSecret
    $script:EncryptionSecret = New-CryptoSecret

    # If reconfiguring, keep existing secrets that look real
    if ($script:ConfigAction -eq 'reconfigure') {
        $existing = Read-EnvFile -Path $script:EnvFile
        if ($existing.ContainsKey('SESSION_SECRET') -and $existing['SESSION_SECRET'] -ne 'change-me-to-a-secure-random-string') {
            $script:SessionSecret = $existing['SESSION_SECRET']
        }
        if ($existing.ContainsKey('ENCRYPTION_SECRET') -and $existing['ENCRYPTION_SECRET'] -ne 'change-me-to-a-secure-random-string') {
            $script:EncryptionSecret = $existing['ENCRYPTION_SECRET']
        }
    }

    # Write values
    Set-EnvValue -Path $script:EnvFile -Key 'CLERK_PUBLISHABLE_KEY' -Value $script:ClerkPub
    Set-EnvValue -Path $script:EnvFile -Key 'CLERK_SECRET_KEY'      -Value $script:ClerkSec
    Set-EnvValue -Path $script:EnvFile -Key 'SESSION_SECRET'        -Value $script:SessionSecret
    Set-EnvValue -Path $script:EnvFile -Key 'ENCRYPTION_SECRET'     -Value $script:EncryptionSecret
    Set-EnvValue -Path $script:EnvFile -Key 'NODE_ENV'              -Value 'production'
    Set-EnvValue -Path $script:EnvFile -Key 'CORS_ORIGIN'           -Value 'http://localhost'
    Set-EnvValue -Path $script:EnvFile -Key 'PORT'                  -Value '3000'

    # Test repository
    if (-not [string]::IsNullOrEmpty($script:GitHubToken)) {
        Set-EnvValue -Path $script:EnvFile -Key 'GITHUB_TOKEN'   -Value $script:GitHubToken
        Set-EnvValue -Path $script:EnvFile -Key 'TESTS_REPO_URL' -Value $script:TestsRepoUrl
    }

    # Elasticsearch -- comment out all first, then set relevant ones
    foreach ($esKey in @('ELASTICSEARCH_NODE', 'ELASTICSEARCH_CLOUD_ID', 'ELASTICSEARCH_API_KEY',
                         'ELASTICSEARCH_USERNAME', 'ELASTICSEARCH_PASSWORD', 'ELASTICSEARCH_INDEX_PATTERN')) {
        Remove-EnvValue -Path $script:EnvFile -Key $esKey
    }

    switch ($script:EsMode) {
        'local' {
            Set-EnvValue -Path $script:EnvFile -Key 'ELASTICSEARCH_NODE'          -Value $script:EsNode
            Set-EnvValue -Path $script:EnvFile -Key 'ELASTICSEARCH_INDEX_PATTERN' -Value $script:EsIndex
        }
        'cloud' {
            if (-not [string]::IsNullOrEmpty($script:EsCloudId)) {
                Set-EnvValue -Path $script:EnvFile -Key 'ELASTICSEARCH_CLOUD_ID' -Value $script:EsCloudId
            }
            if (-not [string]::IsNullOrEmpty($script:EsApiKey)) {
                Set-EnvValue -Path $script:EnvFile -Key 'ELASTICSEARCH_API_KEY' -Value $script:EsApiKey
            }
            Set-EnvValue -Path $script:EnvFile -Key 'ELASTICSEARCH_INDEX_PATTERN' -Value $script:EsIndex
        }
        'self-hosted' {
            Set-EnvValue -Path $script:EnvFile -Key 'ELASTICSEARCH_NODE' -Value $script:EsNode
            if (-not [string]::IsNullOrEmpty($script:EsApiKey)) {
                Set-EnvValue -Path $script:EnvFile -Key 'ELASTICSEARCH_API_KEY' -Value $script:EsApiKey
            }
            if (-not [string]::IsNullOrEmpty($script:EsUsername)) {
                Set-EnvValue -Path $script:EnvFile -Key 'ELASTICSEARCH_USERNAME' -Value $script:EsUsername
            }
            if (-not [string]::IsNullOrEmpty($script:EsPassword)) {
                Set-EnvValue -Path $script:EnvFile -Key 'ELASTICSEARCH_PASSWORD' -Value $script:EsPassword
            }
            Set-EnvValue -Path $script:EnvFile -Key 'ELASTICSEARCH_INDEX_PATTERN' -Value $script:EsIndex
        }
    }

    # Summary
    Write-Success "Configuration written to backend/.env"
    Write-Info "Clerk:      $(Get-MaskedKey $script:ClerkPub)"
    Write-Info "Secrets:    generated (SESSION_SECRET, ENCRYPTION_SECRET)"
    Write-Info "NODE_ENV:   production"
    Write-Info "CORS:       http://localhost"
    if ($script:EsMode -ne 'skip') {
        Write-Info "Analytics:  $($script:EsMode)"
    }

    Write-Host ""
}

# -----------------------------------------------------------------------------
# Phase 8 -- Docker Build & Launch
# -----------------------------------------------------------------------------

function Invoke-PhaseBuild {
    Write-Step 8 "Building and launching Docker containers..."
    Write-Host ""
    Write-Info "This may take 5-10 minutes on the first run."
    Write-Host ""

    $composeArgs = @('up', '-d', '--build')
    if ($script:EsMode -eq 'local') {
        $composeArgs = @('--profile', 'elasticsearch', 'up', '-d', '--build')
    }

    # Build and launch
    Push-Location $script:ProjectRoot
    try {
        if ($script:ComposeCmd -eq 'docker compose') {
            & docker compose @composeArgs
        }
        else {
            & docker-compose @composeArgs
        }

        if ($LASTEXITCODE -ne 0) {
            Write-Host ""
            Write-Failure "Docker build failed (exit code $LASTEXITCODE)."
            Write-Host ""
            Write-Info "Common causes and fixes:"
            Write-Info "  - 'no space left on device': Run 'docker system prune -a'"
            Write-Info "  - CRLF errors ($'\r'): Re-run this script (Phase 4 fixes line endings)"
            Write-Info "  - Permission denied: Run PowerShell as Administrator"
            Write-Host ""
            Write-Info "View build logs: docker compose logs"
            exit 1
        }
    }
    finally {
        Pop-Location
    }

    Write-Host ""
    Write-Success "Docker containers launched"
    Write-Host ""
}

# -----------------------------------------------------------------------------
# Phase 9 -- Health Check Polling
# -----------------------------------------------------------------------------

function Invoke-PhaseHealthCheck {
    Write-Step 9 "Waiting for services to become healthy..."

    $backendOk = Wait-ForHealthy -Url 'http://localhost:3000/api/health' -Label 'Backend API' -TimeoutSeconds 180
    if (-not $backendOk) {
        Write-Warning "Backend did not become healthy within 180 seconds."
        Write-Info "Check logs: docker compose logs backend"
        Write-Info "Common causes: invalid Clerk keys, port conflict, missing .env values"
    }

    if ($script:EsMode -eq 'local') {
        $esOk = Wait-ForHealthy -Url 'http://localhost:9200/_cluster/health' -Label 'Elasticsearch' -TimeoutSeconds 120
        if (-not $esOk) {
            Write-Warning "Elasticsearch did not become healthy within 120 seconds."
            Write-Info "Check logs: docker compose --profile elasticsearch logs elasticsearch"
            Write-Info "Elasticsearch requires ~2 GB RAM. Check Docker Desktop resource settings."
        }
    }

    Write-Host ""
}

# -----------------------------------------------------------------------------
# Phase 10 -- Summary & Launch
# -----------------------------------------------------------------------------

function Invoke-PhaseSummary {
    Write-Step 10 "Setup complete!"
    Write-Host ""

    # Show container status
    Push-Location $script:ProjectRoot
    try {
        if ($script:ComposeCmd -eq 'docker compose') {
            & docker compose ps
        }
        else {
            & docker-compose ps
        }
    }
    finally {
        Pop-Location
    }

    Write-Host ""
    Write-Host "  --------------------------------------------------------" -ForegroundColor DarkGray
    Write-Host "  URLs:" -ForegroundColor Cyan
    Write-Host "    Dashboard:  " -NoNewline; Write-Host "http://localhost" -ForegroundColor Green
    Write-Host "    API Health: " -NoNewline; Write-Host "http://localhost:3000/api/health" -ForegroundColor Green
    if ($script:EsMode -eq 'local') {
        Write-Host "    Elastic:    " -NoNewline; Write-Host "http://localhost:9200" -ForegroundColor Green
    }
    Write-Host ""
    Write-Host "  Next Steps:" -ForegroundColor Cyan
    Write-Host "    1. Sign in with your Clerk account at http://localhost"
    Write-Host "    2. Browse security tests in the Test Browser"
    if ($script:EsMode -eq 'local') {
        Write-Host "    3. View analytics (seed data loads automatically)"
    }
    else {
        Write-Host "    3. Configure Elasticsearch in Settings for analytics"
    }
    Write-Host "    4. Deploy agents via the Agents module"
    Write-Host ""
    Write-Host "  Useful Commands:" -ForegroundColor Cyan
    Write-Host "    docker compose logs -f          # Follow all logs"
    Write-Host "    docker compose logs backend     # Backend logs only"
    Write-Host "    docker compose down              # Stop services"
    Write-Host "    docker compose up -d             # Restart services"
    Write-Host ""
    Write-Host "  --------------------------------------------------------" -ForegroundColor DarkGray
    Write-Host ""

    if (-not $NoOpen) {
        Write-Info "Opening http://localhost in your default browser..."
        try {
            Start-Process 'http://localhost'
        }
        catch {
            Write-Warning "Could not open browser automatically. Navigate to http://localhost"
        }
    }
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------

try {
    Invoke-PhaseBanner
    Invoke-PhasePrereqs
    Invoke-PhaseRepoDetection
    Invoke-PhaseLineEndings
    Invoke-PhaseConfigDetection
    Invoke-PhaseConfiguration
    Invoke-PhaseWriteConfig
    Invoke-PhaseBuild
    Invoke-PhaseHealthCheck
    Invoke-PhaseSummary
}
catch {
    Write-Host ""
    Write-Failure "An unexpected error occurred:"
    Write-Host "         $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "         At: $($_.InvocationInfo.ScriptName):$($_.InvocationInfo.ScriptLineNumber)" -ForegroundColor DarkGray
    Write-Host ""
    exit 1
}
