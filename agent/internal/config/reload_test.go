package config

import (
	"strings"
	"testing"
	"time"
)

func TestApplyHotReload(t *testing.T) {
	type checks struct {
		// Each entry asserts a field on `current` after reload.
		serverURL string
		poll      time.Duration
		hb        time.Duration
		caCert    string
		skipTLS   bool
	}
	tests := []struct {
		name        string
		current     Config
		next        Config
		wantChanged []string
		wantErr     string // substring; "" = no error expected
		want        checks
	}{
		{
			name: "no-op reload",
			current: Config{
				ServerURL: "https://a.example.com", PollInterval: 30 * time.Second,
				HeartbeatInterval: 60 * time.Second, AgentID: "id-1", OrgID: "org-1",
				WorkDir: "/opt/f0/tasks",
			},
			next: Config{
				ServerURL: "https://a.example.com", PollInterval: 30 * time.Second,
				HeartbeatInterval: 60 * time.Second, AgentID: "id-1", OrgID: "org-1",
				WorkDir: "/opt/f0/tasks",
			},
			wantChanged: nil,
			want: checks{
				serverURL: "https://a.example.com",
				poll:      30 * time.Second, hb: 60 * time.Second,
			},
		},
		{
			name: "server URL rotation",
			current: Config{
				ServerURL: "https://old.example.com", PollInterval: 30 * time.Second,
				HeartbeatInterval: 60 * time.Second, AgentID: "id-1",
			},
			next: Config{
				ServerURL: "https://new.example.com", PollInterval: 30 * time.Second,
				HeartbeatInterval: 60 * time.Second, AgentID: "id-1",
			},
			wantChanged: []string{"server_url"},
			want: checks{
				serverURL: "https://new.example.com",
				poll:      30 * time.Second, hb: 60 * time.Second,
			},
		},
		{
			name: "interval + TLS retune",
			current: Config{
				ServerURL: "https://a.example.com", PollInterval: 30 * time.Second,
				HeartbeatInterval: 60 * time.Second, AgentID: "id-1",
				CACert: "", SkipTLSVerify: false,
			},
			next: Config{
				ServerURL: "https://a.example.com", PollInterval: 10 * time.Second,
				HeartbeatInterval: 30 * time.Second, AgentID: "id-1",
				CACert: "/etc/ssl/custom-ca.pem", SkipTLSVerify: true,
			},
			wantChanged: []string{"poll_interval", "heartbeat_interval", "ca_cert", "skip_tls_verify"},
			want: checks{
				serverURL: "https://a.example.com",
				poll:      10 * time.Second, hb: 30 * time.Second,
				caCert: "/etc/ssl/custom-ca.pem", skipTLS: true,
			},
		},
		{
			name: "agent_id mutation refused",
			current: Config{
				ServerURL: "https://a.example.com", AgentID: "id-1", OrgID: "org-1",
			},
			next: Config{
				ServerURL: "https://a.example.com", AgentID: "id-2", OrgID: "org-1",
			},
			wantErr: "agent_id is immutable",
			want:    checks{serverURL: "https://a.example.com"},
		},
		{
			name: "work_dir mutation refused (and partial swap not applied)",
			current: Config{
				ServerURL: "https://old.example.com", AgentID: "id-1", WorkDir: "/opt/f0/tasks",
			},
			next: Config{
				ServerURL: "https://new.example.com", AgentID: "id-1", WorkDir: "/var/lib/f0",
			},
			wantErr: "work_dir is immutable",
			// IMPORTANT: server_url should NOT have been applied — refusal is all-or-nothing.
			want: checks{serverURL: "https://old.example.com"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			cur := tc.current
			changed, err := cur.ApplyHotReload(&tc.next)

			if tc.wantErr != "" {
				if err == nil {
					t.Fatalf("expected error containing %q, got nil", tc.wantErr)
				}
				if !strings.Contains(err.Error(), tc.wantErr) {
					t.Fatalf("expected error containing %q, got %q", tc.wantErr, err.Error())
				}
			} else if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			if tc.wantErr == "" {
				if !equalStringSets(changed, tc.wantChanged) {
					t.Errorf("changed fields = %v, want %v", changed, tc.wantChanged)
				}
			}

			if cur.ServerURL != tc.want.serverURL {
				t.Errorf("ServerURL = %q, want %q", cur.ServerURL, tc.want.serverURL)
			}
			if tc.want.poll != 0 && cur.PollInterval != tc.want.poll {
				t.Errorf("PollInterval = %s, want %s", cur.PollInterval, tc.want.poll)
			}
			if tc.want.hb != 0 && cur.HeartbeatInterval != tc.want.hb {
				t.Errorf("HeartbeatInterval = %s, want %s", cur.HeartbeatInterval, tc.want.hb)
			}
			if tc.want.caCert != "" && cur.CACert != tc.want.caCert {
				t.Errorf("CACert = %q, want %q", cur.CACert, tc.want.caCert)
			}
			if cur.SkipTLSVerify != tc.want.skipTLS {
				t.Errorf("SkipTLSVerify = %v, want %v", cur.SkipTLSVerify, tc.want.skipTLS)
			}
		})
	}
}

func TestApplyHotReloadNilNext(t *testing.T) {
	cur := Config{ServerURL: "https://a.example.com"}
	if _, err := cur.ApplyHotReload(nil); err == nil {
		t.Fatal("expected error for nil next, got nil")
	}
}

func equalStringSets(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	seen := make(map[string]bool, len(a))
	for _, s := range a {
		seen[s] = true
	}
	for _, s := range b {
		if !seen[s] {
			return false
		}
	}
	return true
}
