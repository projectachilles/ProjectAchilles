package service

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"

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

// CanonicalBinaryPath is where the installed agent binary lives (see
// config.DefaultBinaryPath).
func CanonicalBinaryPath() string {
	return config.DefaultBinaryPath()
}

// Install copies the running agent binary to CanonicalBinaryPath (unless it is
// already running from there) and registers that copy as the system service.
// The binary is copied, never moved: the file that was run is left where it
// was. If the copy fails nothing is registered and any existing service is
// left untouched.
func Install(configPath string) error {
	if !isElevated() {
		return fmt.Errorf("install requires administrator/root privileges")
	}
	if _, err := os.Stat(configPath); err != nil {
		return fmt.Errorf("agent is not enrolled (%v): run with --enroll TOKEN --server URL --install", err)
	}

	src, err := os.Executable()
	if err != nil {
		return fmt.Errorf("cannot determine executable path: %w", err)
	}
	if src, err = filepath.EvalSymlinks(src); err != nil {
		return fmt.Errorf("cannot resolve executable path: %w", err)
	}
	dst := CanonicalBinaryPath()
	inPlace := sameFile(src, dst)

	// Secure the agent folder before the binary lands in it: refuse a folder a
	// non-administrator (non-root) created, lock it, check its owner again.
	if err := PrepareInstallDir(); err != nil {
		return fmt.Errorf("%w; service not installed", err)
	}

	// A binary already in place but owned by someone else (e.g. planted before
	// the folder was locked) is rewritten as a new file rather than trusted.
	force := false
	if _, err := os.Lstat(dst); err == nil && config.CheckTrustedOwner(dst) != nil {
		force = true
	}

	copied, err := placeBinary(src, dst, force)
	if err != nil {
		return fmt.Errorf("could not copy the agent to %s: %w; service not installed", dst, err)
	}
	if copied {
		fmt.Printf("Copied the agent to %s\n", dst)
	}

	err = platformInstall(configPath, dst)
	if copied {
		if inPlace {
			// The set-aside file is this process's own image (it was rewritten
			// because of its owner), so Windows won't delete it until this
			// process exits; the agent removes it when it starts.
			_ = os.Remove(dst + replacedSuffix)
			fmt.Printf("Rewrote %s as a new file.\n", dst)
		} else {
			removeReplaced(dst)
			if err == nil {
				fmt.Printf("The service runs %s. %s is no longer used and can be deleted.\n", dst, src)
			}
		}
	}
	return err
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
