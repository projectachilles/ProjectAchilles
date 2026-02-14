//go:build !windows

package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSecureFilePermissions(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.yaml")

	// Create file with overly permissive mode
	if err := os.WriteFile(path, []byte("test"), 0644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	// Verify it starts permissive
	info, _ := os.Stat(path)
	if info.Mode().Perm() != 0644 {
		t.Fatalf("expected 0644, got %o", info.Mode().Perm())
	}

	// Apply secure permissions
	if err := secureFilePermissions(path); err != nil {
		t.Fatalf("secureFilePermissions: %v", err)
	}

	// Verify 0600
	info, _ = os.Stat(path)
	if info.Mode().Perm() != 0600 {
		t.Errorf("expected 0600, got %o", info.Mode().Perm())
	}
}

func TestSaveEnforcesPermissions(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")

	cfg := DefaultConfig()
	cfg.ServerURL = "https://example.com"
	cfg.AgentID = "agent-001"
	cfg.AgentKey = "ak_test"

	if err := cfg.Save(path); err != nil {
		t.Fatalf("Save: %v", err)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("Stat: %v", err)
	}
	if info.Mode().Perm() != 0600 {
		t.Errorf("Save should enforce 0600, got %o", info.Mode().Perm())
	}
}
