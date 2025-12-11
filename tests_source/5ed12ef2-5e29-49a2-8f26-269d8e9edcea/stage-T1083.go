// stage-T1083.go - Stage 3: File and Directory Discovery
// Simulates ransomware file enumeration and target identification

//go:build windows
// +build windows

package main

import (
	"fmt"
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

// TargetFile represents a file identified for encryption
type TargetFile struct {
	Path      string
	Size      int64
	Extension string
	Priority  int // 1=Critical, 2=Important, 3=Standard
}

func main() {
	// Attach to shared log
	if err := AttachLogger("5ed12ef2-5e29-49a2-8f26-269d8e9edcea", "Stage 3: T1083"); err != nil {
		fmt.Printf("[ERROR] Failed to attach logger: %v\n", err)
	}

	LogMessage("INFO", "T1083", "Starting Stage 3: File and Directory Discovery")

	// Perform file discovery
	targets, err := performFileDiscovery()
	if err != nil {
		LogMessage("ERROR", "T1083", fmt.Sprintf("File discovery blocked: %v", err))

		stageData := StageLog{
			StageID:       3,
			Technique:     "T1083",
			Name:          "File and Directory Discovery",
			StartTime:     time.Now(),
			EndTime:       time.Now(),
			DurationMs:    0,
			Status:        "blocked",
			ExitCode:      StageBlocked,
			BlockedReason: err.Error(),
		}
		AppendToSharedLog(stageData)

		os.Exit(StageBlocked)
	}

	// Stage completed successfully
	LogMessage("SUCCESS", "T1083", fmt.Sprintf("File discovery complete - identified %d targets", len(targets)))

	stageData := StageLog{
		StageID:    3,
		Technique:  "T1083",
		Name:       "File and Directory Discovery",
		StartTime:  time.Now(),
		EndTime:    time.Now(),
		DurationMs: 0,
		Status:     "success",
		ExitCode:   StageSuccess,
	}
	AppendToSharedLog(stageData)

	os.Exit(StageSuccess)
}

func performFileDiscovery() ([]TargetFile, error) {
	fmt.Println("[*] Starting file and directory discovery phase...")

	// High-value file extensions typically targeted by ransomware
	targetExtensions := map[string]int{
		// Critical business documents
		".doc":  1, ".docx": 1, ".xls": 1, ".xlsx": 1, ".ppt": 1, ".pptx": 1,
		".pdf": 1, ".odt": 1, ".ods": 1, ".odp": 1,
		// Databases
		".mdb": 1, ".accdb": 1, ".db": 1, ".sqlite": 1, ".sql": 1,
		// Development files
		".cpp": 2, ".cs": 2, ".java": 2, ".py": 2, ".go": 2, ".js": 2,
		".h": 2, ".c": 2, ".php": 2, ".rb": 2,
		// Media files
		".jpg": 3, ".jpeg": 3, ".png": 3, ".gif": 3, ".bmp": 3,
		".mp3": 3, ".mp4": 3, ".avi": 3, ".mov": 3, ".wav": 3,
		// Archives
		".zip": 2, ".rar": 2, ".7z": 2, ".tar": 2, ".gz": 2,
		// Config and keys
		".pem": 1, ".key": 1, ".cer": 1, ".pfx": 1, ".p12": 1,
	}

	// Directories to search (simulated)
	searchPaths := []string{
		"C:\\F0",                        // Test directory
		os.Getenv("USERPROFILE") + "\\Documents",
		os.Getenv("USERPROFILE") + "\\Desktop",
		os.Getenv("USERPROFILE") + "\\Downloads",
	}

	// Directories to exclude (ransomware typically avoids these)
	excludePaths := []string{
		"C:\\Windows",
		"C:\\Program Files",
		"C:\\Program Files (x86)",
		"C:\\ProgramData\\Microsoft",
		"C:\\$Recycle.Bin",
	}

	var targets []TargetFile
	discoveredCount := 0

	fmt.Println("[*] Enumerating file system for encryption targets...")

	// First, create some test files in C:\F0 for safe discovery simulation
	testDir := "C:\\F0\\test_documents"
	if err := os.MkdirAll(testDir, 0755); err != nil {
		return nil, fmt.Errorf("directory creation blocked: %v", err)
	}

	// Create test files
	testFiles := []struct {
		name    string
		content string
	}{
		{"important.docx", "DOCUMENT: Quarterly Report"},
		{"database.sqlite", "DATABASE: Customer Records"},
		{"source.cpp", "CODE: Application Source"},
		{"backup.zip", "ARCHIVE: System Backup"},
		{"credentials.key", "KEY: Private Key Material"},
		{"photo.jpg", "IMAGE: Family Photo"},
	}

	for _, tf := range testFiles {
		filePath := filepath.Join(testDir, tf.name)
		if err := os.WriteFile(filePath, []byte(tf.content), 0644); err != nil {
			return nil, fmt.Errorf("test file creation blocked: %v", err)
		}
	}

	// Simulate aggressive file system scanning
	for _, searchPath := range searchPaths {
		fmt.Printf("[*] Scanning: %s\n", searchPath)

		// Check if path is excluded
		excluded := false
		for _, excludePath := range excludePaths {
			if strings.HasPrefix(searchPath, excludePath) {
				fmt.Printf("[*] Skipping system directory: %s\n", searchPath)
				excluded = true
				break
			}
		}

		if excluded {
			continue
		}

		// Check if we can access the directory
		if _, err := os.Stat(searchPath); os.IsNotExist(err) {
			fmt.Printf("[*] Path does not exist: %s\n", searchPath)
			continue
		}

		// Try to enumerate files (this might trigger EDR)
		err := filepath.Walk(searchPath, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				// Access denied is common and expected
				return nil
			}

			// Skip directories
			if info.IsDir() {
				return nil
			}

			// Check file extension
			ext := strings.ToLower(filepath.Ext(path))
			if priority, isTarget := targetExtensions[ext]; isTarget {
				discoveredCount++

				// Don't actually store all files (too many)
				// Just store first 100 for demonstration
				if len(targets) < 100 {
					targets = append(targets, TargetFile{
						Path:      path,
						Size:      info.Size(),
						Extension: ext,
						Priority:  priority,
					})
				}

				// Aggressive scanning behavior (might trigger EDR)
				if discoveredCount%100 == 0 {
					fmt.Printf("[*] Discovered %d potential targets...\n", discoveredCount)
				}
			}

			return nil
		})

		if err != nil {
			return nil, fmt.Errorf("file enumeration blocked by EDR: %v", err)
		}
	}

	// Check if discovery was too limited (might indicate EDR interference)
	if discoveredCount == 0 {
		return nil, fmt.Errorf("no files discovered - possible EDR blocking")
	}

	fmt.Printf("[+] Discovery complete: Found %d encryption targets\n", discoveredCount)

	// Simulate creating a target list file (common ransomware behavior)
	targetListPath := filepath.Join("C:\\F0", "targets.list")
	targetListContent := fmt.Sprintf("RANSOMWARE_TARGETS\nTotal: %d\nPriority 1: %d\n",
		discoveredCount, len(targets))

	if err := os.WriteFile(targetListPath, []byte(targetListContent), 0644); err != nil {
		return nil, fmt.Errorf("target list creation blocked: %v", err)
	}

	LogFileDropped("targets.list", targetListPath, int64(len(targetListContent)), false)

	// Group targets by priority
	var critical, important, standard int
	for _, target := range targets {
		switch target.Priority {
		case 1:
			critical++
		case 2:
			important++
		case 3:
			standard++
		}
	}

	fmt.Printf("[*] Target Analysis:\n")
	fmt.Printf("    Critical files:  %d (documents, databases, keys)\n", critical)
	fmt.Printf("    Important files: %d (source code, archives)\n", important)
	fmt.Printf("    Standard files:  %d (media, other)\n", standard)

	// Simulate shadow copy discovery (common ransomware technique)
	fmt.Println("[*] Enumerating shadow copies for deletion...")
	shadowCmd := "vssadmin list shadows"
	// Note: We don't actually execute this as it requires admin privileges
	// and could be destructive if combined with delete commands
	fmt.Printf("[*] Would execute: %s\n", shadowCmd)

	// Simulate network share discovery
	fmt.Println("[*] Scanning for network shares...")
	netCmd := "net view"
	// Again, simulated only
	fmt.Printf("[*] Would execute: %s\n", netCmd)

	fmt.Println("[+] Stage 3 completed - File discovery successful")

	return targets, nil
}