package config

import (
	"os"
	"path/filepath"
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
