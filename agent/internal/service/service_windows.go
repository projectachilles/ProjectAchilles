//go:build windows

package service

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"golang.org/x/sys/windows/svc"

	"github.com/f0rt1ka/achilles-agent/internal/config"
	"github.com/f0rt1ka/achilles-agent/internal/poller"
	"github.com/f0rt1ka/achilles-agent/internal/store"
)

const (
	serviceName    = "AchillesAgent"
	serviceDisplay = "Achilles Agent"
	serviceDesc    = "F0RT1KA Achilles security testing agent"
)

// achillesSvc implements svc.Handler for the Windows Service Control Manager.
type achillesSvc struct {
	cfg     *config.Config
	st      *store.Store
	version string
}

func (s *achillesSvc) Execute(_ []string, r <-chan svc.ChangeRequest, status chan<- svc.Status) (bool, uint32) {
	const accepted = svc.AcceptStop | svc.AcceptShutdown

	// Tell SCM we're starting.
	status <- svc.Status{State: svc.StartPending}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Run the poller in the background.
	errCh := make(chan error, 1)
	go func() {
		errCh <- runForeground(ctx, s.cfg, s.st, s.version)
	}()

	// Tell SCM we're running.
	status <- svc.Status{State: svc.Running, Accepts: accepted}

	for {
		select {
		case cr := <-r:
			switch cr.Cmd {
			case svc.Stop, svc.Shutdown:
				status <- svc.Status{State: svc.StopPending}
				cancel()
				<-errCh
				return false, 0
			case svc.Interrogate:
				status <- cr.CurrentStatus
			}
		case err := <-errCh:
			if err != nil {
				if errors.Is(err, poller.ErrUpdateApplied) {
					// Ensure SCM recovery actions are configured before
					// exiting — the initial sc failure during install may
					// have silently failed, leaving no recovery actions.
					ensureRecoveryActions()
					// Schedule a fallback restart via Task Scheduler in
					// case SCM recovery doesn't trigger (exhausted failure
					// counter, misconfigured recovery, etc.).
					scheduleFallbackRestart()
				}
				return false, 1
			}
			return false, 0
		}
	}
}

// ensureRecoveryActions re-configures SCM failure recovery actions right
// before an update exit. This guarantees the service will restart even if
// the initial "sc failure" during install silently failed.
func ensureRecoveryActions() {
	cmd := exec.Command("sc", "failure", serviceName,
		"reset=", "86400",
		"actions=", "restart/5000/restart/5000/restart/5000",
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		log.Printf("warning: failed to configure SCM recovery: %v: %s", err, out)
	} else {
		log.Println("SCM recovery actions configured for restart after update")
	}

	// Enable recovery actions on clean exits (non-crash). Without this flag
	// SCM only triggers recovery when the service crashes — a clean stop
	// with non-zero exit code (which is what svc.Run produces) is ignored.
	cmd = exec.Command("sc", "failureflag", serviceName, "1")
	if out, err := cmd.CombinedOutput(); err != nil {
		log.Printf("warning: failed to set failureflag: %v: %s", err, out)
	}
}

// scheduleFallbackRestart creates a one-time Windows Scheduled Task that
// restarts the service ~2 minutes from now. This is a belt-and-suspenders
// fallback in case SCM recovery doesn't fire (exhausted failure counter,
// job object kills child processes, etc.). The task self-deletes after running.
// If SCM recovery already restarted the service, the "sc start" is a harmless
// no-op on an already-running service.
func scheduleFallbackRestart() {
	when := time.Now().Add(2 * time.Minute)
	taskName := "AchillesAgentRestart"
	// The /TR command restarts the service and then deletes the scheduled task.
	tr := fmt.Sprintf(`cmd.exe /C "sc start %s & schtasks /Delete /TN %s /F"`, serviceName, taskName)

	cmd := exec.Command("schtasks", "/Create",
		"/TN", taskName,
		"/TR", tr,
		"/SC", "ONCE",
		"/SD", when.Format("01/02/2006"),
		"/ST", when.Format("15:04"),
		"/F",
		"/RU", "SYSTEM",
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		log.Printf("warning: failed to schedule fallback restart: %v: %s", err, out)
	} else {
		log.Printf("fallback restart scheduled via Task Scheduler at %s", when.Format("15:04"))
	}
}

func platformServiceStatus() Status {
	var s Status

	// Run "sc query AchillesAgent" and parse the output.
	out, err := exec.Command("sc", "queryex", serviceName).CombinedOutput()
	if err != nil {
		// sc query returns non-zero if the service doesn't exist.
		return s
	}

	s.Installed = true

	// Parse STATE line, e.g. "        STATE              : 4  RUNNING"
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "STATE") {
			s.Running = strings.Contains(line, "RUNNING")
		}
		if strings.HasPrefix(line, "PID") {
			// "        PID                : 12345"
			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 {
				if pid, err := strconv.Atoi(strings.TrimSpace(parts[1])); err == nil && pid > 0 {
					s.PID = pid
				}
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

	// Remove any existing service to make install idempotent.
	_ = exec.Command("sc", "stop", serviceName).Run()
	_ = exec.Command("sc", "delete", serviceName).Run()
	time.Sleep(1 * time.Second)

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

	// Harden the binary — restrict to SYSTEM and Administrators only.
	// The admin may have placed it with inherited permissions from the
	// download directory, allowing any local user to read/execute it.
	aclCmd := exec.Command("icacls", execPath,
		"/inheritance:r",
		"/grant:r", "NT AUTHORITY\\SYSTEM:(RX)",
		"/grant:r", "BUILTIN\\Administrators:(F)",
	)
	if out, err := aclCmd.CombinedOutput(); err != nil {
		fmt.Fprintf(os.Stderr, "warning: icacls on binary failed: %v: %s\n", err, out)
	}

	// Set description.
	cmd = exec.Command("sc", "description", serviceName, serviceDesc)
	_ = cmd.Run()

	// Configure recovery: restart after 10 seconds on failure.
	cmd = exec.Command("sc", "failure", serviceName,
		"reset=", "86400",
		"actions=", "restart/10000/restart/10000/restart/10000",
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		fmt.Fprintf(os.Stderr, "warning: sc failure configuration failed: %v: %s\n", err, out)
	}

	// Enable recovery actions on clean exits. By default SCM only triggers
	// recovery on crashes; the agent exits cleanly via svc.Run after updates.
	cmd = exec.Command("sc", "failureflag", serviceName, "1")
	if out, err := cmd.CombinedOutput(); err != nil {
		fmt.Fprintf(os.Stderr, "warning: sc failureflag failed: %v: %s\n", err, out)
	}

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
	// Detect whether we're running under the Windows SCM or interactively.
	inService, err := svc.IsWindowsService()
	if err != nil {
		return fmt.Errorf("failed to detect service environment: %w", err)
	}

	if !inService {
		// Interactive / foreground mode (e.g. --run from command line).
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		return runForeground(ctx, cfg, st, version)
	}

	// Running under SCM — register as a proper Windows service.
	return svc.Run(serviceName, &achillesSvc{
		cfg:     cfg,
		st:      st,
		version: version,
	})
}
