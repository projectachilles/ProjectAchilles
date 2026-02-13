package config

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"gopkg.in/yaml.v3"
)

// Config holds all agent configuration fields.
type Config struct {
	ServerURL         string        `yaml:"server_url"`
	PollInterval      time.Duration `yaml:"poll_interval"`
	HeartbeatInterval time.Duration `yaml:"heartbeat_interval"`
	AgentID           string        `yaml:"agent_id"`
	AgentKey          string        `yaml:"agent_key"`
	OrgID             string        `yaml:"org_id"`
	WorkDir           string        `yaml:"work_dir"`
	LogFile           string        `yaml:"log_file"`
	MaxExecutionTime  time.Duration `yaml:"max_execution_time"`
	MaxBinarySize     int64         `yaml:"max_binary_size"`
	UpdateInterval    time.Duration `yaml:"update_interval"`
	CACert            string        `yaml:"ca_cert"`
	SkipTLSVerify     bool          `yaml:"skip_tls_verify"`
}

// DefaultConfig returns a Config populated with sensible defaults.
func DefaultConfig() Config {
	workDir := "/opt/f0/tasks"
	logFile := "/opt/f0/achilles-agent.log"
	if runtime.GOOS == "windows" {
		workDir = `C:\F0\tasks`
		logFile = `C:\F0\achilles-agent.log`
	}

	return Config{
		PollInterval:      30 * time.Second,
		HeartbeatInterval: 60 * time.Second,
		MaxExecutionTime:  5 * time.Minute,
		UpdateInterval:    1 * time.Hour,
		MaxBinarySize:     100 * 1024 * 1024, // 100 MB
		WorkDir:           workDir,
		LogFile:           logFile,
	}
}

// DefaultConfigPath returns the platform-specific default path for the config file.
func DefaultConfigPath() string {
	if runtime.GOOS == "windows" {
		return `C:\F0\achilles-agent.yaml`
	}
	return "/opt/f0/achilles-agent.yaml"
}

// Load reads a YAML config file and unmarshals it on top of DefaultConfig,
// so any fields missing from the file retain their default values.
func Load(path string) (*Config, error) {
	cfg := DefaultConfig()

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config %s: %w", path, err)
	}

	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse config %s: %w", path, err)
	}

	return &cfg, nil
}

// Save writes the Config as YAML to the given path, creating parent directories
// with mode 0700 and the file with mode 0600.
func (c *Config) Save(path string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("create config dir %s: %w", dir, err)
	}

	data, err := yaml.Marshal(c)
	if err != nil {
		return fmt.Errorf("marshal config: %w", err)
	}

	if err := os.WriteFile(path, data, 0600); err != nil {
		return fmt.Errorf("write config %s: %w", path, err)
	}

	return nil
}

// ValidateServerURL checks that rawURL uses https://, or http:// only for
// localhost/127.0.0.1/[::1]. This prevents agents from sending credentials
// over plaintext connections to remote servers.
func ValidateServerURL(rawURL string) error {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid server URL %q: %w", rawURL, err)
	}

	switch parsed.Scheme {
	case "https":
		return nil
	case "http":
		host := parsed.Hostname()
		if host == "localhost" || host == "127.0.0.1" || host == "::1" {
			return nil
		}
		return fmt.Errorf("server URL %q uses plaintext HTTP to a remote host; use https:// or connect to localhost for development", rawURL)
	case "":
		return fmt.Errorf("server URL %q has no scheme; use https://", rawURL)
	default:
		return fmt.Errorf("server URL %q uses unsupported scheme %q; use https://", rawURL, parsed.Scheme)
	}
}

// ValidateTLSConfig checks that SkipTLSVerify is not enabled for remote servers
// unless explicitly overridden with --allow-insecure. This is called from main.go
// after Validate(), keeping the Validate() signature unchanged for other callers.
func (c *Config) ValidateTLSConfig(allowInsecure bool) error {
	if !c.SkipTLSVerify {
		return nil
	}

	// Always allow skip_tls_verify for localhost/loopback
	parsed, err := url.Parse(c.ServerURL)
	if err != nil {
		return fmt.Errorf("invalid server URL %q: %w", c.ServerURL, err)
	}
	host := parsed.Hostname()
	if host == "localhost" || host == "127.0.0.1" || host == "::1" {
		return nil
	}

	// Explicit override for legitimate self-signed cert scenarios
	if allowInsecure {
		return nil
	}

	return fmt.Errorf(
		"skip_tls_verify is enabled for remote server %q — this disables all certificate verification. "+
			"Use ca_cert to trust a specific CA, or pass --allow-insecure to override this check",
		c.ServerURL,
	)
}

// Validate checks that required fields are populated.
func (c *Config) Validate() error {
	if c.ServerURL == "" {
		return fmt.Errorf("server_url is required")
	}
	if err := ValidateServerURL(c.ServerURL); err != nil {
		return err
	}
	if c.AgentID == "" {
		return fmt.Errorf("agent_id is required")
	}
	if c.AgentKey == "" {
		return fmt.Errorf("agent_key is required")
	}
	return nil
}
