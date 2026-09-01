package config

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestValidateServerURL(t *testing.T) {
	tests := []struct {
		name    string
		url     string
		wantErr bool
	}{
		// Valid HTTPS
		{"https remote", "https://server.example.com", false},
		{"https with port", "https://server.example.com:8443", false},
		{"https with path", "https://server.example.com/api", false},
		{"https localhost", "https://localhost:3000", false},
		{"https IP", "https://10.0.0.1:443", false},

		// Valid HTTP localhost exceptions
		{"http localhost", "http://localhost:3000", false},
		{"http localhost no port", "http://localhost", false},
		{"http 127.0.0.1", "http://127.0.0.1:3000", false},
		{"http 127.0.0.1 no port", "http://127.0.0.1", false},
		{"http [::1]", "http://[::1]:3000", false},
		{"http [::1] no port", "http://[::1]", false},

		// Rejected: HTTP to remote hosts
		{"http remote", "http://server.example.com", true},
		{"http remote with port", "http://10.0.0.1:3000", true},
		{"http remote IP", "http://192.168.1.100", true},
		// Tricky: localhost.evil.com is NOT localhost
		{"http localhost.evil.com", "http://localhost.evil.com", true},

		// Rejected: missing scheme
		{"no scheme", "server.example.com", true},

		// Rejected: other schemes
		{"ftp scheme", "ftp://server.example.com", true},
		{"ws scheme", "ws://server.example.com", true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateServerURL(tc.url)
			if (err != nil) != tc.wantErr {
				t.Errorf("ValidateServerURL(%q) error = %v, wantErr %v", tc.url, err, tc.wantErr)
			}
		})
	}
}

func TestValidateTLSConfig(t *testing.T) {
	tests := []struct {
		name          string
		serverURL     string
		skipTLS       bool
		allowInsecure bool
		wantErr       bool
	}{
		// TLS verification enabled — always pass
		{"tls enabled, remote", "https://server.example.com", false, false, false},
		{"tls enabled, localhost", "https://localhost:3000", false, false, false},

		// skip_tls_verify + localhost — always pass
		{"skip + localhost", "https://localhost:3000", true, false, false},
		{"skip + 127.0.0.1", "https://127.0.0.1:8443", true, false, false},
		{"skip + [::1]", "https://[::1]:3000", true, false, false},

		// skip_tls_verify + remote — error unless allowInsecure
		{"skip + remote, no override", "https://server.example.com", true, false, true},
		{"skip + remote IP, no override", "https://10.0.0.1:8443", true, false, true},
		{"skip + remote, allow-insecure", "https://server.example.com", true, true, false},
		{"skip + remote IP, allow-insecure", "https://10.0.0.1:8443", true, true, false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			cfg := DefaultConfig()
			cfg.ServerURL = tc.serverURL
			cfg.AgentID = "agent-001"
			cfg.AgentKey = "ak_key"
			cfg.SkipTLSVerify = tc.skipTLS

			err := cfg.ValidateTLSConfig(tc.allowInsecure)
			if (err != nil) != tc.wantErr {
				t.Errorf("ValidateTLSConfig() error = %v, wantErr %v", err, tc.wantErr)
			}
		})
	}
}

func TestValidateIntegration(t *testing.T) {
	// Validate() should reject http:// to remote
	cfg := DefaultConfig()
	cfg.ServerURL = "http://remote.example.com"
	cfg.AgentID = "agent-001"
	cfg.AgentKey = "ak_key"
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected Validate() to reject http:// remote URL")
	}

	// Validate() should accept https://
	cfg.ServerURL = "https://server.example.com"
	if err := cfg.Validate(); err != nil {
		t.Fatalf("unexpected validation error: %v", err)
	}

	// Validate() should accept http://localhost
	cfg.ServerURL = "http://localhost:3000"
	if err := cfg.Validate(); err != nil {
		t.Fatalf("unexpected validation error for localhost: %v", err)
	}
}

func TestLoadPlaintextKeyAutoMigrates(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")

	// Write a config with plaintext agent_key
	content := `server_url: https://example.com
agent_id: agent-001
agent_key: ak_secret123
`
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	// In-memory should have the decrypted key
	if cfg.AgentKey != "ak_secret123" {
		t.Errorf("expected AgentKey=ak_secret123, got %q", cfg.AgentKey)
	}

	// On-disk should no longer have plaintext
	data, _ := os.ReadFile(path)
	if strings.Contains(string(data), "ak_secret123") {
		t.Error("plaintext key should not appear in saved config after auto-migration")
	}
	if !strings.Contains(string(data), "agent_key_encrypted:") {
		t.Error("saved config should contain agent_key_encrypted field")
	}
}

func TestLoadEncryptedKey(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")

	// Save a config (will encrypt the key)
	cfg := DefaultConfig()
	cfg.ServerURL = "https://example.com"
	cfg.AgentID = "agent-001"
	cfg.AgentKey = "ak_encrypted-test"
	if err := cfg.Save(path); err != nil {
		t.Fatalf("Save: %v", err)
	}

	// Load should decrypt successfully
	loaded, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if loaded.AgentKey != "ak_encrypted-test" {
		t.Errorf("expected AgentKey=ak_encrypted-test, got %q", loaded.AgentKey)
	}
}

func TestPersistSavesToLoadPath(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.yaml")

	// Write initial config
	content := `server_url: https://example.com
agent_id: agent-001
agent_key: ak_persist_test
`
	if err := os.WriteFile(cfgPath, []byte(content), 0600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	cfg, err := Load(cfgPath)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	// Modify the key in memory
	cfg.AgentKey = "ak_new_rotated_key"

	// Persist should save to the same path
	if err := cfg.Persist(); err != nil {
		t.Fatalf("Persist: %v", err)
	}

	// Reload and verify
	reloaded, err := Load(cfgPath)
	if err != nil {
		t.Fatalf("Reload: %v", err)
	}
	if reloaded.AgentKey != "ak_new_rotated_key" {
		t.Errorf("expected AgentKey=ak_new_rotated_key, got %q", reloaded.AgentKey)
	}
}

func TestPersistErrorsWithEmptyConfigPath(t *testing.T) {
	cfg := DefaultConfig()
	cfg.ServerURL = "https://example.com"
	cfg.AgentID = "agent-001"
	cfg.AgentKey = "ak_test"

	err := cfg.Persist()
	if err == nil {
		t.Fatal("expected Persist() to error when configPath is empty")
	}
	if !strings.Contains(err.Error(), "not loaded from a file") {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestSaveNeverWritesPlaintextKey(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")

	cfg := DefaultConfig()
	cfg.ServerURL = "https://example.com"
	cfg.AgentID = "agent-001"
	cfg.AgentKey = "ak_should-not-appear"

	if err := cfg.Save(path); err != nil {
		t.Fatalf("Save: %v", err)
	}

	data, _ := os.ReadFile(path)
	if strings.Contains(string(data), "ak_should-not-appear") {
		t.Error("plaintext key should never appear in saved config")
	}

	// Runtime struct should still have the key
	if cfg.AgentKey != "ak_should-not-appear" {
		t.Error("Save should not modify in-memory AgentKey")
	}
}

// Save must be atomic: the config either has its previous contents or the new
// ones, never a truncated in-between. os.WriteFile truncates the target before
// writing, so a crash or a full disk mid-write left the agent with no usable
// key — a brick that no server-side change can undo, because the credential is
// simply gone from the endpoint.
func TestSaveIsAtomicAndLeavesNoTempFiles(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.yaml")

	content := `server_url: https://example.com
agent_id: agent-001
agent_key: ak_original
`
	if err := os.WriteFile(cfgPath, []byte(content), 0600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	cfg, err := Load(cfgPath)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	for _, key := range []string{"ak_a", "ak_b", "ak_c"} {
		cfg.AgentKey = key
		if err := cfg.Save(cfgPath); err != nil {
			t.Fatalf("Save(%s): %v", key, err)
		}
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	if len(entries) != 1 || entries[0].Name() != "config.yaml" {
		names := make([]string, 0, len(entries))
		for _, e := range entries {
			names = append(names, e.Name())
		}
		t.Errorf("directory contains %v, want only config.yaml — a leaked temp file holds the agent key", names)
	}

	reloaded, err := Load(cfgPath)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if reloaded.AgentKey != "ak_c" {
		t.Errorf("AgentKey = %q, want ak_c", reloaded.AgentKey)
	}
}

// A failed Save must leave the previous config intact and loadable, rather than
// destroying the agent's only credential.
func TestSaveFailureLeavesExistingConfigIntact(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("running as root: directory permissions are not enforced")
	}

	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.yaml")

	content := `server_url: https://example.com
agent_id: agent-001
agent_key: ak_original
`
	if err := os.WriteFile(cfgPath, []byte(content), 0600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	cfg, err := Load(cfgPath)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	if err := os.Chmod(dir, 0500); err != nil {
		t.Fatalf("chmod: %v", err)
	}
	t.Cleanup(func() { _ = os.Chmod(dir, 0700) })

	cfg.AgentKey = "ak_replacement"
	if err := cfg.Save(cfgPath); err == nil {
		t.Fatal("expected Save to fail in an unwritable directory")
	}

	_ = os.Chmod(dir, 0700)
	reloaded, err := Load(cfgPath)
	if err != nil {
		t.Fatalf("config unreadable after a failed Save: %v", err)
	}
	if reloaded.AgentKey != "ak_original" {
		t.Errorf("AgentKey = %q, want ak_original", reloaded.AgentKey)
	}
}

// The key is written encrypted, and the file must never be readable by others.
func TestSaveKeepsRestrictivePermissions(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX mode bits do not apply on Windows")
	}

	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.yaml")
	cfg := DefaultConfig()
	cfg.ServerURL = "https://example.com"
	cfg.AgentID = "agent-001"
	cfg.AgentKey = "ak_secret"

	if err := cfg.Save(cfgPath); err != nil {
		t.Fatalf("Save: %v", err)
	}

	info, err := os.Stat(cfgPath)
	if err != nil {
		t.Fatalf("Stat: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0600 {
		t.Errorf("config mode = %o, want 600", perm)
	}
}
