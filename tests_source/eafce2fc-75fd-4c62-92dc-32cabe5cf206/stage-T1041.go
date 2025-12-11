//go:build windows
// +build windows

/*
STAGE 5: Data Exfiltration (T1041)
Exfiltrates sensitive data over C2 channel
*/

package main

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const (
	TEST_UUID      = "eafce2fc-75fd-4c62-92dc-32cabe5cf206"
	TECHNIQUE_ID   = "T1041"
	TECHNIQUE_NAME = "Exfiltration Over C2 Channel"
	STAGE_ID       = 5
)

// Standardized stage exit codes
const (
	StageSuccess     = 0
	StageBlocked     = 126
	StageQuarantined = 105
	StageError       = 999
)

func main() {
	// Attach to shared log
	AttachLogger(TEST_UUID, fmt.Sprintf("Stage %d: %s", STAGE_ID, TECHNIQUE_ID))

	LogMessage("INFO", TECHNIQUE_ID, "Starting Data Exfiltration simulation")
	LogStageStart(STAGE_ID, TECHNIQUE_ID, "Create and exfiltrate sensitive data")

	// Create staging directory
	stagingDir := filepath.Join("c:\\F0", "exfil_staging")
	if err := os.MkdirAll(stagingDir, 0755); err != nil {
		fmt.Printf("[STAGE T1041] Failed to create staging directory: %v\n", err)
		LogMessage("ERROR", TECHNIQUE_ID, fmt.Sprintf("Failed to create staging directory: %v", err))
		LogStageEnd(STAGE_ID, TECHNIQUE_ID, "error", "Staging directory creation failed")
		os.Exit(StageError)
	}

	LogMessage("INFO", TECHNIQUE_ID, fmt.Sprintf("Created staging directory: %s", stagingDir))

	// Create dummy sensitive files
	if err := createDummySensitiveData(stagingDir); err != nil {
		fmt.Printf("[STAGE T1041] Failed to create sensitive data: %v\n", err)
		LogMessage("ERROR", TECHNIQUE_ID, fmt.Sprintf("Failed to create sensitive data: %v", err))
		LogStageEnd(STAGE_ID, TECHNIQUE_ID, "error", err.Error())
		os.Exit(StageError)
	}

	// Compress data for exfiltration
	archivePath := filepath.Join("c:\\F0", "exfiltrated_data.zip")
	if err := compressData(stagingDir, archivePath); err != nil {
		// Check if compression/archiving was blocked
		if strings.Contains(err.Error(), "access denied") ||
			strings.Contains(err.Error(), "blocked") {

			fmt.Printf("[STAGE T1041] Data compression blocked: %v\n", err)
			LogMessage("BLOCKED", TECHNIQUE_ID, fmt.Sprintf("Data compression blocked: %v", err))
			LogStageBlocked(STAGE_ID, TECHNIQUE_ID, err.Error())
			os.Exit(StageBlocked)
		}

		fmt.Printf("[STAGE T1041] Compression failed: %v\n", err)
		LogMessage("ERROR", TECHNIQUE_ID, fmt.Sprintf("Compression failed: %v", err))
		LogStageEnd(STAGE_ID, TECHNIQUE_ID, "error", err.Error())
		os.Exit(StageError)
	}

	// Simulate exfiltration
	if err := simulateExfiltration(archivePath); err != nil {
		// Check if exfiltration was blocked
		if strings.Contains(err.Error(), "blocked") ||
			strings.Contains(err.Error(), "denied") ||
			strings.Contains(err.Error(), "quarantined") {

			fmt.Printf("[STAGE T1041] Exfiltration blocked: %v\n", err)
			LogMessage("BLOCKED", TECHNIQUE_ID, fmt.Sprintf("Exfiltration blocked: %v", err))
			LogStageBlocked(STAGE_ID, TECHNIQUE_ID, err.Error())
			os.Exit(StageBlocked)
		}

		fmt.Printf("[STAGE T1041] Exfiltration failed: %v\n", err)
		LogMessage("ERROR", TECHNIQUE_ID, fmt.Sprintf("Exfiltration failed: %v", err))
		LogStageEnd(STAGE_ID, TECHNIQUE_ID, "error", err.Error())
		os.Exit(StageError)
	}

	LogMessage("SUCCESS", TECHNIQUE_ID, "Data exfiltration completed")
	LogStageEnd(STAGE_ID, TECHNIQUE_ID, "success", "Sensitive data successfully exfiltrated")
	os.Exit(StageSuccess)
}

func createDummySensitiveData(stagingDir string) error {
	LogMessage("INFO", TECHNIQUE_ID, "Creating dummy sensitive files...")

	// Create various types of "sensitive" files
	files := map[string]string{
		"passwords.txt": "admin:P@ssw0rd123\nroot:SuperSecret!\ndbadmin:MyDb2024\n",
		"credentials.csv": "Username,Password,System\njdoe,Password1,PROD-DB\nadmin,Admin2024,WEB-SERVER\n",
		"api_keys.txt": "AWS_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE\nAWS_SECRET_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\n",
		"database.conf": "[database]\nhost=prod-sql.internal.corp\nuser=sa\npassword=P@ssw0rd2024\n",
		"ssh_private_key.pem": "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA... (dummy key)\n-----END RSA PRIVATE KEY-----\n",
		"customer_data.csv": "CustomerID,Name,Email,CreditCard\n1001,John Doe,john@example.com,4532-1234-5678-9012\n",
		"financial_report.xlsx": "Dummy Excel content - Q4 2024 Financial Data\nRevenue: $5,000,000\nExpenses: $3,000,000\n",
		"employee_records.txt": "EmpID,Name,SSN,Salary\n12345,Jane Smith,123-45-6789,$95000\n",
	}

	fileCount := 0
	totalSize := int64(0)

	for filename, content := range files {
		filePath := filepath.Join(stagingDir, filename)
		if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
			return fmt.Errorf("failed to create %s: %v", filename, err)
		}
		fileCount++
		totalSize += int64(len(content))
	}

	LogMessage("INFO", TECHNIQUE_ID, fmt.Sprintf("Created %d dummy sensitive files (%d bytes total)", fileCount, totalSize))
	return nil
}

func compressData(sourceDir, archivePath string) error {
	LogMessage("INFO", TECHNIQUE_ID, fmt.Sprintf("Compressing data to: %s", archivePath))

	// Create zip archive
	zipFile, err := os.Create(archivePath)
	if err != nil {
		return fmt.Errorf("failed to create archive: %v", err)
	}
	defer zipFile.Close()

	zipWriter := zip.NewWriter(zipFile)
	defer zipWriter.Close()

	// Walk through staging directory
	err = filepath.Walk(sourceDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		if info.IsDir() {
			return nil
		}

		// Get relative path for zip
		relPath, err := filepath.Rel(sourceDir, path)
		if err != nil {
			return err
		}

		// Create zip entry
		zipEntry, err := zipWriter.Create(relPath)
		if err != nil {
			return err
		}

		// Copy file content
		fileContent, err := os.Open(path)
		if err != nil {
			return err
		}
		defer fileContent.Close()

		_, err = io.Copy(zipEntry, fileContent)
		return err
	})

	if err != nil {
		return fmt.Errorf("compression failed: %v", err)
	}

	// Get archive size
	archiveInfo, _ := os.Stat(archivePath)
	LogMessage("INFO", TECHNIQUE_ID, fmt.Sprintf("Archive created: %d bytes", archiveInfo.Size()))

	return nil
}

func simulateExfiltration(archivePath string) error {
	LogMessage("INFO", TECHNIQUE_ID, "Simulating data exfiltration over C2 channel...")

	// Verify archive exists and is readable
	archiveInfo, err := os.Stat(archivePath)
	if err != nil {
		return fmt.Errorf("archive not accessible: %v", err)
	}

	LogMessage("INFO", TECHNIQUE_ID, fmt.Sprintf("Archive ready for exfiltration: %d bytes", archiveInfo.Size()))

	// Simulate transfer by copying to "exfiltrated" location
	exfilPath := filepath.Join("c:\\F0", "EXFILTRATED_DATA.zip")

	source, err := os.Open(archivePath)
	if err != nil {
		return fmt.Errorf("failed to open source: %v", err)
	}
	defer source.Close()

	destination, err := os.Create(exfilPath)
	if err != nil {
		return fmt.Errorf("failed to create destination: %v", err)
	}
	defer destination.Close()

	written, err := io.Copy(destination, source)
	if err != nil {
		return fmt.Errorf("transfer failed: %v", err)
	}

	LogMessage("INFO", TECHNIQUE_ID, fmt.Sprintf("Exfiltration simulated: %d bytes transferred", written))
	LogMessage("SUCCESS", TECHNIQUE_ID, "Data successfully exfiltrated to C2 server (simulated)")

	return nil
}