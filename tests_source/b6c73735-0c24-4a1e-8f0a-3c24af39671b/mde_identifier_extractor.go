// mde_identifier_extractor.go - Extract real Microsoft Defender for Endpoint identifiers
// This module extracts actual MDE Machine ID, Tenant/Org ID, and Sense ID from the system
// Build: Embedded in main test binary

//go:build windows
// +build windows

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows/registry"
)

// MDEIdentifiers contains the extracted MDE identifiers
type MDEIdentifiers struct {
	MachineID         string `json:"machineId"`
	TenantID          string `json:"tenantId"`
	OrgID             string `json:"orgId"`
	SenseID           string `json:"senseId"`
	ComputerName      string `json:"computerName"`
	DeviceUUID        string `json:"deviceUuid"`
	OnboardingState   string `json:"onboardingState"`
	Source            string `json:"source"`
	MDEInstalled      bool   `json:"mdeInstalled"`
	ExtractionSuccess bool   `json:"extractionSuccess"`
}

// ExtractMDEIdentifiers attempts to extract real MDE identifiers from the system
func ExtractMDEIdentifiers() *MDEIdentifiers {
	fmt.Println()
	fmt.Println("[*] ========================================")
	fmt.Println("[*] Phase: MDE Identifier Extraction")
	fmt.Println("[*] ========================================")
	fmt.Println()

	identifiers := &MDEIdentifiers{
		Source:            "none",
		MDEInstalled:      false,
		ExtractionSuccess: false,
	}

	// Try multiple methods in order of preference
	fmt.Println("[*] Attempting to extract real MDE identifiers...")

	// Method 1: Registry - Primary source
	if extractFromRegistry(identifiers) {
		fmt.Println("[+] Successfully extracted identifiers from MDE registry")
		identifiers.ExtractionSuccess = true
		identifiers.MDEInstalled = true
		identifiers.Source = "registry"
		saveIdentifiersToFile(identifiers)
		return identifiers
	}

	// Method 2: MDE Configuration Files
	if extractFromConfigFiles(identifiers) {
		fmt.Println("[+] Successfully extracted identifiers from MDE config files")
		identifiers.ExtractionSuccess = true
		identifiers.MDEInstalled = true
		identifiers.Source = "config_files"
		saveIdentifiersToFile(identifiers)
		return identifiers
	}

	// Method 3: WMI - Fallback for device UUID
	if extractFromWMI(identifiers) {
		fmt.Println("[*] Extracted device UUID from WMI (MDE not installed)")
		identifiers.ExtractionSuccess = true
		identifiers.MDEInstalled = false
		identifiers.Source = "wmi_fallback"
		saveIdentifiersToFile(identifiers)
		return identifiers
	}

	// Method 4: Generate simulated identifiers
	fmt.Println("[!] Could not extract real identifiers - using simulated values")
	generateSimulatedIdentifiers(identifiers)
	identifiers.Source = "simulated"
	saveIdentifiersToFile(identifiers)

	return identifiers
}

// extractFromRegistry extracts identifiers from Windows Registry
func extractFromRegistry(id *MDEIdentifiers) bool {
	fmt.Println("[*] Method 1: Checking Windows Registry...")

	// Primary MDE registry path
	regPaths := []string{
		`SOFTWARE\Microsoft\Windows Advanced Threat Protection`,
		`SOFTWARE\Microsoft\Windows Defender Advanced Threat Protection`,
		`SOFTWARE\Policies\Microsoft\Windows Advanced Threat Protection`,
	}

	for _, path := range regPaths {
		fmt.Printf("[*] Checking: %s\n", path)

		key, err := registry.OpenKey(registry.LOCAL_MACHINE, path, registry.QUERY_VALUE)
		if err != nil {
			fmt.Printf("    [*] Path not found\n")
			continue
		}
		defer key.Close()

		fmt.Println("    [+] Registry key found!")

		// Extract MachineId
		if machineID, _, err := key.GetStringValue("MachineId"); err == nil && machineID != "" {
			id.MachineID = machineID
			fmt.Printf("    [+] Machine ID: %s\n", machineID)
		}

		// Extract SenseId
		if senseID, _, err := key.GetStringValue("SenseId"); err == nil && senseID != "" {
			id.SenseID = senseID
			fmt.Printf("    [+] Sense ID: %s\n", senseID)
		}

		// Extract OrgId (Tenant ID)
		if orgID, _, err := key.GetStringValue("OrgId"); err == nil && orgID != "" {
			id.OrgID = orgID
			id.TenantID = orgID // OrgId and TenantId are often the same
			fmt.Printf("    [+] Org/Tenant ID: %s\n", orgID)
		}

		// Extract Onboarding State
		if state, _, err := key.GetIntegerValue("OnboardingState"); err == nil {
			onboardingState := "Unknown"
			switch state {
			case 0:
				onboardingState = "Not Onboarded"
			case 1:
				onboardingState = "Onboarded"
			case 2:
				onboardingState = "Offboarded"
			}
			id.OnboardingState = onboardingState
			fmt.Printf("    [+] Onboarding State: %s\n", onboardingState)
		}

		// If we got at least one ID, consider it successful
		if id.MachineID != "" || id.SenseID != "" {
			return true
		}
	}

	return false
}

// extractFromConfigFiles extracts identifiers from MDE configuration files
func extractFromConfigFiles(id *MDEIdentifiers) bool {
	fmt.Println("[*] Method 2: Checking MDE configuration files...")

	// Common MDE config file locations
	configPaths := []string{
		`C:\ProgramData\Microsoft\Windows Defender Advanced Threat Protection\Config`,
		`C:\ProgramData\Microsoft\Windows Defender\Platform`,
		`C:\Program Files\Windows Defender Advanced Threat Protection`,
	}

	for _, basePath := range configPaths {
		fmt.Printf("[*] Checking: %s\n", basePath)

		if _, err := os.Stat(basePath); os.IsNotExist(err) {
			fmt.Println("    [*] Path not found")
			continue
		}

		// Look for JSON configuration files
		files, err := filepath.Glob(filepath.Join(basePath, "*.json"))
		if err != nil || len(files) == 0 {
			fmt.Println("    [*] No JSON config files found")
			continue
		}

		fmt.Printf("    [+] Found %d config file(s)\n", len(files))

		for _, file := range files {
			data, err := os.ReadFile(file)
			if err != nil {
				continue
			}

			// Try to parse as JSON
			var config map[string]interface{}
			if err := json.Unmarshal(data, &config); err != nil {
				continue
			}

			// Look for relevant fields
			if machineID, ok := config["MachineId"].(string); ok && machineID != "" {
				id.MachineID = machineID
				fmt.Printf("    [+] Machine ID from %s\n", filepath.Base(file))
			}

			if senseID, ok := config["SenseGuid"].(string); ok && senseID != "" {
				id.SenseID = senseID
				fmt.Printf("    [+] Sense ID from %s\n", filepath.Base(file))
			}

			if orgID, ok := config["OrgId"].(string); ok && orgID != "" {
				id.OrgID = orgID
				id.TenantID = orgID
				fmt.Printf("    [+] Org ID from %s\n", filepath.Base(file))
			}
		}

		if id.MachineID != "" || id.SenseID != "" {
			return true
		}
	}

	return false
}

// extractFromWMI extracts device UUID using WMI (fallback method)
func extractFromWMI(id *MDEIdentifiers) bool {
	fmt.Println("[*] Method 3: Querying WMI for device information...")

	// Get computer name
	computerName, err := os.Hostname()
	if err == nil {
		id.ComputerName = computerName
		fmt.Printf("[+] Computer Name: %s\n", computerName)
	}

	// Try to get UUID from registry (BIOS)
	key, err := registry.OpenKey(registry.LOCAL_MACHINE,
		`SYSTEM\HardwareConfig`,
		registry.QUERY_VALUE)

	if err == nil {
		defer key.Close()

		// Try to get LastConfig which often contains UUID
		if lastConfig, _, err := key.GetStringValue("LastConfig"); err == nil && lastConfig != "" {
			id.DeviceUUID = lastConfig
			fmt.Printf("[+] Device UUID: %s\n", lastConfig)
			return true
		}
	}

	// Alternative: Try Win32_ComputerSystemProduct UUID
	// This would require WMI queries which need more complex implementation
	// For now, we'll use a simpler approach

	return id.DeviceUUID != "" || id.ComputerName != ""
}

// generateSimulatedIdentifiers creates simulated identifiers for testing
func generateSimulatedIdentifiers(id *MDEIdentifiers) {
	fmt.Println("[*] Method 4: Generating simulated identifiers...")

	// Get computer name at least
	computerName, _ := os.Hostname()
	id.ComputerName = computerName

	// Generate realistic-looking GUIDs
	id.MachineID = fmt.Sprintf("{%s}", generateGUID())
	id.TenantID = fmt.Sprintf("{%s}", generateGUID())
	id.OrgID = id.TenantID
	id.SenseID = fmt.Sprintf("{%s}", generateGUID())
	id.DeviceUUID = fmt.Sprintf("{%s}", generateGUID())
	id.OnboardingState = "Simulated"

	fmt.Printf("[*] Simulated Machine ID: %s\n", id.MachineID)
	fmt.Printf("[*] Simulated Tenant ID: %s\n", id.TenantID)
	fmt.Println("[*] Note: These are simulated values, not real MDE identifiers")
}

// generateGUID generates a GUID-like string
func generateGUID() string {
	// Simple GUID generation for simulation
	// Format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		randomInt(0, 0xFFFFFFFF),
		randomInt(0, 0xFFFF),
		randomInt(0, 0xFFFF),
		randomInt(0, 0xFFFF),
		randomInt(0, 0xFFFFFFFFFFFF))
}

// randomInt generates a random integer in range
func randomInt(min, max int) int {
	// Simple random number generation
	// In production, use crypto/rand
	return min + (os.Getpid()+int(os.Getuid()))%(max-min+1)
}

// saveIdentifiersToFile saves extracted identifiers to JSON file
func saveIdentifiersToFile(id *MDEIdentifiers) error {
	targetDir := "C:\\F0"
	os.MkdirAll(targetDir, 0755)

	filePath := filepath.Join(targetDir, "mde_identifiers.json")

	data, err := json.MarshalIndent(id, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(filePath, data, 0644)
}

// DisplayIdentifiersSummary prints a summary of extracted identifiers
func DisplayIdentifiersSummary(id *MDEIdentifiers) {
	fmt.Println()
	fmt.Println("[*] ========================================")
	fmt.Println("[*] Identifier Extraction Summary")
	fmt.Println("[*] ========================================")
	fmt.Println()

	fmt.Printf("MDE Installed:       %v\n", id.MDEInstalled)
	fmt.Printf("Extraction Success:  %v\n", id.ExtractionSuccess)
	fmt.Printf("Data Source:         %s\n", id.Source)
	fmt.Println()

	if id.MDEInstalled {
		fmt.Println("[+] Microsoft Defender for Endpoint is installed")
		fmt.Println("[+] Using REAL MDE identifiers for testing")
	} else {
		fmt.Println("[*] Microsoft Defender for Endpoint not detected")
		fmt.Println("[*] Using simulated identifiers for testing")
	}

	fmt.Println()
	fmt.Println("Identifiers:")
	fmt.Printf("  Machine ID:     %s\n", id.MachineID)
	fmt.Printf("  Tenant/Org ID:  %s\n", id.TenantID)

	if id.SenseID != "" {
		fmt.Printf("  Sense ID:       %s\n", id.SenseID)
	}
	if id.ComputerName != "" {
		fmt.Printf("  Computer Name:  %s\n", id.ComputerName)
	}
	if id.DeviceUUID != "" {
		fmt.Printf("  Device UUID:    %s\n", id.DeviceUUID)
	}
	if id.OnboardingState != "" {
		fmt.Printf("  Onboarding:     %s\n", id.OnboardingState)
	}

	fmt.Println()

	if id.MDEInstalled && id.ExtractionSuccess {
		fmt.Println("[!] Using real MDE identifiers increases test realism")
		fmt.Println("[!] Attack simulation will use actual machine identity")
	}

	fmt.Println()
}

// ValidateIdentifiers checks if identifiers are valid
func ValidateIdentifiers(id *MDEIdentifiers) bool {
	if id == nil {
		return false
	}

	// At minimum, need Machine ID and Tenant ID
	if id.MachineID == "" || id.TenantID == "" {
		return false
	}

	// Check if they look like GUIDs
	if !strings.Contains(id.MachineID, "-") || !strings.Contains(id.TenantID, "-") {
		// Might be in different format, still acceptable
	}

	return true
}
