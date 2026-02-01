//go:build windows

package service

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/f0rt1ka/achilles-agent/internal/config"
	"github.com/f0rt1ka/achilles-agent/internal/store"
)

const (
	serviceName    = "AchillesAgent"
	serviceDisplay = "Achilles Agent"
	serviceDesc    = "F0RT1KA Achilles security testing agent"
)

func platformInstall(configPath string) error {
	execPath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("cannot determine executable path: %w", err)
	}
	execPath, err = filepath.EvalSymlinks(execPath)
	if err != nil {
		return fmt.Errorf("cannot resolve executable path: %w", err)
	}

	// Use sc.exe to create and start the service.
	binPath := fmt.Sprintf(`"%s" --run`, execPath)
	cmd := exec.Command("sc", "create", serviceName,
		"binPath=", binPath,
		"DisplayName=", serviceDisplay,
		"start=", "auto",
	)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("sc create failed: %w", err)
	}

	// Set description.
	cmd = exec.Command("sc", "description", serviceName, serviceDesc)
	_ = cmd.Run()

	// Configure recovery: restart after 10 seconds on failure.
	cmd = exec.Command("sc", "failure", serviceName,
		"reset=", "86400",
		"actions=", "restart/10000/restart/10000/restart/10000",
	)
	_ = cmd.Run()

	// Start the service.
	cmd = exec.Command("sc", "start", serviceName)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("sc start failed: %w", err)
	}

	fmt.Println("Service installed and started")
	return nil
}

func platformUninstall() error {
	// Stop the service first.
	cmd := exec.Command("sc", "stop", serviceName)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	_ = cmd.Run()

	// Give it a moment to stop.
	time.Sleep(2 * time.Second)

	// Delete the service.
	cmd = exec.Command("sc", "delete", serviceName)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("sc delete failed: %w", err)
	}

	fmt.Println("Service uninstalled")
	return nil
}

func platformRun(cfg *config.Config, st *store.Store, version string) error {
	// On Windows, when run as a service the SCM expects the process to stay alive.
	// The --run flag runs the poller directly; the service controller manages lifecycle.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	return runForeground(ctx, cfg, st, version)
}
