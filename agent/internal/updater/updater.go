package updater

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"

	"github.com/f0rt1ka/achilles-agent/internal/config"
	"github.com/f0rt1ka/achilles-agent/internal/httpclient"
)

// VersionInfo represents the server's response to a version check.
type VersionInfo struct {
	Version   string `json:"version"`
	SHA256    string `json:"sha256"`
	Size      int64  `json:"size"`
	Mandatory bool   `json:"mandatory"`
}

// CheckAndUpdate checks for a newer agent version and applies the update if available.
// Returns (true, nil) if an update was applied and the agent should restart.
// Returns (false, nil) if no update is needed.
func CheckAndUpdate(ctx context.Context, client *httpclient.Client, currentVersion string, cfg *config.Config) (bool, error) {
	info, err := fetchVersionInfo(ctx, client, currentVersion)
	if err != nil {
		return false, err
	}
	if info == nil {
		return false, nil
	}

	log.Printf("Update available: %s -> %s (mandatory=%v)", currentVersion, info.Version, info.Mandatory)

	currentBin, err := resolveExecutablePath()
	if err != nil {
		return false, err
	}

	tmpPath, err := downloadAndVerify(ctx, client, info, filepath.Dir(currentBin))
	if err != nil {
		return false, err
	}
	// Clean up the temp file on any error after this point.
	defer os.Remove(tmpPath)

	if err := applyUpdate(currentBin, tmpPath); err != nil {
		return false, fmt.Errorf("apply update: %w", err)
	}

	log.Printf("Update applied successfully. Agent should restart.")
	return true, nil
}

// versionResponse wraps the server's JSON envelope for a version check.
type versionResponse struct {
	Success bool        `json:"success"`
	Data    VersionInfo `json:"data"`
}

// fetchVersionInfo queries the server for the latest version. Returns nil when
// no update is available (204 response or version matches currentVersion).
func fetchVersionInfo(ctx context.Context, client *httpclient.Client, currentVersion string) (*VersionInfo, error) {
	resp, err := client.Do(ctx, http.MethodGet, "/api/agent/version", nil)
	if err != nil {
		return nil, fmt.Errorf("version check: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNoContent {
		return nil, nil
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("version check returned status %d", resp.StatusCode)
	}

	var envelope versionResponse
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		return nil, fmt.Errorf("decode version info: %w", err)
	}

	info := envelope.Data
	if info.Version == currentVersion {
		return nil, nil
	}

	return &info, nil
}

// resolveExecutablePath returns the real path of the currently running binary,
// resolving any symlinks.
func resolveExecutablePath() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("get executable path: %w", err)
	}

	resolved, err := filepath.EvalSymlinks(exe)
	if err != nil {
		return "", fmt.Errorf("resolve executable path: %w", err)
	}

	return resolved, nil
}

// downloadAndVerify fetches the update binary from the server, writes it to a
// temp file in dir, and verifies its SHA256 digest and size against info.
// On success it returns the path to the verified temp file; the caller is
// responsible for cleanup.
func downloadAndVerify(ctx context.Context, client *httpclient.Client, info *VersionInfo, dir string) (string, error) {
	downloadPath := fmt.Sprintf("/api/agent/update?os=%s&arch=%s", runtime.GOOS, runtime.GOARCH)

	dlResp, err := client.Do(ctx, http.MethodGet, downloadPath, nil)
	if err != nil {
		return "", fmt.Errorf("download update: %w", err)
	}
	defer dlResp.Body.Close()

	if dlResp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download returned status %d", dlResp.StatusCode)
	}

	tmpFile, err := os.CreateTemp(dir, "achilles-update-*")
	if err != nil {
		return "", fmt.Errorf("create temp file: %w", err)
	}
	tmpPath := tmpFile.Name()

	hasher := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(tmpFile, hasher), dlResp.Body)

	// Always close the temp file before checking errors or returning.
	tmpFile.Close()

	if copyErr != nil {
		os.Remove(tmpPath)
		return "", fmt.Errorf("write update binary: %w", copyErr)
	}

	if info.Size > 0 && written != info.Size {
		os.Remove(tmpPath)
		return "", fmt.Errorf("size mismatch: expected %d, got %d", info.Size, written)
	}

	actualHash := hex.EncodeToString(hasher.Sum(nil))
	if actualHash != info.SHA256 {
		os.Remove(tmpPath)
		return "", fmt.Errorf("SHA256 mismatch: expected %s, got %s", info.SHA256, actualHash)
	}

	log.Printf("Update downloaded and verified: %d bytes, sha256=%s", written, actualHash)
	return tmpPath, nil
}
