//go:build windows
// +build windows

/*
STAGE 1: Ingress Tool Transfer (T1105)
Downloads Tailscale MSI installer from official servers
*/

package main

import (
	_ "embed"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	TEST_UUID      = "eafce2fc-75fd-4c62-92dc-32cabe5cf206"
	TECHNIQUE_ID   = "T1105"
	TECHNIQUE_NAME = "Ingress Tool Transfer"
	STAGE_ID       = 1

	// Latest stable Tailscale MSI for Windows amd64
	TAILSCALE_MSI_URL = "https://pkgs.tailscale.com/stable/tailscale-setup-1.78.3-amd64.msi"
)

// Embed Tailscale MSI (backup if download fails)
//go:embed tailscale_embedded.msi
var tailscaleEmbedded []byte

// Standardized stage exit codes
const (
	StageSuccess     = 0
	StageBlocked     = 126
	StageQuarantined = 105
	StageError       = 999
)

func main() {
	// Attach to shared log created by main orchestrator
	AttachLogger(TEST_UUID, fmt.Sprintf("Stage %d: %s", STAGE_ID, TECHNIQUE_ID))

	LogMessage("INFO", TECHNIQUE_ID, "Starting Ingress Tool Transfer")
	LogStageStart(STAGE_ID, TECHNIQUE_ID, "Download Tailscale MSI installer")

	// Read configuration
	config, err := readConfig()
	if err != nil {
		fmt.Printf("[STAGE T1105] Failed to read config: %v\n", err)
		LogMessage("ERROR", TECHNIQUE_ID, fmt.Sprintf("Failed to read config: %v", err))
		LogStageEnd(STAGE_ID, TECHNIQUE_ID, "error", "Configuration error")
		os.Exit(StageError)
	}

	var downloadSuccess bool
	var downloadErr error

	// Attempt download if configured
	if config["DOWNLOAD_MODE"] == "true" {
		LogMessage("INFO", TECHNIQUE_ID, "Mode: Download MSI from official servers")
		downloadSuccess, downloadErr = downloadTailscaleMSI()
	} else {
		LogMessage("INFO", TECHNIQUE_ID, "Mode: Use embedded MSI")
		downloadSuccess, downloadErr = useEmbeddedMSI()
	}

	if downloadErr != nil {
		// Check if download was blocked by security controls
		if strings.Contains(downloadErr.Error(), "connection refused") ||
			strings.Contains(downloadErr.Error(), "timeout") ||
			strings.Contains(downloadErr.Error(), "access denied") ||
			strings.Contains(downloadErr.Error(), "blocked") {

			fmt.Printf("[STAGE T1105] Download blocked: %v\n", downloadErr)
			LogMessage("BLOCKED", TECHNIQUE_ID, fmt.Sprintf("Download blocked: %v", downloadErr))
			LogStageBlocked(STAGE_ID, TECHNIQUE_ID, downloadErr.Error())
			os.Exit(StageBlocked)
		}

		// Other error
		fmt.Printf("[STAGE T1105] Download failed: %v\n", downloadErr)
		LogMessage("ERROR", TECHNIQUE_ID, fmt.Sprintf("Download failed: %v", downloadErr))
		LogStageEnd(STAGE_ID, TECHNIQUE_ID, "error", downloadErr.Error())
		os.Exit(StageError)
	}

	if !downloadSuccess {
		fmt.Printf("[STAGE T1105] Failed to acquire Tailscale MSI\n")
		LogMessage("ERROR", TECHNIQUE_ID, "Failed to acquire Tailscale MSI")
		LogStageEnd(STAGE_ID, TECHNIQUE_ID, "error", "MSI acquisition failed")
		os.Exit(StageError)
	}

	// Verify MSI was written successfully
	targetPath := filepath.Join("c:\\F0", "tailscale-setup.msi")
	if _, err := os.Stat(targetPath); os.IsNotExist(err) {
		fmt.Printf("[STAGE T1105] Tailscale MSI not found after download\n")
		LogMessage("ERROR", TECHNIQUE_ID, "Tailscale MSI not found after download")
		LogStageEnd(STAGE_ID, TECHNIQUE_ID, "error", "MSI verification failed")
		os.Exit(StageError)
	}

	LogMessage("SUCCESS", TECHNIQUE_ID, fmt.Sprintf("Tailscale MSI acquired: %s", targetPath))
	LogStageEnd(STAGE_ID, TECHNIQUE_ID, "success", "Tailscale MSI successfully acquired")
	os.Exit(StageSuccess)
}

func downloadTailscaleMSI() (bool, error) {
	targetPath := filepath.Join("c:\\F0", "tailscale-setup.msi")

	LogMessage("INFO", TECHNIQUE_ID, fmt.Sprintf("Downloading from: %s", TAILSCALE_MSI_URL))

	// Create HTTP client with timeout (2 minutes for larger MSI file)
	client := &http.Client{
		Timeout: 120 * time.Second,
	}

	// Attempt download
	resp, err := client.Get(TAILSCALE_MSI_URL)
	if err != nil {
		return false, fmt.Errorf("HTTP request blocked/failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return false, fmt.Errorf("download failed: HTTP %d", resp.StatusCode)
	}

	// Create output file
	out, err := os.Create(targetPath)
	if err != nil {
		return false, fmt.Errorf("file creation failed: %v", err)
	}
	defer out.Close()

	// Write to file
	written, err := io.Copy(out, resp.Body)
	if err != nil {
		return false, fmt.Errorf("file write failed: %v", err)
	}

	LogMessage("INFO", TECHNIQUE_ID, fmt.Sprintf("Downloaded %d bytes", written))

	// Wait for defensive reaction
	time.Sleep(3 * time.Second)

	// Check if file was quarantined
	if _, err := os.Stat(targetPath); os.IsNotExist(err) {
		return false, fmt.Errorf("file quarantined after download")
	}

	return true, nil
}

func useEmbeddedMSI() (bool, error) {
	targetPath := filepath.Join("c:\\F0", "tailscale-setup.msi")

	LogMessage("INFO", TECHNIQUE_ID, "Extracting embedded Tailscale MSI")

	// Write embedded MSI
	if err := os.WriteFile(targetPath, tailscaleEmbedded, 0755); err != nil {
		return false, fmt.Errorf("failed to extract MSI: %v", err)
	}

	LogMessage("INFO", TECHNIQUE_ID, fmt.Sprintf("Extracted %d bytes", len(tailscaleEmbedded)))

	// Wait for defensive reaction
	time.Sleep(3 * time.Second)

	// Check if file was quarantined
	if _, err := os.Stat(targetPath); os.IsNotExist(err) {
		return false, fmt.Errorf("MSI quarantined after extraction")
	}

	return true, nil
}

func readConfig() (map[string]string, error) {
	configPath := filepath.Join("c:\\F0", "test_config.txt")
	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, err
	}

	config := make(map[string]string)
	lines := strings.Split(string(data), "\n")
	for _, line := range lines {
		parts := strings.SplitN(strings.TrimSpace(line), "=", 2)
		if len(parts) == 2 {
			config[parts[0]] = parts[1]
		}
	}

	return config, nil
}