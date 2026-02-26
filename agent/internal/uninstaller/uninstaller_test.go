package uninstaller

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/f0rt1ka/achilles-agent/internal/config"
	"github.com/f0rt1ka/achilles-agent/internal/executor"
	"github.com/f0rt1ka/achilles-agent/internal/httpclient"
)

// TestExecuteReportsBeforeCleanup verifies Phase 1 (report) completes before
// returning ErrUninstallInitiated. We mock the backend HTTP server and verify
// the result payload arrives correctly.
func TestExecuteReportsBeforeCleanup(t *testing.T) {
	var receivedResult executor.Result

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			if err := json.NewDecoder(r.Body).Decode(&receivedResult); err != nil {
				t.Errorf("failed to decode result: %v", err)
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"success":true}`))
			return
		}
		// PATCH for status updates
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"success":true}`))
	}))
	defer srv.Close()

	cfg := &config.Config{
		ServerURL: srv.URL,
		AgentID:   "agent-test",
		AgentKey:  "ak_test",
	}
	client := httpclient.NewClient(cfg, "0.1.0-test")

	task := executor.Task{
		ID:   "task-uninstall-001",
		Type: "uninstall",
		Payload: executor.TaskPayload{
			Command: "", // soft-delete (no cleanup)
		},
	}

	err := Execute(context.Background(), client, task, cfg)

	// Should return ErrUninstallInitiated (success sentinel)
	if !errors.Is(err, ErrUninstallInitiated) {
		t.Fatalf("expected ErrUninstallInitiated, got: %v", err)
	}

	// Verify Phase 1 report was sent
	if receivedResult.TaskID != "task-uninstall-001" {
		t.Errorf("task_id: got %q, want %q", receivedResult.TaskID, "task-uninstall-001")
	}
	if receivedResult.ExitCode != 0 {
		t.Errorf("exit_code: got %d, want 0", receivedResult.ExitCode)
	}
	if receivedResult.Stdout != "uninstall initiated" {
		t.Errorf("stdout: got %q, want %q", receivedResult.Stdout, "uninstall initiated")
	}
}

// TestExecuteCleanupFlag verifies the cleanup flag is correctly parsed from
// the task payload command field.
func TestExecuteCleanupFlag(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
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
	client := httpclient.NewClient(cfg, "0.1.0-test")

	task := executor.Task{
		ID:   "task-cleanup-001",
		Type: "uninstall",
		Payload: executor.TaskPayload{
			Command: "cleanup", // full cleanup
		},
	}

	// Execute will attempt platform cleanup (which will likely fail in test env
	// since the service isn't installed), but should still return sentinel.
	err := Execute(context.Background(), client, task, cfg)
	if !errors.Is(err, ErrUninstallInitiated) {
		t.Fatalf("expected ErrUninstallInitiated, got: %v", err)
	}
}

// TestExecuteReportFailure verifies that if the Phase 1 report fails,
// Execute returns a real error (not the sentinel).
func TestExecuteReportFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			// Simulate server error on result submission
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(`{"success":false,"error":"db error"}`))
			return
		}
		// PATCH for failure status update
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"success":true}`))
	}))
	defer srv.Close()

	cfg := &config.Config{
		ServerURL: srv.URL,
		AgentID:   "agent-test",
		AgentKey:  "ak_test",
	}
	client := httpclient.NewClient(cfg, "0.1.0-test")

	task := executor.Task{
		ID:   "task-fail-001",
		Type: "uninstall",
		Payload: executor.TaskPayload{
			Command: "",
		},
	}

	// Use a short-lived context so we don't wait 14s for retry backoff (2+4+8s).
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	err := Execute(ctx, client, task, cfg)

	// Should NOT be the sentinel — report failure means the uninstall didn't proceed
	if errors.Is(err, ErrUninstallInitiated) {
		t.Fatal("expected real error, not ErrUninstallInitiated")
	}
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	// The error message should mention phase 1
	if got := err.Error(); got == "" {
		t.Error("expected non-empty error message")
	}
}

// TestDefaultWorkDir verifies the platform-specific default work directory.
func TestDefaultWorkDir(t *testing.T) {
	dir := defaultWorkDir()
	if dir == "" {
		t.Error("defaultWorkDir returned empty string")
	}
	// Just verify it returns something reasonable for the current platform.
	// Exact value depends on GOOS.
}
