package service

import (
	"context"
	"fmt"
	"log"

	"github.com/f0rt1ka/achilles-agent/internal/config"
	"github.com/f0rt1ka/achilles-agent/internal/poller"
	"github.com/f0rt1ka/achilles-agent/internal/store"
)

// Status describes the current state of the agent system service.
type Status struct {
	Installed bool
	Running   bool
	PID       int // 0 if unknown or not running
}

// Install registers the agent as a system service on the current platform.
func Install(configPath string) error {
	return platformInstall(configPath)
}

// Uninstall removes the agent system service from the current platform.
func Uninstall() error {
	return platformUninstall()
}

// ServiceStatus queries the platform service manager for the agent's current state.
func ServiceStatus() Status {
	return platformServiceStatus()
}

// RunService starts the agent as a system service (Windows) or directly (Linux).
func RunService(cfg *config.Config, st *store.Store, version string) error {
	return platformRun(cfg, st, version)
}

// runForeground is shared logic: starts the poller loop until context cancels.
func runForeground(ctx context.Context, cfg *config.Config, st *store.Store, version string) error {
	if err := poller.Run(ctx, cfg, st, version); err != nil {
		if err == poller.ErrUpdateApplied {
			log.Println("update applied, exiting for restart")
			return poller.ErrUpdateApplied
		}
		if err == poller.ErrUninstallInitiated {
			log.Println("uninstall initiated, exiting")
			return poller.ErrUninstallInitiated
		}
		if err != context.Canceled {
			return fmt.Errorf("agent error: %w", err)
		}
	}
	return nil
}
