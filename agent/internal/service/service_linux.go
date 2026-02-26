//go:build linux

package service

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"

	"github.com/f0rt1ka/achilles-agent/internal/config"
	"github.com/f0rt1ka/achilles-agent/internal/store"
)

const (
	unitName = "achilles-agent.service"
	unitPath = "/etc/systemd/system/" + unitName
)

const unitTemplate = `[Unit]
Description=Achilles Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=%s --run
Restart=always
RestartSec=10
WorkingDirectory=%s

[Install]
WantedBy=multi-user.target
`

func platformServiceStatus() Status {
	var s Status

	// Check if installed by looking for the unit file.
	if _, err := os.Stat(unitPath); err == nil {
		s.Installed = true
	}

	// Check if active via systemctl.
	out, err := exec.Command("systemctl", "is-active", unitName).Output()
	if err == nil && strings.TrimSpace(string(out)) == "active" {
		s.Running = true
	}

	// Get MainPID from systemctl show.
	out, err = exec.Command("systemctl", "show", "--property=MainPID", unitName).Output()
	if err == nil {
		// Output is "MainPID=12345\n"
		line := strings.TrimSpace(string(out))
		if after, ok := strings.CutPrefix(line, "MainPID="); ok {
			if pid, err := strconv.Atoi(after); err == nil && pid > 0 {
				s.PID = pid
			}
		}
	}

	return s
}

func platformInstall(configPath string) error {
	execPath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("cannot determine executable path: %w", err)
	}
	execPath, err = filepath.EvalSymlinks(execPath)
	if err != nil {
		return fmt.Errorf("cannot resolve executable path: %w", err)
	}
	workDir := filepath.Dir(execPath)

	// Harden the binary — only root needs read/execute. The admin may have
	// placed it with 0755 (world-executable) from the download.
	if err := os.Chmod(execPath, 0700); err != nil {
		return fmt.Errorf("chmod binary: %w", err)
	}

	unit := fmt.Sprintf(unitTemplate, execPath, workDir)
	if err := os.WriteFile(unitPath, []byte(unit), 0644); err != nil {
		return fmt.Errorf("failed to write unit file: %w", err)
	}

	cmds := [][]string{
		{"systemctl", "daemon-reload"},
		{"systemctl", "enable", unitName},
		{"systemctl", "start", unitName},
	}
	for _, args := range cmds {
		cmd := exec.Command(args[0], args[1:]...)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("command %v failed: %w", args, err)
		}
	}

	fmt.Println("Service installed and started")
	return nil
}

func platformUninstall() error {
	cmds := [][]string{
		{"systemctl", "stop", unitName},
		{"systemctl", "disable", unitName},
	}
	for _, args := range cmds {
		cmd := exec.Command(args[0], args[1:]...)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		// Ignore errors (service may already be stopped)
		_ = cmd.Run()
	}

	if err := os.Remove(unitPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove unit file: %w", err)
	}

	cmd := exec.Command("systemctl", "daemon-reload")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	_ = cmd.Run()

	fmt.Println("Service uninstalled")
	return nil
}

func platformRun(cfg *config.Config, st *store.Store, version string) error {
	// On Linux, systemd manages the lifecycle. Just run the poller directly.
	ctx, cancel := signalContext()
	defer cancel()
	return runForeground(ctx, cfg, st, version)
}

// signalContext returns a context that cancels on SIGINT/SIGTERM.
func signalContext() (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithCancel(context.Background())
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	go func() {
		select {
		case <-sigCh:
			cancel()
		case <-ctx.Done():
		}
	}()
	return ctx, cancel
}
