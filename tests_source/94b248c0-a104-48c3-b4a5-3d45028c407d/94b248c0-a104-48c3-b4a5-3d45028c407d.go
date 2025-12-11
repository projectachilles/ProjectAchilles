//go:build windows
//+build windows
/*
ID: 94b248c0-a104-48c3-b4a5-3d45028c407d
NAME: Gunra Ransomware Simulation
TECHNIQUE: T1486, T1490, T1082
UNIT: response
CREATED: 2024-10-13
*/
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	Endpoint "github.com/preludeorg/libraries/go/tests/endpoint"
)

const (
	testDir          = `c:\F0\94b248c0-a104-48c3-b4a5-3d45028c407d`
	encryptedExt     = ".ENCRT"
	ransomNoteFile   = "R3ADM3.txt"
	testFileName     = "test_document.txt"
	testFileContent  = "This is a test file for Gunra ransomware simulation"
)

var (
	ransomNoteContent = `
=== YOUR FILES HAVE BEEN ENCRYPTED ===

All your important files have been encrypted with strong encryption algorithms.

Your unique ID: GUNRA-TEST-2024

WHAT HAPPENED?
Your network has been compromised and your sensitive data has been encrypted and exfiltrated.

WHAT GUARANTEES DO WE GIVE?
- We can decrypt 1-2 files for free as proof
- After payment, you will receive the decryption tool
- We guarantee that your data will not be published if you pay

WARNING!
- Do not attempt to decrypt files yourself - you may lose them permanently
- Do not contact recovery companies - they cannot help you
- You have 5 DAYS to contact us, or your data will be published on underground forums

HOW TO CONTACT US?
Visit our Tor site: [REDACTED FOR SAFETY]

This is a SECURITY TEST - No actual encryption has occurred.
This test simulates Gunra ransomware behavior for security validation purposes.
`

	createdFiles []string
)

// Simulate anti-debugging check (T1622)
func checkDebugger() bool {
	Endpoint.Say("Performing anti-debugging check")
	// In real Gunra, this uses IsDebuggerPresent API
	// For testing, we just simulate the check
	return false
}

// Simulate system information gathering (T1082)
func gatherSystemInfo() error {
	Endpoint.Say("Gathering system information")
	
	// Get computer name
	hostname, err := os.Hostname()
	if err != nil {
		return fmt.Errorf("failed to get hostname: %v", err)
	}
	Endpoint.Say("System hostname: %s", hostname)
	
	// Get current user
	username := os.Getenv("USERNAME")
	Endpoint.Say("Current user: %s", username)
	
	// Get OS info
	osInfo := os.Getenv("OS")
	Endpoint.Say("Operating system: %s", osInfo)
	
	return nil
}

// Simulate shadow copy deletion (T1490)
func deleteShadowCopies() error {
	Endpoint.Say("Simulating shadow copy deletion via WMI (SAFE MODE - not actually deleting)")
	
	// SAFE MODE: Only check if vssadmin is accessible, don't actually delete
	// This simulates the behavior without causing actual system damage
	cmd := []string{"vssadmin.exe", "list", "shadows"}
	_, err := Endpoint.Shell(cmd)
	
	if err != nil {
		// Check if it's a permission issue
		if strings.Contains(err.Error(), "access") || strings.Contains(err.Error(), "privilege") {
			Endpoint.Say("Shadow copy service access blocked - insufficient privileges or EDR prevention")
			return nil // Not a failure for the test
		}
		Endpoint.Say("Shadow copy service check failed: %v", err)
		return nil // Continue test even if we can't access VSS
	}
	
	// Log what real malware would do
	Endpoint.Say("Shadow copy service is accessible")
	Endpoint.Say("Real Gunra malware would execute: vssadmin delete shadows /all /quiet")
	Endpoint.Say("TEST MODE: Shadow copies preserved for safety - simulating successful deletion")
	
	return nil
}

// Create test directory and files
func setupTestEnvironment() error {
	Endpoint.Say("Setting up test environment in %s", testDir)
	
	// Create test directory
	if err := os.MkdirAll(testDir, 0755); err != nil {
		return fmt.Errorf("failed to create test directory: %v", err)
	}
	createdFiles = append(createdFiles, testDir)
	
	// Create test files to "encrypt"
	testFiles := []string{
		"document1.docx",
		"spreadsheet1.xlsx",
		"presentation1.pptx",
		"image1.jpg",
		"data.pdf",
	}
	
	for _, filename := range testFiles {
		filePath := filepath.Join(testDir, filename)
		if err := os.WriteFile(filePath, []byte(testFileContent), 0644); err != nil {
			return fmt.Errorf("failed to create test file %s: %v", filename, err)
		}
		createdFiles = append(createdFiles, filePath)
		Endpoint.Say("Created test file: %s", filename)
	}
	
	return nil
}

// Simulate file enumeration (T1083)
func enumerateFiles() ([]string, error) {
	Endpoint.Say("Enumerating files in test directory")
	
	var files []string
	err := filepath.Walk(testDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() && !strings.HasSuffix(path, encryptedExt) && !strings.HasSuffix(path, ransomNoteFile) {
			files = append(files, path)
		}
		return nil
	})
	
	if err != nil {
		return nil, fmt.Errorf("failed to enumerate files: %v", err)
	}
	
	Endpoint.Say("Found %d files to process", len(files))
	return files, nil
}

// Simulate file encryption (T1486)
func encryptFiles(files []string) error {
	Endpoint.Say("Simulating file encryption with .ENCRT extension")
	
	for _, file := range files {
		// Read original file
		content, err := os.ReadFile(file)
		if err != nil {
			Endpoint.Say("Warning: Failed to read file %s: %v", file, err)
			continue
		}
		
		// Simulate encryption by renaming and modifying
		encryptedPath := file + encryptedExt
		
		// Write "encrypted" content (in reality, just marking it)
		encryptedContent := append([]byte("[ENCRYPTED BY GUNRA - TEST MODE]\n"), content...)
		if err := os.WriteFile(encryptedPath, encryptedContent, 0644); err != nil {
			Endpoint.Say("Warning: Failed to write encrypted file %s: %v", encryptedPath, err)
			continue
		}
		
		// Remove original file
		if err := os.Remove(file); err != nil {
			Endpoint.Say("Warning: Failed to remove original file %s: %v", file, err)
		}
		
		createdFiles = append(createdFiles, encryptedPath)
		Endpoint.Say("Encrypted file: %s -> %s", filepath.Base(file), filepath.Base(encryptedPath))
	}
	
	return nil
}

// Drop ransom note (T1486)
func dropRansomNote() error {
	Endpoint.Say("Dropping ransom note: %s", ransomNoteFile)
	
	notePath := filepath.Join(testDir, ransomNoteFile)
	if err := os.WriteFile(notePath, []byte(ransomNoteContent), 0644); err != nil {
		return fmt.Errorf("failed to write ransom note: %v", err)
	}
	
	createdFiles = append(createdFiles, notePath)
	Endpoint.Say("Ransom note dropped successfully")
	return nil
}

// Verify encryption occurred
func verifyEncryption() bool {
	Endpoint.Say("Verifying encryption simulation")
	
	// Check for encrypted files
	encryptedCount := 0
	filepath.Walk(testDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if strings.HasSuffix(path, encryptedExt) {
			encryptedCount++
		}
		return nil
	})
	
	// Check for ransom note
	notePath := filepath.Join(testDir, ransomNoteFile)
	noteExists := Endpoint.Exists(notePath)
	
	Endpoint.Say("Found %d encrypted files and ransom note exists: %v", encryptedCount, noteExists)
	
	return encryptedCount > 0 && noteExists
}

func test() {
	Endpoint.Say("Starting Gunra Ransomware simulation test")
	
	// Step 1: Anti-debugging check
	if checkDebugger() {
		Endpoint.Say("Debugger detected - real malware would exit")
		// For testing purposes, we continue
	}
	
	// Step 2: Gather system information (T1082)
	if err := gatherSystemInfo(); err != nil {
		Endpoint.Say("Failed to gather system info: %v", err)
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}
	
	// Step 3: Setup test environment
	if err := setupTestEnvironment(); err != nil {
		Endpoint.Say("Failed to setup test environment: %v", err)
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}
	
	// Step 4: Delete shadow copies (T1490)
	if err := deleteShadowCopies(); err != nil {
		Endpoint.Say("Shadow copy deletion failed: %v", err)
		// Continue test even if this fails
	}
	
	// Step 5: Enumerate files (T1083)
	files, err := enumerateFiles()
	if err != nil {
		Endpoint.Say("File enumeration failed: %v", err)
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}
	
	// Step 6: Encrypt files (T1486)
	if err := encryptFiles(files); err != nil {
		Endpoint.Say("File encryption simulation failed: %v", err)
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}
	
	// Step 7: Drop ransom note (T1486)
	if err := dropRansomNote(); err != nil {
		Endpoint.Say("Failed to drop ransom note: %v", err)
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}
	
	// Step 8: Verify the attack succeeded
	if !verifyEncryption() {
		Endpoint.Say("Encryption verification failed - security solution may have intervened")
		Endpoint.Stop(Endpoint.ExecutionPrevented)
	}
	
	Endpoint.Say("Gunra ransomware simulation completed successfully")
	Endpoint.Say("System is UNPROTECTED - ransomware behavior was not blocked")
	Endpoint.Stop(Endpoint.Unprotected)
}

func main() {
	Endpoint.Start(test)
}
