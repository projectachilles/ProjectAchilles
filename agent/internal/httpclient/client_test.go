package httpclient

import (
	"context"
	"errors"
	"io"
	"net"
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

// TestDoStreamSucceedsBeyondQuickTimeout verifies that DoStream is not
// subject to the 30s Client.Timeout that bounds Do(). We use a body read
// that takes longer than the quick client's timeout would allow per chunk
// (in real life, this is "downloading 50MB on a slow link"). We don't
// actually wait 30+ seconds in CI — instead we prove the structural
// difference: the streaming client returns the full body when given a
// generous context, while the quick client would hit Client.Timeout if
// the same body trickle exceeded its budget.
func TestDoStreamReceivesFullBodyWithSlowChunks(t *testing.T) {
	// Server flushes headers quickly, then drips body in 5 chunks 50ms apart.
	// Total body time: ~250ms. Well under both timeouts; this just exercises
	// the streaming path end-to-end.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		w.WriteHeader(http.StatusOK)
		flusher, _ := w.(http.Flusher)
		for i := 0; i < 5; i++ {
			_, _ = w.Write([]byte("chunk"))
			flusher.Flush()
			time.Sleep(50 * time.Millisecond)
		}
	}))
	defer srv.Close()

	cfg := &config.Config{
		ServerURL: srv.URL,
		AgentID:   "agent-test",
		AgentKey:  "ak_test",
	}
	client := NewClient(cfg, "0.1.0-test")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	resp, err := client.DoStream(ctx, "GET", "/binary", nil)
	if err != nil {
		t.Fatalf("DoStream failed: %v", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read streamed body: %v", err)
	}
	if string(body) != "chunkchunkchunkchunkchunk" {
		t.Errorf("unexpected body: %q", body)
	}
}

// TestDoStreamRespectsContextCancel proves the streaming client is governed
// by the caller's context (not a hardcoded Client.Timeout). The server hangs
// mid-body forever; only context cancellation should free the goroutine.
func TestDoStreamRespectsContextCancel(t *testing.T) {
	// Server writes header + one chunk, then blocks indefinitely with a
	// channel the test owns, so we deterministically control when the body
	// stalls.
	hold := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		w.WriteHeader(http.StatusOK)
		if flusher, ok := w.(http.Flusher); ok {
			_, _ = w.Write([]byte("partial"))
			flusher.Flush()
		}
		<-hold // never closes during the test
	}))
	defer func() {
		close(hold)
		srv.Close()
	}()

	cfg := &config.Config{
		ServerURL: srv.URL,
		AgentID:   "agent-test",
		AgentKey:  "ak_test",
	}
	client := NewClient(cfg, "0.1.0-test")

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	resp, err := client.DoStream(ctx, "GET", "/binary", nil)
	if err != nil {
		// Some platforms surface ctx error from DoStream itself.
		if !isContextError(err) {
			t.Fatalf("unexpected error from DoStream: %v", err)
		}
		return
	}
	defer resp.Body.Close()

	start := time.Now()
	_, readErr := io.ReadAll(resp.Body)
	elapsed := time.Since(start)

	if readErr == nil {
		t.Fatal("expected body read to fail when context cancels mid-stream")
	}
	if !isContextError(readErr) {
		t.Errorf("expected context-related error, got: %v", readErr)
	}
	// Should fail near the 200ms ctx deadline, not the 30s quick-client budget.
	if elapsed > 5*time.Second {
		t.Errorf("body read took %v — context cancel did not propagate quickly", elapsed)
	}
}

// TestDoStreamHeaderTimeoutEngages verifies the Transport.ResponseHeaderTimeout
// safety net. A server that accepts the TCP connection but never writes
// headers must fail fast — without this safety, removing Client.Timeout
// would create a worse failure mode (silent forever-hang) than the bug fix.
func TestDoStreamHeaderTimeoutEngages(t *testing.T) {
	// Raw TCP listener that accepts but never writes a response.
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer listener.Close()

	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			// Hold the connection open without writing anything.
			go func(c net.Conn) {
				defer c.Close()
				time.Sleep(60 * time.Second)
			}(conn)
		}
	}()

	cfg := &config.Config{
		ServerURL: "http://" + listener.Addr().String(),
		AgentID:   "agent-test",
		AgentKey:  "ak_test",
	}
	client := NewClient(cfg, "0.1.0-test")

	// Override the streaming transport to a much shorter header timeout so
	// the test runs quickly. We're testing that the field is wired through,
	// not the production value.
	client.httpStream.Transport.(*http.Transport).ResponseHeaderTimeout = 100 * time.Millisecond

	// Tight context — proves ctx caps total time and the header timeout
	// engages within one retry attempt (rather than hanging indefinitely
	// the way a streaming client without ResponseHeaderTimeout would).
	ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()

	start := time.Now()
	_, err = client.DoStream(ctx, "GET", "/binary", nil)
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("expected ResponseHeaderTimeout / ctx to fire")
	}
	// Without ResponseHeaderTimeout, removing Client.Timeout would hang
	// indefinitely on this stalled server. Anything well under 5s confirms
	// the header timeout (or ctx) freed the goroutine quickly.
	if elapsed > 3*time.Second {
		t.Errorf("ResponseHeaderTimeout did not engage — took %v", elapsed)
	}
}

// isContextError returns true if err is or wraps context.Canceled / context.DeadlineExceeded.
func isContextError(err error) bool {
	return errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)
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
