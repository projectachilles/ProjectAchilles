package httpclient

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/f0rt1ka/achilles-agent/internal/config"
)

func TestClientSetsTimestampHeader(t *testing.T) {
	var capturedTimestamp string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedTimestamp = r.Header.Get("X-Request-Timestamp")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"success":true}`))
	}))
	defer srv.Close()

	cfg := &config.Config{
		ServerURL: srv.URL,
		AgentID:   "agent-test",
		AgentKey:  "ak_test",
	}

	client := NewClient(cfg, "0.1.0-test")
	resp, err := client.Do(context.Background(), "GET", "/test", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	resp.Body.Close()

	if capturedTimestamp == "" {
		t.Fatal("X-Request-Timestamp header was not set")
	}

	// Verify it's valid RFC3339 and recent (within 5 seconds)
	ts, err := time.Parse(time.RFC3339, capturedTimestamp)
	if err != nil {
		t.Fatalf("X-Request-Timestamp %q is not valid RFC3339: %v", capturedTimestamp, err)
	}
	age := time.Since(ts)
	if age > 5*time.Second || age < -5*time.Second {
		t.Errorf("timestamp age %v is not within ±5s of now", age)
	}
}

func TestRedirectDowngradeBlocked(t *testing.T) {
	// Set up an HTTP server that the HTTPS server will redirect to.
	httpSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"success":true}`))
	}))
	defer httpSrv.Close()

	// Set up an HTTPS server that redirects to the HTTP server.
	httpsSrv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, httpSrv.URL+"/downgraded", http.StatusFound)
	}))
	defer httpsSrv.Close()

	cfg := &config.Config{
		ServerURL:     httpsSrv.URL,
		AgentID:       "agent-test",
		AgentKey:      "ak_test",
		SkipTLSVerify: true, // test server uses self-signed cert
	}

	client := NewClient(cfg, "0.1.0-test")

	_, err := client.Do(context.Background(), "GET", "/test", nil)
	if err == nil {
		t.Fatal("expected error for HTTPS→HTTP redirect downgrade")
	}
	if !strings.Contains(err.Error(), "HTTPS to HTTP downgrade") {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestHTTPSToHTTPSRedirectAllowed(t *testing.T) {
	// Set up an HTTPS server that handles the final request.
	finalSrv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"success":true}`))
	}))
	defer finalSrv.Close()

	// Set up a single HTTPS server that redirects /start → /final (same host).
	var redirectSrvURL string
	redirectSrv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/final" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"success":true}`))
			return
		}
		http.Redirect(w, r, redirectSrvURL+"/final", http.StatusFound)
	}))
	defer redirectSrv.Close()
	redirectSrvURL = redirectSrv.URL

	cfg := &config.Config{
		ServerURL:     redirectSrv.URL,
		AgentID:       "agent-test",
		AgentKey:      "ak_test",
		SkipTLSVerify: true,
	}

	client := NewClient(cfg, "0.1.0-test")

	resp, err := client.Do(context.Background(), "GET", "/start", nil)
	if err != nil {
		t.Fatalf("HTTPS→HTTPS redirect should be allowed: %v", err)
	}
	resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
}
