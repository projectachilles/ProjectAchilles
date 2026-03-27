package status

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/f0rt1ka/achilles-agent/internal/config"
	"github.com/f0rt1ka/achilles-agent/internal/service"
	"github.com/f0rt1ka/achilles-agent/internal/store"
)

// ConnResult holds the outcome of a server connectivity check.
type ConnResult struct {
	Reachable bool
	Latency   time.Duration
	ErrMsg    string
}

// CheckConnection performs a TCP (or TLS) dial to the server to verify
// network reachability without sending any agent credentials.
func CheckConnection(serverURL string, cfg *config.Config) ConnResult {
	parsed, err := url.Parse(serverURL)
	if err != nil {
		return ConnResult{ErrMsg: err.Error()}
	}

	host := parsed.Hostname()
	port := parsed.Port()
	if port == "" {
		switch parsed.Scheme {
		case "https":
			port = "443"
		default:
			port = "80"
		}
	}
	addr := net.JoinHostPort(host, port)

	const timeout = 5 * time.Second
	start := time.Now()

	if parsed.Scheme == "https" {
		tlsCfg := &tls.Config{
			InsecureSkipVerify: cfg.SkipTLSVerify,
			MinVersion:         tls.VersionTLS12,
		}

		// Load custom CA if configured.
		if cfg.CACert != "" {
			pem, err := os.ReadFile(cfg.CACert)
			if err == nil {
				pool := x509.NewCertPool()
				pool.AppendCertsFromPEM(pem)
				tlsCfg.RootCAs = pool
			}
		}

		dialer := &net.Dialer{Timeout: timeout}
		conn, err := tls.DialWithDialer(dialer, "tcp", addr, tlsCfg)
		latency := time.Since(start)
		if err != nil {
			return ConnResult{ErrMsg: err.Error(), Latency: latency}
		}
		conn.Close()
		return ConnResult{Reachable: true, Latency: latency}
	}

	// Plain TCP for http:// (localhost dev only).
	conn, err := net.DialTimeout("tcp", addr, timeout)
	latency := time.Since(start)
	if err != nil {
		return ConnResult{ErrMsg: err.Error(), Latency: latency}
	}
	conn.Close()
	return ConnResult{Reachable: true, Latency: latency}
}

// PrintStatus prints a comprehensive agent status report to stdout.
// configPath is the path to the YAML config file (needed for the not-enrolled
// case and for reading raw YAML to check encryption status).
func PrintStatus(configPath string, version string) {
	cfg, err := config.Load(configPath)
	if err != nil {
		fmt.Printf("Achilles Agent v%s\n", version)
		fmt.Printf("Status: not enrolled (no config at %s)\n", configPath)
		return
	}

	// --- Header ---
	fmt.Println("Achilles Agent Status")
	fmt.Println("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500")
	fmt.Printf("  Agent ID:        %s\n", cfg.AgentID)
	if cfg.OrgID != "" {
		fmt.Printf("  Org ID:          %s\n", cfg.OrgID)
	}
	fmt.Printf("  Server URL:      %s\n", cfg.ServerURL)
	fmt.Printf("  Version:         %s\n", version)

	// --- Service ---
	fmt.Println()
	fmt.Println("Service")
	svcStatus := service.ServiceStatus()
	if svcStatus.Running {
		fmt.Printf("  Status:          running (PID %d)\n", svcStatus.PID)
	} else if svcStatus.Installed {
		fmt.Println("  Status:          stopped")
	} else {
		fmt.Println("  Status:          not installed")
	}
	fmt.Printf("  Installed:       %s\n", yesNo(svcStatus.Installed))

	// --- Connection ---
	fmt.Println()
	fmt.Println("Connection")
	conn := CheckConnection(cfg.ServerURL, cfg)
	if conn.Reachable {
		fmt.Printf("  Server:          reachable (%dms)\n", conn.Latency.Milliseconds())
	} else {
		fmt.Printf("  Server:          unreachable (%s)\n", conn.ErrMsg)
	}

	// Last heartbeat from state file.
	st, err := store.New(cfg.WorkDir)
	if err == nil {
		state := st.Get()
		if state.LastHeartbeat != nil {
			ago := time.Since(*state.LastHeartbeat).Truncate(time.Second)
			fmt.Printf("  Last Heartbeat:  %s ago\n", formatDuration(ago))
		} else {
			fmt.Println("  Last Heartbeat:  never")
		}
	}

	fmt.Printf("  TLS Verify:      %s\n", yesNo(!cfg.SkipTLSVerify))
	fmt.Printf("  Key Encrypted:   %s\n", yesNo(isKeyEncryptedOnDisk(configPath)))

	// --- Configuration ---
	fmt.Println()
	fmt.Println("Configuration")
	fmt.Printf("  Config File:     %s\n", configPath)
	fmt.Printf("  Poll Interval:   %s\n", cfg.PollInterval)
	fmt.Printf("  Heartbeat:       %s\n", cfg.HeartbeatInterval)
	fmt.Printf("  Work Dir:        %s\n", cfg.WorkDir)
	if cfg.LogFile != "" {
		fmt.Printf("  Log File:        %s\n", cfg.LogFile)
	}
}

// isKeyEncryptedOnDisk reads the raw YAML config file and checks whether
// the agent_key_encrypted field is present (meaning the key is encrypted
// at rest). config.Load() decrypts the key in memory, so we must check
// the file directly.
func isKeyEncryptedOnDisk(path string) bool {
	data, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	for _, line := range strings.Split(string(data), "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "agent_key_encrypted:") {
			// Ensure it has a non-empty value.
			val := strings.TrimSpace(strings.TrimPrefix(trimmed, "agent_key_encrypted:"))
			return val != "" && val != `""`
		}
	}
	return false
}

// formatDuration returns a human-friendly duration string like "45s", "12m30s".
func formatDuration(d time.Duration) string {
	if d < time.Minute {
		return fmt.Sprintf("%ds", int(d.Seconds()))
	}
	if d < time.Hour {
		m := int(d.Minutes())
		s := int(d.Seconds()) % 60
		if s == 0 {
			return fmt.Sprintf("%dm", m)
		}
		return fmt.Sprintf("%dm%ds", m, s)
	}
	h := int(d.Hours())
	m := int(d.Minutes()) % 60
	if m == 0 {
		return fmt.Sprintf("%dh", h)
	}
	return fmt.Sprintf("%dh%dm", h, m)
}

func yesNo(b bool) string {
	if b {
		return "yes"
	}
	return "no"
}
