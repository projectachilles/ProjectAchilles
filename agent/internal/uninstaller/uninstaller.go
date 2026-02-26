package uninstaller

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"runtime"
	"time"

	"github.com/f0rt1ka/achilles-agent/internal/config"
	"github.com/f0rt1ka/achilles-agent/internal/executor"
	"github.com/f0rt1ka/achilles-agent/internal/httpclient"
	"github.com/f0rt1ka/achilles-agent/internal/reporter"
)

// ErrUninstallInitiated is returned from Execute when the uninstall has been
// initiated successfully and the agent should exit.
var ErrUninstallInitiated = errors.New("uninstall initiated, agent exiting")

// Execute handles an uninstall task in two phases:
//
//  1. Report "uninstall initiated" result back to the server (so the backend
//     marks the agent as uninstalled before auth is revoked).
//  2. Perform platform-specific cleanup (stop service, optionally delete files).
//
// The cleanup parameter controls whether files are deleted (true = full cleanup,
// false = soft-delete: stop service only, leave files for inspection).
func Execute(ctx context.Context, client *httpclient.Client, task executor.Task, cfg *config.Config) error {
	cleanup := task.Payload.Command == "cleanup"

	log.Printf("[uninstaller] starting uninstall (cleanup=%v)", cleanup)

	// Phase 1: Report result to backend before performing destructive actions.
	// This ensures the backend marks the agent as 'uninstalled' while auth still works.
	result := &executor.Result{
		TaskID:              task.ID,
		ExitCode:            0,
		Stdout:              "uninstall initiated",
		StartedAt:           time.Now().UTC().Format(time.RFC3339),
		CompletedAt:         time.Now().UTC().Format(time.RFC3339),
		ExecutionDurationMs: 0,
		Hostname:            hostname(),
		OS:                  runtime.GOOS,
		Arch:                runtime.GOARCH,
	}

	if err := reporter.Report(ctx, client, task.ID, result); err != nil {
		return fmt.Errorf("uninstall phase 1 (report) failed: %w", err)
	}

	log.Println("[uninstaller] phase 1 complete: result reported to backend")

	// Phase 2: Platform-specific cleanup.
	workDir := defaultWorkDir()
	binPath, _ := os.Executable()

	if err := platformCleanup(workDir, binPath, cfg, cleanup); err != nil {
		log.Printf("[uninstaller] cleanup error (non-fatal): %v", err)
	}

	return ErrUninstallInitiated
}

// defaultWorkDir returns the platform default work directory.
func defaultWorkDir() string {
	if runtime.GOOS == "windows" {
		return `C:\F0`
	}
	return "/opt/f0"
}

func hostname() string {
	h, _ := os.Hostname()
	return h
}
