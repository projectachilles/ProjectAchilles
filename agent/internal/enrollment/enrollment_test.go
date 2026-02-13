package enrollment

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestEnrollRejectsHTTPServer(t *testing.T) {
	// http:// to a remote host should be rejected before any network call.
	err := Enroll("http://remote.example.com", "token-abc", t.TempDir()+"/cfg.yaml", "0.1.0")
	if err == nil {
		t.Fatal("expected error for http:// remote server")
	}
	// Error should mention plaintext/refusing
	if got := err.Error(); !contains(got, "refusing to enroll") {
		t.Errorf("unexpected error message: %s", got)
	}
}

func TestEnrollAcceptsHTTPLocalhost(t *testing.T) {
	// http://localhost should pass URL validation (will fail on network, not scheme).
	err := Enroll("http://localhost:9999", "token-abc", t.TempDir()+"/cfg.yaml", "0.1.0")
	if err == nil {
		t.Fatal("expected error (no server), but not a scheme error")
	}
	if got := err.Error(); contains(got, "refusing to enroll") {
		t.Errorf("localhost should not be rejected for scheme: %s", got)
	}
}

func TestEnrollAcceptsHTTPS(t *testing.T) {
	// https:// should pass URL validation (will fail on network, not scheme).
	err := Enroll("https://nonexistent.example.com", "token-abc", t.TempDir()+"/cfg.yaml", "0.1.0")
	if err == nil {
		t.Fatal("expected error (no server), but not a scheme error")
	}
	if got := err.Error(); contains(got, "refusing to enroll") {
		t.Errorf("https should not be rejected for scheme: %s", got)
	}
}

func TestCheckRedirectDowngrade(t *testing.T) {
	// Simulate HTTPS → HTTP redirect via the exported checkRedirectDowngrade.
	httpsReq := &http.Request{URL: mustParseURL("https://server.example.com/step1")}
	httpReq := &http.Request{URL: mustParseURL("http://server.example.com/step2")}

	err := checkRedirectDowngrade(httpReq, []*http.Request{httpsReq})
	if err == nil {
		t.Fatal("expected error for HTTPS→HTTP downgrade")
	}
}

func TestCheckRedirectHTTPSToHTTPS(t *testing.T) {
	// HTTPS → HTTPS redirect should be allowed.
	req1 := &http.Request{URL: mustParseURL("https://server.example.com/step1")}
	req2 := &http.Request{URL: mustParseURL("https://server.example.com/step2")}

	if err := checkRedirectDowngrade(req2, []*http.Request{req1}); err != nil {
		t.Fatalf("HTTPS→HTTPS redirect should be allowed: %v", err)
	}
}

func TestCheckRedirectTooMany(t *testing.T) {
	// More than 10 redirects should be rejected.
	via := make([]*http.Request, 10)
	for i := range via {
		via[i] = &http.Request{URL: mustParseURL("https://server.example.com")}
	}
	next := &http.Request{URL: mustParseURL("https://server.example.com/final")}

	if err := checkRedirectDowngrade(next, via); err == nil {
		t.Fatal("expected error for too many redirects")
	}
}

func TestEnrollRejectsInsecureServerResponse(t *testing.T) {
	// Stand up a local HTTPS-ish test server that returns http:// as server_url.
	// Since httptest.NewServer uses HTTP, we'll use localhost which passes our
	// initial validation, but the response contains a remote http:// URL.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		// Return an http:// remote URL — the agent should reject this.
		_, _ = w.Write([]byte(`{
			"success": true,
			"data": {
				"agent_id": "agent-001",
				"agent_key": "ak_test",
				"org_id": "org-1",
				"server_url": "http://evil.example.com:3000",
				"poll_interval": 30
			}
		}`))
	}))
	defer srv.Close()

	err := Enroll(srv.URL, "token-abc", t.TempDir()+"/cfg.yaml", "0.1.0")
	if err == nil {
		t.Fatal("expected error for insecure server_url in response")
	}
	if got := err.Error(); !contains(got, "server returned insecure URL") {
		t.Errorf("unexpected error message: %s", got)
	}
}

// helpers

func contains(s, substr string) bool {
	return len(s) >= len(substr) && searchString(s, substr)
}

func searchString(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

func mustParseURL(raw string) *url.URL {
	u, err := url.Parse(raw)
	if err != nil {
		panic(err)
	}
	return u
}
