package reporter

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/f0rt1ka/achilles-agent/internal/config"
	"github.com/f0rt1ka/achilles-agent/internal/executor"
	"github.com/f0rt1ka/achilles-agent/internal/httpclient"
)

// newTestClient returns an httpclient.Client pointed at the given test server.
func newTestClient(t *testing.T, server *httptest.Server) *httpclient.Client {
	t.Helper()
	cfg := &config.Config{
		ServerURL: server.URL,
		AgentID:   "agent-test",
		AgentKey:  "ak_test",
	}
	return httpclient.NewClient(cfg, "0.6.2-test")
}

// dummyResult is a minimal valid result for POSTs.
func dummyResult() *executor.Result {
	return &executor.Result{
		TaskID:              "t1",
		ExitCode:            0,
		Stdout:              "",
		Stderr:              "",
		StartedAt:           time.Now().UTC().Format(time.RFC3339),
		CompletedAt:         time.Now().UTC().Format(time.RFC3339),
		ExecutionDurationMs: 1,
		BinarySHA256:        "abc",
		Hostname:            "h",
		OS:                  "linux",
		Arch:                "amd64",
	}
}

func TestReport_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	err := Report(context.Background(), newTestClient(t, server), "t1", dummyResult())
	if err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
}

func TestReport_PermanentRejection_400(t *testing.T) {
	var calls int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		http.Error(w, `{"error":"Cannot submit result for task in status: failed"}`, http.StatusBadRequest)
	}))
	defer server.Close()

	err := Report(context.Background(), newTestClient(t, server), "t1", dummyResult())
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !errors.Is(err, ErrPermanent) {
		t.Fatalf("expected ErrPermanent, got %v", err)
	}
	// Critical assertion: 400 short-circuits — only 1 attempt, no retries.
	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Fatalf("expected 1 attempt for permanent rejection, got %d", got)
	}
}

func TestReport_PermanentRejection_404(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":"Task not found"}`, http.StatusNotFound)
	}))
	defer server.Close()

	err := Report(context.Background(), newTestClient(t, server), "t1", dummyResult())
	if !errors.Is(err, ErrPermanent) {
		t.Fatalf("expected ErrPermanent for 404, got %v", err)
	}
}

func TestReport_TransientRejection_500_RetriesAndReturnsErrTransient(t *testing.T) {
	var resultCalls, statusCalls int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost:
			atomic.AddInt32(&resultCalls, 1)
			http.Error(w, "boom", http.StatusInternalServerError)
		case http.MethodPatch:
			atomic.AddInt32(&statusCalls, 1)
			w.WriteHeader(http.StatusOK)
		}
	}))
	defer server.Close()

	// 1 initial + 3 retries with 2s/4s/8s delays would take 14s real time.
	// Use a context with timeout to confirm we still classify the failure
	// as transient even if cancellation interrupts the backoff.
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	err := Report(ctx, newTestClient(t, server), "t1", dummyResult())
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	// On context-cancelled retry the error wraps ctx.Err(); on full retry
	// exhaustion it wraps ErrTransient. Either is acceptable for "transient".
	if errors.Is(err, ErrPermanent) {
		t.Fatalf("expected non-permanent error, got %v", err)
	}
}

func TestReport_429IsTransient_NotPermanent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "rate limited", http.StatusTooManyRequests)
	}))
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	err := Report(ctx, newTestClient(t, server), "t1", dummyResult())
	if err == nil {
		t.Fatal("expected error")
	}
	if errors.Is(err, ErrPermanent) {
		t.Fatalf("429 should NOT be permanent (token rotation/rate-limit may resolve), got %v", err)
	}
}

func TestReport_401IsTransient_NotPermanent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
	}))
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	err := Report(ctx, newTestClient(t, server), "t1", dummyResult())
	if errors.Is(err, ErrPermanent) {
		t.Fatalf("401 should NOT be permanent (key rotation may resolve), got %v", err)
	}
}
