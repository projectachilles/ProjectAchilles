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
	if !isElevated() {
		return fmt.Errorf("install requires administrator/root privileges")
	}
	return platformInstall(configPath)
}

// Uninstall removes the agent system service from the current platform.
func Uninstall() error {
	if !isElevated() {
		return fmt.Errorf("uninstall requires administrator/root privileges")
	}
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
// Passes a nil reload channel — for the reload-capable variant, platform code
// should call runForegroundWithReload directly.
func runForeground(ctx context.Context, cfg *config.Config, st *store.Store, version string) error {
	return runForegroundWithReload(ctx, cfg, st, version, nil)
}

// runForegroundWithReload is the same as runForeground but accepts a reload
// channel. Each receive on `reloadCh` triggers an in-place YAML re-read and
// hot-reload of mutable config fields. Pass nil to disable hot-reload.
func runForegroundWithReload(ctx context.Context, cfg *config.Config, st *store.Store, version string, reloadCh <-chan struct{}) error {
	if err := poller.Run(ctx, cfg, st, version, reloadCh); err != nil {
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
