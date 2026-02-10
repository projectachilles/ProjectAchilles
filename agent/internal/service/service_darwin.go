//go:build darwin

package service

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/f0rt1ka/achilles-agent/internal/config"
	"github.com/f0rt1ka/achilles-agent/internal/store"
)

const (
	plistLabel = "com.f0rtika.achilles-agent"
	plistPath  = "/Library/LaunchDaemons/" + plistLabel + ".plist"
)

const plistTemplate = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>%s</string>
	<key>ProgramArguments</key>
	<array>
		<string>%s</string>
		<string>--run</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>WorkingDirectory</key>
	<string>%s</string>
	<key>StandardOutPath</key>
	<string>/var/log/achilles-agent.log</string>
	<key>StandardErrorPath</key>
	<string>/var/log/achilles-agent.err</string>
</dict>
</plist>
`

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

	plist := fmt.Sprintf(plistTemplate, plistLabel, execPath, workDir)
	if err := os.WriteFile(plistPath, []byte(plist), 0644); err != nil {
		return fmt.Errorf("failed to write plist file: %w", err)
	}

	cmd := exec.Command("launchctl", "load", "-w", plistPath)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("launchctl load failed: %w", err)
	}

	fmt.Println("Service installed and started")
	return nil
}

func platformUninstall() error {
	cmd := exec.Command("launchctl", "unload", plistPath)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	// Ignore errors (service may already be unloaded)
	_ = cmd.Run()

	if err := os.Remove(plistPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove plist file: %w", err)
	}

	fmt.Println("Service uninstalled")
	return nil
}

func platformRun(cfg *config.Config, st *store.Store, version string) error {
	// On macOS, launchd manages the lifecycle. Just run the poller directly.
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
